"""The work queue: agy runs become jobs instead of blocking HTTP requests.

Why this exists, in order of how much each reason costs to ignore:

1. **agy is one CLI.** `run_agy` used to reject a second caller outright with
   AgyBusyError -> HTTP 409. That is a reasonable answer for one person and a
   hostile one for several: "someone else is using it, try again" with no
   sense of when. A queue turns a rejection into a wait with a position.

2. **A 300-second HTTP request cannot survive a proxy.** Cloudflare's free
   tier returns 524 when the origin hasn't sent response headers within 100
   seconds; nginx defaults to 60. Any deployment behind a proxy forces the
   work off the request. Returning 202 + a job id and polling is not polish,
   it is the only shape that works.

3. **Work outlives the tab.** A cut that is enqueued completes whether or not
   the browser stays open, and the result is on the row when it comes back.

Deliberately a separate database from tracker.db. tracker.db is the user's
record, migrated additively and never rewritten; the queue is operational
state that can be truncated without losing anything that matters. Keeping
them apart means queue changes can never threaten the record.

Point FACET_QUEUE_DB at a shared file to have several app processes feed one
worker — which is what the multi-user host deployment does.
"""

import asyncio
import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from services.paths import DATA_DIR

logger = logging.getLogger("facet.jobs")

QUEUE_DB = Path(os.environ.get("FACET_QUEUE_DB", "").strip() or DATA_DIR / "queue.db")

# How often the worker looks for work when the queue is empty. Short enough
# that a cut feels immediate, long enough to be free at idle.
POLL_SECONDS = 1.0

QUEUED, RUNNING, DONE, FAILED, CANCELLED = (
    "queued", "running", "done", "failed", "cancelled",
)
TERMINAL = (DONE, FAILED, CANCELLED)

_connection: sqlite3.Connection | None = None
_lock = asyncio.Lock()


def _connect() -> sqlite3.Connection:
    global _connection
    if _connection is None:
        QUEUE_DB.parent.mkdir(parents=True, exist_ok=True)
        _connection = sqlite3.connect(QUEUE_DB, check_same_thread=False)
        _connection.row_factory = sqlite3.Row
        # WAL so a reader polling job status never blocks the worker writing
        # to it — the single most common access pattern here.
        _connection.execute("PRAGMA journal_mode = WAL")
        _connection.execute("PRAGMA synchronous = NORMAL")
        _connection.execute("PRAGMA busy_timeout = 5000")
    return _connection


