"""The Cutting Pipeline — tailoring (Sections 5-6)."""

import json
import re
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routers.resume import PROFILE_PATH
from services import db
from services.agy_runner import parse_json_output, run_agy
from services.docgen import (
    build_cover_letter_context,
    build_resume_context,
    render_cover_letter_pdf,
    render_resume_docx,
    render_resume_pdf,
)
from services.matching import keyword_overlap_score
from services.paths import EXPORTS_DIR, WORKSPACE_DIR as WORKSPACE

router = APIRouter()

JD_MAX_CHARS = 15000
WEAK_MATCH_THRESHOLD = 0.15

TAILOR_SCHEMA = """{
  "match_score": 0-100,
  "matching_skills": ["..."],
  "inferred_skills": ["..."],
  "missing_but_true": ["..."],
  "missing_and_absent": ["..."],
  "tailored_summary": "...",
  "tailored_skills_order": ["..."],
  "role_bullets": { "role_1": ["...", "..."] },
  "cover_letter_body": "...",
  "recruiter_summary": "..."
}"""


class TailorRequest(BaseModel):
    company: str
    role_title: str
    job_description: str
    truthfulness_mode: Literal["strict", "inferred_adjacent"] = "strict"
    target_role: Optional[str] = None
    job_url: Optional[str] = None
    application_id: Optional[int] = None


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _build_instruction(mode: str) -> str:
    mode_label = "Strict mode" if mode == "strict" else "Inferred-adjacent mode"
    return f"""Read `RULES.md`, `profile.json`, and `job_description.md`, all in the current directory.

You are running in **{mode_label}** — follow exactly that mode's rules from RULES.md and no other mode's rules.

Write a JSON file `tailored_fields.json` with this exact schema:
{TAILOR_SCHEMA}

- `role_bullets` keys must match profile.json's role `id`s exactly — one entry per role.
- `inferred_skills` must be an empty array if you are in strict mode.
- `matching_skills`: things the job description asks for that the candidate's profile genuinely supports (explicitly, in strict mode).
- `missing_but_true`: things the job description asks for that the candidate's profile DOES support, but which didn't make it into `matching_skills`/bullets for some reason — i.e. true and relevant, just not already surfaced elsewhere in your output. Do not put things here that the job description never asked for.
- `missing_and_absent`: things the job description asks for that the candidate's profile does NOT support at all. This is the only place unsupported requirements may appear — never in the resume or cover letter.
- `tailored_skills_order`: the actual skills list that will appear on the resume. In strict mode, this is `matching_skills` reordered/curated for relevance. In inferred-adjacent mode, this MAY also include entries from `inferred_skills` — the person has opted into that mode and will review before sending, so the resume itself should reflect the inference, not just report it internally.
- Do not reproduce name, contact, company names, titles, dates, education, or projects in your output — those come from profile.json directly and are never part of tailored_fields.json.
- `cover_letter_body` is 2-4 short paragraphs, plain text (blank line between paragraphs), no salutation or signoff — those are handled by the fixed letter template.
- `recruiter_summary` is 2-3 sentences, a ready-made pitch for a recruiter email.
"""


@router.post("/api/tailor")
async def tailor(body: TailorRequest):
    if not body.job_description.strip():
        raise HTTPException(status_code=400, detail="Job description is empty")
    if len(body.job_description) > JD_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Job description exceeds the {JD_MAX_CHARS} character cap",
        )
    if not PROFILE_PATH.exists():
        raise HTTPException(status_code=404, detail="No profile yet — import a resume first")

    profile = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))

    # Local pre-check, no agy call (Section 5 step 1) — never blocks the
    # run, just tells the person it looks like a weak match.
    keywords = profile.get("keywords", []) + profile.get("skills", [])
    overlap = keyword_overlap_score(body.job_description, keywords)
    weak_match = overlap < WEAK_MATCH_THRESHOLD

    WORKSPACE.mkdir(parents=True, exist_ok=True)
    (WORKSPACE / "job_description.md").write_text(body.job_description, encoding="utf-8")

    instruction = _build_instruction(body.truthfulness_mode)
    output = await run_agy(instruction, "tailored_fields.json")
    tailored_fields = parse_json_output(output)

    if body.truthfulness_mode == "strict":
        tailored_fields["inferred_skills"] = []

    resume_context = build_resume_context(profile, tailored_fields)
    pdf_bytes = render_resume_pdf(resume_context)
    docx_bytes = render_resume_docx(resume_context)

    letter_context = build_cover_letter_context(profile, tailored_fields)
    letter_pdf_bytes = render_cover_letter_pdf(letter_context)

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    slug = _slugify(body.company)
    resume_pdf_path = EXPORTS_DIR / f"{slug}.pdf"
    resume_docx_path = EXPORTS_DIR / f"{slug}.docx"
    cover_letter_path = EXPORTS_DIR / f"{slug}-cover-letter.pdf"
    resume_pdf_path.write_bytes(pdf_bytes)
    resume_docx_path.write_bytes(docx_bytes)
    cover_letter_path.write_bytes(letter_pdf_bytes)

    ats_score = tailored_fields.get("match_score")
    row_fields = dict(
        company=body.company,
        role_title=body.role_title,
        target_role=body.target_role,
        job_description=body.job_description,
        ats_score=ats_score,
        resume_path=str(resume_pdf_path),
        docx_path=str(resume_docx_path),
        cover_letter_path=str(cover_letter_path),
        recruiter_summary=tailored_fields.get("recruiter_summary"),
        job_url=body.job_url,
    )

    if body.application_id:
        set_clause = ", ".join(f"{k} = ?" for k in row_fields)
        await db.execute(
            f"UPDATE applications SET {set_clause}, status = 'Cut', updated_at = datetime('now') WHERE id = ?",
            (*row_fields.values(), body.application_id),
        )
        application_id = body.application_id
    else:
        application_id = await db.execute(
            """INSERT INTO applications
               (company, role_title, target_role, job_description, ats_score,
                resume_path, docx_path, cover_letter_path, recruiter_summary,
                job_url, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Cut')""",
            (
                row_fields["company"],
                row_fields["role_title"],
                row_fields["target_role"],
                row_fields["job_description"],
                row_fields["ats_score"],
                row_fields["resume_path"],
                row_fields["docx_path"],
                row_fields["cover_letter_path"],
                row_fields["recruiter_summary"],
                row_fields["job_url"],
            ),
        )

    application = await db.fetch_one(
        "SELECT * FROM applications WHERE id = ?", (application_id,)
    )

    return {
        "weak_match": weak_match,
        "truthfulness_mode": body.truthfulness_mode,
        "tailored_fields": tailored_fields,
        "application": application,
    }
