import logging
import os

# Logging first — before any other Facet import, so anything those modules log
# at import time lands in data/logs/facet.log rather than nowhere.
from services.logging_setup import RequestLogMiddleware, setup_logging

setup_logging()

from contextlib import asynccontextmanager  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from routers import calendar, feeds, resume, status, tailor, tracker  # noqa: E402
from services.agy_runner import AgyBusyError, AgyError, check_agy_health  # noqa: E402
from services.db import init_db  # noqa: E402
from services.scheduler import shutdown_scheduler, start_scheduler  # noqa: E402

logger = logging.getLogger("facet")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown in one place, with a defined order.

    Replaces the deprecated @app.on_event pair. The ordering matters on the
    way down: the scheduler is stopped before anything else so a poll can't
    start against a closing database.
    """
    init_db()
    start_scheduler()

    available, detail = check_agy_health()
    app.state.agy_available = available
    app.state.agy_detail = detail
    if not available:
        logger.warning("[Facet] WARNING: agy health check failed — %s", detail)

    yield

    shutdown_scheduler()


app = FastAPI(title="Facet", lifespan=lifespan)


@app.exception_handler(AgyError)
async def agy_error_handler(request: Request, exc: AgyError):
    return JSONResponse(status_code=502, content={"error": exc.message, "hint": exc.hint})


@app.exception_handler(AgyBusyError)
async def agy_busy_handler(request: Request, exc: AgyBusyError):
    return JSONResponse(
        status_code=409,
        content={
            "error": "Facet is already running an AI request",
            "hint": "Wait for it to finish, then try again.",
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Last-resort safety net — every error should reach the frontend as
    # structured JSON (Section 15), never a raw stack trace or HTML page.
    logger.error(
        "[Facet] unhandled exception on %s: %r", request.url.path, exc,
        exc_info=exc, extra={"path": request.url.path},
    )
    return JSONResponse(
        status_code=500,
        content={"error": "Something went wrong", "hint": str(exc)},
    )


# Hardcoding the frontend's origin makes the backend only work on one machine
# with one port. Comma-separated env var, defaulting to the local dev setup;
# behind the compose proxy the frontend is same-origin and none of this is
# even consulted.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "FACET_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(RequestLogMiddleware)

app.include_router(status.router)
app.include_router(tracker.router)
app.include_router(feeds.router)
app.include_router(resume.router)
app.include_router(calendar.router)
app.include_router(tailor.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/agy/health")
async def agy_health():
    return {"available": app.state.agy_available, "detail": app.state.agy_detail}
