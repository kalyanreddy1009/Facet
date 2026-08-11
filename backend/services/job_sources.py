"""Job aggregation across public job APIs + the RSS feeds you've subscribed to.

Every source here is either a documented public API or a feed a board itself
publishes. Nothing logs into a job platform on your behalf and nothing scrapes
a login-gated page — see README "Where the line is". LinkedIn / Naukri /
Indeed postings reach you two ways, both first-party:

  * Jooble (`jooble_key`) is an aggregator whose index already contains
    postings syndicated from those boards, returned through their own API.
  * `build_feed_urls()` constructs the saved-search / job-alert URL for each
    platform so you can subscribe on the platform itself in one click.

Providers are independent: one being down, rate-limited or unconfigured
degrades to fewer results, never to an error.
"""

from __future__ import annotations

import hashlib
import html
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable, Iterable
from urllib.parse import quote_plus

import feedparser
import httpx

from services.settings_store import load_settings

USER_AGENT = "Facet/2.0 (local job-search assistant; +https://github.com/)"
TIMEOUT = httpx.Timeout(12.0, connect=6.0)
MAX_PER_SOURCE = 200

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")

logger = logging.getLogger("facet.job_sources")

# Last observed outcome per source, for /api/status. In-memory on purpose:
# it describes what *this* process has seen, and a restart legitimately
# resets it to "unknown". Written by _record_feed() and fetch_all().
FEED_HEALTH: dict[str, dict] = {}
LAST_RUN: dict = {"at": None, "report": {}, "postings": 0}


