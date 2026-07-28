"""The admin portal — API and page.

Run it:

    backend/.venv/python.exe -m control.app          # http://127.0.0.1:9000

Binds to localhost only. In the host deployment nothing is published
directly: cloudflared reaches it over the loopback, and a Cloudflare Access
policy naming one email address is the authentication. That is why there is
no login here — adding a second identity system behind Access would be
strictly worse than the one Access already provides.

Until Phase 3 wires that up, the loopback bind *is* the boundary. Do not
expose this port.
"""

import logging
import os
import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, field_validator

from . import provision, store

logger = logging.getLogger("facet.control")

app = FastAPI(title="Facet — control plane")

PAGE = Path(__file__).resolve().parent / "admin.html"


def actor(request: Request) -> str:
    """Who is acting, for the audit log.

    Cloudflare Access puts the authenticated address on every request it
    forwards. Reading it now means the audit log is already correct the day
    Phase 3 puts Access in front, rather than recording "local-admin" for
    everything forever.
    """
    return request.headers.get("Cf-Access-Authenticated-User-Email") or "local-admin"


@app.exception_handler(provision.ProvisionError)
async def provision_error(request: Request, exc: provision.ProvisionError):
    return JSONResponse(status_code=400, content={"error": exc.message, "step": exc.step})


# ------------------------------------------------------------------ stats

def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _count(db: Path, sql: str) -> int | None:
    """Read a number out of an instance's database without disturbing it.

    Read-only URI and a short busy timeout: the control plane observes user
    databases, it never writes to them, and it must never be the reason an
    instance blocks.
    """
    if not db.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        try:
            return conn.execute(sql).fetchone()[0]
        finally:
            conn.close()
    except sqlite3.Error:
        return None


def user_summary(user: dict) -> dict:
    paths = store.user_paths(user["slug"])
    queue_counts = {}
    if paths["queue_db"].exists():
        try:
            conn = sqlite3.connect(f"file:{paths['queue_db']}?mode=ro", uri=True, timeout=2)
            try:
                queue_counts = {
                    row[0]: row[1]
                    for row in conn.execute("SELECT status, COUNT(*) FROM jobs GROUP BY status")
                }
            finally:
                conn.close()
        except sqlite3.Error:
            queue_counts = {}

    return {
        **user,
        "running": provision.instance_running(user),
        "postings": _count(paths["tracker_db"], "SELECT COUNT(*) FROM seen_postings"),
        "applications": _count(paths["tracker_db"], "SELECT COUNT(*) FROM applications"),
        "queue": queue_counts,
        "disk": {
            "data": _dir_size(paths["data"]),
            "workspace": _dir_size(paths["workspace"]),
            "total": _dir_size(paths["home"]),
        },
        "urls": {"web": f"http://127.0.0.1:{user['web_port']}"},
    }


# ------------------------------------------------------------------ routes

@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(PAGE)


@app.get("/api/health")
async def health():
    return {"status": "ok", "host_root": str(store.HOST_ROOT)}


@app.get("/api/users")
async def list_users(include_deleted: bool = False):
    return [user_summary(u) for u in store.list_users(include_deleted)]


@app.get("/api/users/{user_id}")
async def get_user(user_id: int):
    user = store.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="No such user")
    return user_summary(user)


class CreateUser(BaseModel):
    email: str
    display_name: str | None = None

    @field_validator("email")
    @classmethod
    def sane_email(cls, value: str) -> str:
        """Deliberately not RFC 5322, and not pydantic's EmailStr.

        This address only has to name a person in a Cloudflare Access policy
        and survive being turned into a directory name. Full validation would
        mean adding `email-validator` to every host install to reject
        addresses an admin is typing by hand anyway.
        """
        email = value.strip().lower()
        local, _, domain = email.partition("@")
        if not local or "." not in domain or any(c.isspace() for c in email):
            raise ValueError("not a usable email address")
        return email


@app.post("/api/users", status_code=201)
async def create_user(body: CreateUser, request: Request):
    user = provision.create_user(body.email, body.display_name, actor(request))
    return user_summary(user)


@app.post("/api/users/{user_id}/provision")
async def reprovision(user_id: int, request: Request):
    """Retry a pipeline that stopped part way. Every step is idempotent, so
    this resumes rather than starting over."""
    return user_summary(provision.provision(user_id, actor(request)))


@app.post("/api/users/{user_id}/suspend")
async def suspend(user_id: int, request: Request):
    return user_summary(provision.suspend(user_id, actor(request)))


