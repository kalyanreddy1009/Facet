"""Two users, one process, no leaks.

    backend/.venv/bin/python scripts/test_multiuser.py

This is the check the whole single-instance design rests on. Everything else
in the multi-user change is plumbing; the question that matters is whether
Bob can see Alice's job applications. So it writes as Alice, reads as Bob,
and asserts absence — through the real code paths, not a mock of them.

The failures it is built to catch are the silent ones. None of these raise on
their own; each simply returns the wrong person's data:

  * a query dispatched with `run_in_executor`, which drops the ContextVar and
    resolves every path with no user set
  * a `from services.paths import DB_PATH` that bound at import time
  * a cached connection handed to whoever asks next
  * a queued job run by the worker as nobody
  * an identity that falls back to the shared directory when a header is
    missing, instead of refusing
"""

import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Redirect the roots BEFORE importing anything that reads them.
_TMP = Path(tempfile.mkdtemp(prefix="facet-multiuser-"))
os.environ["FACET_DATA_DIR"] = str(_TMP / "data")
os.environ["FACET_WORKSPACE_DIR"] = str(_TMP / "workspace")
os.environ["FACET_QUEUE_DB"] = str(_TMP / "data" / "queue.db")

from services import db, identity, jobs, paths  # noqa: E402


def _rows(sql, params=()):
    return asyncio.run(db.fetch_all(sql, params))


def _write_application(company: str) -> None:
    asyncio.run(db.execute(
        "INSERT INTO applications (company, role_title, status) VALUES (?, ?, ?)",
        (company, "Engineer", "applied"),
    ))


def check_databases_are_separate() -> None:
    """The core claim: one process, two databases, no overlap."""
    with paths.user_scope("alice"):
        db.init_db()
        _write_application("Alice Corp")
        assert len(_rows("SELECT * FROM applications")) == 1

    with paths.user_scope("bob"):
        db.init_db()
        bob_sees = _rows("SELECT * FROM applications")
        assert bob_sees == [], f"bob can see alice's applications: {bob_sees}"
        _write_application("Bob Ltd")

    # And back again — Alice must still have exactly her own row, which is
    # what fails if a cached connection were shared between them.
    with paths.user_scope("alice"):
        rows = _rows("SELECT company FROM applications")
        assert [r["company"] for r in rows] == ["Alice Corp"], rows

    with paths.user_scope("bob"):
        rows = _rows("SELECT company FROM applications")
        assert [r["company"] for r in rows] == ["Bob Ltd"], rows

    # The files really are distinct, on disk.
    with paths.user_scope("alice"):
        alice_db = paths.DB_PATH
    with paths.user_scope("bob"):
        bob_db = paths.DB_PATH
    assert alice_db != bob_db
    assert alice_db.exists() and bob_db.exists()
    print("  databases:  separate, and neither can see the other")


def check_context_survives_the_threadpool() -> None:
    """The failure that motivated `asyncio.to_thread`.

    `db.fetch_all` hands the query to a worker thread. If that dispatch drops
    the context, the query runs with no user current and reads the shared
    database — returning plausible, wrong data with no error anywhere.
    """
    async def read_as(slug):
        with paths.user_scope(slug):
            # Confirm the identity is actually visible from inside the thread,
            # not merely from the coroutine that scheduled it.
            seen = await asyncio.to_thread(paths.get_user)
            assert seen == slug, f"context lost crossing into the thread: {seen!r}"
            return await db.fetch_all("SELECT company FROM applications")

    alice = asyncio.run(read_as("alice"))
    bob = asyncio.run(read_as("bob"))
    assert [r["company"] for r in alice] == ["Alice Corp"], alice
    assert [r["company"] for r in bob] == ["Bob Ltd"], bob
    print("  threadpool: identity survives the dispatch")


def check_workspace_files_are_separate() -> None:
    """profile.json is the Stone — the most personal file in the product."""
    with paths.user_scope("alice"):
        paths.WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
        paths.PROFILE_PATH.write_text('{"name": "Alice"}', encoding="utf-8")
        alice_profile = paths.PROFILE_PATH

    with paths.user_scope("bob"):
        assert not paths.PROFILE_PATH.exists(), "bob inherited alice's profile"
        paths.WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
        paths.PROFILE_PATH.write_text('{"name": "Bob"}', encoding="utf-8")

    assert alice_profile.read_text(encoding="utf-8") == '{"name": "Alice"}'

    # Exports too — a tailored resume is as private as the profile.
    with paths.user_scope("alice"):
        alice_exports = paths.EXPORTS_DIR
    with paths.user_scope("bob"):
        assert paths.EXPORTS_DIR != alice_exports
    print("  workspace:  profiles and exports are separate")


def check_queued_jobs_run_as_their_owner() -> None:
    """A job is queued by a request and run later by a shared worker.

    The identity has to travel through the database row, because by the time
    the worker picks it up the request that queued it is long gone.
    """
    jobs.init_queue()

    with paths.user_scope("alice"):
        job_id = asyncio.run(jobs.enqueue("tailor", {"x": 1}))

    row = asyncio.run(jobs.get(job_id))
    assert row["user_slug"] == "alice", f"job did not record its owner: {row}"

    # Now run it and confirm the handler sees Alice, from a worker that was
    # started with nobody current.
    observed = {}

    async def handler(job):
        observed["user"] = paths.get_user()
        observed["db"] = paths.DB_PATH
        return {"ok": True}

    assert paths.get_user() is None, "the worker starts as nobody, by design"
    asyncio.run(jobs._execute(row, {"tailor": handler}))

    assert observed["user"] == "alice", (
        f"the worker ran alice's job as {observed['user']!r} — her tailored "
        "resume would have been written to the wrong directory"
    )
    assert "alice" in str(observed["db"])
    assert paths.get_user() is None, "the worker leaked an identity"
    print("  queue:      jobs run as whoever queued them")


def check_identity_fails_closed() -> None:
    """No header must never mean "the shared directory"."""
    os.environ["FACET_MULTIUSER"] = "1"
    try:
        for missing in (None, "", "   "):
            try:
                identity.resolve(missing)
            except identity.IdentityError as exc:
                assert exc.status == 401, exc.status
            else:
                raise AssertionError(
                    f"identity {missing!r} resolved instead of being refused"
                )
    finally:
        os.environ.pop("FACET_MULTIUSER", None)

    # A traversal in a slug must not reach outside the users directory, even
    # if a registry row somehow contained one.
    for hostile in ("../bob", "..", "a/b"):
        try:
            paths.set_user(hostile)
        except paths.InvalidUserId:
            pass
        else:
            raise AssertionError(f"{hostile!r} was accepted as a user id")
    print("  identity:   refuses rather than falling back")


def main() -> None:
    try:
        check_databases_are_separate()
        check_context_survives_the_threadpool()
        check_workspace_files_are_separate()
        check_queued_jobs_run_as_their_owner()
        check_identity_fails_closed()
        print("multiuser: all checks passed (two users, one process, no leaks)")
    finally:
        db.close_all()
        shutil.rmtree(_TMP, ignore_errors=True)


if __name__ == "__main__":
    main()