def init_queue() -> None:
    conn = _connect()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS jobs (
          id          INTEGER PRIMARY KEY,
          user_id     INTEGER,          -- NULL = the single local user
          kind        TEXT NOT NULL,
          status      TEXT NOT NULL,
          payload     TEXT NOT NULL,
          result      TEXT,
          error       TEXT,
          error_kind  TEXT,
          attempts    INTEGER NOT NULL DEFAULT 0,
          queued_at   REAL NOT NULL,
          started_at  REAL,
          finished_at REAL,
          worker_pid  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status, id);
        CREATE INDEX IF NOT EXISTS idx_jobs_recent ON jobs(queued_at DESC);
        """
    )
    conn.commit()


async def _run(fn, *args):
    """Every queue statement goes through one lock and the threadpool, for
    the same reason tracker.db does: keep sqlite off the event loop."""
    async with _lock:
        return await asyncio.get_running_loop().run_in_executor(None, fn, *args)


def _row_to_job(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    job = dict(row)
    job["payload"] = json.loads(job["payload"])
    job["result"] = json.loads(job["result"]) if job["result"] else None
    return job


# ----------------------------------------------------------------- writing

def _enqueue(kind: str, payload: dict, user_id: int | None) -> int:
    conn = _connect()
    cur = conn.execute(
        "INSERT INTO jobs (user_id, kind, status, payload, queued_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (user_id, kind, QUEUED, json.dumps(payload), time.time()),
    )
    conn.commit()
    return cur.lastrowid


async def enqueue(kind: str, payload: dict, user_id: int | None = None) -> int:
    job_id = await _run(_enqueue, kind, payload, user_id)
    logger.info("[Facet] job %s queued (%s)", job_id, kind)
    return job_id


def _claim() -> dict | None:
    """Take the oldest queued job, atomically.

    One UPDATE rather than SELECT-then-UPDATE. There is a single worker
    today, so the race cannot happen yet — but the whole point of this queue
    is that a second process may drain it later, and a claim that is only
    safe by accident is the kind of thing nobody remembers to revisit.
    """
    conn = _connect()
    cur = conn.execute(
        f"""UPDATE jobs
               SET status = '{RUNNING}', started_at = ?, worker_pid = ?,
                   attempts = attempts + 1
             WHERE id = (SELECT id FROM jobs WHERE status = '{QUEUED}'
                          ORDER BY id LIMIT 1)
         RETURNING *""",
        (time.time(), os.getpid()),
    )
    row = cur.fetchone()
    conn.commit()
    return _row_to_job(row)


def _finish(job_id: int, status: str, result: dict | None, error: str | None,
            error_kind: str | None) -> None:
    conn = _connect()
    conn.execute(
        "UPDATE jobs SET status = ?, result = ?, error = ?, error_kind = ?, "
        "finished_at = ? WHERE id = ?",
        (status, json.dumps(result) if result is not None else None,
         error, error_kind, time.time(), job_id),
    )
    conn.commit()


def _cancel(job_id: int) -> bool:
    """Only a job that hasn't started can be cancelled.

    A running job means an agy subprocess is mid-flight; killing it cleanly
    is the admin dashboard's problem (PLAN.md Phase 4), not something to fake
    here by marking a row cancelled while the process keeps running.
    """
    conn = _connect()
    cur = conn.execute(
        "UPDATE jobs SET status = ?, finished_at = ? WHERE id = ? AND status = ?",
        (CANCELLED, time.time(), job_id, QUEUED),
    )
    conn.commit()
    return cur.rowcount > 0


async def cancel(job_id: int) -> bool:
    return await _run(_cancel, job_id)


def _reconcile() -> int:
    """Fail jobs left `running` by a process that is no longer alive.

    Without this a crash — or a `uvicorn --reload` restart mid-cut — strands
    the row in `running` forever, and the browser polls a spinner that will
    never resolve. Runs at startup, before the worker takes anything new.
    """
    conn = _connect()
    stranded = conn.execute(
        f"SELECT id, worker_pid FROM jobs WHERE status = '{RUNNING}'"
    ).fetchall()

    failed = 0
    for row in stranded:
        pid = row["worker_pid"]
        if pid is not None and pid != os.getpid() and _pid_alive(pid):
            continue  # genuinely still running elsewhere; leave it alone
        conn.execute(
            "UPDATE jobs SET status = ?, error = ?, error_kind = ?, finished_at = ? "
            "WHERE id = ?",
            (FAILED, "Interrupted — Facet restarted while this was running.",
             "interrupted", time.time(), row["id"]),
        )
        failed += 1
    conn.commit()
    return failed


def _pid_alive(pid: int) -> bool:
    if os.name == "nt":
        import subprocess
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True, text=True,
        )
        return str(pid) in out.stdout
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists, owned by someone else
    return True


async def reconcile() -> int:
    count = await _run(_reconcile)
    if count:
        logger.warning("[Facet] %s interrupted job(s) marked failed at startup", count)
    return count


# ----------------------------------------------------------------- reading

def _get(job_id: int) -> dict | None:
    conn = _connect()
    job = _row_to_job(
        conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    )
    if job is None:
        return None

    # Position is only meaningful while waiting, and it is 1-based because it
    # is shown to a person: "2nd in queue", not "1 ahead of you".
    if job["status"] == QUEUED:
        ahead = conn.execute(
            f"SELECT COUNT(*) FROM jobs WHERE status = '{QUEUED}' AND id < ?",
            (job_id,),
        ).fetchone()[0]
        job["position"] = ahead + 1
    else:
        job["position"] = None
    return job


async def get(job_id: int) -> dict | None:
    return await _run(_get, job_id)


def _latest(kind: str) -> dict | None:
    conn = _connect()
    return _row_to_job(
        conn.execute(
            "SELECT * FROM jobs WHERE kind = ? ORDER BY id DESC LIMIT 1", (kind,)
        ).fetchone()
    )


async def latest(kind: str) -> dict | None:
    """The most recent job of a kind — for endpoints that report "what is the
    state of X" rather than tracking a specific job id."""
    return await _run(_latest, kind)


