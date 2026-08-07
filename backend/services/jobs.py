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

from services import paths
from services.paths import DATA_DIR  # host-wide: the queue is shared by design

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
    # Additive, like tracker.db's: a queue written by the single-user build
    # has no user_slug, and those rows are the local user's by definition.
    # `user_id` above is the old integer column and stays untouched.
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(jobs)")}
    if "user_slug" not in existing:
        conn.execute("ALTER TABLE jobs ADD COLUMN user_slug TEXT")
    conn.commit()


async def _run(fn, *args):
    """Every queue statement goes through one lock and a thread, for the same
    reason tracker.db does: keep sqlite off the event loop.

    `asyncio.to_thread`, not `run_in_executor` — it copies the caller's
    context, which is what carries the current user into the thread. The queue
    database itself is host-wide, but handlers dispatched from here read the
    user's own files.
    """
    async with _lock:
        return await asyncio.to_thread(fn, *args)


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
    # Stamped from the ambient identity rather than passed in by each caller.
    # A job that forgot to record its owner would be run by the worker as
    # whoever happened to be current — which is nobody, so it would read the
    # shared directory instead of the person's own.
    cur = conn.execute(
        "INSERT INTO jobs (user_id, user_slug, kind, status, payload, queued_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, paths.get_user(), kind, QUEUED, json.dumps(payload), time.time()),
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
    # Only a job still marked running may be finished. A cancel sets the row
    # to `cancelled` and *then* the agy process dies, so the handler raises a
    # moment later — without this guard that late failure would overwrite the
    # cancellation and the row would read `failed` for something the user
    # deliberately stopped.
    conn.execute(
        "UPDATE jobs SET status = ?, result = ?, error = ?, error_kind = ?, "
        f"finished_at = ? WHERE id = ? AND status = '{RUNNING}'",
        (status, json.dumps(result) if result is not None else None,
         error, error_kind, time.time(), job_id),
    )
    conn.commit()


def _cancel(job_id: int) -> tuple[bool, str]:
    """Cancel a job, queued or running.

    A queued job is simply marked. A running one means an agy subprocess is
    in flight, so the process tree is stopped first and the row is marked
    only if that succeeded — reporting a job cancelled while the process
    keeps burning the CLI would be a lie the rest of the system has to live
    with.
    """
    conn = _connect()
    row = conn.execute("SELECT status, worker_pid FROM jobs WHERE id = ?",
                       (job_id,)).fetchone()
    if row is None:
        return False, "no such job"
    if row["status"] in TERMINAL:
        return False, f"already {row['status']}"

    if row["status"] == RUNNING:
        if row["worker_pid"] != os.getpid():
            # Another process owns that subprocess and we cannot signal it
            # from here. Refuse rather than mark a row for work that carries
            # on regardless.
            return False, f"running in another process (pid {row['worker_pid']})"

        from services.agy_runner import terminate_current  # avoids a cycle

        if not terminate_current(f"job {job_id} cancelled"):
            return False, "the run has already finished"

    conn.execute(
        "UPDATE jobs SET status = ?, error = ?, error_kind = ?, finished_at = ? "
        "WHERE id = ?",
        (CANCELLED, "Cancelled.", "cancelled", time.time(), job_id),
    )
    conn.commit()
    return True, "cancelled"


async def cancel(job_id: int) -> tuple[bool, str]:
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

    # Job ids are sequential across everybody, so without this check any user
    # can read -- or cancel -- another user's job by counting upwards. The
    # payload of a tailor job is the company and the full job description.
    #
    # `None` rather than an exception: every caller already treats it as "no
    # such job", which is also the right thing to tell somebody probing.
    user = paths.get_user()
    if user is not None and job.get("user_slug") != user:
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
    """The newest job of a kind, in this user's scope, shaped exactly like
    `_get` — including `position`.

    It used to build the dict itself, which meant it returned a row with no
    `position` key and no user filter. `/api/resume/extraction-status` reads
    `job["position"]`, so every poll after a resume save 500'd: the Stone page
    spun forever and the profile — and so every match score derived from it —
    never refreshed. Going through `_get` means the two can't drift again.
    """
    conn = _connect()
    user = paths.get_user()
    if user is None:
        row = conn.execute(
            "SELECT id FROM jobs WHERE kind = ? ORDER BY id DESC LIMIT 1", (kind,)
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT id FROM jobs WHERE kind = ? AND user_slug = ? ORDER BY id DESC LIMIT 1",
            (kind, user),
        ).fetchone()
    return _get(row[0]) if row else None


async def latest(kind: str) -> dict | None:
    """The most recent job of a kind — for endpoints that report "what is the
    state of X" rather than tracking a specific job id."""
    return await _run(_latest, kind)


def _recent(limit: int) -> list[dict]:
    conn = _connect()
    # Scoped to the current user. The queue table is host-wide -- one worker
    # drains everyone's jobs -- so an unscoped SELECT here hands one person
    # every other person's job payloads, which contain the company and the
    # full job description they are applying to.
    user = paths.get_user()
    if user is None:
        rows = conn.execute(
            "SELECT * FROM jobs ORDER BY queued_at DESC LIMIT ?", (limit,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM jobs WHERE user_slug = ? ORDER BY queued_at DESC LIMIT ?",
            (user, limit),
        ).fetchall()
    return [_row_to_job(r) for r in rows]


async def recent(limit: int = 50) -> list[dict]:
    return await _run(_recent, limit)


def _stats() -> dict:
    conn = _connect()
    user = paths.get_user()
    if user is None:
        rows = conn.execute("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status")
    else:
        rows = conn.execute(
            "SELECT status, COUNT(*) AS n FROM jobs WHERE user_slug = ? GROUP BY status",
            (user,),
        )
    counts = {row["status"]: row["n"] for row in rows}
    return {
        "queued": counts.get(QUEUED, 0),
        "running": counts.get(RUNNING, 0),
        "done": counts.get(DONE, 0),
        "failed": counts.get(FAILED, 0),
        "cancelled": counts.get(CANCELLED, 0),
    }


async def stats() -> dict:
    return await _run(_stats)


def _percentile(values: list[float], fraction: float) -> float | None:
    """Nearest-rank percentile. No numpy for two numbers on a dashboard."""
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(fraction * len(ordered)) - 1))
    return round(ordered[index], 1)


