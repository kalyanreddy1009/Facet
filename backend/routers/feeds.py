"""Job aggregation, search, and feed subscriptions — The Rough (Section 9).

Filtering, sorting and pagination all happen in SQLite, not in the browser:
the frontend never receives more than one page of rows, so the list stays
instant no matter how many postings have accumulated.
"""

import asyncio
import json
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services import db
from services.feed_ingest import load_feeds, run_feed_ingest, save_feeds
from services.job_sources import available_providers, build_feed_urls
from services.settings_store import load_settings, redacted, save_settings

router = APIRouter()

# Whitelisted so the `sort` parameter can never reach SQL as free text.
SORT_COLUMNS = {
    "match": "match_score DESC, COALESCE(posted_date, first_seen_at) DESC",
    "recent": "COALESCE(posted_date, first_seen_at) DESC",
    "salary": "COALESCE(salary_max, salary_min, 0) DESC, match_score DESC",
    "company": "company COLLATE NOCASE ASC",
    "title": "title COLLATE NOCASE ASC",
}


def decode_list(value) -> list:
    """`tags` and `match_terms` are JSON-encoded TEXT, written by ingest and
    read here. A row whose column is NULL, empty, malformed, or holding a
    non-list (an older writer, a hand-edited DB, a truncated write) must not
    take the whole job list down with a 500 — the posting is still perfectly
    readable without its tags.
    """
    if not value:
        return []
    try:
        decoded = json.loads(value)
    except (TypeError, ValueError):
        return []
    return decoded if isinstance(decoded, list) else []


class FeedCreate(BaseModel):
    url: str
    label: str


class SettingsPatch(BaseModel):
    adzuna_app_id: Optional[str] = None
    adzuna_app_key: Optional[str] = None
    adzuna_country: Optional[str] = None
    jooble_key: Optional[str] = None
    default_location: Optional[str] = None
    enabled_sources: Optional[list[str]] = None


class SearchRequest(BaseModel):
    q: str = ""
    location: str = ""


# ------------------------------------------------------------- feeds CRUD


@router.get("/api/feeds")
async def list_feeds():
    return load_feeds()


@router.post("/api/feeds")
async def add_feed(body: FeedCreate):
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="A feed URL must start with http:// or https://")
    feeds = load_feeds()
    if any(f["url"] == url for f in feeds):
        raise HTTPException(status_code=400, detail="Feed already subscribed")
    feeds.append({"url": url, "label": body.label.strip() or url})
    save_feeds(feeds)
    return feeds


@router.delete("/api/feeds")
async def remove_feed(url: str):
    feeds = [f for f in load_feeds() if f["url"] != url]
    save_feeds(feeds)
    return feeds


@router.get("/api/feeds/builder")
async def feed_builder(q: str = "", location: str = ""):
    """Ready-made saved-search URLs for LinkedIn, Naukri, Indeed and friends.

    `kind: "rss"` can be subscribed to directly; `kind: "alert"` opens the
    platform's own search so *you* create the alert there — Facet never signs
    in to a job platform on your behalf.
    """
    return build_feed_urls(q, location)


@router.post("/api/feeds/sync")
async def sync_feeds(q: str = "", location: str = ""):
    """On-demand pull across every configured source — the same code path the
    daily scheduled job runs. Off the event loop: it's network-bound."""
    return await asyncio.to_thread(run_feed_ingest, q, location)


@router.post("/api/jobs/search")
async def live_search(body: SearchRequest):
    """Query the live providers with these terms, ingest, then hand back the
    fresh counts. The frontend re-queries /api/jobs for the rows themselves."""
    return await asyncio.to_thread(run_feed_ingest, body.q.strip(), body.location.strip())


# ------------------------------------------------------------ job queries


