"""The Cabinet — applications, contacts, interviews CRUD (Section 10)."""

from pathlib import Path
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, StringConstraints

from services import db
from services import paths

router = APIRouter()

Status = Literal["Saved", "Cut", "Set", "Interviewing", "Rejected", "Offer"]
VALID_STATUSES = set(Status.__args__)

# Constraints belong on the models, not in the handlers.
#
# They were in the handlers, and each one only guarded the field somebody had
# thought about: `if updates.get("status") and ...` let `""` through, because
# an empty string is falsy — so an application could be PATCHed into a status
# no view knows how to render, and the Cabinet's filters would drop the row.
# A score of -5 or 5000 stored just as happily and drew a ring off the end of
# its track. Declared here, one refusal covers create and update, every field
# of the same shape, and any handler written later.
#
# `strip_whitespace` is deliberate: a company of " " is not a company, and
# storing the untrimmed version means two rows for the same employer.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
OptionalName = Annotated[
    Optional[str], StringConstraints(strip_whitespace=True, max_length=200)
]
# 0–100 because it is a percentage shown as a ring. Outside that it is not a
# score that means anything, whatever produced it.
Score = Annotated[int, Field(ge=0, le=100)]


# ---------- Applications ----------


class ApplicationCreate(BaseModel):
    company: Name
    role_title: Name
    target_role: OptionalName = None
    job_description: Optional[str] = None
    job_url: Optional[str] = None
    company_domain: Optional[str] = None


class ApplicationUpdate(BaseModel):
    company: Optional[Name] = None
    role_title: Optional[Name] = None
    target_role: OptionalName = None
    job_description: Optional[str] = None
    ats_score: Optional[Score] = None
    recruiter_summary: Optional[str] = None
    status: Optional[Status] = None
    job_url: Optional[str] = None
    company_domain: Optional[str] = None
    notes: Optional[str] = None

    # resume_path / docx_path / cover_letter_path are deliberately absent.
    #
    # They used to be accepted here, and `_serve_application_file` read
    # whatever they contained straight off disk — so a client could PATCH a
    # path and then GET the file, reading anything the service user could.
    # Harmless on a laptop reading your own files; an arbitrary-read
    # primitive on a host serving other people.
    #
    # Only the cutting pipeline writes these, server-side, with names it
    # generated itself. A client has no legitimate reason to set them, and
    # pydantic ignores unknown fields, so an old client sending them is
    # simply ignored rather than broken.


@router.post("/api/applications")
async def create_application(body: ApplicationCreate):
    app_id = await db.execute(
        """INSERT INTO applications
           (company, role_title, target_role, job_description, job_url, company_domain)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            body.company,
            body.role_title,
            body.target_role,
            body.job_description,
            body.job_url,
            body.company_domain,
        ),
    )
    return await db.fetch_one("SELECT * FROM applications WHERE id = ?", (app_id,))


@router.get("/api/applications")
async def list_applications():
    return await db.fetch_all("SELECT * FROM applications ORDER BY created_at DESC")


@router.get("/api/applications/{application_id}")
async def get_application(application_id: int):
    row = await db.fetch_one("SELECT * FROM applications WHERE id = ?", (application_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    return row


@router.patch("/api/applications/{application_id}")
async def update_application(application_id: int, body: ApplicationUpdate):
    existing = await db.fetch_one("SELECT * FROM applications WHERE id = ?", (application_id,))
    if not existing:
        raise HTTPException(status_code=404, detail="Application not found")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(
            f"UPDATE applications SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
            (*updates.values(), application_id),
        )
    return await db.fetch_one("SELECT * FROM applications WHERE id = ?", (application_id,))


# ---------- Contacts ----------


class ContactCreate(BaseModel):
    application_id: int
    name: Name
    role_title: OptionalName = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    notes: Optional[str] = None


@router.post("/api/contacts")
async def create_contact(body: ContactCreate):
    application = await db.fetch_one(
        "SELECT 1 FROM applications WHERE id = ?", (body.application_id,)
    )
    if not application:
        raise HTTPException(status_code=400, detail="No application with that id")

    contact_id = await db.execute(
        """INSERT INTO contacts
           (application_id, name, role_title, email, phone, linkedin_url, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            body.application_id,
            body.name,
            body.role_title,
            body.email,
            body.phone,
            body.linkedin_url,
            body.notes,
        ),
    )
    return await db.fetch_one("SELECT * FROM contacts WHERE id = ?", (contact_id,))


