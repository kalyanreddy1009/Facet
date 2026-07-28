"""Feed subscriptions + posting ingest for The Rough (Section 9).

RSS is now one provider among several (see services/job_sources.py); this
module owns the subscription list and the write path into `seen_postings`
that every provider shares.

Runs from APScheduler's own thread as well as from a request, so it talks to
sqlite through its own short-lived connection rather than services.db's
event-loop-bound one.
"""

import json
import sqlite3
from datetime import datetime, timedelta, timezone

from services.db import DB_PATH, apply_pragmas
from services.matching import posting_match_score, posting_match_terms
from services.paths import FEEDS_PATH, PROFILE_PATH

# Anything older than this is noise on a job board — dropping it on the way in
# is what keeps the table small enough to query instantly.
MAX_AGE = timedelta(days=45)
PRUNE_AFTER = timedelta(days=60)


DEFAULT_FEEDS = [
    {"url": "https://weworkremotely.com/categories/remote-programming-jobs.rss", "label": "We Work Remotely — Programming"},
    {"url": "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss", "label": "We Work Remotely — Front-End"},
    {"url": "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss", "label": "We Work Remotely — Back-End"},
    {"url": "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss", "label": "We Work Remotely — DevOps & SysAdmin"},
    {"url": "https://www.python.org/jobs/feed/rss/", "label": "Python.org — Official Job Board"},
    {"url": "https://himalayas.app/jobs/rss", "label": "Himalayas — Remote Tech Jobs"},
    {"url": "https://jobspresso.co/feed/?post_type=job_listing", "label": "Jobspresso — Software & Tech"},
    {"url": "https://remotefirstjobs.com/rss/jobs/python.rss", "label": "RemoteFirstJobs — Python Developer"},
    {"url": "https://workanywhere.pro/rss/developer.xml", "label": "WorkAnywhere — Software Engineering"},
]
# Removed after probing each one three times and inspecting the HTTP status,
# not just the parse error:
#   remoteok.com/remote-dev-jobs.rss  -> 410 Gone (RemoteOK's JSON API covers it)
#   remotive.com/feed                 -> 403, Cloudflare challenge; unreadable by any script
#   realworkfromanywhere.com/...      -> 404 "Category not found"
# WorkAnywhere looked equally dead (429) but is alive — see FEED_UA in
# job_sources.py. Check the status code before deleting a subscription.


def load_feeds() -> list[dict]:
    if not FEEDS_PATH.exists():
        save_feeds(DEFAULT_FEEDS)
        return list(DEFAULT_FEEDS)
    try:
        feeds = json.loads(FEEDS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return list(DEFAULT_FEEDS)
    return feeds if isinstance(feeds, list) else list(DEFAULT_FEEDS)


def save_feeds(feeds: list[dict]) -> None:
    FEEDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    FEEDS_PATH.write_text(json.dumps(feeds, indent=2), encoding="utf-8")


def load_candidate_keywords() -> list[str]:
    if not PROFILE_PATH.exists():
        return []
    try:
        profile = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return list(profile.get("keywords", [])) + list(profile.get("skills", []))


def _too_old(posted_date: str | None) -> bool:
    if not posted_date:
        return False  # undated postings are usually fresh; keep them
    try:
        posted = datetime.fromisoformat(posted_date)
    except ValueError:
        return False
    if posted.tzinfo is None:
        posted = posted.replace(tzinfo=timezone.utc)
    return posted < datetime.now(timezone.utc) - MAX_AGE


def store_postings(postings: list[dict]) -> dict:
    """Upsert normalized postings, scoring each against the Stone.

    Re-seeing a posting refreshes `last_seen_at` and its score but never
    resurrects one you dismissed — that decision sticks.
    """
    keywords = load_candidate_keywords()
    now = datetime.now(timezone.utc).isoformat()
    new_count = 0
    seen_count = 0
    skipped_old = 0

    conn = sqlite3.connect(str(DB_PATH))
    try:
        apply_pragmas(conn)
        for posting in postings:
            if _too_old(posting.get("posted_date")):
                skipped_old += 1
                continue

            is_new = conn.execute(
                "SELECT 1 FROM seen_postings WHERE posting_hash = ?", (posting["posting_hash"],)
            ).fetchone() is None

            haystack = (
                f"{posting['title']} {posting['company']} {posting['summary']} "
                f"{' '.join(posting['tags'])}"
            )
            score = posting_match_score(haystack, keywords)
            matched = posting_match_terms(haystack, keywords)
            conn.execute(
                """INSERT INTO seen_postings
                     (posting_hash, source_feed, source, company, title, posting_url,
                      posted_date, summary, match_score, location, remote,
                      employment_type, salary_min, salary_max, salary_currency,
                      tags, last_seen_at, match_terms)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(posting_hash) DO UPDATE SET
                     last_seen_at = excluded.last_seen_at,
                     -- Score and its evidence always move together; a stale
                     -- term list next to a fresh score is worse than neither.
                     match_score  = excluded.match_score,
                     match_terms  = excluded.match_terms,
                     summary      = COALESCE(NULLIF(excluded.summary, ''), seen_postings.summary),
                     location     = COALESCE(NULLIF(excluded.location, ''), seen_postings.location),
                     salary_min   = COALESCE(excluded.salary_min, seen_postings.salary_min),
                     salary_max   = COALESCE(excluded.salary_max, seen_postings.salary_max),
                     -- Title/company/source refresh too, so a parsing fix
                     -- heals rows already in the table on the next sync
                     -- instead of leaving them wrong forever. Guarded: a
                     -- blank or unknown value never overwrites a real one.
                     title        = COALESCE(NULLIF(excluded.title, ''), seen_postings.title),
                     company      = CASE
                                      WHEN excluded.company IN ('', 'Unknown company')
                                        THEN seen_postings.company
                                      ELSE excluded.company
                                    END,
                     source       = COALESCE(NULLIF(excluded.source, ''), seen_postings.source),
                     tags         = COALESCE(NULLIF(excluded.tags, '[]'), seen_postings.tags),
                     employment_type = COALESCE(
                                         NULLIF(excluded.employment_type, ''),
                                         seen_postings.employment_type
                                       ),
                     remote       = excluded.remote""",
                (
                    posting["posting_hash"],
                    posting["source"],
                    posting["source"],
                    posting["company"],
                    posting["title"],
                    posting["posting_url"],
                    posting["posted_date"],
                    posting["summary"],
                    score,
                    posting["location"],
                    posting["remote"],
                    posting["employment_type"],
                    posting["salary_min"],
                    posting["salary_max"],
                    posting["salary_currency"],
                    json.dumps(posting["tags"]),
                    now,
                    json.dumps(matched),
                ),
            )
            seen_count += 1
            new_count += is_new

        # Prune: postings nobody has seen in two months and that never became
        # an application. Keeps the table — and every query on it — small.
        cutoff = (datetime.now(timezone.utc) - PRUNE_AFTER).isoformat()
        conn.execute(
            "DELETE FROM seen_postings WHERE promoted = 0 AND COALESCE(last_seen_at, first_seen_at) < ?",
            (cutoff,),
        )
        conn.commit()
    finally:
        conn.close()

    return {"stored": seen_count, "new": new_count, "skipped_stale": skipped_old}


def run_feed_ingest(query: str = "", location: str = "", providers: list[str] | None = None) -> dict:
    """One pull across every configured source. Also the daily scheduled job."""
    from services.job_sources import fetch_all  # imported late: job_sources imports us

    postings, report = fetch_all(query=query, location=location, providers=providers)
    return {"sources": report, **store_postings(postings)}
