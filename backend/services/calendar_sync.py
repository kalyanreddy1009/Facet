"""Google Calendar secret-.ics-feed sync — Section 10's calendar-sync
subsection. Read-only, no OAuth. Every match is a guess and lands in the
Suggested Interviews queue; nothing here ever writes to `interviews`
directly — a person always confirms or dismisses by hand.
"""

import json
import logging
import re
import sqlite3
import urllib.request
from datetime import datetime, timezone

from icalendar import Calendar

from services import paths

INTERVIEW_KEYWORDS = ["interview", "screen", "technical round", "onsite"]

logger = logging.getLogger("facet.calendar_sync")


def load_calendar_config() -> dict | None:
    if not paths.CALENDAR_CONFIG_PATH.exists():
        return None
    return json.loads(paths.CALENDAR_CONFIG_PATH.read_text(encoding="utf-8"))


def save_calendar_config(ics_url: str) -> None:
    paths.CALENDAR_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    paths.CALENDAR_CONFIG_PATH.write_text(json.dumps({"ics_url": ics_url}), encoding="utf-8")


def masked_config() -> dict:
    """Never returns the secret URL in full — it's a credential."""
    config = load_calendar_config()
    if not config:
        return {"configured": False}
    url = config["ics_url"]
    match = re.match(r"(https?://[^/]+)/", url)
    host = match.group(1) if match else "configured feed"
    return {"configured": True, "masked_url": f"{host}/••••••••"}


def _attendee_emails(component) -> list[str]:
    raw = component.get("attendee", [])
    if not isinstance(raw, list):
        raw = [raw]
    emails = []
    for attendee in raw:
        value = str(attendee)
        if value.lower().startswith("mailto:"):
            value = value[len("mailto:"):]
        emails.append(value.lower().strip())
    return emails


def _looks_like_interview(title: str, description: str) -> bool:
    text = f"{title} {description}".lower()
    return any(keyword in text for keyword in INTERVIEW_KEYWORDS)


def _match_confidence(conn, emails: list[str]) -> tuple[str, int | None, int | None] | None:
    """Returns (confidence, application_id, contact_id) or None if no match."""
    for email in emails:
        row = conn.execute(
            "SELECT id, application_id FROM contacts WHERE lower(email) = ?", (email,)
        ).fetchone()
        if row:
            return "high", row[1], row[0]

    for email in emails:
        if "@" not in email:
            continue
        domain = email.split("@", 1)[1]
        row = conn.execute(
            "SELECT id FROM applications WHERE lower(company_domain) = ?", (domain,)
        ).fetchone()
        if row:
            return "medium", row[0], None

    return None


def run_calendar_sync() -> dict:
    config = load_calendar_config()
    if not config:
        return {"skipped": "no calendar configured"}

    try:
        with urllib.request.urlopen(config["ics_url"], timeout=20) as response:
            raw = response.read()
        calendar = Calendar.from_ical(raw)
    except Exception as exc:
        # Network hiccup or a malformed feed shouldn't crash the scheduler
        # run (Section 15) — log and skip, same as a bad job-feed URL.
        logger.error("[Facet] calendar sync failed: %s", exc, exc_info=True)
        return {"error": "Calendar sync failed", "hint": str(exc)}
    now = datetime.now(timezone.utc)

    new_suggestions = 0
    conn = sqlite3.connect(str(paths.DB_PATH))
    try:
        for component in calendar.walk("VEVENT"):
            uid = str(component.get("uid", ""))
            if not uid:
                continue

            existing = conn.execute(
                "SELECT 1 FROM suggested_interviews WHERE uid = ?", (uid,)
            ).fetchone()
            if existing:
                continue

            dtstart = component.get("dtstart")
            if dtstart is None:
                continue
            start = dtstart.dt
            if isinstance(start, datetime):
                if start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
            else:
                # all-day event (a date, not a datetime) — treat as start of day UTC
                start = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)

            if start < now:
                continue

            title = str(component.get("summary", ""))
            description = str(component.get("description", ""))
            emails = _attendee_emails(component)

            match = _match_confidence(conn, emails)
            if match:
                confidence, application_id, contact_id = match
            elif _looks_like_interview(title, description):
                confidence, application_id, contact_id = "low", None, None
            else:
                continue  # not interview-shaped, not matched — not a candidate at all

            conn.execute(
                """INSERT INTO suggested_interviews
                   (uid, application_id, contact_id, confidence, event_title,
                    scheduled_at, description, raw_attendees)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    uid,
                    application_id,
                    contact_id,
                    confidence,
                    title,
                    start.isoformat(),
                    description,
                    ", ".join(emails),
                ),
            )
            new_suggestions += 1

        conn.commit()
    finally:
        conn.close()

    return {"new_suggestions": new_suggestions}