def _record_feed(feed: dict, status: str, entries: int, error: str | None, started: float) -> None:
    FEED_HEALTH[feed["url"]] = {
        "url": feed["url"],
        "label": feed.get("label") or feed["url"],
        "status": status,
        "entries": entries,
        "error": error,
        "ms": int((time.monotonic() - started) * 1000),
        "at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------- helpers


# "JÃºnior" is "Júnior" that went through UTF-8 -> latin-1 -> UTF-8. Several
# of these APIs serve it that way; without repair it reaches the card as
# visible garbage.
_MOJIBAKE_MARKERS = ("Ã", "â€", "Â")


def fix_mojibake(text: str) -> str:
    if not any(marker in text for marker in _MOJIBAKE_MARKERS):
        return text
    try:
        repaired = text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text  # not this flavour of broken; leave it alone
    # Only accept the repair if it actually removed markers — otherwise a
    # legitimately accented string could be mangled instead of fixed.
    before = sum(text.count(m) for m in _MOJIBAKE_MARKERS)
    after = sum(repaired.count(m) for m in _MOJIBAKE_MARKERS)
    return repaired if after < before else text


def clean_text(raw: str | None, limit: int = 1200) -> str:
    """HTML fragment -> readable plain text. Job APIs return wildly
    inconsistent markup; the card only ever shows a short excerpt."""
    if not raw:
        return ""
    text = _TAG_RE.sub(" ", str(raw))
    text = html.unescape(text)
    text = fix_mojibake(text)
    text = _WS_RE.sub(" ", text).replace("\n ", "\n").strip()
    return text[:limit]


def _iso(value) -> str | None:
    """Normalize the half-dozen date shapes these APIs return to UTC ISO-8601."""
    if value in (None, "", 0):
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
        except (ValueError, OSError, OverflowError):
            return None
    text = str(value).strip()
    if text.isdigit():  # epoch seconds arriving as a string
        return _iso(int(text))
    text = text.replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y %H:%M:%S"):
        try:
            dt = datetime.fromisoformat(text) if fmt is None else datetime.strptime(text, fmt)
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    # Last resort: RFC-822, which is what most RSS feeds actually emit.
    try:
        dt = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _money(value) -> int | None:
    if value in (None, "", 0):
        return None
    try:
        amount = int(float(value))
    except (TypeError, ValueError):
        digits = re.sub(r"[^\d]", "", str(value))
        if not digits:
            return None
        amount = int(digits)
    return amount or None


def _is_remote(*parts: str | None) -> bool:
    blob = " ".join(p for p in parts if p).lower()
    return any(word in blob for word in ("remote", "anywhere", "work from home", "wfh"))


# ponytail: two hardcoded conventions, not a parser. Job feeds that carry no
# structured company field overwhelmingly use one of these two title shapes.
# If a feed shows up using a third, add it here rather than reaching for
# something cleverer — a wrong guess is worse than "Unknown company".
def split_company(title: str) -> tuple[str, str]:
    """('Acme: Senior Engineer') -> ('Senior Engineer', 'Acme').

    Deliberately does NOT split on commas: "Lead Analyst, Player Analytics"
    would yield a company named "Player Analytics".
    """
    title = title.strip()

    # "Senior Engineer at Acme" — rpartition so "at" inside the role survives.
    if " at " in title:
        role, _, company = title.rpartition(" at ")
        if role.strip() and company.strip():
            return role.strip(), company.strip()

    # "Acme: Senior Engineer" — the We Work Remotely / Remotive convention.
    # Only the first colon, and only when the left side is short enough to be
    # a company name rather than a role with a subtitle.
    if ": " in title:
        company, _, role = title.partition(": ")
        if role.strip() and 1 < len(company.strip()) <= 40 and "," not in company:
            return role.strip(), company.strip()

    return title, ""


def posting_key(url: str | None, title: str, company: str) -> str:
    """Stable dedup identity. The same job syndicated to three boards has three
    URLs, so title+company is the fallback that actually collapses duplicates."""
    basis = (url or "").split("?")[0].strip().lower()
    if not basis:
        basis = f"{title.strip().lower()}|{company.strip().lower()}"
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


# A board that re-lists an unchanged job mints a new slug by appending a
# counter or a fresh internal id: `/coinbase-senior-software-engineer` becomes
# `/coinbase-senior-software-engineer-1`. Different URL, so a different
# `posting_key` — which is why the same job shows up twice.
#
# Only a suffix *inside* the last path segment counts, i.e. preceded by a
# hyphen. This is the whole reason python.org survives: `/jobs/8117/` and
# `/jobs/8107/` are digits as their own segment, so nothing is stripped and two
# genuinely different postings stay two rows. Strip by segment instead and
# every python.org job collapses into one.
_REPOST_SUFFIX = re.compile(r"-\d+$")


def canonical_posting_url(url: str | None) -> str:
    """A posting URL with query string, trailing slash and repost suffix gone."""
    base = (url or "").split("?")[0].split("#")[0].strip().lower().rstrip("/")
    return _REPOST_SUFFIX.sub("", base)


def dedup_key(url: str | None, title: str | None, company: str | None) -> str:
    """Group key for collapsing re-listings of one posting at read time.

    Deliberately conservative: the canonical URL alone would merge "Engineer
    Level 1" with "Engineer Level 2" (`…-engineer-1` / `…-engineer-2`), so the
    title and company have to match too. Two postings only collapse when all
    three agree — a job seeker losing a real opening to over-eager dedup is a
    worse failure than seeing one row twice.

    Rows with no URL fall back to their own identity and never group.
    """
    canonical = canonical_posting_url(url)
    if not canonical:
        return f"id:{(title or '').strip().lower()}|{(company or '').strip().lower()}"
    return f"{canonical}|{(title or '').strip().lower()}|{(company or '').strip().lower()}"


def normalize(
    *,
    source: str,
    title: str | None,
    company: str | None,
    url: str | None,
    location: str | None = None,
    summary: str | None = None,
    posted_at=None,
    employment_type: str | None = None,
    salary_min=None,
    salary_max=None,
    salary_currency: str | None = None,
    tags: Iterable[str] | None = None,
    remote: bool | None = None,
) -> dict | None:
    title = clean_text(title, 200).strip()
    if not title:
        return None  # a posting with no title is unusable in the UI
    company = clean_text(company, 120).strip() or "Unknown company"
    location = clean_text(location, 120).strip()
    tag_list = sorted({clean_text(t, 40).strip().lower() for t in (tags or []) if t})[:12]
    return {
        "posting_hash": posting_key(url, title, company),
        "source": source,
        "title": title,
        "company": company,
        "posting_url": (url or "").strip(),
        "location": location,
        "summary": clean_text(summary),
        "posted_date": _iso(posted_at),
        "employment_type": clean_text(employment_type, 40).strip().lower(),
        "salary_min": _money(salary_min),
        "salary_max": _money(salary_max),
        "salary_currency": (salary_currency or "").strip().upper()[:8],
        "tags": tag_list,
        "remote": 1 if (remote if remote is not None else _is_remote(location, title, " ".join(tag_list))) else 0,
    }


def _get_json(client: httpx.Client, url: str, **kwargs):
    response = client.get(url, timeout=TIMEOUT, **kwargs)
    response.raise_for_status()
    return response.json()


def _as_list(value) -> list:
    """A JSON field that is *supposed* to be a list, coerced into one.

    PHP serializes a sparse array as an object, so a field that is a list in
    174 rows arrives as `{"1": "manager"}` in the 175th. `job_types[0]` then
    raises KeyError(0) and — because a provider is all-or-nothing — one odd row
    cost the entire Arbeitnow batch, every sync, silently: the failure is a
    WARNING in the log and an empty provider in the report.

    Order is the insertion order the server sent, which is the only ordering
    information there is; the numeric keys are indices, not a ranking.
    """
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return list(value.values())
    if isinstance(value, str):
        return [value]  # a single tag sent bare rather than wrapped
    return []


# ---------------------------------------------------------------- providers
# Each takes (client, query, location, settings) and returns normalized dicts.
# Raising is fine — fetch_all() isolates every provider.


def _remoteok(client, query, location, settings):
    # First element of the array is RemoteOK's legal notice, not a job.
    data = _get_json(client, "https://remoteok.com/api")
    out = []
    for row in data[1:]:
        if not isinstance(row, dict):
            continue
        out.append(
            normalize(
                source="RemoteOK",
                title=row.get("position") or row.get("title"),
                company=row.get("company"),
                url=row.get("url") or row.get("apply_url"),
                location=row.get("location") or "Remote",
                summary=row.get("description"),
                posted_at=row.get("date") or row.get("epoch"),
                salary_min=row.get("salary_min"),
                salary_max=row.get("salary_max"),
                salary_currency="USD",
                tags=row.get("tags") or [],
                remote=True,
            )
        )
    return out


def _arbeitnow(client, query, location, settings):
    data = _get_json(client, "https://www.arbeitnow.com/api/job-board-api")
    out = []
    for row in data.get("data", []):
        job_types = _as_list(row.get("job_types"))
        out.append(
            normalize(
                source="Arbeitnow",
                title=row.get("title"),
                company=row.get("company_name"),
                url=row.get("url"),
                location=row.get("location"),
                summary=row.get("description"),
                posted_at=row.get("created_at"),
                employment_type=job_types[0] if job_types else None,
                tags=_as_list(row.get("tags")) + job_types,
                remote=bool(row.get("remote")),
            )
        )
    return out


def _jobicy(client, query, location, settings):
    url = "https://jobicy.com/api/v2/remote-jobs?count=50"
    if query:
        url += f"&tag={quote_plus(query)}"
    data = _get_json(client, url)
    out = []
    for row in data.get("jobs", []):
        job_types = _as_list(row.get("jobType"))
        out.append(
            normalize(
                source="Jobicy",
                title=row.get("jobTitle"),
                company=row.get("companyName"),
                url=row.get("url"),
                location=row.get("jobGeo") or "Remote",
                summary=row.get("jobExcerpt") or row.get("jobDescription"),
                posted_at=row.get("pubDate"),
                employment_type=job_types[0] if job_types else None,
                salary_min=row.get("annualSalaryMin"),
                salary_max=row.get("annualSalaryMax"),
                salary_currency=row.get("salaryCurrency"),
                tags=_as_list(row.get("jobIndustry")) + job_types,
                remote=True,
            )
        )
    return out


def _himalayas(client, query, location, settings):
    data = _get_json(client, "https://himalayas.app/jobs/api?limit=50")
    out = []
    for row in data.get("jobs", []):
        out.append(
            normalize(
                source="Himalayas",
                title=row.get("title"),
                company=row.get("companyName"),
                url=row.get("applicationLink") or row.get("guid"),
                location=", ".join(row.get("locationRestrictions") or []) or "Remote",
                summary=row.get("excerpt") or row.get("description"),
                posted_at=row.get("pubDate"),
                employment_type=row.get("employmentType"),
                salary_min=row.get("minSalary"),
                salary_max=row.get("maxSalary"),
                salary_currency="USD",
                tags=row.get("categories") or [],
                remote=True,
            )
        )
    return out


def _adzuna(client, query, location, settings):
    app_id = settings.get("adzuna_app_id")
    app_key = settings.get("adzuna_app_key")
    if not (app_id and app_key):
        return []
    country = (settings.get("adzuna_country") or "in").lower()
    params = {
        "app_id": app_id,
        "app_key": app_key,
        "results_per_page": 50,
        "content-type": "application/json",
    }
    if query:
        params["what"] = query
    if location:
        params["where"] = location
    data = _get_json(client, f"https://api.adzuna.com/v1/api/jobs/{country}/search/1", params=params)
    out = []
    for row in data.get("results", []):
        out.append(
            normalize(
                source="Adzuna",
                title=row.get("title"),
                company=(row.get("company") or {}).get("display_name"),
                url=row.get("redirect_url"),
                location=(row.get("location") or {}).get("display_name"),
                summary=row.get("description"),
                posted_at=row.get("created"),
                employment_type=row.get("contract_time"),
                salary_min=row.get("salary_min"),
                salary_max=row.get("salary_max"),
                salary_currency={"in": "INR", "gb": "GBP", "us": "USD"}.get(country, ""),
                tags=[(row.get("category") or {}).get("label", "")],
            )
        )
    return out


def _jooble(client, query, location, settings):
    """Jooble's index already aggregates postings syndicated from LinkedIn,
    Indeed, Naukri and company boards — this is the legitimate route to those
    listings, via their own API, with no scraping and no login."""
    key = settings.get("jooble_key")
    if not key:
        return []
    body = {"keywords": query or "software engineer", "page": "1"}
    if location:
        body["location"] = location
    response = client.post(f"https://jooble.org/api/{key}", json=body, timeout=TIMEOUT)
    response.raise_for_status()
    out = []
    for row in response.json().get("jobs", []):
        out.append(
            normalize(
                source=f"Jooble · {row.get('source') or 'aggregated'}",
                title=row.get("title"),
                company=row.get("company"),
                url=row.get("link"),
                location=row.get("location"),
                summary=row.get("snippet"),
                posted_at=row.get("updated"),
                employment_type=row.get("type"),
                salary_min=row.get("salary"),
            )
        )
    return out


# Job boards routinely reject feedparser's default User-Agent — WorkAnywhere
# answers 429 to it and 200 with 50 entries to a normal browser string. This
# is a plain GET of a public feed either way; it isn't evading a login or a
# paywall, it's asking not to be mistaken for a scraper.
FEED_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)


