import logging
import os

# Logging first — before any other Facet import, so anything those modules log
# at import time lands in data/logs/facet.log rather than nowhere.
from services.logging_setup import RequestLogMiddleware, setup_logging

setup_logging()

import asyncio  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from routers import (  # noqa: E402
    admin, auth, calendar, feeds, queue, resume, status, tailor, tracker,
)
from services import auth as auth_service  # noqa: E402
from services import identity, jobs, paths  # noqa: E402
from services.agy_runner import (  # noqa: E402
    AgyBusyError,
    AgyError,
    check_agy_health,
    sweep_orphan_job_dirs,
)
from services.db import init_db  # noqa: E402
from services.scheduler import shutdown_scheduler, start_scheduler  # noqa: E402

logger = logging.getLogger("facet")

# Registered here rather than in services/jobs.py: the handlers live in
# routers, and routers import services — wiring them the other way round
# would be an import cycle.
JOB_HANDLERS = {
    "tailor": tailor.run_tailor_job,
    "extract_profile": resume.run_extract_profile_job,
}

def active_user_slugs() -> list[str | None]:
    """Every identity the process should warm up on startup.

    `[None]` in single-user mode — that is the original single-user layout,
    and it keeps a local checkout behaving exactly as it did.

    A user added later does not need a restart: `db._get_connection` opens
    and initialises a database the first time a request arrives for someone
    it has not seen. This loop only front-loads that work.
    """
    if not identity.multiuser_enabled():
        return [None]
    from control import store

    return [u["slug"] for u in store.list_users() if u["status"] == "active"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown in one place, with a defined order.

    Replaces the deprecated @app.on_event pair. The ordering matters on the
    way down: the scheduler is stopped before anything else so a poll can't
    start against a closing database.
    """
    # Before anything is served: refuse to run multi-user on a port the world
    # can reach. The identity header is only trustworthy behind loopback.
    identity.assert_trustworthy_binding()

    if identity.multiuser_enabled():
        from control import store

        granted = store.bootstrap_admin()
        if granted:
            logger.info("[Facet] administrator: %s", granted)
        elif not store.admin_emails():
            logger.warning(
                "[Facet] no administrator yet. Set FACET_ADMIN_EMAIL to an "
                "existing user's address and restart, or nobody can add users."
            )

    for slug in active_user_slugs():
        with paths.user_scope(slug):
            init_db()
    jobs.init_queue()

    # Before the worker takes anything new: fail rows stranded `running` by a
    # process that died, and delete the scratch directories they left behind.
    # Skipping this leaves a browser polling a spinner that resolves never.
    await jobs.reconcile()
    orphans = sweep_orphan_job_dirs()
    if orphans:
        logger.info("[Facet] swept %s orphaned job director%s",
                    orphans, "y" if orphans == 1 else "ies")

    start_scheduler()
    worker = asyncio.create_task(jobs.worker_loop(JOB_HANDLERS))

    available, detail = check_agy_health()
    app.state.agy_available = available
    app.state.agy_detail = detail
    if not available:
        logger.warning("[Facet] WARNING: agy health check failed — %s", detail)

    yield

    # Scheduler first: a poll must not start against a closing database.
    shutdown_scheduler()
    worker.cancel()
    try:
        await worker
    except asyncio.CancelledError:
        pass


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


@app.exception_handler(auth_service.AuthError)
async def auth_error_handler(request: Request, exc: auth_service.AuthError):
    """A refusal the person can act on, not a 500.

    Without this a password below the length floor reached the catch-all
    below and came back as "Something went wrong" — which tells someone
    typing a password nothing about what to do differently.
    """
    return JSONResponse(
        status_code=exc.status,
        content={"error": exc.message, "hint": exc.hint},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Last-resort safety net — every error should reach the frontend as
    # structured JSON (Section 15), never a raw stack trace or HTML page.
    logger.error(
        "[Facet] unhandled exception on %s: %r", request.url.path, exc,
        exc_info=exc, extra={"path": request.url.path},
    )
    # The exception text goes to the log, not to the client. It routinely
    # contains an absolute path, a query, or a row of somebody's data —
    # `sqlite3.OperationalError` in particular quotes the statement. On a
    # laptop that was a useful hint; on a host serving other people it is a
    # description of the server handed to whoever provoked the error.
    #
    # Set FACET_DEBUG_ERRORS=1 locally to get it back in the response.
    hint = "Try again. If it keeps happening, the server log has the detail."
    if os.environ.get("FACET_DEBUG_ERRORS") == "1":
        hint = str(exc)
    return JSONResponse(
        status_code=500,
        content={"error": "Something went wrong", "hint": hint},
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
@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Three headers a browser needs on every response.

    None of them defends against a bug in this codebase — they defend against
    the browser being clever on our behalf:

      * `nosniff`, because a JSON body is full of text somebody else typed. A
        response sniffed as HTML is that text executing.
      * `DENY`, because nothing here is ever meant to be framed, and a Facet
        framed invisibly over someone else's page is a clickjacked "suspend
        this user".
      * a referrer policy, because an invite link carries its token in the
        query string. Without this, clicking any outbound link from that page
        hands the token to the site being visited.
    """
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(RequestLogMiddleware)


@app.middleware("http")
async def identify_user(request: Request, call_next):
    """Bind the request to one user's data, or refuse it.

    Added last, so it runs first — every router below it executes with the
    identity already set. There is no code path that reaches a handler with
    an unresolved identity while multi-user is on: `identity.resolve` either
    returns a slug or raises.

    The context is reset in `finally`. Starlette reuses the task for the
    response, and a leaked identity would attach to whatever came next.
    """
    if request.url.path in identity.PUBLIC_PATHS:
        return await call_next(request)

    try:
        slug = identity.resolve(request.cookies.get(auth_service.SESSION_COOKIE))
    except identity.IdentityError as exc:
        return JSONResponse(
            status_code=exc.status,
            content={"error": exc.message, "hint": exc.hint},
        )

    token = paths.set_user(slug)
    try:
        return await call_next(request)
    finally:
        paths.reset_user(token)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(status.router)
app.include_router(queue.router)
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