def _build_filters(
    q: str,
    location: str,
    sources: list[str] | None,
    remote: Optional[bool],
    employment_type: str,
    min_score: float,
    max_age_days: Optional[int],
    salary_min: Optional[int],
    include_dismissed: bool,
) -> tuple[str, list]:
    clauses = []
    params: list = []

    if not include_dismissed:
        clauses.append("dismissed = 0")

    if q.strip():
        # Every word must appear somewhere in the posting — AND across terms
        # is what makes a two-word search actually narrow the list.
        for term in q.strip().split()[:8]:
            like = f"%{term.lower()}%"
            clauses.append(
                "(LOWER(title) LIKE ? OR LOWER(company) LIKE ? OR LOWER(summary) LIKE ? "
                "OR LOWER(COALESCE(tags,'')) LIKE ? OR LOWER(COALESCE(location,'')) LIKE ?)"
            )
            params.extend([like] * 5)

    if location.strip():
        clauses.append("LOWER(COALESCE(location,'')) LIKE ?")
        params.append(f"%{location.strip().lower()}%")

    if sources:
        clauses.append("source IN (%s)" % ",".join("?" * len(sources)))
        params.extend(sources)

    if remote is not None:
        clauses.append("remote = ?")
        params.append(1 if remote else 0)

    if employment_type.strip():
        clauses.append("LOWER(COALESCE(employment_type,'')) LIKE ?")
        params.append(f"%{employment_type.strip().lower()}%")

    if min_score > 0:
        clauses.append("COALESCE(match_score, 0) >= ?")
        params.append(min_score)

    if max_age_days:
        clauses.append("COALESCE(posted_date, first_seen_at) >= datetime('now', ?)")
        params.append(f"-{int(max_age_days)} days")

    if salary_min:
        clauses.append("COALESCE(salary_max, salary_min, 0) >= ?")
        params.append(int(salary_min))

    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


