"""Renders the fixed resume/cover-letter templates to PDF/DOCX in memory.

The templates in templates/ are built once and treated as sacred (Section 7)
— this module only ever fills fields into them. Nothing here regenerates or
restructures a template. Renders happen in-memory (BytesIO); no temp files
are left on disk (Section 14).
"""

from datetime import date
from io import BytesIO

from docxtpl import DocxTemplate
from jinja2 import Environment, FileSystemLoader

from services import resume_templates
from services.paths import TEMPLATES_DIR

_jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))
# Date normalisation lives in the template layer because it is a presentation
# concern — profile.json keeps whatever the user typed, and only the rendered
# document says "Mar 2021". See resume_templates.when().
_jinja_env.filters["when"] = resume_templates.when


def _weasyprint_html():
    """Imported lazily so the backend boots even where WeasyPrint's native
    GTK/Pango libs aren't installed — only PDF export fails, with a clear
    error, instead of the whole app failing to start."""
    try:
        from weasyprint import HTML
    except (ImportError, OSError) as exc:
        raise RuntimeError(
            "PDF export needs WeasyPrint's native libraries (GTK/Pango/Cairo), "
            "which aren't installed. On Windows the reliable way is a conda-forge "
            "env; on macOS `brew install pango`, on Linux the distro's pango/cairo "
            "packages. Everything else in Facet works without them."
        ) from exc
    return HTML


def build_resume_context(profile: dict, tailored_fields: dict) -> dict:
    """Merge profile.json (fixed scaffold) with tailored_fields.json (agy's
    narrow output). Name, contact, company names, titles, dates, education,
    and projects always come from profile.json — nothing downstream alters
    them (Section 3/7)."""
    role_bullets = tailored_fields.get("role_bullets", {})
    roles = []
    for role in profile.get("roles", []):
        roles.append(
            {
                "company": role["company"],
                "title": role["title"],
                "start": role["start"],
                "end": role["end"],
                "location": role.get("location", ""),
                "bullets": role_bullets.get(role["id"], role.get("bullets", [])),
            }
        )

    return {
        "name": profile.get("name", ""),
        "contact": profile.get("contact", {}),
        "summary": tailored_fields.get("tailored_summary", profile.get("summary_base", "")),
        "skills": tailored_fields.get("tailored_skills_order", profile.get("skills", [])),
        "roles": roles,
        "projects": profile.get("projects", []),
        "education": profile.get("education", []),
        "certifications": profile.get("certifications", []),
    }


def render_resume_pdf(context: dict, template_id: str | None = None) -> bytes:
    """Render the resume through one of the seven templates.

    `template_id` is resolved rather than validated: an unknown or retired id
    falls back to the default. This request has already been accepted and
    queued, and failing it thirty seconds later over a stale preference would
    cost the user a cut and tell them nothing useful.
    """
    HTML = _weasyprint_html()
    template = _jinja_env.get_template(resume_templates.resolve(template_id).html)
    html_string = template.render(**context)
    buffer = BytesIO()
    HTML(string=html_string, base_url=str(TEMPLATES_DIR)).write_pdf(buffer)
    return buffer.getvalue()


def render_resume_docx(context: dict, template_id: str | None = None) -> bytes:
    """The same resume as an editable Word document.

    DOCX carries the template's typography — family, sizes, heading treatment —
    but not every one of its layout refinements: Word has no equivalent of a
    tinted heading band that reflows, and forcing one in would produce exactly
    the kind of shape a parser dislikes. The section order, headings and
    content are identical to the PDF, which is what an ATS reads either way.

    A template whose DOCX has not been built falls back to the shared one, so
    adding a template can never break the Word export.
    """
    chosen = resume_templates.resolve(template_id)
    path = TEMPLATES_DIR / resume_templates.TEMPLATE_DIR_NAME / chosen.docx
    if not path.exists():
        path = TEMPLATES_DIR / "resume_template.docx"
    doc = DocxTemplate(str(path))
    # docxtpl builds its own Jinja environment, so the date normaliser has to
    # be handed over explicitly — otherwise the DOCX renders "{{ role.start |
    # when }}" as an error while the PDF beside it is perfectly correct.
    doc.render(context, jinja_env=_jinja_env)
    buffer = BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def build_cover_letter_context(profile: dict, tailored_fields: dict) -> dict:
    return {
        "name": profile.get("name", ""),
        "contact": profile.get("contact", {}),
        "today": date.today().strftime("%B %d, %Y"),
        "cover_letter_body": tailored_fields.get("cover_letter_body", ""),
    }


def render_cover_letter_pdf(context: dict) -> bytes:
    HTML = _weasyprint_html()
    template = _jinja_env.get_template("cover_letter_template.html")
    html_string = template.render(**context)
    buffer = BytesIO()
    HTML(string=html_string, base_url=str(TEMPLATES_DIR)).write_pdf(buffer)
    return buffer.getvalue()
