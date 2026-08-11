"""The seven resume templates, and the rule that keeps them honest.

WHY SEVEN SKINS AND ONE SKELETON
--------------------------------
Applicant tracking systems fail on a short and well-documented list: multiple
columns, tables, graphics, text in the page header or footer, non-standard
section headings, and decorative fonts. Every one of those is a *structural*
choice. Typeface, weight, rules, spacing and the arrangement of a role's title
against its dates are not — a parser never sees them.

So the seven templates share one skeleton (`templates/resumes/_base.html`) that
owns every structural decision, and differ only in the layer above it. They are
meaningfully different documents to a person and the same document to a
machine. That is the whole design, and `demo()` at the bottom of this file is
what stops it drifting: it renders all seven, extracts the text back out with
the same kind of reader an ATS uses, and asserts they all yield the same
skeleton in the same order.

WHAT THE CHOICES ARE BASED ON
-----------------------------
Current guidance from Jobscan's ATS formatting research, Resume.io's template
analysis, and Enhancv's 2025 parser study across Workday, iCIMS, Greenhouse,
Lever and Taleo. The consistent findings: single-column beats multi-column by a
wide margin, the Work Experience section is where multi-column layouts lose the
most data (parsers interleave role records), text-selectable PDF parses as
cleanly as DOCX in the major systems, and roughly a quarter of parse failures
are formatting rather than content.

Dates are the other quiet killer. "Jan '21" and "2021–2023" both defeat common
date extractors, so `when()` below normalises what it recognises into
"Jan 2021" and leaves anything it does not recognise completely alone.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from services.paths import TEMPLATES_DIR

TEMPLATE_DIR_NAME = "resumes"


@dataclass(frozen=True)
class ResumeTemplate:
    """One template, as the picker and the renderer both see it."""

    id: str
    name: str
    #: One line, shown under the name in the picker.
    blurb: str
    #: Who it is for. Short enough to sit on a card.
    best_for: str
    #: Drives the miniature preview the frontend draws, so the preview cannot
    #: claim a layout the template does not have.
    traits: dict = field(default_factory=dict)

    @property
    def html(self) -> str:
        return f"{TEMPLATE_DIR_NAME}/{self.id}.html"

    @property
    def docx(self) -> str:
        return f"{self.id}.docx"


#: Order matters — it is the order of the picker, and it runs from the most
#: conventional to the most contemporary so the list reads as a spectrum
#: rather than a bag.
TEMPLATES: tuple[ResumeTemplate, ...] = (
    ResumeTemplate(
        id="chicago",
        name="Chicago",
        blurb="Centred serif with ruled section headings. The traditional resume.",
        best_for="Finance, law, consulting, government",
        traits={"family": "serif", "align": "center", "rules": "heading", "density": "regular"},
    ),
    ResumeTemplate(
        id="zurich",
        name="Zurich",
        blurb="Sans-serif, ranged left, no rules - structure carried by whitespace.",
        best_for="Design, product, startups",
        traits={"family": "sans", "align": "left", "rules": "none", "density": "airy"},
    ),
    ResumeTemplate(
        id="cambridge",
        name="Cambridge",
        blurb="Garamond at a generous measure, small-caps headings, dates above each role.",
        best_for="Academia, research, science",
        traits={"family": "serif", "align": "left", "rules": "none", "density": "airy", "dates": "above"},
    ),
    ResumeTemplate(
        id="meridian",
        name="Meridian",
        blurb="Masthead name over a full-width rule, company before title.",
        best_for="Senior and executive roles",
        traits={"family": "sans", "align": "left", "rules": "header", "density": "regular", "lead": "company"},
    ),
    ResumeTemplate(
        id="compact",
        name="Compact",
        blurb="Tighter margins, type and leading. The same document at higher density.",
        best_for="Ten years or more on one page",
        traits={"family": "sans", "align": "left", "rules": "heading", "density": "dense"},
    ),
    ResumeTemplate(
        id="ledger",
        name="Ledger",
        blurb="Serif text with sans labels, and a rule between every role.",
        best_for="Engineering, operations, long tenures",
        traits={"family": "mixed", "align": "left", "rules": "between", "density": "regular"},
    ),
    ResumeTemplate(
        id="bulletin",
        name="Bulletin",
        blurb="Section headings in a tinted band. Open, contemporary, still plain text.",
        best_for="Marketing, comms, general industry",
        traits={"family": "sans", "align": "left", "rules": "band", "density": "airy"},
    ),
)

BY_ID = {template.id: template for template in TEMPLATES}

#: What a user who has never touched the control gets. Chicago is the closest
#: descendant of the single template Facet shipped before the picker existed,
#: so an existing user's next resume looks very nearly like their last one.
DEFAULT_ID = "chicago"


def resolve(template_id: str | None) -> ResumeTemplate:
    """The named template, or the default.

    Deliberately forgiving. A stored preference naming a template that no
    longer exists must not turn into a failed cut thirty seconds after the
    request was accepted — the user would lose the run and have no idea why.
    """
    return BY_ID.get((template_id or "").strip().lower(), BY_ID[DEFAULT_ID])


def catalog() -> list[dict]:
    """What the picker needs, as plain JSON."""
    return [
        {
            "id": t.id,
            "name": t.name,
            "blurb": t.blurb,
            "best_for": t.best_for,
            "traits": t.traits,
        }
        for t in TEMPLATES
    ]


# ---------------------------------------------------------------- dates ----

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_ISO = re.compile(r"^\s*(\d{4})[-/](\d{1,2})\s*$")
_SLASH = re.compile(r"^\s*(\d{1,2})[-/](\d{4})\s*$")


def when(value) -> str:
    """Normalise a date into the form ATS date extractors read most reliably.

    `2021-03` and `3/2021` both become `Mar 2021`. Anything else — "Present",
    "Summer 2019", "Jan 2021", an empty string — is returned untouched, because
    the alternative is a parser mangling a date it would have read correctly
    and a user seeing their own history quietly rewritten.
    """
    if value is None:
        return ""
    text = str(value)
    for pattern, year_at, month_at in ((_ISO, 1, 2), (_SLASH, 2, 1)):
        match = pattern.match(text)
        if match:
            month = int(match.group(month_at))
            if 1 <= month <= 12:
                return f"{_MONTHS[month - 1]} {match.group(year_at)}"
    return text.strip()


# ----------------------------------------------------------------- check ----


def demo() -> None:
    """Render all seven and prove they are the same document to a parser.

        backend/.venv/bin/python -m services.resume_templates

    This is the check that matters for this feature. A template is not "fine
    because it renders" — it is fine because the text comes back out of the PDF
    in the right order, with every heading a parser looks for, and with nothing
    dropped. That is the plain-text test the ATS guidance describes, run for
    real rather than described in a comment.

    Skipped, loudly, where WeasyPrint's native libraries are absent: this is a
    developer check, and refusing to run is better than pretending to pass.
    """
    import sys

    from services import docgen

    profile = {
        "name": "Ada Okonkwo",
        "contact": {
            "email": "ada@example.com",
            "phone": "+44 7700 900123",
            "location": "London, UK",
            "linkedin": "linkedin.com/in/adaokonkwo",
        },
        "summary_base": "Backend engineer with eight years on payment systems.",
        "skills": ["Python", "FastAPI", "PostgreSQL"],
        "roles": [
            {
                "id": "role_1",
                "company": "Meridian Pay",
                "title": "Senior Backend Engineer",
                "start": "2021-03",
                "end": "Present",
                "location": "London",
                "bullets": ["Rebuilt the reconciliation pipeline."],
            },
            {
                "id": "role_2",
                "company": "Copperline",
                "title": "Software Engineer",
                "start": "6/2018",
                "end": "2021-02",
                "location": "Bristol",
                "bullets": ["Shipped the billing API."],
            },
        ],
        "projects": [{"name": "Facet", "stack": "Python, Next.js", "description": "A job-search assistant."}],
        "education": [{"degree": "BSc Computer Science", "institution": "University of Bristol", "year": "2018"}],
        "certifications": [{"name": "AWS Solutions Architect", "year": "2022"}],
    }
    tailored = {
        "tailored_summary": "Backend engineer with eight years on payment systems.",
        "tailored_skills_order": ["Python", "FastAPI", "PostgreSQL", "Docker"],
        "role_bullets": {"role_1": ["Rebuilt the reconciliation pipeline, cutting settlement breaks by 40%."]},
    }

    # The date normaliser, first — everything below depends on it.
    assert when("2021-03") == "Mar 2021", when("2021-03")
    assert when("6/2018") == "Jun 2018", when("6/2018")
    assert when("Present") == "Present"
    assert when("Summer 2019") == "Summer 2019"
    assert when("2021-13") == "2021-13", "an impossible month must pass through untouched"
    assert when(None) == "" and when("") == ""

    context = docgen.build_resume_context(profile, tailored)

    try:
        docgen.render_resume_pdf(context, "chicago")
    except RuntimeError as exc:  # WeasyPrint's native libs are missing
        print(f"resume_templates: date normalisation OK; render check skipped — {exc}")
        return

    import shutil
    import subprocess
    import tempfile

    pdftotext = shutil.which("pdftotext")

    # The skeleton, in the order a parser must meet it. Sections only: within a
    # role, whether the title or the company comes first is a design choice
    # (Meridian leads with the company, which is the executive convention) and
    # no parser depends on it. What every parser does depend on is the section
    # sequence and reverse-chronological roles, so those are what is asserted.
    expected_order = [
        "Ada Okonkwo",
        "Professional Summary",
        "Skills",
        "Work Experience",
        "Projects",
        "Education",
        "Certifications",
    ]
    # Must all be present, order-independent.
    expected_present = ["Senior Backend Engineer", "Meridian Pay", "Software Engineer", "Copperline"]

    with tempfile.TemporaryDirectory() as tmp:
        for template in TEMPLATES:
            pdf = docgen.render_resume_pdf(context, template.id)
            assert pdf[:4] == b"%PDF", f"{template.id} did not produce a PDF"
            assert len(pdf) > 2000, f"{template.id} produced a suspiciously small PDF"

            if not pdftotext:
                continue

            path = f"{tmp}/{template.id}.pdf"
            with open(path, "wb") as handle:
                handle.write(pdf)
            text = subprocess.run(
                [pdftotext, "-layout", path, "-"], capture_output=True, text=True, check=True
            ).stdout

            # 1. Everything survives the trip out of the PDF, in order.
            #    Case-insensitively, because `text-transform: uppercase` is
            #    applied at render time and therefore changes what is actually
            #    stored in the PDF — a heading styled in caps reaches a parser
            #    as "WORK EXPERIENCE". That is fine and extremely common;
            #    heading matching in every major ATS is case-insensitive. It is
            #    worth knowing that the CSS is not merely cosmetic here.
            flat = text.lower()
            cursor = -1
            for needle in expected_order:
                found = flat.find(needle.lower(), cursor + 1)
                assert found > cursor, (
                    f"{template.id}: '{needle}' is missing from the extracted text, or arrived "
                    f"out of order — a parser would read this resume wrongly"
                )
                cursor = found

            # 1b. Every role's title and employer survived, and the roles are
            #     still in reverse-chronological order — the one ordering
            #     assumption every parser makes about an experience section.
            for needle in expected_present:
                assert needle.lower() in flat, f"{template.id}: '{needle}' did not survive extraction"
            assert flat.index("meridian pay") < flat.index("copperline"), (
                f"{template.id}: roles came out oldest-first — reverse-chronological order is "
                f"what a parser assumes when it assigns your most recent title"
            )

            # 2. The contact details are in the body, not a page header.
            assert "ada@example.com" in text, f"{template.id}: email did not survive extraction"
            assert "+44 7700 900123" in text, f"{template.id}: phone did not survive extraction"

            # 3. Dates arrived in the normalised form.
            assert "Mar 2021" in text, f"{template.id}: start date was not normalised"
            assert "Jun 2018" in text, f"{template.id}: second start date was not normalised"

            # 4. The tailored bullet — the actual product of a cut — is present.
            assert "settlement breaks" in text, f"{template.id}: the tailored bullet is missing"

    # 5. Letter-spacing stays under the measured limit.
    #
    #    This one was found the hard way and is the reason the check exists.
    #    Tracked capitals are a staple of resume design, and at 1pt on an 8.5pt
    #    heading the PDF text extractor returns "P R O F E SS I O N A L S U M
    #    M A RY" — the section heading is gone as far as any parser is
    #    concerned. Worse, it is length-dependent: SKILLS survived at the same
    #    tracking while PROFESSIONAL SUMMARY did not, so a template can pass a
    #    casual look and still lose its longest heading.
    #
    #    The limit turned out to be a *ratio*, not an absolute, which is why an
    #    early fix of "cap everything at 0.8pt" still failed: 0.8pt is fine on
    #    an 11pt heading and broken on an 8pt one. Measured across 8/8.5/9/10/
    #    11.5pt against this WeasyPrint/poppler pair, the boundary sits exactly
    #    at 10% of the font size — 9% extracts cleanly, 10% does not, at every
    #    size tested. The ceiling here is 8%, which leaves room for a different
    #    font or renderer to be slightly less forgiving.
    TRACKING_RATIO_LIMIT = 0.08
    block = re.compile(r"\{([^{}]*)\}")
    for template in TEMPLATES:
        source = (TEMPLATES_DIR / TEMPLATE_DIR_NAME / f"{template.id}.html").read_text(encoding="utf-8")
        for rule in block.finditer(source):
            body = rule.group(1)
            spacing = re.search(r"letter-spacing:\s*(-?[\d.]+)pt", body)
            size = re.search(r"font-size:\s*([\d.]+)pt", body)
            if not spacing or not size:
                continue
            track, points = float(spacing.group(1)), float(size.group(1))
            if track <= 0:
                continue  # negative tracking tightens; it never splits a word
            assert track / points <= TRACKING_RATIO_LIMIT, (
                f"{template.id}: letter-spacing {track}pt on {points}pt type is "
                f"{track / points:.1%} of the font size, over the {TRACKING_RATIO_LIMIT:.0%} "
                f"ceiling. Past 10% the PDF text extractor splits words, and a section "
                f"heading stops being recognisable to an ATS."
            )

    # 6. Structure is single-column and free of the things parsers choke on.
    for template in TEMPLATES:
        source = (TEMPLATES_DIR / TEMPLATE_DIR_NAME / f"{template.id}.html").read_text(encoding="utf-8")
        squashed = source.replace(" ", "")
        for banned, why in (
            ("<table", "a table scrambles reading order"),
            ("<img", "an image carries no parseable text"),
            ("float:", "a float creates a second column"),
            ("position:absolute", "absolute positioning detaches text from the flow"),
            ("@top-center", "page-margin content is skipped by most parsers"),
            ("@bottom-center", "page-margin content is skipped by most parsers"),
            ("column-count", "multiple columns interleave role records"),
            (
                "font-variant:small-caps",
                "WeasyPrint synthesises small-caps as separate glyph runs, and the "
                "extractor reads 'P rofessional s ummary' - the heading stops being "
                "recognisable. Use normal case or ordinary uppercase",
            ),
        ):
            assert banned.replace(" ", "") not in squashed, f"{template.id}: contains '{banned}' — {why}"

    # 7. The Word export exists for every template and carries the same
    #    content. The DOCX shells previously emitted `edu.school` against a
    #    context holding `institution`, so every Word resume shipped with a
    #    blank university line — invisible, because the PDF used a different
    #    template that got it right. That is exactly the class of bug a check
    #    across both renderers catches and neither renderer alone does.
    import io
    import zipfile

    for template in TEMPLATES:
        path = TEMPLATES_DIR / TEMPLATE_DIR_NAME / template.docx
        assert path.exists(), (
            f"{template.id}: {path.name} is missing — run "
            f"templates/build_resume_docx_templates.py"
        )
        blob = docgen.render_resume_docx(context, template.id)
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            body = re.sub(r"<[^>]+>", "", archive.read("word/document.xml").decode("utf-8"))
        for needle in ("Ada Okonkwo", "University of Bristol", "Meridian Pay", "Mar 2021"):
            assert needle in body, f"{template.id}: DOCX is missing '{needle}'"
        assert "work experience" in body.lower(), f"{template.id}: DOCX lost its Experience heading"
        assert "{{" not in body, f"{template.id}: DOCX left an unrendered Jinja tag"

    # 8. Every template has a current preview image.
    #
    #    The picker shows real renders now rather than drawn miniatures, which
    #    is the only way to actually choose between them — but a screenshot is
    #    a copy of the truth and copies rot. This compares the hash the
    #    generator recorded against the template on disk, so a skin edited
    #    without re-running the generator fails here by name instead of
    #    quietly advertising the old design.
    #
    #    The base is folded into the hash because a change there reshapes all
    #    seven, and a preview tracking only its own file would go stale on
    #    exactly the edit that affects every template.
    import hashlib

    previews = TEMPLATES_DIR.parent / "frontend" / "public" / "resume-templates"
    manifest_path = previews / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        base_bytes = (TEMPLATES_DIR / TEMPLATE_DIR_NAME / "_base.html").read_bytes()
        stale = []
        for template in TEMPLATES:
            image = previews / f"{template.id}.webp"
            assert image.exists(), (
                f"{template.id}: preview image is missing — run "
                f"templates/build_template_previews.py"
            )
            source = TEMPLATES_DIR / TEMPLATE_DIR_NAME / f"{template.id}.html"
            current = hashlib.sha256(base_bytes + source.read_bytes()).hexdigest()[:16]
            if manifest.get(template.id, {}).get("hash") != current:
                stale.append(template.id)
        assert not stale, (
            f"preview images are out of date for: {', '.join(stale)}. The picker would show "
            f"the old design. Run templates/build_template_previews.py"
        )
    else:
        print(
            "resume_templates: no preview manifest - run templates/build_template_previews.py",
            flush=True,
        )

    assert len(TEMPLATES) == 7, f"the sprint calls for seven templates, found {len(TEMPLATES)}"
    assert len(BY_ID) == 7, "two templates share an id"
    assert resolve("nonsense").id == DEFAULT_ID, "an unknown id must fall back, never fail"
    assert resolve(None).id == DEFAULT_ID
    assert resolve("  ZURICH  ").id == "zurich", "ids should be forgiving of case and space"

    where = "extracted and ordered" if pdftotext else "rendered (pdftotext absent, text check skipped)"
    print(
        f"resume_templates: {len(TEMPLATES)} templates {where}; headings, contact, "
        f"normalised dates and tailored bullets all survive the parse",
        file=sys.stderr if False else None,
    )


if __name__ == "__main__":
    demo()
