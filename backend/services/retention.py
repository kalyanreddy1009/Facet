"""Reclaiming space without ever losing something someone wanted.

Exports accumulate forever and nothing removed them. The rule that makes
cleaning them safe is the distinction between *referenced* and *unreferenced*:
a PDF attached to a row in `applications` is part of the user's record and is
never touched, whatever its age. A PDF from a cut they abandoned is scratch.

Everything here is dry-run capable and reports what it would remove before it
removes anything. Nothing is ever deleted under disk pressure — a quota that
starts deleting is how you lose the file you meant to keep. Crossing the
quota warns; that is all it does.

`workspace/` and `tracker.db` are never touched by any sweep.
"""

import logging
import os
import sqlite3
import time
from pathlib import Path

from services.paths import DATA_DIR, EXPORTS_DIR, WORKSPACE_DIR

logger = logging.getLogger("facet.retention")


def _setting(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


# Days an unreferenced export survives. Long enough that "I meant to keep
# that" has time to happen.
EXPORT_TTL_DAYS = _setting("FACET_EXPORT_TTL_DAYS", 30)

# Completed and failed job rows. The queue is operational state; the record
# of what was cut lives in `applications`.
JOB_TTL_DAYS = _setting("FACET_JOB_TTL_DAYS", 90)

# Warns only. See the module docstring.
QUOTA_BYTES = _setting("FACET_QUOTA_MB", 2048) * 1024 * 1024


def referenced_exports(db_path: Path) -> set[str]:
    """Filenames still pointed at by an application row.

    Compared by basename because both storage forms exist: bare filenames
    from the current pipeline, and absolute paths from rows written earlier.
    A basename match is the conservative reading — it can only ever protect
    more files, never fewer, and erring toward keeping is the right bias for
    somebody's resume.
    """
    if not db_path.exists():
        # NOT an empty set. An absent database means "I cannot tell what is
        # referenced", and answering that with "nothing is" would sweep every
        # export the user has. Fail closed; the caller keeps everything.
        raise FileNotFoundError(f"no database at {db_path}")

    names: set[str] = set()
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=5)
    try:
        for row in conn.execute(
            "SELECT resume_path, docx_path, cover_letter_path FROM applications"
        ):
            for value in row:
                if value:
                    names.add(Path(value).name)
    except sqlite3.Error as exc:
        # Failing closed: an unreadable database means everything is treated
        # as referenced, so a sweep can never delete on the strength of a
        # query that did not work.
        logger.warning("[Facet] retention: could not read %s (%s) — keeping everything",
                       db_path, exc)
        raise
    finally:
        conn.close()
    return names


def sweep_exports(dry_run: bool = True, ttl_days: int | None = None,
                  db_path: Path | None = None,
                  exports_dir: Path | None = None) -> dict:
    """Remove unreferenced exports older than the TTL."""
    exports = exports_dir or EXPORTS_DIR
    ttl = (ttl_days if ttl_days is not None else EXPORT_TTL_DAYS) * 86400
    result: dict = {"removed": [], "kept_referenced": 0, "kept_recent": 0,
                    "bytes": 0, "dry_run": dry_run}
    if not exports.exists():
        return result

    try:
        keep = referenced_exports(db_path or (DATA_DIR / "tracker.db"))
    except (sqlite3.Error, OSError) as exc:
        # Missing or unreadable: keep everything. A sweep may only delete on
        # the strength of a query that actually answered.
        result["error"] = f"references unreadable, nothing swept ({exc})"
        return result

    cutoff = time.time() - ttl
    for item in sorted(exports.iterdir()):
        if not item.is_file():
            continue
        if item.name in keep:
            result["kept_referenced"] += 1
            continue
        if item.stat().st_mtime > cutoff:
            result["kept_recent"] += 1
            continue
        result["removed"].append(item.name)
        result["bytes"] += item.stat().st_size
        if not dry_run:
            item.unlink(missing_ok=True)

    if result["removed"] and not dry_run:
        logger.info("[Facet] retention: removed %s unreferenced export(s), %s bytes",
                    len(result["removed"]), result["bytes"])
    return result


def sweep_jobs(dry_run: bool = True, ttl_days: int | None = None,
               queue_db: Path | None = None) -> dict:
    """Drop finished job rows past the TTL. Queued and running are untouched."""
    from services import jobs

    db_path = queue_db or jobs.QUEUE_DB
    ttl = (ttl_days if ttl_days is not None else JOB_TTL_DAYS) * 86400
    result = {"removed": 0, "dry_run": dry_run}
    if not db_path.exists():
        return result

    cutoff = time.time() - ttl
    conn = sqlite3.connect(db_path, timeout=5)
    try:
        terminal = ",".join(f"'{s}'" for s in jobs.TERMINAL)
        sql_where = f"status IN ({terminal}) AND COALESCE(finished_at, queued_at) < ?"
        result["removed"] = conn.execute(
            f"SELECT COUNT(*) FROM jobs WHERE {sql_where}", (cutoff,)
        ).fetchone()[0]
        if not dry_run and result["removed"]:
            conn.execute(f"DELETE FROM jobs WHERE {sql_where}", (cutoff,))
            conn.commit()
    finally:
        conn.close()
    return result