@app.post("/api/users/{user_id}/resume")
async def resume(user_id: int, request: Request):
    return user_summary(provision.resume(user_id, actor(request)))


@app.post("/api/users/{user_id}/export")
async def export(user_id: int, request: Request):
    bundle = provision.export_account(user_id, actor(request))
    return {"bundle": bundle.name, "bytes": bundle.stat().st_size}


@app.get("/api/users/{user_id}/export/{name}")
async def download_export(user_id: int, name: str):
    # Resolved under the exports directory and checked, so a crafted name
    # can't walk out of it. The control plane is the one place on this host
    # that can read every user's data; it does not get to be casual.
    bundle = (store.EXPORTS_DIR / name).resolve()
    if not bundle.is_file() or store.EXPORTS_DIR.resolve() not in bundle.parents:
        raise HTTPException(status_code=404, detail="No such export")
    return FileResponse(bundle, filename=bundle.name)


class DeleteUser(BaseModel):
    confirm_email: str


@app.post("/api/users/{user_id}/delete")
async def delete_user(user_id: int, body: DeleteUser, request: Request):
    """Soft delete. An export is written first and the data is moved aside,
    recoverable until the grace period expires."""
    return user_summary(provision.delete_user(user_id, body.confirm_email, actor(request)))


@app.post("/api/users/{user_id}/undelete")
async def undelete(user_id: int, request: Request):
    return user_summary(provision.undelete(user_id, actor(request)))


class ImportExisting(BaseModel):
    email: str
    data_dir: str
    workspace_dir: str


@app.post("/api/users/import")
async def import_existing(body: ImportExisting, request: Request):
    """Adopt an existing single-user installation as a user of this host.

    Copies, never moves: the source installation keeps working untouched
    until the copy has been verified serving real traffic. That is the whole
    safety argument for migrating this way rather than in place.
    """
    data = Path(body.data_dir).expanduser().resolve()
    workspace = Path(body.workspace_dir).expanduser().resolve()
    if not data.is_dir():
        raise HTTPException(status_code=400, detail=f"No such data directory: {data}")

    user = provision.import_existing(body.email.strip().lower(), data, workspace,
                                     actor(request))
    return user_summary(user)


@app.get("/api/audit")
async def audit(limit: int = 100):
    return store.audit_log(limit)


@app.get("/api/storage")
async def storage():
    import shutil as _shutil
    usage = _shutil.disk_usage(str(store.HOST_ROOT))
    users = [user_summary(u) for u in store.list_users()]
    return {
        "disk": {"total": usage.total, "used": usage.used, "free": usage.free},
        "host_root": str(store.HOST_ROOT),
        "users_total": sum(u["disk"]["total"] for u in users),
        "deleted_total": _dir_size(store.DELETED_DIR),
        "exports_total": _dir_size(store.EXPORTS_DIR),
        "purge_grace_days": provision.PURGE_GRACE_SECONDS // 86400,
    }


@app.get("/api/queue")
async def queue():
    """Every instance's queue, in one view.

    Aggregated per user rather than from one shared queue because in Phase 2
    each instance still owns its own. Phase 3 points them at a shared file
    and this becomes a single read.
    """
    rows = []
    for user in store.list_users():
        paths = store.user_paths(user["slug"])
        if not paths["queue_db"].exists():
            continue
        try:
            conn = sqlite3.connect(f"file:{paths['queue_db']}?mode=ro", uri=True, timeout=2)
        except sqlite3.Error:
            continue
        try:
            for row in conn.execute(
                "SELECT id, kind, status, error_kind, queued_at, started_at, finished_at "
                "FROM jobs ORDER BY queued_at DESC LIMIT 25"
            ):
                rows.append({
                    "user": user["slug"], "id": row[0], "kind": row[1],
                    "status": row[2], "error_kind": row[3],
                    "queued_at": row[4], "started_at": row[5], "finished_at": row[6],
                })
        except sqlite3.Error:
            pass
        finally:
            conn.close()
    rows.sort(key=lambda r: r["queued_at"], reverse=True)
    return rows


@app.on_event("startup")
async def startup():
    store.init_control_db()
    logger.info("[Facet] control plane ready — host root %s", store.HOST_ROOT)


def main() -> None:
    import uvicorn

    from services.logging_setup import setup_logging

    setup_logging()
    store.init_control_db()
    port = int(os.environ.get("FACET_CONTROL_PORT", "9000"))
    print(f"\n  Admin portal: http://127.0.0.1:{port}")
    print(f"  Host root:    {store.HOST_ROOT}\n")
    uvicorn.run(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
