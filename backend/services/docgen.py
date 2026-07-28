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

from services.paths import TEMPLATES_DIR

_jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))


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


def render_resume_pdf(context: dict) -> bytes:
    HTML = _weasyprint_html()
    template = _jinja_env.get_template("resume_template.html")
    html_string = template.render(**context)
    buffer = BytesIO()
    HTML(string=html_string, base_url=str(TEMPLATES_DIR)).write_pdf(buffer)
    return buffer.getvalue()


def render_resume_docx(context: dict) -> bytes:
    doc = DocxTemplate(str(TEMPLATES_DIR / "resume_template.docx"))
    doc.render(context)
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
