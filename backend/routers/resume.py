"""Master resume CRUD + import + profile extraction (Section 3)."""

import json

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

from services import feed_ingest, jobs, resume_templates, settings_store
from services.agy_runner import (
    cleanup_job_dir,
    parse_json_output,
    prepare_job_dir,
    run_agy,
)
from services.parser import parse_resume
from services import paths

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


@router.get("/api/profile/keywords")
async def profile_keywords():
    """The terms the Cut page's live match pre-check scores against.

    Not `GET /api/profile`: that carries the whole Stone — employers, dates,
    every bullet — and the pre-check needs a list of skill words. Sending the
    smaller thing is both faster and less to leak into a browser tab that may
    be open on a shared machine.

    Scoring happens in the browser rather than here because it runs on every
    keystroke of a 15,000-character paste, and a round trip per keystroke is a
    worse answer than shipping the vocabulary once. `frontend/src/lib/match.ts`
    holds the same algorithm as `services.matching`, and both have a check
    asserting they agree.
    """
    if not paths.PROFILE_PATH.exists():
        return {"keywords": []}
    try:
        profile = json.loads(paths.PROFILE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"keywords": []}
    terms = list(profile.get("skills", [])) + list(profile.get("keywords", []))
    # Deduplicated case-insensitively but keeping the first spelling, so the
    # evidence line shows "PostgreSQL" rather than "postgresql".
    seen, out = set(), []
    for term in terms:
        key = str(term).strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(str(term).strip())
    return {"keywords": out}


@router.get("/api/resume/templates")
async def resume_template_catalog():
    """The seven templates, and which one the next cut will use.

    Served rather than hardcoded in the frontend so the picker cannot drift out
    of step with what the renderer will actually do — a card promising a layout
    the backend no longer has is worse than no card.
    """
    return {
        "templates": resume_templates.catalog(),
        "selected": settings_store.load_settings().get("resume_template")
        or resume_templates.DEFAULT_ID,
    }


@router.get("/api/profile")
async def get_profile():
    if not paths.PROFILE_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="No profile yet — import a resume first.",
        )
    return json.loads(paths.PROFILE_PATH.read_text(encoding="utf-8"))


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
    if not paths.MASTER_RESUME_PATH.exists():
        raise HTTPException(status_code=404, detail="No master resume saved yet")
    return {"markdown": paths.MASTER_RESUME_PATH.read_text(encoding="utf-8")}


class MasterResumeBody(BaseModel):
    markdown: str


async def run_extract_profile_job(job: dict) -> dict:
    """Extract profile.json from master_resume.md — run by the queue worker.

    This used to be a FastAPI BackgroundTask writing to a module-global dict,
    which meant one shared extraction status for the whole process and errors
    that no exception handler could see (background tasks run after the
    response is sent). As a job it gets persistence, a real error field, and
    a status that survives a restart.
    """
    job_dir = prepare_job_dir(
        job["id"], {}, copy_from_workspace=("master_resume.md",)
    )
    try:
        output = await run_agy(EXTRACTION_INSTRUCTION, "profile.json", job_dir)
    finally:
        cleanup_job_dir(job["id"])

    profile = parse_json_output(output)
    paths.PROFILE_PATH.write_text(json.dumps(profile, indent=2), encoding="utf-8")

    # The Stone just changed, so every stored score was computed against the
    # old one. Rescoring here rather than lazily on read because The Rough
    # sorts and filters on `match_score` in SQL — a score that only exists in
    # the response can't order the list. ~670 rows is well under a second.
    examined, changed = feed_ingest.rescore_stored_postings()
    return {"saved": True, "rescored": changed, "postings": examined}


@router.get("/api/resume/extraction-status")
async def get_extraction_status():
    """Reports the latest extraction in the shape the frontend already polls:
    {status: idle|running|done|error, error: {error, hint} | null}."""
    job = await jobs.latest("extract_profile")
    if job is None:
        return {"status": "idle", "error": None, "job_id": None}

    status = {
        jobs.QUEUED: "running",   # waiting is running as far as the user cares
        jobs.RUNNING: "running",
        jobs.DONE: "done",
        jobs.FAILED: "error",
        jobs.CANCELLED: "idle",
    }[job["status"]]

    error = None
    if status == "error":
        error = {"error": "Profile extraction failed", "hint": job["error"]}

    return {
        "status": status,
        "error": error,
        "job_id": job["id"],
        "position": job["position"],
    }


@router.post("/api/resume/master")
async def save_master_resume(body: MasterResumeBody):
    """Saves master_resume.md, then queues the profile.json extraction
    (Section 3) — the save itself doesn't wait on agy."""
    paths.WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    paths.MASTER_RESUME_PATH.write_text(body.markdown, encoding="utf-8")
    job_id = await jobs.enqueue("extract_profile", {})
    return {"saved": True, "extraction": "started", "job_id": job_id}
