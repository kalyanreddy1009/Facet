"""Master resume CRUD + import + profile extraction (Section 3)."""

import json

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile
from pydantic import BaseModel

from services.agy_runner import AgyBusyError, AgyError, parse_json_output, run_agy
from services.parser import parse_resume
from services.paths import MASTER_RESUME_PATH, PROFILE_PATH, WORKSPACE_DIR as WORKSPACE

router = APIRouter()

EXTRACTION_INSTRUCTION = """Read the file `master_resume.md` in the current directory — it is a candidate's full resume in markdown, written or edited by them directly.

Extract its content into a structured JSON file, following this exact schema and field names:
{
  "name": "...",
  "contact": { "email": "...", "phone": "...", "location": "...", "linkedin": "..." },
  "summary_base": "...",
  "skills": ["..."],
  "roles": [{ "id": "role_1", "company": "...", "title": "...", "start": "...", "end": "...", "location": "...", "bullets": ["..."] }],
  "projects": [{ "name": "...", "description": "..." }],
  "certifications": ["..."],
  "education": [{ "school": "...", "degree": "...", "year": "..." }],
  "keywords": ["..."]
}

Rules:
- Extract only what is genuinely present in master_resume.md. Do not invent or infer skills, employers, dates, or accomplishments that aren't stated.
- Assign role ids role_1, role_2, etc. in the order roles appear in the document.
- `keywords` is a broader list of terms (skills, tools, domains, job titles) useful for matching against job descriptions later — derived only from the actual resume content.
- `summary_base` is a short professional summary drawn from the resume, or reasonably synthesized from its actual content if no explicit summary section exists.
- Output raw valid JSON only in the output file — no code fences, no commentary.
"""


@router.get("/api/profile")
async def get_profile():
    if not PROFILE_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="No profile yet — import a resume first.",
        )
    return json.loads(PROFILE_PATH.read_text(encoding="utf-8"))


@router.post("/api/resume/import")
async def import_resume(file: UploadFile):
    """Parses an uploaded PDF/DOCX into markdown for review — does not save
    anything yet. The person reviews/corrects this before it becomes
    master_resume.md (Section 3)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    contents = await file.read()
    try:
        markdown = parse_resume(contents, file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"markdown": markdown}


@router.get("/api/resume/master")
async def get_master_resume():
    if not MASTER_RESUME_PATH.exists():
        raise HTTPException(status_code=404, detail="No master resume saved yet")
    return {"markdown": MASTER_RESUME_PATH.read_text(encoding="utf-8")}


class MasterResumeBody(BaseModel):
    markdown: str


# BackgroundTasks run after the HTTP response is already sent, so the app's
# global AgyError/AgyBusyError handlers (request-cycle only) never see
# exceptions raised in here — this has to catch and record its own errors,
# exposed via GET /api/resume/extraction-status for the frontend to poll.
_extraction_state = {"status": "idle", "error": None}


async def _extract_profile():
    global _extraction_state
    _extraction_state = {"status": "running", "error": None}
    try:
        output = await run_agy(EXTRACTION_INSTRUCTION, "profile.json")
        profile = parse_json_output(output)
        PROFILE_PATH.write_text(json.dumps(profile, indent=2), encoding="utf-8")
        _extraction_state = {"status": "done", "error": None}
    except AgyError as exc:
        _extraction_state = {
            "status": "error",
            "error": {"error": exc.message, "hint": exc.hint},
        }
    except AgyBusyError:
        _extraction_state = {
            "status": "error",
            "error": {
                "error": "Facet is already running an AI request",
                "hint": "Wait for it to finish, then save again.",
            },
        }


@router.get("/api/resume/extraction-status")
async def get_extraction_status():
    return _extraction_state


@router.post("/api/resume/master")
async def save_master_resume(body: MasterResumeBody, background_tasks: BackgroundTasks):
    """Saves master_resume.md, then runs the profile.json extraction as a
    background agy pass (Section 3) — the save itself doesn't wait on agy."""
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    MASTER_RESUME_PATH.write_text(body.markdown, encoding="utf-8")
    background_tasks.add_task(_extract_profile)
    return {"saved": True, "extraction": "started"}