def _recent(limit: int) -> list[dict]:
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM jobs ORDER BY queued_at DESC LIMIT ?", (limit,)
    ).fetchall()
    return [_row_to_job(r) for r in rows]


async def recent(limit: int = 50) -> list[dict]:
    return await _run(_recent, limit)


def _stats() -> dict:
    conn = _connect()
    counts = {
        row["status"]: row["n"]
        for row in conn.execute("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status")
    }
    return {
        "queued": counts.get(QUEUED, 0),
        "running": counts.get(RUNNING, 0),
        "done": counts.get(DONE, 0),
        "failed": counts.get(FAILED, 0),
        "cancelled": counts.get(CANCELLED, 0),
    }


async def stats() -> dict:
    return await _run(_stats)


# ------------------------------------------------------------------ worker

# Handlers receive the whole job, not just the payload — they need `id` to
# name their scratch directory, and having `attempts` to hand is what lets a
# handler behave differently on a retry.
Handler = Callable[[dict], Awaitable[dict]]


async def worker_loop(handlers: dict[str, Handler]) -> None:
    """Drain the queue, one job at a time, forever.

    Runs as a lifespan task. One job at a time is not a simplification to be
    optimized away later — agy is a single CLI, and the whole queue exists to
    express that.
    """
    logger.info("[Facet] queue worker started (pid %s) -> %s", os.getpid(), QUEUE_DB)
    while True:
        try:
            job = await _run(_claim)
        except Exception:
            logger.exception("[Facet] queue claim failed")
            await asyncio.sleep(POLL_SECONDS)
            continue

        if job is None:
            await asyncio.sleep(POLL_SECONDS)
            continue

        await _execute(job, handlers)


async def _execute(job: dict, handlers: dict[str, Handler]) -> None:
    job_id, kind = job["id"], job["kind"]
    started = time.monotonic()
    handler = handlers.get(kind)

    if handler is None:
        await _run(_finish, job_id, FAILED, None,
                   f"No handler registered for job kind '{kind}'", "no_handler")
        logger.error("[Facet] job %s has unknown kind %r", job_id, kind)
        return

    try:
        result = await handler(job)
    except asyncio.CancelledError:
        # Shutdown. Record it rather than leaving the row `running` for
        # reconcile() to find on the next boot — the user gets a real message
        # now instead of a spinner until restart.
        await _run(_finish, job_id, FAILED, None,
                   "Cancelled — Facet shut down while this was running.", "interrupted")
        raise
    except Exception as exc:
        message, kind_hint = _describe(exc)
        await _run(_finish, job_id, FAILED, None, message, kind_hint)
        logger.error("[Facet] job %s (%s) failed: %s", job_id, kind, message)
        return

    await _run(_finish, job_id, DONE, result, None, None)
    logger.info("[Facet] job %s (%s) done in %.1fs", job_id, kind, time.monotonic() - started)