def usage(data_dir: Path | None = None, workspace_dir: Path | None = None) -> dict:
    """Disk used by this instance, and whether it is over the soft quota."""
    data = data_dir or DATA_DIR
    workspace = workspace_dir or WORKSPACE_DIR

    def size(path: Path) -> int:
        if not path.exists():
            return 0
        return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())

    data_bytes, workspace_bytes = size(data), size(workspace)
    total = data_bytes + workspace_bytes
    return {
        "data": data_bytes,
        "workspace": workspace_bytes,
        "total": total,
        "quota": QUOTA_BYTES,
        "over_quota": total > QUOTA_BYTES,
        # Warns only. Deleting under pressure is how you lose the file you
        # meant to keep.
        "action": "none — quota warns, never deletes",
    }


def sweep_all(dry_run: bool = True) -> dict:
    return {
        "exports": sweep_exports(dry_run),
        "jobs": sweep_jobs(dry_run),
        "usage": usage(),
    }


def demo() -> None:
    """Self-check:  backend/.venv/python.exe -m services.retention"""
    import tempfile

    root = Path(tempfile.mkdtemp())
    exports = root / "exports"
    exports.mkdir()
    db_path = root / "tracker.db"

    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE applications (resume_path TEXT, docx_path TEXT, "
                 "cover_letter_path TEXT)")
    conn.execute("INSERT INTO applications VALUES (?, ?, ?)",
                 ("stripe.pdf", "stripe.docx", "stripe-cover-letter.pdf"))
    # A legacy row holding an absolute path must protect its file just as
    # well as a bare filename does.
    conn.execute("INSERT INTO applications VALUES (?, ?, ?)",
                 (str(exports / "legacy.pdf"), None, None))
    conn.commit()
    conn.close()

    old = time.time() - 60 * 86400
    for name in ("stripe.pdf", "stripe.docx", "stripe-cover-letter.pdf",
                 "legacy.pdf", "abandoned.pdf", "yesterday.pdf"):
        path = exports / name
        path.write_bytes(b"x" * 100)
        if name != "yesterday.pdf":
            os.utime(path, (old, old))

    assert referenced_exports(db_path) == {
        "stripe.pdf", "stripe.docx", "stripe-cover-letter.pdf", "legacy.pdf",
    }

    # Dry run reports and changes nothing.
    plan = sweep_exports(dry_run=True, db_path=db_path, exports_dir=exports)
    assert plan["removed"] == ["abandoned.pdf"], plan
    assert plan["kept_referenced"] == 4, plan
    assert plan["kept_recent"] == 1, plan
    assert (exports / "abandoned.pdf").exists(), "a dry run must not delete"

    # The real sweep removes exactly what the dry run promised.
    done = sweep_exports(dry_run=False, db_path=db_path, exports_dir=exports)
    assert done["removed"] == ["abandoned.pdf"], done
    assert not (exports / "abandoned.pdf").exists()
    # An attached resume is part of the record and survives any age.
    assert (exports / "stripe.pdf").exists()
    assert (exports / "legacy.pdf").exists()
    assert (exports / "yesterday.pdf").exists(), "inside the TTL"

    # A MISSING database keeps everything. This is the one that matters: an
    # absent tracker.db must not read as "nothing is referenced", or a sweep
    # would delete every export the user has.
    missing = sweep_exports(dry_run=False, db_path=root / "nope.db", exports_dir=exports)
    assert missing["removed"] == [] and "error" in missing, missing
    assert (exports / "stripe.pdf").exists(), "a missing database must not delete"

    (root / "corrupt.db").write_bytes(b"this is not a database")
    guarded = sweep_exports(dry_run=False, db_path=root / "corrupt.db", exports_dir=exports)
    assert guarded["removed"] == [] and "error" in guarded, guarded
    assert (exports / "stripe.pdf").exists(), "failure must not delete"

    # Jobs: finished rows age out, queued and running never do.
    queue_db = root / "queue.db"
    conn = sqlite3.connect(queue_db)
    conn.execute("CREATE TABLE jobs (id INTEGER PRIMARY KEY, status TEXT, "
                 "queued_at REAL, finished_at REAL)")
    conn.executemany("INSERT INTO jobs (status, queued_at, finished_at) VALUES (?, ?, ?)", [
        ("done", old, old), ("failed", old, old), ("cancelled", old, old),
        ("done", time.time(), time.time()),
        ("queued", old, None), ("running", old, None),
    ])
    conn.commit()
    conn.close()

    # TTL passed explicitly: the rows above are 60 days old and the default
    # is 90, so relying on the default would silently assert nothing.
    assert sweep_jobs(dry_run=True, ttl_days=30, queue_db=queue_db)["removed"] == 3
    assert sweep_jobs(dry_run=True, ttl_days=90, queue_db=queue_db)["removed"] == 0, \
        "the default TTL must spare 60-day-old rows"
    conn = sqlite3.connect(queue_db)
    assert conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 6, "dry run kept all"
    conn.close()

    assert sweep_jobs(dry_run=False, ttl_days=30, queue_db=queue_db)["removed"] == 3
    conn = sqlite3.connect(queue_db)
    left = {r[0] for r in conn.execute("SELECT status FROM jobs")}
    assert left == {"done", "queued", "running"}, left
    conn.close()

    # Usage warns, never acts.
    stats = usage(data_dir=root, workspace_dir=root / "absent")
    assert stats["total"] > 0 and stats["workspace"] == 0
    assert stats["over_quota"] is False
    assert "never deletes" in stats["action"]

    print("retention: all checks passed (referenced exports are never swept)")


if __name__ == "__main__":
    demo()
