"""Task 4 validation: render two different fake datasets and compare layout."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.docgen import build_resume_context, render_resume_pdf, render_resume_docx  # noqa: E402

OUT_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
OUT_DIR.mkdir(parents=True, exist_ok=True)

PROFILE_A = {
    "name": "Priya Sharma",
    "contact": {
        "email": "priya.sharma@example.com",
        "phone": "+1 (555) 010-2020",
        "location": "Austin, TX",
        "linkedin": "linkedin.com/in/priyasharma",
    },
    "summary_base": "Backend engineer with 6 years building distributed systems.",
    "skills": ["Python", "Go", "Kubernetes"],
    "roles": [
        {
            "id": "role_1",
            "company": "Nimbus Data",
            "title": "Senior Backend Engineer",
            "start": "2021",
            "end": "Present",
            "location": "Austin, TX",
            "bullets": ["Led migration to event-driven architecture."],
        },
        {
            "id": "role_2",
            "company": "Fieldstone Systems",
            "title": "Backend Engineer",
            "start": "2018",
            "end": "2021",
            "location": "Remote",
            "bullets": ["Built the billing reconciliation service."],
        },
    ],
    "projects": [{"name": "OpenLedger", "description": "Open-source double-entry ledger library."}],
    "certifications": ["AWS Certified Solutions Architect"],
    "education": [{"school": "UT Austin", "degree": "B.S. Computer Science", "year": "2018"}],
    "keywords": ["python", "distributed systems"],
}

TAILORED_A = {
    "match_score": 82,
    "matching_skills": ["Python", "Kubernetes"],
    "missing_but_true": [],
    "missing_and_absent": ["Rust"],
    "tailored_summary": "Backend engineer specializing in distributed, event-driven systems at scale.",
    "tailored_skills_order": ["Python", "Kubernetes", "Go"],
    "role_bullets": {
        "role_1": [
            "Led migration to event-driven architecture, cutting p99 latency by 40%.",
            "Mentored 3 engineers through senior promotion.",
        ],
        "role_2": ["Built the billing reconciliation service handling $2M/day in transactions."],
    },
    "cover_letter_body": "...",
    "recruiter_summary": "...",
}

PROFILE_B = {
    "name": "Marcus Lindqvist",
    "contact": {
        "email": "marcus.l@example.com",
        "phone": "+46 70 123 4567",
        "location": "Stockholm, Sweden",
        "linkedin": "linkedin.com/in/marcuslindqvist",
    },
    "summary_base": "Product designer focused on developer tools.",
    "skills": ["Figma", "Design Systems", "TypeScript"],
    "roles": [
        {
            "id": "role_1",
            "company": "Kioskly",
            "title": "Staff Product Designer",
            "start": "2019",
            "end": "Present",
            "location": "Stockholm, Sweden",
            "bullets": ["Rebuilt the design system used across 12 product teams."],
        },
        {
            "id": "role_2",
            "company": "Rutter Labs",
            "title": "Product Designer",
            "start": "2016",
            "end": "2019",
            "location": "Berlin, Germany",
            "bullets": ["Designed the onboarding flow that lifted activation 18%."],
        },
    ],
    "projects": [{"name": "Formkit", "description": "A form-building toolkit for internal tools."}],
    "certifications": ["Nielsen Norman UX Certification"],
    "education": [{"school": "KTH Royal Institute of Technology", "degree": "M.S. Interaction Design", "year": "2016"}],
    "keywords": ["product design", "design systems"],
}

TAILORED_B = {
    "match_score": 74,
    "matching_skills": ["Figma", "Design Systems"],
    "missing_but_true": [],
    "missing_and_absent": ["Motion design"],
    "tailored_summary": "Staff-level product designer who scales design systems across large product orgs.",
    "tailored_skills_order": ["Design Systems", "Figma", "TypeScript"],
    "role_bullets": {
        "role_1": [
            "Rebuilt the design system used across 12 product teams, cutting design debt tickets by 60%.",
            "Ran a cross-team component audit that unified 40+ divergent button styles.",
        ],
        "role_2": ["Designed the onboarding flow that lifted activation 18%."],
    },
    "cover_letter_body": "...",
    "recruiter_summary": "...",
}


def render_dataset(label, profile, tailored):
    context = build_resume_context(profile, tailored)
    pdf_bytes = render_resume_pdf(context)
    docx_bytes = render_resume_docx(context)
    (OUT_DIR / f"resume_{label}.pdf").write_bytes(pdf_bytes)
    (OUT_DIR / f"resume_{label}.docx").write_bytes(docx_bytes)
    print(f"{label}: pdf={len(pdf_bytes)} bytes, docx={len(docx_bytes)} bytes")
    return pdf_bytes


render_dataset("A", PROFILE_A, TAILORED_A)
render_dataset("B", PROFILE_B, TAILORED_B)
print(f"Wrote outputs to {OUT_DIR.resolve()}")
