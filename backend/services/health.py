"""GET /api/status — the service dashboard.

The response shape is fixed by frontend/src/lib/status.ts; that file is the
contract, this module serializes it.

Two rules govern everything here:

  * Every check actually executes something and is timed. Nothing returns a
    hardcoded "ok".
  * No check may take the report down. Each one is wrapped: an exception
    becomes that check's `error` status with the exception message.

No live network calls to job providers — the sources group reports the last
observed result recorded by services.job_sources, which is what makes this
endpoint answer in milliseconds instead of seconds.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from services import agy_runner, feed_ingest, job_sources, scheduler, settings_store
from services.db import apply_pragmas
from services.logging_setup import recent_errors, traffic_snapshot
from services import paths
from services.paths import ROOT, TEMPLATES_DIR

logger = logging.getLogger("facet.health")

STARTED_AT = time.time()

EXPECTED_TABLES = {
    "applications",
    "contacts",
    "interviews",
    "seen_postings",
    "suggested_interviews",
}

VALID_STATUSES = {"ok", "degraded", "error", "disabled", "unknown"}

# Providers needing credentials -> the settings keys that configure them.
KEYED_PROVIDERS = {
    "adzuna": ("adzuna_app_id", "adzuna_app_key"),
    "jooble": ("jooble_key",),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mb(num_bytes: float) -> str:
    return f"{num_bytes / 1024 / 1024:.1f} MB"


def _open_db() -> sqlite3.Connection:
    """A short-lived read connection of our own — the dashboard must never
    queue behind services.db's single shared writer."""
    conn = sqlite3.connect(str(paths.DB_PATH), timeout=2.0)
    conn.row_factory = sqlite3.Row
    apply_pragmas(conn)
    return conn


# ------------------------------------------------------------------- core


def _check_process() -> dict:
    uptime = time.time() - STARTED_AT
    return {
        "status": "ok",
        "detail": f"API process alive, up {uptime:.0f}s (pid {os.getpid()})",
        "meta": {"pid": os.getpid(), "uptime_seconds": round(uptime, 1), "python": sys.version.split()[0]},
    }


def _check_db_connectivity() -> dict:
    if not paths.DB_PATH.exists():
        return {"status": "error", "detail": f"{paths.DB_PATH} does not exist",
                "hint": "run scripts/init_db.py"}
    conn = _open_db()
    try:
        row = conn.execute("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").fetchone()
        journal = conn.execute("PRAGMA journal_mode").fetchone()[0]
    finally:
        conn.close()
    return {
        "status": "ok",
        "detail": f"connected, {row['n']} tables, journal_mode={journal}",
        "meta": {"path": str(paths.DB_PATH), "tables": row["n"], "journal_mode": journal},
    }


def _check_integrity() -> dict:
    conn = _open_db()
    try:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        conn.close()
    if result == "ok":
        return {"status": "ok", "detail": "PRAGMA integrity_check: ok"}
    return {
        "status": "error",
        "detail": f"integrity_check reported: {result}"[:300],
        "hint": "the database file is damaged - restore a copy of data/tracker.db",
    }


def _check_schema() -> dict:
    conn = _open_db()
    try:
        tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(seen_postings)")}
    finally:
        conn.close()
    missing_tables = sorted(EXPECTED_TABLES - tables)
    missing_columns = sorted(set(feed_ingest_columns()) - columns)
    if missing_tables or missing_columns:
        return {
            "status": "error",
            "detail": f"missing tables {missing_tables or '-'}, missing columns {missing_columns or '-'}",
            "hint": "restart the backend (init_db runs the ALTER TABLE migrations at startup)",
            "meta": {"missing_tables": ", ".join(missing_tables) or "none",
                     "missing_columns": ", ".join(missing_columns) or "none"},
        }
    return {
        "status": "ok",
        "detail": f"{len(EXPECTED_TABLES)} expected tables and all {len(columns)} seen_postings columns present",
        "meta": {"seen_postings_columns": len(columns)},
    }


def feed_ingest_columns() -> list[str]:
    from services.db import _POSTING_COLUMNS

    return list(_POSTING_COLUMNS)


