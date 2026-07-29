"""The Cabinet — applications, contacts, interviews CRUD (Section 10)."""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from services import db
from services.paths import EXPORTS_DIR

router = APIRouter()

VALID_STATUSES = {"Saved", "Cut", "Set", "Interviewing", "Rejected", "Offer"}


# ---------- Applications ----------


class ApplicationCreate(BaseModel):
    company: str
    role_title: str
    target_role: Optional[str] = None
    job_description: Optional[str] = None
    job_url: Optional[str] = None
    company_domain: Optional[str] = None


class ApplicationUpdate(BaseModel):
    company: Optional[str] = None
    role_title: Optional[str] = None
    target_role: Optional[str] = None
    job_description: Optional[str] = None
    ats_score: Optional[int] = None
    recruiter_summary: Optional[str] = None
    status: Optional[str] = None
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
    if updates.get("status") and updates["status"] not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status: {updates['status']}")

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
    name: str
    role_title: Optional[str] = None
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
    round_name: Optional[str] = None
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

    Everything served here must live under `EXPORTS_DIR`, whatever the
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
    root = EXPORTS_DIR.resolve()
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

    global EXPORTS_DIR
    root = Path(tempfile.mkdtemp())
    EXPORTS_DIR = root / "exports"
    EXPORTS_DIR.mkdir(parents=True)
    (EXPORTS_DIR / "stripe.pdf").write_bytes(b"%PDF fake")
    (EXPORTS_DIR / "sub").mkdir()
    (EXPORTS_DIR / "sub" / "nested.pdf").write_bytes(b"%PDF fake")
    secret = root / "secret.txt"
    secret.write_text("not yours", encoding="utf-8")

    # What should work: the bare filename the pipeline writes now, and the
    # absolute paths rows written before this change still hold.
    assert resolve_export("stripe.pdf") == (EXPORTS_DIR / "stripe.pdf").resolve()
    assert resolve_export(str(EXPORTS_DIR / "stripe.pdf")) is not None
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
    assert resolve_export(str(EXPORTS_DIR)) is None

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


@router.get("/api/dashboard/summary")
async def dashboard_summary():
    """Precomputes the Cabinet's three-view numbers server-side in one call
    (Section 10), so the frontend never recalculates aggregates from a full
    row dump on every render.

    Only a single current `status` is tracked per application (no status-
    history log), so the funnel below counts "reached this stage or later"
    using the natural progression Cut -> Set -> Interviewing -> Offer.
    Rejected applications are excluded from funnel/response-rate math (we
    can't know which stage they dropped from) and reported as their own
    count instead, so the funnel never silently guesses that.
    """
    applications = await db.fetch_all("SELECT * FROM applications")

    reached_cut = [a for a in applications if a["status"] != "Saved"]
    reached_set = [a for a in reached_cut if a["status"] != "Cut"]
    reached_interviewing = [
        a for a in reached_set if a["status"] in ("Interviewing", "Offer")
    ]
    reached_offer = [a for a in reached_set if a["status"] == "Offer"]
    rejected = [a for a in applications if a["status"] == "Rejected"]

    response_rate = (
        len(reached_interviewing) / len(reached_set) if reached_set else None
    )

    cut_now = [a for a in applications if a["status"] == "Cut"]
    set_or_later = reached_set

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
            "Cut": len(reached_cut),
            "Set": len(reached_set),
            "Interviewing": len(reached_interviewing),
            "Offer": len(reached_offer),
        },
        "rejected_count": len(rejected),
        "needs_followup": followups,
        "cut_vs_set": {
            "cut": len(cut_now),
            "set": len(set_or_later),
            "gap": len(cut_now) - len(set_or_later),
        },
        "cut_not_sent_yet": cut_now,
        "clarity_score_trend": clarity_trend,
    }


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
