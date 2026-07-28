"""Dedup + upsert checks for the posting store — no network, no real feeds.

The old version of this hit live RSS feeds, which made it slow and dependent
on whatever a job board happened to be publishing that day. Same property
proven here against a throwaway database: ingesting the same posting twice
must never produce two rows, and must never resurrect a dismissal.

    python scripts/test_feed_dedup.py
"""

import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import services.db as db  # noqa: E402

# Point every module at a scratch database before anything opens the real one.
_tmp = Path(tempfile.mkdtemp()) / "test_tracker.db"
db.DB_PATH = _tmp

import services.feed_ingest as feed_ingest  # noqa: E402
from services.job_sources import normalize  # noqa: E402

feed_ingest.DB_PATH = _tmp
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

print("DEDUP OK — no duplicates, dismissals stick, stale postings dropped.")