def _check_wal() -> dict:
    wal = paths.DB_PATH.with_name(paths.DB_PATH.name + "-wal")
    if not wal.exists():
        return {"status": "ok", "detail": "no WAL file (checkpointed)", "meta": {"bytes": 0}}
    size = wal.stat().st_size
    # SQLite auto-checkpoints around 4MB of WAL; an order of magnitude past
    # that means checkpoints aren't completing.
    status = "degraded" if size > 64 * 1024 * 1024 else "ok"
    return {
        "status": status,
        "detail": f"WAL {_mb(size)}",
        "hint": "run PRAGMA wal_checkpoint(TRUNCATE)" if status != "ok" else None,
        "meta": {"bytes": size},
    }


def _check_db_size() -> dict:
    size = paths.DB_PATH.stat().st_size if paths.DB_PATH.exists() else 0
    return {"status": "ok", "detail": f"tracker.db {_mb(size)}", "meta": {"bytes": size}}


def _check_disk() -> dict:
    usage = shutil.disk_usage(str(paths.DB_PATH.parent if paths.DB_PATH.parent.exists() else ROOT))
    free_gb = usage.free / 1024 ** 3
    status = "error" if free_gb < 0.2 else "degraded" if free_gb < 1 else "ok"
    return {
        "status": status,
        "detail": f"{free_gb:.1f} GB free of {usage.total / 1024 ** 3:.0f} GB",
        "hint": "free disk space - exports and the WAL need room" if status != "ok" else None,
        "meta": {"free_bytes": usage.free, "total_bytes": usage.total},
    }


def _check_scheduler() -> list[dict]:
    sched = scheduler._scheduler
    checks = [
        {
            "key": "scheduler.running",
            "label": "Background scheduler",
            "status": "ok" if sched.running else "error",
            "detail": "APScheduler running" if sched.running else "APScheduler is not running",
            "hint": None if sched.running else "restart the backend",
        }
    ]
    jobs = sched.get_jobs() if sched.running else []
    for job in jobs:
        nxt = getattr(job, "next_run_time", None)
        checks.append(
            {
                "key": f"scheduler.job.{job.id}",
                "label": f"Job: {job.id}",
                "status": "ok" if nxt else "degraded",
                "detail": f"next run {nxt.isoformat()}" if nxt else "no next run time (paused)",
                "hint": None if nxt else "the job is paused; restart the backend",
                "meta": {"trigger": str(job.trigger)},
            }
        )
    if sched.running and not jobs:
        checks.append(
            {
                "key": "scheduler.jobs",
                "label": "Scheduled jobs",
                "status": "error",
                "detail": "scheduler running but no jobs registered",
                "hint": "start_scheduler() did not register feed_ingest/calendar_sync",
            }
        )
    return checks


# ---------------------------------------------------------------- sources


def _check_providers() -> list[dict]:
    settings = settings_store.load_settings()
    enabled = settings.get("enabled_sources") or []
    available = set(job_sources.available_providers(settings))
    report = job_sources.LAST_RUN.get("report") or {}
    checks = []
    for name in job_sources.PROVIDERS:
        keys = KEYED_PROVIDERS.get(name)
        configured = all(settings.get(k) for k in keys) if keys else True
        if not configured:
            status, detail = "disabled", f"no API key configured ({', '.join(keys)})"
        elif name not in available:
            status, detail = "disabled", "turned off in settings (enabled_sources)"
        else:
            stat = report.get(name)
            if stat is None:
                status, detail = "unknown", "no run observed since this process started"
            elif stat.get("error"):
                status, detail = "error", f"last run failed: {stat['error']}"
            elif stat.get("count", 0) == 0:
                status, detail = "degraded", f"last run returned 0 postings in {stat.get('ms', 0)}ms"
            else:
                status, detail = "ok", f"last run returned {stat['count']} postings in {stat.get('ms', 0)}ms"
        checks.append(
            {
                "key": f"source.{name}",
                "label": f"Provider: {name}",
                "status": status,
                "detail": detail,
                "hint": "add the API key in Settings" if status == "disabled" and keys else None,
                "meta": {"keyless": name in job_sources.KEYLESS,
                         "enabled_in_settings": (not enabled) or name in enabled},
            }
        )
    return checks