def _describe(exc: Exception) -> tuple[str, str]:
    """Bucket a failure so the dashboard can say *why*, not just "3 failed".

    The buckets have genuinely different fixes: a timeout means agy is slow
    or wedged, `agy_missing` means PATH, `no_output_file` almost always means
    --add-dir. Lumping them together throws away the diagnosis.
    """
    from services.agy_runner import AgyError  # local: avoids an import cycle

    if isinstance(exc, AgyError):
        message = f"{exc.message} — {exc.hint}" if exc.hint else exc.message
        lowered = f"{exc.message} {exc.hint}".lower()
        if "timed out" in lowered:
            return message, "timeout"
        if "not found" in lowered:
            return message, "agy_missing"
        if "no output" in lowered:
            return message, "no_output_file"
        if "malformed" in lowered or "json" in lowered:
            return message, "bad_json"
        return message, "agy_error"
    return f"{type(exc).__name__}: {exc}", "internal"


def demo() -> None:
    """Self-check:  backend/.venv/python.exe -m services.jobs"""
    import tempfile

    global QUEUE_DB, _connection
    QUEUE_DB = Path(tempfile.mkdtemp()) / "queue.db"
    _connection = None
    init_queue()

    async def main():
        # Enqueue preserves order, and position is 1-based from the front.
        a = await enqueue("tailor", {"n": 1})
        b = await enqueue("tailor", {"n": 2})
        assert (await get(a))["position"] == 1
        assert (await get(b))["position"] == 2
        assert (await stats())["queued"] == 2

        # Cancelling a queued job works and moves the one behind it forward.
        assert await cancel(b) is True
        assert (await get(b))["status"] == CANCELLED
        assert await cancel(b) is False, "cancelling twice must not re-cancel"

        # A handler's return value lands on the row as the result, and it is
        # handed the whole job so it can use the id.
        async def ok(job):
            assert job["id"] and job["kind"] == "tailor", job
            return {"doubled": job["payload"]["n"] * 2}

        job = await _run(_claim)
        assert job["id"] == a and job["status"] == RUNNING
        await _execute(job, {"tailor": ok})
        finished = await get(a)
        assert finished["status"] == DONE, finished
        assert finished["result"] == {"doubled": 2}, finished
        assert finished["position"] is None
        assert await _run(_claim) is None, "queue should be empty"

        # A raising handler fails the job, bucketed, without killing the loop.
        c = await enqueue("tailor", {"n": 9})

        async def boom(job):
            raise RuntimeError("nope")

        await _execute(await _run(_claim), {"tailor": boom})
        failed = await get(c)
        assert failed["status"] == FAILED, failed
        assert failed["error_kind"] == "internal", failed
        assert "nope" in failed["error"]

        # An unknown kind fails cleanly rather than wedging the worker.
        d = await enqueue("nonsense", {})
        await _execute(await _run(_claim), {"tailor": ok})
        assert (await get(d))["error_kind"] == "no_handler"

        # reconcile() rescues rows stranded by a dead process, and leaves
        # rows belonging to a live one alone.
        e = await enqueue("tailor", {})
        await _run(_claim)
        conn = _connect()
        conn.execute("UPDATE jobs SET worker_pid = 999999 WHERE id = ?", (e,))
        conn.commit()
        assert await reconcile() == 1
        stranded = await get(e)
        assert stranded["status"] == FAILED and stranded["error_kind"] == "interrupted"

        f = await enqueue("tailor", {})
        await _run(_claim)  # worker_pid is this live process
        assert await reconcile() == 1, "own-pid rows are stale too after a restart"

        # Failure bucketing maps agy's errors to actionable causes.
        from services.agy_runner import AgyError
        assert _describe(AgyError("AI engine timed out", "300s"))[1] == "timeout"
        assert _describe(AgyError("AI engine not found", ""))[1] == "agy_missing"
        assert _describe(AgyError("AI engine produced no output", ""))[1] == "no_output_file"
        assert _describe(ValueError("x"))[1] == "internal"

        print("jobs: all checks passed")

    asyncio.run(main())


if __name__ == "__main__":
    demo()