@router.get("/api/jobs")
async def list_jobs(
    q: str = "",
    location: str = "",
    source: list[str] = Query(default=[]),
    remote: Optional[bool] = None,
    employment_type: str = "",
    min_score: float = 0,
    max_age_days: Optional[int] = None,
    salary_min: Optional[int] = None,
    include_dismissed: bool = False,
    sort: Literal["match", "recent", "salary", "company", "title"] = "match",
    limit: int = Query(default=40, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    where, params = _build_filters(
        q, location, source, remote, employment_type, min_score,
        max_age_days, salary_min, include_dismissed,
    )
    # Boards re-list an unchanged job under a new slug, so the same posting can
    # sit in the table under two hashes. Collapsed here at read time rather than
    # by rehashing: existing rows keep the identity they were stored with, and
    # the rule stays reversible if it ever proves too aggressive. `MIN(id)` keeps
    # the first-seen copy, so the choice is stable across requests and paging.
    keep_ids = (
        f"SELECT MIN(id) FROM seen_postings{where} "
        "GROUP BY dedup_key(posting_url, title, company)"
    )
    total = (
        await db.fetch_one(f"SELECT COUNT(*) AS n FROM ({keep_ids})", tuple(params))
    )["n"]
    rows = await db.fetch_all(
        f"SELECT * FROM seen_postings WHERE id IN ({keep_ids}) "
        f"ORDER BY {SORT_COLUMNS[sort]} LIMIT ? OFFSET ?",
        tuple(params) + (limit, offset),
    )
    for row in rows:
        row["tags"] = decode_list(row.get("tags"))
        row["match_terms"] = decode_list(row.get("match_terms"))
    return {"total": total, "limit": limit, "offset": offset, "items": rows}


@router.get("/api/jobs/facets")
async def job_facets(
    q: str = "",
    location: str = "",
    remote: Optional[bool] = None,
    employment_type: str = "",
    min_score: float = 0,
    max_age_days: Optional[int] = None,
    salary_min: Optional[int] = None,
):
    """Counts per filter value, computed against the *other* active filters —
    so the source list shows how many results each source would actually add."""
    where, params = _build_filters(
        q, location, None, remote, employment_type, min_score,
        max_age_days, salary_min, False,
    )
    # Counted over the same collapsed set the list renders, or every facet would
    # promise more results than the list can show.
    keep_ids = (
        f"SELECT MIN(id) FROM seen_postings{where} "
        "GROUP BY dedup_key(posting_url, title, company)"
    )
    kept = f"SELECT * FROM seen_postings WHERE id IN ({keep_ids})"
    sources = await db.fetch_all(
        f"SELECT source, COUNT(*) AS count FROM ({kept}) "
        "GROUP BY source ORDER BY count DESC",
        tuple(params),
    )
    types = await db.fetch_all(
        f"SELECT employment_type AS value, COUNT(*) AS count FROM ({kept}) "
        "WHERE COALESCE(employment_type,'') != '' "
        "GROUP BY employment_type ORDER BY count DESC LIMIT 12",
        tuple(params),
    )
    totals = await db.fetch_one(
        f"SELECT COUNT(*) AS total, SUM(remote) AS remote_count, "
        f"SUM(CASE WHEN salary_min IS NOT NULL OR salary_max IS NOT NULL THEN 1 ELSE 0 END) AS with_salary "
        f"FROM ({kept})",
        tuple(params),
    )
    return {
        "sources": sources,
        "employment_types": types,
        "total": totals["total"] or 0,
        "remote_count": totals["remote_count"] or 0,
        "with_salary": totals["with_salary"] or 0,
        "available_providers": available_providers(),
    }


@router.get("/api/rough")
async def list_rough(limit: int = 40):
    """Back-compat alias — the plain ranked list, no filters."""
    rows = await db.fetch_all(
        f"SELECT * FROM seen_postings WHERE dismissed = 0 ORDER BY {SORT_COLUMNS['match']} LIMIT ?",
        (max(1, min(limit, 200)),),
    )
    for row in rows:
        row["tags"] = decode_list(row.get("tags"))
    return rows


@router.post("/api/rough/{posting_id}/promote")
async def promote_posting(posting_id: int):
    posting = await db.fetch_one("SELECT * FROM seen_postings WHERE id = ?", (posting_id,))
    if not posting:
        raise HTTPException(status_code=404, detail="Posting not found")
    await db.execute("UPDATE seen_postings SET promoted = 1 WHERE id = ?", (posting_id,))
    posting["promoted"] = 1
    posting["tags"] = decode_list(posting.get("tags"))
    return posting


@router.post("/api/rough/{posting_id}/dismiss")
async def dismiss_posting(posting_id: int):
    posting = await db.fetch_one("SELECT id FROM seen_postings WHERE id = ?", (posting_id,))
    if not posting:
        raise HTTPException(status_code=404, detail="Posting not found")
    await db.execute("UPDATE seen_postings SET dismissed = 1 WHERE id = ?", (posting_id,))
    return {"dismissed": True}


@router.post("/api/rough/{posting_id}/restore")
async def restore_posting(posting_id: int):
    """Undo for a mis-tapped Dismiss — the toast's action needs somewhere to go."""
    await db.execute("UPDATE seen_postings SET dismissed = 0 WHERE id = ?", (posting_id,))
    return {"dismissed": False}


# --------------------------------------------------------------- settings


@router.get("/api/settings")
async def get_settings():
    return redacted(load_settings())


@router.put("/api/settings")
async def put_settings(body: SettingsPatch):
    return redacted(save_settings(body.model_dump(exclude_none=True)))


def demo() -> None:
    """Self-check:  backend/.venv/bin/python -m routers.feeds"""
    assert decode_list(None) == []
    assert decode_list("") == []
    assert decode_list("[]") == []
    assert decode_list('["python", "remote"]') == ["python", "remote"]
    # The cases that used to be a 500 on the whole job list.
    assert decode_list("not json at all") == []
    assert decode_list('["python"') == []  # truncated write
    assert decode_list('{"a": 1}') == []  # right JSON, wrong shape
    assert decode_list("42") == []
    assert decode_list(b"\xff") == []
    print("feeds: all checks passed")


if __name__ == "__main__":
    demo()