class FeedFetchError(RuntimeError):
    """Non-200 from a feed — carries the status so the dashboard can say
    'gone' vs 'rate-limited' vs 'blocked' instead of a parser error."""


def _fetch_feed(client: httpx.Client, url: str):
    """Fetch the bytes ourselves, then parse.

    Letting feedparser fetch means its own User-Agent and no redirect/timeout
    control, and a rejected request surfaces as a confusing XML parse error
    ("mismatched tag") rather than the real cause (410, 403, 429).
    """
    try:
        response = client.get(url, headers={"User-Agent": FEED_UA}, timeout=TIMEOUT)
    except httpx.HTTPError as exc:
        raise FeedFetchError(f"{type(exc).__name__}: {exc}") from exc

    if response.status_code != 200:
        raise FeedFetchError(f"HTTP {response.status_code} {HTTP_REASON.get(response.status_code, '')}".strip())

    return feedparser.parse(response.content)


HTTP_REASON = {
    403: "- blocked (bot protection); this feed can't be read by a script",
    404: "- not found; the feed URL has moved or the category was removed",
    410: "- gone; the publisher has permanently retired this feed",
    429: "- rate limited; it should recover on the next sync",
    500: "- the feed's own server errored",
    503: "- the feed's server is unavailable",
}


def _rss_feeds(client, query, location, settings):
    """The subscribed-feeds path — where a LinkedIn or Naukri saved-search
    alert lands once you've subscribed to it on the platform itself."""
    from services.feed_ingest import load_feeds

    out = []
    for feed in load_feeds():
        started = time.monotonic()
        try:
            parsed = _fetch_feed(client, feed["url"])
        except Exception as exc:  # noqa: BLE001 — one dead feed never fails the run
            _record_feed(feed, "error", 0, f"{type(exc).__name__}: {exc}", started)
            logger.warning("feed %s failed to parse: %r", feed.get("url"), exc)
            continue
        if parsed.bozo and not parsed.entries:
            reason = str(getattr(parsed, "bozo_exception", "")) or "malformed feed, no entries"
            _record_feed(feed, "error", 0, reason, started)
            logger.warning("feed %s returned no usable entries: %s", feed.get("url"), reason)
            continue
        _record_feed(
            feed,
            "ok",
            len(parsed.entries),
            str(getattr(parsed, "bozo_exception", "")) if parsed.bozo else None,
            started,
        )
        for entry in parsed.entries[:MAX_PER_SOURCE]:
            title = getattr(entry, "title", "") or ""
            company = getattr(entry, "author", "") or ""
            if not company:
                title, company = split_company(title)
            out.append(
                normalize(
                    source=feed.get("label") or "RSS",
                    title=title,
                    # Never fall back to the feed's label — "Python.org Job
                    # Board" is not the employer, and the source chip already
                    # shows where the posting came from.
                    company=company,
                    url=getattr(entry, "link", ""),
                    location=getattr(entry, "location", "") or "",
                    summary=getattr(entry, "summary", ""),
                    posted_at=getattr(entry, "published", None) or getattr(entry, "updated", None),
                    tags=[t.get("term", "") for t in getattr(entry, "tags", []) or []],
                )
            )
    return out