def _check_feeds() -> list[dict]:
    feeds = feed_ingest.load_feeds()
    checks = []
    for feed in feeds:
        health = job_sources.FEED_HEALTH.get(feed.get("url"))
        label = feed.get("label") or feed.get("url", "?")
        if health is None:
            status, detail, hint = "unknown", "not polled since this process started", None
        elif health["status"] == "ok":
            status = "ok" if health["entries"] else "degraded"
            detail = f"{health['entries']} entries in {health['ms']}ms at {health['at']}"
            hint = None
        else:
            status = "error"
            detail = f"{health['error']} (at {health['at']})"
            hint = "check the feed URL in The Rough → Feeds, or remove it"
        checks.append(
            {
                "key": f"feed.{feed.get('url', label)}",
                "label": f"Feed: {label}",
                "status": status,
                "detail": detail,
                "hint": hint,
                "meta": {"url": feed.get("url", "")},
            }
        )
    if not checks:
        checks.append({"key": "feed.none", "label": "Subscribed feeds", "status": "disabled",
                       "detail": "no feeds subscribed", "hint": "add one in The Rough → Feeds"})
    return checks


def _check_last_sync() -> dict:
    conn = _open_db()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS n, MAX(COALESCE(last_seen_at, first_seen_at)) AS last FROM seen_postings"
        ).fetchone()
    finally:
        conn.close()
    last = row["last"] or job_sources.LAST_RUN.get("at")
    if not last:
        return {"status": "degraded", "detail": "no sync has ever completed",
                "hint": "the first scheduled pull runs 10s after startup"}
    return {
        "status": "ok",
        "detail": f"{row['n']} postings in DB, last synced {last}",
        "meta": {"postings": row["n"], "last_sync": last,
                 "last_run_this_process": job_sources.LAST_RUN.get("at")},
    }


# --------------------------------------------------------------- ai engine


# `check_agy_health` spawns the agy CLI. That is by far the most expensive
# thing in the report — ~280ms warm and multiple seconds cold — and a
# dashboard polling every 15s must not fork a process every time. The
# installed CLI's version doesn't change between polls, so cache it; the
# check reports how old the reading is rather than pretending it's live.
_AGY_TTL = 60.0
_agy_cache: tuple[float, bool, str] | None = None


def _check_agy() -> dict:
    global _agy_cache

    now = time.monotonic()
    if _agy_cache and now - _agy_cache[0] < _AGY_TTL:
        cached_at, available, detail = _agy_cache
        age = now - cached_at
    else:
        available, detail = agy_runner.check_agy_health()
        _agy_cache = (now, available, detail)
        age = 0.0

    if available:
        hint = None
    elif "not found" in detail:
        # "Not found" almost never means "not installed". The usual cause is a
        # shell that was already open when the installer added its directory to
        # PATH: the registry has the new entry, the running process kept the old
        # block, and every child it spawns — including this backend — inherits
        # the stale one. Saying "install the CLI" sends someone to reinstall
        # software they already have.
        hint = (
            "if agy is already installed, this is usually a stale PATH: close "
            "this terminal, open a new one, and start Facet again. Otherwise "
            "install it, or set FACET_AGY_BIN to its full path."
        )
    else:
        hint = "agy is installed but did not answer - check that it's authenticated"

    return {
        "status": "ok" if available else "error",
        "detail": detail or ("agy available" if available else "agy unavailable"),
        "hint": hint,
        "meta": {"cache_age_seconds": round(age, 1), "cache_ttl_seconds": _AGY_TTL},
    }


def reset_agy_cache() -> None:
    """Force the next report to re-probe the CLI (used by the self-check)."""
    global _agy_cache
    _agy_cache = None