def _metrics(days: int) -> dict:
    """How long people wait, how long runs take, and why they fail.

    Failure reasons are bucketed rather than counted together because the
    buckets have genuinely different fixes: `timeout` means agy is slow or
    wedged, `agy_missing` means PATH, `no_output_file` almost always means
    --add-dir. "3 failures" is noise; "3 failures, all no_output_file" points
    straight at the cause.
    """
    conn = _connect()
    since = time.time() - days * 86400

    waits, runs = [], []
    for row in conn.execute(
        "SELECT queued_at, started_at, finished_at FROM jobs "
        "WHERE started_at IS NOT NULL AND queued_at >= ?", (since,)
    ):
        waits.append(row["started_at"] - row["queued_at"])
        if row["finished_at"]:
            runs.append(row["finished_at"] - row["started_at"])

    reasons = {
        row["error_kind"]: row["n"]
        for row in conn.execute(
            "SELECT error_kind, COUNT(*) AS n FROM jobs "
            f"WHERE status = '{FAILED}' AND queued_at >= ? AND error_kind IS NOT NULL "
            "GROUP BY error_kind ORDER BY n DESC", (since,)
        )
    }
    completed = conn.execute(
        f"SELECT COUNT(*) FROM jobs WHERE status IN ('{DONE}', '{FAILED}') "
        "AND queued_at >= ?", (since,)
    ).fetchone()[0]
    failed = sum(reasons.values())

    return {
        "window_days": days,
        "completed": completed,
        "failed": failed,
        "failure_rate": round(failed / completed, 3) if completed else 0.0,
        "wait_p50": _percentile(waits, 0.50),
        "wait_p95": _percentile(waits, 0.95),
        "run_p50": _percentile(runs, 0.50),
        "run_p95": _percentile(runs, 0.95),
        "failure_reasons": reasons,
    }


async def metrics(days: int = 30) -> dict:
    return await _run(_metrics, days)


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
    """Run one job as the user who queued it.

    The whole body is inside `user_scope`, so the handler — and everything it
    touches, including tracker.db and the workspace — resolves to that user's
    files. Without it the worker serves every job as nobody and writes each
    person's tailored resume into the shared directory.
    """
    with paths.user_scope(job.get("user_slug")):
        await _execute_scoped(job, handlers)


