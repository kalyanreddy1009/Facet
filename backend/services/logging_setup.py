"""Logging, an in-memory error ring buffer, and per-endpoint request metrics.

Everything the /api/status dashboard shows about *this process* is collected
here: the last N warnings/errors (a deque, not a file re-read) and latency
histograms keyed by route template. Nothing is persisted — a restart starts
the counters over, which is the correct semantics for "how is the running
process doing".
"""

from __future__ import annotations

import logging
import logging.handlers
import time
import traceback
from collections import defaultdict, deque
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware

from services.paths import DATA_DIR

# Host-wide, deliberately: one process, one log an operator can tail.
# Not paths.LOG_PATH, which follows the current user.
LOG_DIR = DATA_DIR / "logs"
LOG_PATH = LOG_DIR / "facet.log"

RING_SIZE = 200
LATENCY_SAMPLES = 500

LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")

_configured = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class _UTCFormatter(logging.Formatter):
    """Timestamps as UTC ISO-8601 — the same shape the API serializes."""

    def formatTime(self, record, datefmt=None):  # noqa: N802 (stdlib name)
        return datetime.fromtimestamp(record.created, timezone.utc).isoformat()


# asyncio's Proactor loop on Windows logs an ERROR every time a client drops a
# connection mid-response — a browser tab closing, a navigation, a dev-server
# reload. It is not an application fault, but it lands at ERROR level, so
# without this the status dashboard fills up with red entries that mean
# nothing and mask the real ones.
_BENIGN_PATTERNS = (
    "ConnectionResetError",
    "WinError 10054",
    "_call_connection_lost",
    "ConnectionAbortedError",
    "WinError 10053",
)


def _is_benign_disconnect(record: logging.LogRecord) -> bool:
    if record.name.split(".")[0] != "asyncio":
        return False
    text = record.getMessage()
    if record.exc_info and record.exc_info[0] is not None:
        text += f" {record.exc_info[0].__name__}"
    return any(pattern in text for pattern in _BENIGN_PATTERNS)


class BenignNoiseFilter(logging.Filter):
    """Drops client-disconnect noise that isn't ours and isn't actionable."""

    def filter(self, record: logging.LogRecord) -> bool:
        return not _is_benign_disconnect(record)


class RingBufferHandler(logging.Handler):
    """Keeps the last RING_SIZE WARNING+ records as LogEntry dicts."""

    def __init__(self, capacity: int = RING_SIZE):
        super().__init__(level=logging.WARNING)
        self.records: deque[dict] = deque(maxlen=capacity)
        self.addFilter(BenignNoiseFilter())

    def clear(self) -> None:
        """Drop everything held. Used by the self-checks, which deliberately
        raise to prove isolation and must not leave fake errors on the
        dashboard afterwards."""
        self.records.clear()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            tb = None
            if record.exc_info:
                tb = "".join(traceback.format_exception(*record.exc_info))[-4000:]
            self.records.append(
                {
                    "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
                    "level": record.levelname,
                    "logger": record.name,
                    "message": record.getMessage(),
                    "path": getattr(record, "path", None),
                    "traceback": tb,
                }
            )
        except Exception:  # noqa: BLE001 — a logging handler must never raise
            pass


_ring = RingBufferHandler()


def clear_ring() -> None:
    """Forget the buffered warnings — see RingBufferHandler.clear."""
    _ring.clear()


def recent_errors(limit: int = 50, level: str | None = None) -> list[dict]:
    """Newest first. `level` filters to that level and above."""
    entries = list(_ring.records)
    if level:
        wanted = level.upper()
        if wanted in LEVELS:
            floor = LEVELS.index(wanted)
            entries = [e for e in entries if e["level"] in LEVELS[floor:]]
    entries.reverse()
    return entries[: max(0, limit)]


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    """Idempotent — safe to call from startup and from a script."""
    global _configured
    root = logging.getLogger()
    if _configured:
        return root

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fmt = _UTCFormatter("%(asctime)s %(levelname)-8s %(name)s %(message)s")

    file_handler = logging.handlers.RotatingFileHandler(
        LOG_PATH, maxBytes=2 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)

    console = logging.StreamHandler()
    console.setFormatter(fmt)

    root.setLevel(level)
    for handler in (file_handler, console, _ring):
        root.addHandler(handler)

    # Third-party chatter that would otherwise dominate the log file.
    logging.getLogger("weasyprint").setLevel(logging.WARNING)
    logging.getLogger("fontTools").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    # Keep client-disconnect noise out of the log file too, not just the ring.
    logging.getLogger("asyncio").addFilter(BenignNoiseFilter())

    _configured = True
    logging.getLogger("facet").info("logging initialized -> %s", LOG_PATH)
    return root


# ------------------------------------------------------------ request metrics

_metrics: dict[str, dict] = defaultdict(
    lambda: {"count": 0, "errors": 0, "samples": deque(maxlen=LATENCY_SAMPLES)}
)
EXCLUDED_PATHS = {"/api/status", "/api/status/logs"}