def _check_agy_busy() -> dict:
    """Whether an agy run is in flight anywhere on this host.

    The lock stopped being an in-process threading primitive when the queue
    landed — it is a file lock now, precisely so the answer covers every
    user's instance and not just this one. Probing means trying to take it:
    if it is free we hold it for microseconds and hand it straight back,
    which is honest in a way that reading a local flag cannot be.
    """
    from services.filelock import FileLock

    probe = FileLock(agy_runner.AGY_LOCK_PATH, timeout=0)
    busy = probe.is_held()

    meta = {"in_flight": busy, "lock": str(agy_runner.AGY_LOCK_PATH)}
    if busy:
        # Who is holding it — which, across instances, is the only way to
        # tell "my run is slow" from "someone else's run is ahead of me".
        meta["holder"] = probe.holder()
    return {
        "status": "ok",
        "detail": "an agy run is in flight" if busy else "idle",
        "meta": meta,
    }


def _json_file_check(path: Path, what: str, hint: str) -> dict:
    if not path.exists():
        return {"status": "degraded", "detail": f"{path.name} not present", "hint": hint}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return {"status": "error", "detail": f"{path.name} is not valid JSON: {exc}", "hint": hint}
    mtime = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    return {
        "status": "ok",
        "detail": f"{what}: valid JSON, {len(data) if hasattr(data, '__len__') else '?'} top-level keys, updated {mtime}",
        "meta": {"updated_at": mtime, "bytes": path.stat().st_size},
    }


def _check_profile() -> dict:
    return _json_file_check(paths.PROFILE_PATH, "profile.json",
                            "run the resume extraction in The Stone to build profile.json")


def _check_last_extraction() -> dict:
    return _json_file_check(paths.TAILORED_FIELDS_PATH, "last tailoring output",
                            "run a tailoring pass in The Tailor")


# --------------------------------------------------------------- documents


def _check_weasyprint() -> dict:
    started = time.perf_counter()
    try:
        import weasyprint  # noqa: F401 — services/__init__ set the DLL path
    except (ImportError, OSError) as exc:
        return {
            "status": "error",
            "detail": f"weasyprint unimportable: {type(exc).__name__}: {exc}"[:300],
            "hint": "native GTK/Pango libs missing - PDF export won't work; everything else does",
        }
    return {
        "status": "ok",
        "detail": f"weasyprint {weasyprint.__version__} importable "
                  f"({(time.perf_counter() - started) * 1000:.0f}ms)",
        "meta": {"version": weasyprint.__version__},
    }


def _check_templates() -> list[dict]:
    checks = []

    # The seven resume templates, reported as one line rather than fourteen —
    # /status is meant to be read, and a wall of green rows for files that are
    # either all present or all missing together tells nobody anything. The
    # detail names whichever ones are actually absent.
    from services import resume_templates

    missing = [
        f"{t.id}{ext}"
        for t in resume_templates.TEMPLATES
        for ext, name in ((".html", t.html), (".docx", f"{resume_templates.TEMPLATE_DIR_NAME}/{t.docx}"))
        if not (TEMPLATES_DIR / name).exists()
    ]
    checks.append(
        {
            "key": "template.resumes",
            "label": "Resume templates",
            "status": "ok" if not missing else "error",
            "detail": (
                f"{len(resume_templates.TEMPLATES)} templates, HTML and DOCX"
                if not missing
                else f"missing: {', '.join(missing)}"
            ),
            "hint": None if not missing else "restore templates/resumes/, then run templates/build_resume_docx_templates.py",
        }
    )

    for filename, label in (
        ("resume_template.html", "Resume template (PDF, legacy)"),
        ("cover_letter_template.html", "Cover letter template (PDF)"),
        ("resume_template.docx", "Resume template (DOCX, legacy)"),
    ):
        path = TEMPLATES_DIR / filename
        exists = path.exists() and path.stat().st_size > 0
        checks.append(
            {
                "key": f"template.{filename}",
                "label": label,
                "status": "ok" if exists else "error",
                "detail": f"{filename} — {_mb(path.stat().st_size)}" if exists else f"{filename} missing",
                "hint": None if exists else f"restore templates/{filename}",
            }
        )
    return checks