async def _execute_scoped(job: dict, handlers: dict[str, Handler]) -> None:
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
        # Shutdown. Stop agy too — the handler runs in an executor thread
        # that cancellation does not reach, so without this the subprocess
        # outlives the process that started it and keeps holding the CLI.
        from services.agy_runner import terminate_current

        terminate_current("shutting down")
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
    from services.agy_runner import AgyCancelled, AgyError  # local: avoids a cycle

    if isinstance(exc, AgyCancelled):
        return "Cancelled.", "cancelled"
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
    """Self-check:  backend/.venv/bin/python -m services.jobs"""
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
        assert (await cancel(b))[0] is True
        assert (await get(b))["status"] == CANCELLED
        again, reason = await cancel(b)
        assert again is False and "already cancelled" in reason, reason
        assert (await cancel(9999))[0] is False, "unknown job cannot be cancelled"

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

        # `latest` must be shaped like `get` — the extraction-status endpoint
        # reads `position` off it, and a missing key there 500'd every poll.
        assert await latest("nothing-of-this-kind") is None
        newest = await latest("tailor")
        assert newest is not None and newest["id"] == b, newest
        assert "position" in newest, newest

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

        # A cancel that lands while the handler is still running must win.
        # The handler fails a moment later — the process it was waiting on
        # was just killed — and that late failure must not overwrite the
        # cancellation, or a deliberate stop would read as an error.
        late = await enqueue("tailor", {})
        job = await _run(_claim)

        async def cancels_itself(j):
            conn = _connect()
            conn.execute("UPDATE jobs SET status = ?, error_kind = ? WHERE id = ?",
                         (CANCELLED, "cancelled", j["id"]))
            conn.commit()
            raise RuntimeError("agy was killed")

        await _execute(job, {"tailor": cancels_itself})
        finished_late = await get(late)
        assert finished_late["status"] == CANCELLED, finished_late
        assert finished_late["error_kind"] == "cancelled", finished_late

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

        # Metrics: percentiles, and failures bucketed by cause.
        stats_now = await metrics(30)
        assert stats_now["completed"] >= 2, stats_now
        assert stats_now["failed"] >= 1, stats_now
        assert stats_now["failure_reasons"].get("internal") == 1, stats_now
        assert stats_now["run_p50"] is not None and stats_now["run_p50"] >= 0
        assert 0 <= stats_now["failure_rate"] <= 1, stats_now
        # A window that excludes everything reports zeroes, not a crash.
        assert (await metrics(0))["completed"] == 0

        assert _percentile([], 0.5) is None
        assert _percentile([1.0], 0.5) == 1.0
        assert _percentile([1.0, 2.0, 3.0, 4.0], 0.5) == 2.0
        assert _percentile([1.0, 2.0, 3.0, 4.0], 0.95) == 4.0

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


def _agy_queue() -> dict:
    """What agy is doing, from this user's point of view.

    There is one authenticated agy CLI on this host, so a run belonging to
    somebody else genuinely delays yours -- and saying so is the difference
    between "Facet is slow" and "you are third in line".

    Only counts and positions cross this boundary. Never a payload, never an
    email, never a slug: whose job is running is not this user's business,
    but *that* one is running very much is.
    """
    conn = _connect()
    user = paths.get_user()

    queued = conn.execute(
        f"SELECT id, user_slug, kind, queued_at FROM jobs "
        f"WHERE status = '{QUEUED}' ORDER BY id"
    ).fetchall()
    running = conn.execute(
        f"SELECT id, user_slug, kind, started_at FROM jobs WHERE status = '{RUNNING}'"
    ).fetchall()

    mine = []
    for position, row in enumerate(queued):
        if row["user_slug"] == user:
            mine.append({
                "id": row["id"],
                "kind": row["kind"],
                "queued_at": row["queued_at"],
                # 1-based, and counted across everyone: agy is shared, so a
                # position that ignored other people's jobs would be a lie.
                "position": position + 1,
                "ahead": position,
            })

    mine_running = [
        {"id": r["id"], "kind": r["kind"], "started_at": r["started_at"]}
        for r in running if r["user_slug"] == user
    ]

    return {
        "mine": {"queued": mine, "running": mine_running},
        "system": {
            # Numbers only.
            "queued": len(queued),
            "running": len(running),
            "busy_with_someone_else": any(r["user_slug"] != user for r in running),
        },
    }


async def agy_queue() -> dict:
    return await _run(_agy_queue)