def record_request(path: str, status_code: int, duration_ms: float) -> None:
    if path in EXCLUDED_PATHS:
        return
    entry = _metrics[path]
    entry["count"] += 1
    entry["errors"] += 1 if status_code >= 500 else 0
    entry["samples"].append(duration_ms)


def _pct(samples: list[float], fraction: float) -> float:
    if not samples:
        return 0.0
    index = min(len(samples) - 1, int(round(fraction * (len(samples) - 1))))
    return round(samples[index], 1)


def traffic_snapshot() -> dict:
    by_endpoint = []
    total = errors = 0
    for path, entry in _metrics.items():
        samples = sorted(entry["samples"])
        total += entry["count"]
        errors += entry["errors"]
        by_endpoint.append(
            {
                "path": path,
                "count": entry["count"],
                "errors": entry["errors"],
                "p50_ms": _pct(samples, 0.50),
                "p95_ms": _pct(samples, 0.95),
                "max_ms": round(samples[-1], 1) if samples else 0.0,
            }
        )
    by_endpoint.sort(key=lambda row: row["count"], reverse=True)
    return {
        "total_requests": total,
        "total_errors": errors,
        "error_rate": round(errors / total, 4) if total else 0.0,
        "by_endpoint": by_endpoint,
    }


class RequestLogMiddleware(BaseHTTPMiddleware):
    """One log line and one metric sample per request, keyed by ROUTE TEMPLATE
    so `/api/rough/12` and `/api/rough/13` are the same row."""

    def __init__(self, app):
        super().__init__(app)
        self.log = logging.getLogger("facet.request")

    async def dispatch(self, request, call_next):
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration = (time.perf_counter() - started) * 1000
            record_request(self._template(request), 500, duration)
            self.log.exception(
                "%s %s -> 500 in %.1fms", request.method, request.url.path, duration,
                extra={"path": request.url.path},
            )
            raise
        duration = (time.perf_counter() - started) * 1000
        template = self._template(request)
        record_request(template, response.status_code, duration)
        self.log.log(
            logging.WARNING if response.status_code >= 500 else logging.INFO,
            "%s %s -> %s in %.1fms",
            request.method,
            template,
            response.status_code,
            duration,
            extra={"path": request.url.path},
        )
        return response

    @staticmethod
    def _template(request) -> str:
        route = request.scope.get("route")
        return getattr(route, "path", None) or "<unmatched>"


def demo() -> None:
    setup_logging()
    log = logging.getLogger("facet.demo")

    before = len(_ring.records)
    log.info("info entries are not kept in the ring buffer")
    assert len(_ring.records) == before, "INFO must not enter the WARNING+ ring"
    log.warning("ring buffer check")
    assert len(_ring.records) == before + 1
    entry = _ring.records[-1]
    assert set(entry) == {"ts", "level", "logger", "message", "path", "traceback"}, entry
    assert entry["level"] == "WARNING" and entry["logger"] == "facet.demo"

    try:
        raise ValueError("boom")
    except ValueError:
        log.exception("with traceback")
    assert "ValueError: boom" in _ring.records[-1]["traceback"]

    # A dropped client connection is noise, not an incident — it must never
    # reach the ring, or the dashboard fills with red that means nothing.
    noisy = logging.LogRecord(
        "asyncio", logging.ERROR, __file__, 0,
        "Exception in callback _ProactorBasePipeTransport._call_connection_lost(None)",
        (), None,
    )
    assert _is_benign_disconnect(noisy) is True
    held = len(_ring.records)
    _ring.handle(noisy)
    assert len(_ring.records) == held, "benign disconnect noise entered the ring"

    # ...but a real asyncio error still gets through.
    real = logging.LogRecord("asyncio", logging.ERROR, __file__, 0, "task exploded", (), None)
    assert _is_benign_disconnect(real) is False

    newest = recent_errors(limit=1)
    assert len(newest) == 1 and newest[0]["message"] == "with traceback"
    assert recent_errors(limit=5, level="CRITICAL") == [], "level filter is a floor"

    # Leave nothing behind: this self-check raised on purpose, and those
    # synthetic failures must not show up on the dashboard as real ones.
    clear_ring()
    assert recent_errors() == [], "self-check left synthetic errors in the ring"

    _metrics.clear()
    for ms in (10, 20, 30, 40, 500):
        record_request("/api/rough/{posting_id}", 200, ms)
    record_request("/api/rough/{posting_id}", 500, 5)
    record_request("/api/status", 200, 1)  # excluded from metrics
    snap = traffic_snapshot()
    assert snap["total_requests"] == 6, snap
    assert snap["total_errors"] == 1
    assert [r["path"] for r in snap["by_endpoint"]] == ["/api/rough/{posting_id}"]
    row = snap["by_endpoint"][0]
    assert row["max_ms"] == 500.0 and row["p50_ms"] == 20.0, row
    assert LOG_PATH.exists()
    _metrics.clear()
    print("logging_setup: all checks passed")


if __name__ == "__main__":
    demo()
