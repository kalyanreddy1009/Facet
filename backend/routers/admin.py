"""Account management, for administrators only.

The whole point of this file is the four lines of `require_admin`. Everything
else is a thin wrapper over `control.store` and `control.provision`.

**Hiding the Admin link in the UI is not access control.** The link is hidden
because showing people a door they cannot open is bad design, not because
hiding it protects anything. Every route below is a FastAPI dependency call
away from refusing, and `scripts/test_admin.py` calls these endpoints
directly as a non-admin to prove it.

These import `control.*` rather than proxying to the control plane on :9000.
It is the same repository and the same process user, so a proxy would add a
network hop, a second failure mode, and a second place for the authorisation
check to be forgotten.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from control import provision, store
from services import auth

logger = logging.getLogger("facet.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])


class CreateUser(BaseModel):
    email: str
    display_name: str | None = None


def current_user(request: Request) -> dict:
    token = request.cookies.get(auth.SESSION_COOKIE)
    user = store.session_user(auth.token_digest(token)) if token else None
    if user is None or user["status"] != store.ACTIVE:
        raise HTTPException(401, "Not signed in.")
    return user


def require_admin(request: Request) -> dict:
    """The gate. Every route in this file depends on it.

    A 404 rather than a 403 for non-admins: a signed-in user who is not an
    administrator should not learn that an admin API exists here, and there
    is nothing they can do with the knowledge except probe it.
    """
    user = current_user(request)
    if not user["is_admin"]:
        logger.warning("[Facet] %s tried to reach %s", user["email"], request.url.path)
        raise HTTPException(404, "Not found")
    return user


def _summary(user: dict) -> dict:
    """One user, as an administrator may see them.

    Deliberately excludes `password_hash`, `invite_hash` and every session
    token. An admin can reset somebody's password; they have no business
    reading its hash, and a hash on a screen is a hash in a screenshot.
    """
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "slug": user["slug"],
        "status": user["status"],
        "is_admin": bool(user["is_admin"]),
        "created_at": user["created_at"],
        "last_seen_at": user["last_seen_at"],
        "has_password": bool(user["password_hash"]),
        "sessions": len(store.list_sessions(user["id"])),
    }


@router.get("/users")
async def list_users(_admin: dict = Depends(require_admin)):
    return {"users": [_summary(u) for u in store.list_users()]}


@router.post("/users", status_code=201)
async def create_user(body: CreateUser, admin: dict = Depends(require_admin)):
    """Create an account and return its one-time sign-in link.

    The link comes back exactly once. Only its digest is stored, so this
    response is the only chance to copy it — reissue rather than trying to
    recover it.
    """
    user = provision.create_user(body.email, body.display_name, admin["email"])
    return {
        **_summary(user),
        "invite_url": provision.issue_invite(user["id"], admin["email"]),
    }


@router.post("/users/{user_id}/invite")
async def reissue_invite(user_id: int, admin: dict = Depends(require_admin)):
    """A fresh sign-in link. This is the password reset.

    It does not clear the existing password, so a link sent to the wrong
    address does not lock the right person out of their own account.
    """
    return {"invite_url": provision.issue_invite(user_id, admin["email"])}


@router.post("/users/{user_id}/suspend")
async def suspend(user_id: int, admin: dict = Depends(require_admin)):
    _refuse_self(user_id, admin, "suspend")
    return _summary(provision.suspend(user_id, admin["email"]))


@router.post("/users/{user_id}/resume")
async def resume(user_id: int, admin: dict = Depends(require_admin)):
    return _summary(provision.resume(user_id, admin["email"]))


@router.post("/users/{user_id}/revoke-sessions")
async def revoke_sessions(user_id: int, admin: dict = Depends(require_admin)):
    """Sign someone out everywhere. What you reach for when a laptop is lost."""
    user = store.get_user(user_id)
    if user is None:
        raise HTTPException(404, "no such user")
    removed = store.revoke_user_sessions(user_id)
    store.record(admin["email"], "user.sessions_revoked", user["email"],
                 f"{removed} session(s)")
    return {"revoked": removed}


@router.post("/users/{user_id}/admin")
async def set_admin(user_id: int, request: Request, admin: dict = Depends(require_admin)):
    """Grant or revoke administrator rights."""
    body = await request.json()
    grant = bool(body.get("is_admin"))

    if not grant:
        _refuse_self(user_id, admin, "remove your own administrator rights")
        # And never leave the deployment with nobody who can add users. The
        # only way back from that is editing the database by hand.
        if len(store.admin_emails()) <= 1:
            raise HTTPException(
                400, "This is the only administrator. Promote someone else first.",
            )

    user = store.get_user(user_id)
    if user is None:
        raise HTTPException(404, "no such user")
    store.set_admin(user_id, grant)
    store.record(admin["email"], "user.admin_changed", user["email"],
                 "granted" if grant else "revoked")
    return _summary(store.get_user(user_id))


def _refuse_self(user_id: int, admin: dict, action: str) -> None:
    """An administrator locking themselves out is a support call with no
    resolution short of editing control.db by hand."""
    if user_id == admin["id"]:
        raise HTTPException(400, f"You cannot {action} on your own account.")


@router.get("/audit")
async def audit(limit: int = 100, _admin: dict = Depends(require_admin)):
    return {"entries": store.audit_log(min(limit, 500))}
