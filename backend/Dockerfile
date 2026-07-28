# syntax=docker/dockerfile:1
#
# Facet backend. Nothing here is tied to a particular host — paths, ports,
# origins and the agy binary all come from the environment.

FROM python:3.11-slim AS base

# WeasyPrint needs Pango/Cairo/GDK-PixBuf at runtime. On Windows this is the
# GTK DLL problem that breaks PDF export by default; on Debian it is one
# apt-get. Kept in a single layer so it caches independently of the app.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libharfbuzz0b \
        libcairo2 \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        shared-mime-info \
        fonts-dejavu-core \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app/backend

# Dependencies before source, so editing code doesn't reinstall the world.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ /app/backend/
COPY templates/ /app/templates/

# Runs unprivileged. HOME must be writable and owned by this user: agy keeps
# its credentials and a scratch directory under $HOME, and the app writes
# data/ and workspace/ (both normally volumes).
RUN useradd --create-home --uid 10001 facet \
    && mkdir -p /app/data /app/workspace /home/facet/.gemini \
    && chown -R facet:facet /app /home/facet
USER facet
ENV HOME=/home/facet

EXPOSE 8000

# Uses the app's own health endpoint rather than a bare port check, so the
# container is only "healthy" once FastAPI is actually serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