@router.get("/api/contacts")
async def list_contacts(application_id: Optional[int] = None):
    if application_id is not None:
        return await db.fetch_all(
            "SELECT * FROM contacts WHERE application_id = ? ORDER BY created_at DESC",
            (application_id,),
        )
    return await db.fetch_all("SELECT * FROM contacts ORDER BY created_at DESC")


# ---------- Interviews ----------


class InterviewCreate(BaseModel):
    application_id: int
    contact_id: Optional[int] = None
    round_name: OptionalName = None
    scheduled_at: Optional[str] = None
    notes: Optional[str] = None


class InterviewUpdate(BaseModel):
    contact_id: Optional[int] = None
    round_name: Optional[str] = None
    scheduled_at: Optional[str] = None
    completed: Optional[bool] = None
    outcome: Optional[str] = None
    notes: Optional[str] = None


@router.post("/api/interviews")
async def create_interview(body: InterviewCreate):
    application = await db.fetch_one(
        "SELECT 1 FROM applications WHERE id = ?", (body.application_id,)
    )
    if not application:
        raise HTTPException(status_code=400, detail="No application with that id")
    if body.contact_id is not None:
        contact = await db.fetch_one("SELECT 1 FROM contacts WHERE id = ?", (body.contact_id,))
        if not contact:
            raise HTTPException(status_code=400, detail="No contact with that id")

    interview_id = await db.execute(
        """INSERT INTO interviews
           (application_id, contact_id, round_name, scheduled_at, notes)
           VALUES (?, ?, ?, ?, ?)""",
        (
            body.application_id,
            body.contact_id,
            body.round_name,
            body.scheduled_at,
            body.notes,
        ),
    )
    return await db.fetch_one("SELECT * FROM interviews WHERE id = ?", (interview_id,))


@router.get("/api/interviews")
async def list_interviews(application_id: Optional[int] = None):
    if application_id is not None:
        return await db.fetch_all(
            "SELECT * FROM interviews WHERE application_id = ? ORDER BY scheduled_at",
            (application_id,),
        )
    return await db.fetch_all("SELECT * FROM interviews ORDER BY scheduled_at")


@router.patch("/api/interviews/{interview_id}")
async def update_interview(interview_id: int, body: InterviewUpdate):
    existing = await db.fetch_one("SELECT * FROM interviews WHERE id = ?", (interview_id,))
    if not existing:
        raise HTTPException(status_code=404, detail="Interview not found")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "completed" in updates:
        updates["completed"] = int(updates["completed"])

    if updates:
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        await db.execute(
            f"UPDATE interviews SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
            (*updates.values(), interview_id),
        )
    return await db.fetch_one("SELECT * FROM interviews WHERE id = ?", (interview_id,))


_DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def resolve_export(stored: str) -> Path | None:
    """Turn a stored path into a real file inside this instance's exports.

    Everything served here must live under `paths.EXPORTS_DIR`, whatever the
    database says. Accepts both forms:

    - a bare filename, which is what the pipeline writes now, so an instance
      keeps working when its data directory moves;
    - an absolute path, which is what rows written before this change hold.

    Either way the result is resolved and checked against the exports root,
    so `..`, a symlink out, or an absolute path somewhere else all fail. That
    check is the point — not the shape of the input.

    Returns None rather than raising, so callers answer 404 and never confirm
    whether an out-of-bounds file exists.
    """
    root = paths.EXPORTS_DIR.resolve()
    candidate = Path(stored)
    resolved = (candidate if candidate.is_absolute() else root / candidate).resolve()

    if resolved != root and root not in resolved.parents:
        return None
    if not resolved.is_file():
        return None
    return resolved


async def _serve_application_file(application_id: int, column: str, media_type: str):
    application = await db.fetch_one(
        f"SELECT {column} FROM applications WHERE id = ?", (application_id,)
    )
    if not application or not application[column]:
        raise HTTPException(status_code=404, detail="No Facet cut for this application yet")

    path = resolve_export(application[column])
    if path is None:
        raise HTTPException(status_code=404, detail="File missing on disk")

    return Response(
        content=path.read_bytes(),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )


def demo() -> None:
    """Self-check:  backend/.venv/bin/python -m routers.tracker

    The export resolver is a trust boundary — every file this app hands back
    goes through it — so it gets its own checks rather than relying on the
    endpoints above being called correctly.
    """
    import tempfile

    root = Path(tempfile.mkdtemp())
    # EXPORTS_DIR is derived, so redirect the root rather than assigning the
    # derived name — assigning it would shadow __getattr__ for every user.
    original_data = paths.DATA_DIR
    paths.DATA_DIR = root
    try:
        _demo_exports(root)
    finally:
        paths.DATA_DIR = original_data


