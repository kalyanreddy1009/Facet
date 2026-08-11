"""Dedup + upsert checks for the posting store — no network, no real feeds.

The old version of this hit live RSS feeds, which made it slow and dependent
on whatever a job board happened to be publishing that day. Same property
proven here against a throwaway database: ingesting the same posting twice
must never produce two rows, and must never resurrect a dismissal.

    backend/.venv/bin/python scripts/test_feed_dedup.py
"""

import os
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Redirect the roots BEFORE importing anything that reads them.
#
# This used to assign `db.DB_PATH = _tmp` instead. That stopped working when
# paths moved into `services.paths` and became per-request: the assignment
# bound a name nothing reads any more, so every run of this file opened the
# *real* tracker.db, wrote two test postings into it, and then asserted about
# somebody's actual data. It had been failing for that reason — "new: 0",
# because the rows were already there from the run before.
#
# Environment variables, like every other suite here, because they are read
# at import time and there is no name left to monkeypatch.
_TMP = Path(tempfile.mkdtemp(prefix="facet-dedup-"))
os.environ["FACET_DATA_DIR"] = str(_TMP / "data")
os.environ["FACET_WORKSPACE_DIR"] = str(_TMP / "workspace")
os.environ["FACET_QUEUE_DB"] = str(_TMP / "data" / "queue.db")

import services.db as db  # noqa: E402
import services.feed_ingest as feed_ingest  # noqa: E402
from services import paths  # noqa: E402
from services.job_sources import normalize  # noqa: E402

_tmp = paths.DB_PATH
assert str(_TMP) in str(_tmp), f"the test is pointed at {_tmp}, which is not a scratch database"
db.init_db()


def posting(title: str, url: str, company: str = "Acme") -> dict:
    row = normalize(
        source="TestSource",
        title=title,
        company=company,
        url=url,
        summary="Python FastAPI engineer",
        location="Remote",
    )
    assert row is not None
    return row


def count(where: str = "1=1") -> int:
    conn = sqlite3.connect(str(_tmp))
    try:
        return conn.execute(f"SELECT COUNT(*) FROM seen_postings WHERE {where}").fetchone()[0]
    finally:
        conn.close()


batch = [
    posting("Backend Engineer", "https://jobs.test/1"),
    posting("Frontend Engineer", "https://jobs.test/2"),
]

run1 = feed_ingest.store_postings(batch)
assert run1["new"] == 2, run1
assert count() == 2, count()

# Same batch again: zero new rows, zero duplicates.
run2 = feed_ingest.store_postings(batch)
assert run2["new"] == 0, run2
assert count() == 2, count()

# The same posting arriving from another board with tracking params on the URL
# is the same job, not a third row.
run3 = feed_ingest.store_postings([posting("Backend Engineer", "https://jobs.test/1?utm=linkedin")])
assert run3["new"] == 0, run3
assert count() == 2, count()

# A dismissal survives re-ingestion — otherwise every sync would resurrect
# everything the person already said no to.
conn = sqlite3.connect(str(_tmp))
conn.execute("UPDATE seen_postings SET dismissed = 1 WHERE title = 'Backend Engineer'")
conn.commit()
conn.close()
feed_ingest.store_postings(batch)
assert count("dismissed = 1") == 1, "re-ingest resurrected a dismissed posting"

# A posting past the age cutoff is dropped rather than stored.
stale = posting("Ancient Role", "https://jobs.test/old")
stale["posted_date"] = "2000-01-01T00:00:00+00:00"
run4 = feed_ingest.store_postings([stale])
assert run4["skipped_stale"] == 1, run4
assert count() == 2, count()

# --- Rescoring after the Stone changes ------------------------------------
#
# Postings are scored at ingest against whatever profile.json said then, so
# editing your resume leaves every stored row carrying the old answer — and a
# first-ever resume leaves them all at zero, which renders as no badge at all.
# That is the "I updated my resume and the score vanished" bug.


def scores() -> list[float | None]:
    conn = sqlite3.connect(str(_tmp))
    try:
        return [r[0] for r in conn.execute("SELECT match_score FROM seen_postings ORDER BY id")]
    finally:
        conn.close()


# Ingested above with no profile at all, so every score is a zero.
assert all((s or 0.0) == 0.0 for s in scores()), scores()

paths.PROFILE_PATH.parent.mkdir(parents=True, exist_ok=True)
paths.PROFILE_PATH.write_text('{"skills": ["Python", "FastAPI"], "keywords": []}', encoding="utf-8")

examined, changed = feed_ingest.rescore_stored_postings(dry_run=True)
assert examined == 2 and changed == 2, (examined, changed)
assert all((s or 0.0) == 0.0 for s in scores()), "a dry run must write nothing"

examined, changed = feed_ingest.rescore_stored_postings()
assert examined == 2 and changed == 2, (examined, changed)
assert all(s and s > 0 for s in scores()), scores()

# Idempotent: a second pass moves nothing.
assert feed_ingest.rescore_stored_postings()[1] == 0, "rescore is not idempotent"

# And it never revisits a decision the user made.
assert count("dismissed = 1") == 1, "rescoring cleared a dismissal"

print("DEDUP OK - no duplicates, dismissals stick, stale postings dropped, rescore heals scores.")