def _check_exports_writable() -> dict:
    paths.EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    probe = paths.EXPORTS_DIR / f".healthcheck-{os.getpid()}"
    probe.write_bytes(b"ok")
    written = probe.read_bytes()
    probe.unlink()
    assert written == b"ok"
    count = sum(1 for _ in paths.EXPORTS_DIR.glob("*"))
    return {
        "status": "ok",
        "detail": f"{paths.EXPORTS_DIR} writable, {count} files",
        "meta": {"path": str(paths.EXPORTS_DIR), "files": count},
    }


# -------------------------------------------------------------------- data


def _check_counts() -> list[dict]:
    conn = _open_db()
    try:
        rows = {
            name: conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
            for name in ("applications", "contacts", "interviews", "seen_postings")
        }
        postings = conn.execute(
            """SELECT SUM(dismissed) AS dismissed, SUM(promoted) AS promoted,
                      MIN(COALESCE(posted_date, first_seen_at)) AS oldest,
                      MAX(COALESCE(posted_date, first_seen_at)) AS newest
               FROM seen_postings"""
        ).fetchone()
    finally:
        conn.close()
    return [
        {
            "key": "data.tracker",
            "label": "Tracker records",
            "status": "ok",
            "detail": f"{rows['applications']} applications, {rows['contacts']} contacts, "
                      f"{rows['interviews']} interviews",
            "meta": {k: v for k, v in rows.items() if k != "seen_postings"},
        },
        {
            "key": "data.postings",
            "label": "Postings",
            "status": "ok" if rows["seen_postings"] else "degraded",
            "detail": f"{rows['seen_postings']} postings — {postings['dismissed'] or 0} dismissed, "
                      f"{postings['promoted'] or 0} promoted",
            "hint": None if rows["seen_postings"] else "no postings yet - wait for the first sync",
            "meta": {
                "total": rows["seen_postings"],
                "dismissed": postings["dismissed"] or 0,
                "promoted": postings["promoted"] or 0,
                "oldest": postings["oldest"],
                "newest": postings["newest"],
            },
        },
    ]


# ------------------------------------------------------------------ runner

GROUPS = [
    ("core", "Core", "The API process, its database, and the background scheduler.", [
        ("api.process", "API process", _check_process),
        ("db.connectivity", "SQLite connectivity", _check_db_connectivity),
        ("db.integrity", "Database integrity", _check_integrity),
        ("db.schema", "Schema & migrations", _check_schema),
        ("db.wal", "Write-ahead log", _check_wal),
        ("db.size", "Database size", _check_db_size),
        ("disk.free", "Disk space", _check_disk),
        ("scheduler", "Scheduler", _check_scheduler),
    ]),
    ("sources", "Job sources", "Aggregator providers and subscribed RSS feeds - last observed results, no live calls.", [
        ("sources.providers", "Providers", _check_providers),
        ("sources.feeds", "Subscribed feeds", _check_feeds),
        ("sources.sync", "Last sync", _check_last_sync),
    ]),
    ("ai", "AI engine", "The agy CLI and the profile it extracts.", [
        ("agy.cli", "agy CLI", _check_agy),
        ("agy.busy", "Run in flight", _check_agy_busy),
        ("agy.profile", "profile.json", _check_profile),
        ("agy.extraction", "Last tailoring", _check_last_extraction),
    ]),
    ("documents", "Documents", "PDF/DOCX rendering and the export directory.", [
        ("docs.weasyprint", "WeasyPrint", _check_weasyprint),
        ("docs.templates", "Templates", _check_templates),
        ("docs.exports", "Exports directory", _check_exports_writable),
    ]),
    ("data", "Data", "What's actually stored in tracker.db.", [
        ("data.counts", "Record counts", _check_counts),
    ]),
]


def run_check(key: str, label: str, fn) -> list[dict]:
    """Execute one check, timed, and never let it raise."""
    started = time.perf_counter()
    try:
        result = fn()
    except Exception as exc:  # noqa: BLE001 — a broken check is a red dot, not a 500
        logger.warning("status check %s failed: %r", key, exc)
        result = {"status": "error", "detail": f"{type(exc).__name__}: {exc}"[:300],
                  "hint": "this check itself failed - see data/logs/facet.log"}
    latency = round((time.perf_counter() - started) * 1000, 1)
    items = result if isinstance(result, list) else [{"key": key, "label": label, **result}]
    now = _now()
    for item in items:
        item.setdefault("key", key)
        item.setdefault("label", label)
        item.setdefault("hint", None)
        item.setdefault("meta", {})
        item["latency_ms"] = latency
        item["last_checked"] = now
        if item.get("status") not in VALID_STATUSES:
            item["status"] = "unknown"
        item["detail"] = str(item.get("detail") or "")
    return items