def _demo_exports(root: Path) -> None:
    paths.EXPORTS_DIR.mkdir(parents=True)
    (paths.EXPORTS_DIR / "stripe.pdf").write_bytes(b"%PDF fake")
    (paths.EXPORTS_DIR / "sub").mkdir()
    (paths.EXPORTS_DIR / "sub" / "nested.pdf").write_bytes(b"%PDF fake")
    secret = root / "secret.txt"
    secret.write_text("not yours", encoding="utf-8")

    # What should work: the bare filename the pipeline writes now, and the
    # absolute paths rows written before this change still hold.
    assert resolve_export("stripe.pdf") == (paths.EXPORTS_DIR / "stripe.pdf").resolve()
    assert resolve_export(str(paths.EXPORTS_DIR / "stripe.pdf")) is not None
    assert resolve_export("sub/nested.pdf") is not None, "subdirectories are inside"

    # What must not: every way out of the exports directory.
    for hostile in (
        "../secret.txt",                 # traversal
        "a/../../secret.txt",            # traversal via a fake segment
        str(secret),                     # absolute, elsewhere
        "/etc/passwd",                   # the classic
        "C:/Windows/win.ini",
        str(root),                       # the parent directory itself
        "sub/../../secret.txt",
    ):
        assert resolve_export(hostile) is None, f"escaped with {hostile!r}"

    # Missing files are None, not an exception — the caller answers 404 and
    # never reveals whether an out-of-bounds path exists.
    assert resolve_export("absent.pdf") is None
    assert resolve_export("") is None

    # The exports root itself is a directory, not a file, so it is refused
    # even though it is trivially "inside" itself.
    assert resolve_export(str(paths.EXPORTS_DIR)) is None

    # A client cannot set these columns any more; the model must ignore them
    # rather than accept them.
    update = ApplicationUpdate(**{"company": "Acme", "resume_path": "/etc/passwd"})
    assert not hasattr(update, "resume_path"), "path fields must not be settable"
    assert update.company == "Acme", "ordinary fields still work"

    print("tracker: all checks passed (export resolver holds the boundary)")


@router.get("/api/applications/{application_id}/resume-file")
async def get_resume_file(application_id: int):
    """Serves the stored resume PDF back — used by the Apply-Assist
    extension (Task 11) to attach it to a file input via the DataTransfer
    API, and by the tailor result page's download link."""
    return await _serve_application_file(application_id, "resume_path", "application/pdf")


@router.get("/api/applications/{application_id}/docx-file")
async def get_docx_file(application_id: int):
    return await _serve_application_file(application_id, "docx_path", _DOCX_MEDIA_TYPE)


@router.get("/api/applications/{application_id}/cover-letter-file")
async def get_cover_letter_file(application_id: int):
    return await _serve_application_file(application_id, "cover_letter_path", "application/pdf")


#: The pipeline, in order. Rejected is deliberately absent: it is an outcome
#: that can arrive at any stage, not a stage of its own, and ranking it would
#: make a rejection at screening look like progress past an interview.
STAGES = ("Saved", "Cut", "Set", "Interviewing", "Offer")
_STAGE_RANK = {name: i for i, name in enumerate(STAGES)}


def _furthest_stage(statuses: list[str]) -> str | None:
    """The furthest point an application reached, from its recorded history
    plus its current status. None when nothing recognisable was seen — which
    is what a row rejected before history existed looks like, and it is
    reported as unknown rather than guessed at."""
    ranks = [_STAGE_RANK[s] for s in statuses if s in _STAGE_RANK]
    return STAGES[max(ranks)] if ranks else None