Provider = Callable[..., list]

PROVIDERS: dict[str, Provider] = {
    "remoteok": _remoteok,
    "arbeitnow": _arbeitnow,
    "jobicy": _jobicy,
    "himalayas": _himalayas,
    "adzuna": _adzuna,
    "jooble": _jooble,
    "feeds": _rss_feeds,
}

KEYLESS = ("remoteok", "arbeitnow", "jobicy", "himalayas", "feeds")


def available_providers(settings: dict | None = None) -> list[str]:
    settings = settings or load_settings()
    names = list(KEYLESS)
    if settings.get("adzuna_app_id") and settings.get("adzuna_app_key"):
        names.append("adzuna")
    if settings.get("jooble_key"):
        names.append("jooble")
    enabled = settings.get("enabled_sources") or []
    return [n for n in names if not enabled or n in enabled]


def fetch_all(query: str = "", location: str = "", providers: list[str] | None = None) -> tuple[list[dict], dict]:
    """Fan out across providers in parallel. Returns (postings, per-provider report).

    Every provider is isolated: a timeout, a 429, or a shape change in one
    API costs you that provider's results for this run and nothing else.
    """
    settings = load_settings()
    names = providers or available_providers(settings)
    report: dict[str, dict] = {}
    postings: list[dict] = []

    with httpx.Client(headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:

        def run(name: str):
            started = time.monotonic()
            try:
                rows = [r for r in PROVIDERS[name](client, query, location, settings) if r]
                return name, rows, {"count": len(rows), "ms": int((time.monotonic() - started) * 1000)}
            except Exception as exc:  # noqa: BLE001 — one bad provider must not fail the run
                logger.warning("provider %s failed: %r", name, exc)
                return name, [], {"error": f"{type(exc).__name__}: {exc}"[:200]}

        # Threads, not asyncio: feedparser is blocking and this runs from
        # APScheduler's thread as well as from the event loop.
        with ThreadPoolExecutor(max_workers=min(8, max(1, len(names)))) as pool:
            for name, rows, stat in pool.map(run, names):
                report[name] = stat
                postings.extend(rows[:MAX_PER_SOURCE])

    # Collapse cross-source duplicates, keeping the first (providers are
    # ordered by how much structure they give us).
    deduped: dict[str, dict] = {}
    for posting in postings:
        deduped.setdefault(posting["posting_hash"], posting)

    LAST_RUN.update(
        at=datetime.now(timezone.utc).isoformat(),
        report=report,
        postings=len(deduped),
    )
    logger.info("fetch_all: %d unique postings from %s", len(deduped), ", ".join(names))
    return list(deduped.values()), report


# ------------------------------------------------------- feed-URL builder

def build_feed_urls(query: str, location: str = "") -> list[dict]:
    """Ready-made saved-search / job-alert URLs per platform.

    `rss` entries can be pasted straight into Facet's feed list. `alert`
    entries open the platform's own search page — LinkedIn and Naukri only
    hand out a feed once *you* subscribe there, which is exactly the boundary
    this app keeps.
    """
    q = query.strip()
    loc = location.strip()
    q_plus = quote_plus(q)
    q_slug = re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-") or "software-developer"
    loc_slug = re.sub(r"[^a-z0-9]+", "-", loc.lower()).strip("-")

    entries = [
        {
            "platform": "LinkedIn",
            "kind": "alert",
            "label": f"LinkedIn — {q or 'jobs'}",
            "url": f"https://www.linkedin.com/jobs/search/?keywords={q_plus}&location={quote_plus(loc)}&f_TPR=r86400",
            "instructions": "Open the search, toggle 'Set alert' on, then paste the RSS URL LinkedIn emails you back here.",
        },
        {
            "platform": "Naukri",
            "kind": "alert",
            "label": f"Naukri — {q or 'jobs'}",
            "url": f"https://www.naukri.com/{q_slug}-jobs" + (f"-in-{loc_slug}" if loc_slug else ""),
            "instructions": "Open the search and click 'Create job alert'; Naukri then emails matching postings you can forward or feed in.",
        },
        {
            "platform": "Indeed",
            "kind": "alert",
            "label": f"Indeed — {q or 'jobs'}",
            "url": f"https://www.indeed.com/jobs?q={q_plus}&l={quote_plus(loc)}&fromage=1",
            "instructions": "Open the search and click 'Create job alert' - Indeed retired public RSS, so alerts are the supported route.",
        },
        {
            "platform": "We Work Remotely",
            "kind": "rss",
            "label": f"We Work Remotely — {q or 'all'}",
            "url": f"https://weworkremotely.com/remote-jobs/search.rss?term={q_plus}",
            "instructions": "Subscribable directly - click Add.",
        },
        # RemoteOK's RSS endpoints answer 410 Gone — offering one here would
        # hand someone a feed that can never work. Their JSON API is already a
        # built-in keyless provider, so those postings arrive regardless.
        {
            "platform": "Jobicy",
            "kind": "rss",
            "label": f"Jobicy — {q or 'all'}",
            "url": f"https://jobicy.com/?feed=job_feed&search_keyword={q_plus}",
            "instructions": "Subscribable directly - click Add.",
        },
        {
            "platform": "Himalayas",
            "kind": "rss",
            "label": "Himalayas - all remote roles",
            "url": "https://himalayas.app/jobs/rss",
            "instructions": "Subscribable directly - click Add.",
        },
        {
            "platform": "Google Jobs",
            "kind": "alert",
            "label": f"Google Alerts — {q or 'jobs'}",
            "url": f"https://www.google.com/alerts#q:{q_plus}+jobs",
            "instructions": "Create the alert with 'Deliver to: RSS feed', then paste the feed URL here.",
        },
    ]
    return entries


def demo() -> None:
    """Self-check for the parsing/normalizing logic — no network required."""
    row = normalize(
        source="t",
        title="  <b>Senior Engineer</b> ",
        company="Acme &amp; Co",
        url="https://x.test/job/1?utm_source=spam",
        location="Remote - India",
        summary="<p>Build   things</p>",
        posted_at="2026-07-01T10:00:00Z",
        salary_min="₹1,200,000",
        tags=["Python", "python", "  API "],
    )
    assert row is not None
    assert row["title"] == "Senior Engineer", row["title"]
    assert row["company"] == "Acme & Co", row["company"]
    assert row["summary"] == "Build things", repr(row["summary"])
    assert row["salary_min"] == 1200000, row["salary_min"]
    assert row["tags"] == ["api", "python"], row["tags"]
    assert row["remote"] == 1
    assert row["posted_date"].startswith("2026-07-01T10:00:00+00:00")

    # Query-string noise must not create a second copy of the same posting.
    assert row["posting_hash"] == posting_key("https://x.test/job/1", "x", "y")
    # No URL -> identity falls back to title+company, case-insensitively.
    assert posting_key(None, "Eng", "Acme") == posting_key("", " eng ", " ACME ")

    # ---- read-time dedup of re-listings. Fixtures are real URL pairs copied
    # out of a live tracker.db, not read from it. ------------------------------
    def dk(url, title="Senior Software Engineer", company="Coinbase"):
        return dedup_key(url, title, company)

    wwr = "https://weworkremotely.com/remote-jobs/coinbase-senior-software-engineer"
    # A repost suffix is the same posting.
    assert dk(wwr + "-1") == dk(wwr)
    # Query string and trailing slash are noise, as before.
    assert dk(wwr + "/?utm=x") == dk(wwr)
    # A long internal id appended to an unchanged slug is still the same posting.
    him = "https://himalayas.app/companies/vertu-agent/jobs/marketing-outreach-assistant"
    assert dk(him + "-2041882849", "Marketing & Outreach Assistant", "Vertu Agent") == dk(
        him, "Marketing & Outreach Assistant", "Vertu Agent"
    )

    # ---- and now everything that must NOT collapse. -------------------------
    # python.org numbers its postings as a whole path segment. Stripping by
    # segment instead of by hyphen would merge every job on the board into one.
    assert dk("https://www.python.org/jobs/8117/", "Senior Python Engineer, EPAM", "") != dk(
        "https://www.python.org/jobs/8107/", "Senior Python Engineer, EPAM", ""
    )
    # Two real openings, same title and employer, different city.
    arb = "https://www.arbeitnow.com/jobs/companies/concape/leiter-operations-produktion-"
    assert dk(arb + "kempten-139611", "Leiter Operations", "Concape") != dk(
        arb + "ravensburg-264833", "Leiter Operations", "Concape"
    )
    # Two different employers whose names both failed to parse ("Unknown
    # company"): the URL is the only thing left telling them apart.
    assert dk("https://himalayas.app/companies/tilt-com/jobs/backend", "Backend", "") != dk(
        "https://himalayas.app/companies/flex-one/jobs/backend", "Backend", ""
    )
    # A trailing number that is part of the role, not a repost counter. The URLs
    # canonicalize to the same string, so only the title keeps these apart.
    assert dk("https://x.test/jobs/support-engineer-1", "Support Engineer 1", "Acme") != dk(
        "https://x.test/jobs/support-engineer-2", "Support Engineer 2", "Acme"
    )
    # A URL-less row groups only with itself.
    assert dk(None, "A", "B") != dk(None, "A", "C")
    # A posting with no title is dropped rather than rendered as a blank card.
    assert normalize(source="t", title="  ", company="c", url="u") is None

    # Company parsed out of the two title conventions job feeds actually use.
    assert split_company("Acme: Senior Engineer") == ("Senior Engineer", "Acme")
    assert split_company("Senior Engineer at Acme") == ("Senior Engineer", "Acme")
    assert split_company("Proxify AB: Senior Backend Developer (Python)") == (
        "Senior Backend Developer (Python)",
        "Proxify AB",
    )
    # A comma-shaped title must NOT be split — that's the unsafe guess.
    assert split_company("Lead Analyst, Player Analytics") == (
        "Lead Analyst, Player Analytics",
        "",
    )
    # Nor a colon that's really a role subtitle rather than a company.
    assert split_company(
        "Senior Full-Stack Engineer, Payments Platform: Remote US-only"
    )[1] == ""
    assert split_company("Engineer") == ("Engineer", "")
    assert split_company("") == ("", "")

    # Double-encoded UTF-8 from the provider is repaired, not passed through.
    assert fix_mojibake("ADVPL JÃºnior") == "ADVPL Júnior"
    assert fix_mojibake("Ingénieur") == "Ingénieur", "correct accents left alone"
    assert fix_mojibake("plain ascii") == "plain ascii"
    assert clean_text("<b>ADVPL JÃºnior</b>") == "ADVPL Júnior"

    assert _iso(1751367600) is not None
    assert _iso("Tue, 01 Jul 2026 10:00:00 GMT").startswith("2026-07-01")
    assert _iso("garbage") is None
    assert _money("not a number") is None
    assert _is_remote("Bengaluru", "Work From Home Engineer") is True
    assert _is_remote("Bengaluru", "Engineer") is False

    urls = build_feed_urls("python developer", "Bengaluru")
    assert any(e["platform"] == "Naukri" for e in urls)
    assert all(e["url"].startswith("https://") for e in urls)
    assert "python-developer-jobs-in-bengaluru" in next(
        e["url"] for e in urls if e["platform"] == "Naukri"
    )
    # Per-feed outcomes are recorded, not swallowed (status endpoint reads these).
    _record_feed({"url": "https://x.test/f.rss", "label": "X"}, "error", 0, "boom", time.monotonic())
    health = FEED_HEALTH["https://x.test/f.rss"]
    assert health["status"] == "error" and health["error"] == "boom" and health["label"] == "X"
    assert health["at"] and isinstance(health["ms"], int)
    FEED_HEALTH.clear()

    # A list-shaped field that arrived as an object. This is not hypothetical:
    # Arbeitnow served exactly `{"1": "manager"}` for one row in 175 on
    # 2026-08-07, and `job_types[0]` raising KeyError(0) cost the whole batch —
    # all 175 postings — on every sync.
    assert _as_list({"1": "manager"}) == ["manager"]
    assert _as_list({"1": "a", "0": "b"}) == ["a", "b"], "server order, not key order"
    assert _as_list(["a", "b"]) == ["a", "b"]
    assert _as_list("manager") == ["manager"], "a bare tag is one tag"
    assert _as_list(None) == [] and _as_list(0) == [] and _as_list({}) == []
    # The two lines that actually broke, in the shape the providers use them.
    for shape in ({"1": "manager"}, ["manager"], "manager"):
        types = _as_list(shape)
        assert types[0] == "manager"
        assert _as_list(["Remote"]) + types == ["Remote", "manager"]

    print("job_sources: all checks passed")


if __name__ == "__main__":
    demo()