def _versions() -> dict:
    import fastapi

    return {
        "facet": "2.0",
        "python": sys.version.split()[0],
        "fastapi": fastapi.__version__,
        "sqlite": sqlite3.sqlite_version,
        "platform": f"{platform.system()} {platform.release()}",
    }


async def build_report() -> dict:
    """Assemble the whole StatusReport. Checks run concurrently in threads —
    they're all blocking file/sqlite/subprocess I/O."""
    started = time.perf_counter()

    tasks = [
        (group_key, asyncio.gather(*(asyncio.to_thread(run_check, k, lbl, fn) for k, lbl, fn in checks)))
        for group_key, _, _, checks in GROUPS
    ]
    results = {group_key: await task for group_key, task in tasks}

    groups = []
    counts = {"ok": 0, "degraded": 0, "error": 0, "disabled": 0}
    core_error = False
    any_bad = False

    for group_key, label, description, _ in GROUPS:
        checks = [check for batch in results[group_key] for check in batch]
        for check in checks:
            if check["status"] in counts:
                counts[check["status"]] += 1
            if check["status"] in ("error", "degraded"):
                any_bad = True
                if group_key == "core":
                    core_error = core_error or check["status"] == "error"
        groups.append({"key": group_key, "label": label, "description": description, "checks": checks})

    overall = "down" if core_error else "degraded" if any_bad else "operational"

    return {
        "generated_at": _now(),
        "overall": overall,
        "uptime_seconds": round(time.time() - STARTED_AT, 1),
        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
        "versions": _versions(),
        "groups": groups,
        "counts": counts,
        "traffic": traffic_snapshot(),
        "recent_errors": recent_errors(limit=25),
    }


def demo() -> None:
    # Cold build: probes the agy CLI for real, so it's allowed to be slow —
    # spawning a process on Windows is measured in seconds, not milliseconds.
    reset_agy_cache()
    report = asyncio.run(build_report())
    cold_ms = report["duration_ms"]
    assert cold_ms < 8000, f"cold report far too slow: {cold_ms}ms"

    # Warm build is what a dashboard polling every 15s actually experiences,
    # and that one has a real budget to meet.
    warm = asyncio.run(build_report())
    assert warm["duration_ms"] < 1000, f"warm report too slow: {warm['duration_ms']}ms"

    agy = next(c for g in warm["groups"] for c in g["checks"] if c["key"] == "agy.cli")
    assert agy["meta"]["cache_age_seconds"] > 0, "agy probe was not cached on the warm build"

    assert report["overall"] in ("operational", "degraded", "down"), report["overall"]
    assert {g["key"] for g in report["groups"]} == {"core", "sources", "ai", "documents", "data"}
    checks = [c for g in report["groups"] for c in g["checks"]]
    assert checks, "no checks ran"
    for check in checks:
        assert check["status"] in VALID_STATUSES, check
        assert check["detail"], f"{check['key']} has an empty detail"

    # A raising check becomes that check's error, never an exception.
    broken = run_check("x.boom", "Boom", lambda: 1 / 0)
    assert len(broken) == 1 and broken[0]["status"] == "error"
    assert "ZeroDivisionError" in broken[0]["detail"], broken
    assert broken[0]["last_checked"] and broken[0]["latency_ms"] is not None

    # run_check above logged a synthetic failure on purpose — don't leave it
    # sitting on the dashboard as if something were really wrong.
    from services.logging_setup import clear_ring

    clear_ring()

    print(
        f"health: all checks passed ({report['overall']}, "
        f"cold {cold_ms}ms / warm {warm['duration_ms']}ms)"
    )


if __name__ == "__main__":
    from services.logging_setup import setup_logging

    setup_logging()
    demo()