@router.get("/api/dashboard/summary")
async def dashboard_summary():
    """Precomputes the Cabinet's three-view numbers server-side in one call
    (Section 10), so the frontend never recalculates aggregates from a full
    row dump on every render.

    THE FUNNEL READS HISTORY NOW, NOT JUST THE CURRENT STATUS.

    This used to work from `applications.status` alone, which meant it could
    only *infer* that anything currently 'Offer' must once have been 'Set',
    and had to drop rejections from the maths entirely — a rejected row could
    not say which stage it was rejected from, so counting it anywhere would
    have been a guess. That excluded exactly the outcome people most want to
    understand.

    `application_events` records every status change (by trigger, so no write
    path can forget), and the furthest stage an application reached is the
    highest-ranked status across its history *and* its current value. Taking
    the maximum of both is what lets rows backfilled with a single event —
    everything created before this table existed — still count correctly:
    their current status is their furthest known stage.

    A rejection now lands in the funnel at the stage it actually reached.
    Where that is genuinely unknown, it is reported under `unknown` instead of
    being assigned somewhere convenient.
    """
    applications = await db.fetch_all("SELECT * FROM applications")
    events = await db.fetch_all(
        "SELECT application_id, status FROM application_events ORDER BY occurred_at, id"
    )

    history: dict[int, list[str]] = {}
    for event in events:
        history.setdefault(event["application_id"], []).append(event["status"])

    # Furthest stage per application, from history + where it sits today.
    furthest: dict[int, str | None] = {
        a["id"]: _furthest_stage(history.get(a["id"], []) + [a["status"]])
        for a in applications
    }
    rejected = [a for a in applications if a["status"] == "Rejected"]

    def reached(stage: str) -> list[dict]:
        floor = _STAGE_RANK[stage]
        return [
            a
            for a in applications
            if (best := furthest[a["id"]]) is not None and _STAGE_RANK[best] >= floor
        ]

    reached_set = reached("Set")
    reached_interviewing = reached("Interviewing")

    # Rejections are included in both sides now: an application that was sent
    # and then rejected did reach 'Set', and pretending otherwise flattered
    # the response rate by removing its worst outcomes from the denominator.
    response_rate = len(reached_interviewing) / len(reached_set) if reached_set else None

    # Where rejections actually happened. `unknown` is the honest bucket for
    # rows whose history predates this table and that were already rejected,
    # so nothing ever knew what stage they died at.
    rejected_from: dict[str, int] = {}
    for application in rejected:
        stage = _furthest_stage(history.get(application["id"], []))
        rejected_from[stage or "unknown"] = rejected_from.get(stage or "unknown", 0) + 1

    cut_now = [a for a in applications if a["status"] == "Cut"]

    followups = await db.fetch_all(
        """SELECT * FROM applications
           WHERE status = 'Set' AND julianday('now') - julianday(updated_at) >= 5
           ORDER BY updated_at ASC"""
    )

    clarity_trend = await db.fetch_all(
        """SELECT id, company, role_title, ats_score, created_at
           FROM applications
           WHERE ats_score IS NOT NULL
           ORDER BY created_at ASC"""
    )

    return {
        "response_rate": response_rate,
        "funnel": {
            "Cut": len(reached("Cut")),
            "Set": len(reached_set),
            "Interviewing": len(reached_interviewing),
            "Offer": len(reached("Offer")),
        },
        "rejected_count": len(rejected),
        "rejected_from": rejected_from,
        "needs_followup": followups,
        # `cut_vs_set` used to live here and has been removed rather than left
        # unused. Its `gap` was `len(cut_now) - len(reached_set)`, which
        # subtracts a *current-status* count from a *cumulative-reached* one:
        # two facets waiting against six ever sent gave -4, and the Cabinet
        # rendered "you've sent more than you've cut — nothing waiting in the
        # wings" directly above the list of the two waiting facets. The number
        # was never repairable, because the two quantities do not belong in the
        # same subtraction. `cut_not_sent_yet` below is the honest answer to the
        # only question it was trying to ask, and it is a list, so it cannot
        # disagree with itself.
        "cut_not_sent_yet": cut_now,
        "clarity_score_trend": clarity_trend,
    }


@router.get("/api/applications/{application_id}/events")
async def application_events(application_id: int):
    """The status history of one application, oldest first.

    Ordered by `occurred_at, id` rather than `occurred_at` alone: two changes
    inside the same second are ordinary (a cut that immediately marks itself
    'Cut'), `datetime('now')` has one-second resolution, and without the id
    tiebreak the pair would come back in arbitrary order.
    """
    if not await db.fetch_one("SELECT 1 FROM applications WHERE id = ?", (application_id,)):
        raise HTTPException(status_code=404, detail="Application not found")
    return await db.fetch_all(
        """SELECT id, status, occurred_at, note FROM application_events
           WHERE application_id = ? ORDER BY occurred_at, id""",
        (application_id,),
    )


@router.get("/api/interviews/{interview_id}/detail")
async def get_interview_detail(interview_id: int):
    """An interview card's full context: contact, and the exact Facet used —
    pulled from applications, never duplicated (Section 10)."""
    interview = await db.fetch_one("SELECT * FROM interviews WHERE id = ?", (interview_id,))
    if not interview:
        raise HTTPException(status_code=404, detail="Interview not found")

    application = await db.fetch_one(
        "SELECT * FROM applications WHERE id = ?", (interview["application_id"],)
    )
    contact = None
    if interview["contact_id"] is not None:
        contact = await db.fetch_one(
            "SELECT * FROM contacts WHERE id = ?", (interview["contact_id"],)
        )

    return {"interview": interview, "application": application, "contact": contact}


if __name__ == "__main__":
    demo()
