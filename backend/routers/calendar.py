"""Calendar-detected interviews (Section 10's calendar-sync subsection)."""

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import db
from services.calendar_sync import masked_config, run_calendar_sync, save_calendar_config

router = APIRouter()


class CalendarConfigBody(BaseModel):
    ics_url: str


class ConfirmBody(BaseModel):
    application_id: Optional[int] = None
    contact_id: Optional[int] = None
    round_name: str = "Interview"


@router.get("/api/calendar/config")
async def get_calendar_config():
    return masked_config()


@router.post("/api/calendar/config")
async def set_calendar_config(body: CalendarConfigBody):
    save_calendar_config(body.ics_url)
    return masked_config()


@router.post("/api/calendar/sync")
async def sync_calendar():
    try:
        return run_calendar_sync()
    except Exception as exc:  # network/parse failures shouldn't crash the app
        return {"error": "Calendar sync failed", "hint": str(exc)}


@router.get("/api/calendar/suggestions")
async def list_suggestions():
    return await db.fetch_all(
        "SELECT * FROM suggested_interviews WHERE dismissed = 0 ORDER BY scheduled_at ASC"
    )


@router.post("/api/calendar/suggestions/{suggestion_id}/confirm")
async def confirm_suggestion(suggestion_id: int, body: ConfirmBody):
    suggestion = await db.fetch_one(
        "SELECT * FROM suggested_interviews WHERE id = ?", (suggestion_id,)
    )
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    application_id = body.application_id or suggestion["application_id"]
    if not application_id:
        raise HTTPException(
            status_code=400,
            detail="This suggestion has no matched application — pick one explicitly.",
        )
    contact_id = body.contact_id or suggestion["contact_id"]

    interview_id = await db.execute(
        """INSERT INTO interviews (application_id, contact_id, round_name, scheduled_at)
           VALUES (?, ?, ?, ?)""",
        (application_id, contact_id, body.round_name, suggestion["scheduled_at"]),
    )
    await db.execute(
        "UPDATE suggested_interviews SET dismissed = 1 WHERE id = ?", (suggestion_id,)
    )
    return await db.fetch_one("SELECT * FROM interviews WHERE id = ?", (interview_id,))


@router.post("/api/calendar/suggestions/{suggestion_id}/dismiss")
async def dismiss_suggestion(suggestion_id: int):
    suggestion = await db.fetch_one(
        "SELECT * FROM suggested_interviews WHERE id = ?", (suggestion_id,)
    )
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    await db.execute(
        "UPDATE suggested_interviews SET dismissed = 1 WHERE id = ?", (suggestion_id,)
    )
    return {"dismissed": True}
