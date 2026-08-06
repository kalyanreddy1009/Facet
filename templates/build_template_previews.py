"""Render each resume template to a preview image for the picker.

    backend/.venv/bin/python templates/build_template_previews.py

Not part of the running app. Run it whenever a template's look changes; the
check in `services.resume_templates` fails until you do.

WHY GENERATED RATHER THAN DRAWN
-------------------------------
The picker first showed a miniature drawn from each template's declared
`traits` — bars standing in for text, serif or sans, where the rules fall. The
reasoning was that seven screenshots are seven files to keep in step with seven
templates, and they go stale silently the first time a template changes.

The reasoning was right about the risk and wrong about the trade. A bar diagram
tells you the shape of a page. It cannot tell you whether you would send it,
and that is the only question the picker exists to answer. Choosing a resume
template without seeing the resume is choosing blind.

So the previews are real renders of the real templates, and the staleness
problem is solved rather than avoided: this script records the SHA-256 of each
template's HTML alongside its image, and the check compares them. Change a
template without re-running this and the check tells you, by name.

WHY A FIXED FIXTURE
-------------------
Every preview renders the same invented person. Not the user's own Stone —
generating seven PDFs of somebody's real employment history every time they
open a picker is a lot of work to show them something they already know, and it
would put their name and phone number into a cache directory. The fixture is
deliberately plain so the differences between the seven are the typography and
the layout, which is what is being chosen between.
"""

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

OUT_DIR = REPO / "frontend" / "public" / "resume-templates"
MANIFEST = OUT_DIR / "manifest.json"

#: Rendered at 144 DPI and downsampled to 560, which is sharper than rendering
#: straight to 560 — the supersample averages away the antialiasing fringes that
#: make small text look furry.
RENDER_DPI = 144
TARGET_WIDTH = 560

#: WebP, not PNG. Seven pages of black-on-white text came to 580 KB as PNG,
#: which is a lot to spend on a control most people open once. Lossy WebP at 82
#: holds the type crisp at card size and costs about a tenth of that. The picker
#: also lazy-loads them, so the ordinary path — arrive, accept the remembered
#: template, never open the picker — fetches none of it.
WEBP_QUALITY = 82

FIXTURE_PROFILE = {
    "name": "Ada Okonkwo",
    "contact": {
        "email": "ada.okonkwo@example.com",
        "phone": "+44 7700 900123",
        "location": "London, UK",
        "linkedin": "linkedin.com/in/adaokonkwo",
    },
    "summary_base": "",
    "skills": [],
    "roles": [
        {
            "id": "role_1",
            "company": "Meridian Pay",
            "title": "Senior Backend Engineer",
            "start": "2021-03",
            "end": "Present",
            "location": "London, UK",
            "bullets": [],
        },
        {
            "id": "role_2",
            "company": "Copperline Systems",
            "title": "Backend Engineer",
            "start": "2018-06",
            "end": "2021-02",
            "location": "Bristol, UK",
            "bullets": [],
        },
        {
            "id": "role_3",
            "company": "Northgate Retail",
            "title": "Software Engineer",
            "start": "2016-09",
            "end": "2018-05",
            "location": "Leeds, UK",
            "bullets": [],
        },
    ],
    "projects": [
        {
            "name": "Facet",
            "stack": "Python, FastAPI, Next.js",
            "description": "A local-only job-search assistant that tailors an application per posting.",
        }
    ],
    "education": [
        {
            "degree": "BSc (Hons) Computer Science, First Class",
            "institution": "University of Bristol",
            "year": "2016",
        }
    ],
    "certifications": [{"name": "AWS Certified Solutions Architect – Associate", "year": "2022"}],
}

FIXTURE_TAILORED = {
    "tailored_summary": (
        "Backend engineer with eight years building payment and settlement systems at scale. "
        "Leads the design of event-driven services in Python, and has taken two platforms "
        "through PCI audit without a finding."
    ),
    "tailored_skills_order": [
        "Python", "FastAPI", "PostgreSQL", "Kafka", "Docker",
        "Kubernetes", "Terraform", "AWS", "Event-driven architecture", "Distributed systems",
    ],
    "role_bullets": {
        "role_1": [
            "Rebuilt the reconciliation pipeline as an event-driven service, cutting unmatched "
            "settlements by 40% and nightly batch time from 6 hours to 25 minutes.",
            "Led the migration of 14 services from a shared Postgres instance to per-service "
            "databases with zero downtime.",
            "Set the on-call rotation's error budget policy; page volume fell 62% over two quarters.",
        ],
        "role_2": [
            "Designed and shipped the billing API now handling £180m a year across 40,000 merchants.",
            "Introduced contract testing between the payments and ledger teams, removing the two "
            "most common release rollbacks.",
        ],
        "role_3": [
            "Built the stock-reservation service behind the checkout, sustaining 3,000 requests "
            "per second at peak trading.",
        ],
    },
}


def template_hash(path: Path) -> str:
    """What the check compares. The base is folded in because a change there
    reshapes every template, and a preview that only tracks its own skin would
    go stale silently on exactly the edit that affects all seven."""
    base = (path.parent / "_base.html").read_bytes()
    return hashlib.sha256(base + path.read_bytes()).hexdigest()[:16]


def build() -> int:
    from services import docgen, resume_templates

    for tool in ("pdftoppm",):
        if not shutil.which(tool):
            print(f"error: {tool} is required (install poppler-utils)", file=sys.stderr)
            return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    context = docgen.build_resume_context(FIXTURE_PROFILE, FIXTURE_TAILORED)
    manifest = {}

    with tempfile.TemporaryDirectory() as tmp:
        for template in resume_templates.TEMPLATES:
            pdf_path = Path(tmp) / f"{template.id}.pdf"
            pdf_path.write_bytes(docgen.render_resume_pdf(context, template.id))

            stem = Path(tmp) / template.id
            subprocess.run(
                ["pdftoppm", "-png", "-r", str(RENDER_DPI), "-f", "1", "-l", "1",
                 "-scale-to-x", str(TARGET_WIDTH), "-scale-to-y", "-1",
                 str(pdf_path), str(stem)],
                check=True,
            )
            # pdftoppm suffixes the page number; there is exactly one page.
            rendered = next(Path(tmp).glob(f"{template.id}-*.png"))
            target = OUT_DIR / f"{template.id}.webp"
            with Image.open(rendered) as image:
                image.convert("RGB").save(target, "WEBP", quality=WEBP_QUALITY, method=6)

            source = REPO / "templates" / resume_templates.TEMPLATE_DIR_NAME / f"{template.id}.html"
            manifest[template.id] = {
                "hash": template_hash(source),
                "bytes": target.stat().st_size,
            }
            print(f"  {template.id:<10} {target.stat().st_size // 1024:>3} KB")

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    total = sum(entry["bytes"] for entry in manifest.values())
    print(f"\nwrote {len(manifest)} previews to {OUT_DIR.relative_to(REPO)} ({total // 1024} KB total)")
    return 0


if __name__ == "__main__":
    raise SystemExit(build())
