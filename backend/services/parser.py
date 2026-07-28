"""PDF/DOCX -> structured markdown import (Section 3, one-time).

Deliberately mechanical, not agy-assisted — Section 1 lists pdfplumber and
python-docx as the tools for this step, and the person reviews/corrects the
result before it's saved as master_resume.md, so a rough first pass is the
right amount of effort here, not a polished one.
"""

from io import BytesIO

import pdfplumber
from docx import Document


def parse_pdf_to_markdown(file_bytes: bytes) -> str:
    pages = []
    with pdfplumber.open(BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            pages.append(text.strip())
    body = "\n\n".join(p for p in pages if p)
    return f"# Imported Resume (review before saving)\n\n{body}\n"


def parse_docx_to_markdown(file_bytes: bytes) -> str:
    doc = Document(BytesIO(file_bytes))
    lines = ["# Imported Resume (review before saving)", ""]
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            lines.append("")
            continue
        style = (para.style.name or "").lower()
        if "heading" in style or "title" in style:
            lines.append(f"## {text}")
        elif "list" in style or "bullet" in style:
            lines.append(f"- {text}")
        else:
            lines.append(text)
    return "\n".join(lines)


def parse_resume(file_bytes: bytes, filename: str) -> str:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return parse_pdf_to_markdown(file_bytes)
    if lower.endswith(".docx"):
        return parse_docx_to_markdown(file_bytes)
    raise ValueError("Only .pdf and .docx resumes are supported")
