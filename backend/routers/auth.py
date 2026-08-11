"""Sign in, sign out, set a password.

The rules every endpoint here follows, because getting one wrong is how
accounts get taken:

**No user enumeration.** Wrong password and no such account produce the same
message, the same status, and roughly the same timing. Anything else turns
this into a service for discovering who has an account.

**Lockout is per account and counted server-side.** Rate limiting in the
browser stops nobody.

**The session cookie is HttpOnly.** The frontend never reads it and never
needs to; `/api/auth/me` answers who you are.

**Setting a password ends every other session.** If a password is being
changed because it may have leaked, leaving the old sessions alive defeats
the point.
"""

import logging
import time

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from control import store
from services import auth

logger = logging.getLogger("facet.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    email: str
    password: str


class AcceptInviteBody(BaseModel):
    token: str
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


class RequestLinkBody(BaseModel):
    email: str


# Characters a chat client, a mail client or a human commonly welds onto the
# end of a pasted URL. A token is `[A-Za-z0-9_-]` and nothing else, so
# anything outside that at either end is not part of it.
_TOKEN_JUNK = " \t\r\n\"'<>()[]{}.,;:!?«»“”‘’"


def _clean_token(token: str | None) -> str:
    """Recover the token from however it survived being pasted.

    Links get sent through WhatsApp and mail clients, which wrap them in
    angle brackets, glue a full stop on the end of the sentence, or leave a
    trailing newline from a copy. Every one of those produced "that link
    isn't valid" from an otherwise perfect link, and the person on the other
    end has no way to tell that from a genuinely dead one.
    """
    cleaned = (token or "").strip().strip(_TOKEN_JUNK)
    # Someone pasting the whole URL into the token field rather than the
    # address bar is a real thing, and there is no reason to punish it.
    if "token=" in cleaned:
        cleaned = cleaned.split("token=", 1)[1].split("&", 1)[0]
    return cleaned.strip(_TOKEN_JUNK)


def _client(request: Request) -> str:
    return request.client.host if request.client else ""


def _issue_session(response: Response, user: dict, request: Request) -> None:
    token, digest = auth.new_token()
    store.create_session(user["id"], digest, auth.SESSION_TTL_SECONDS,
                         request.headers.get("User-Agent"))
    response.set_cookie(value=token, **auth.cookie_kwargs())


def _public_user(user: dict) -> dict:
    """What the frontend is allowed to know. Never the hash, never the slug's
    filesystem meaning, never another user's anything."""
    return {
        "email": user["email"],
        "display_name": user["display_name"] or user["email"].split("@")[0],
        "status": user["status"],
        "must_set_password": not user["password_hash"],
        # The UI hides the Admin link when this is false. That is presentation,
        # not protection -- every admin route checks the same flag server-side.
        "is_admin": bool(user["is_admin"]),
    }


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response):
    email = (body.email or "").strip().lower()
    remote = _client(request)

    # Lockout first, before any password work. Checking it after would let an
    # attacker keep the expensive hash running on every attempt regardless.
    locked = auth.lockout_remaining(
        store.recent_failures(email, auth.ATTEMPT_WINDOW_SECONDS)
    )
    if locked > 0:
        minutes = max(1, int(locked // 60))
        response.status_code = 429
        return {
            "error": "Too many attempts.",
            "hint": f"Try again in about {minutes} minute(s).",
        }

    user = store.get_user_by_email(email) if email else None

    # `verify_password` burns the same time on a missing account as on a real
    # one, so "no such user" and "wrong password" are not distinguishable by
    # stopwatch any more than by message.
    ok = auth.verify_password(body.password or "", user["password_hash"] if user else None)

    if not ok or user is None:
        store.record_failure(email or "(blank)", remote)
        logger.warning("[Facet] failed login for %r from %s", email, remote or "?")
        response.status_code = 401
        # Still one message for "wrong password" and "no such account" — this
        # must not become an oracle for who has an account. The way out for
        # somebody who never set a password is the "request a link" control
        # that the sign-in page shows to everyone unconditionally, which
        # reveals nothing because it is always there.
        return {
            "error": "That email and password do not match.",
            "hint": "If you were sent a sign-in link and never set a password, "
                    "use the link. Lost it? Ask for a new one below.",
            "reason": "bad_credentials",
        }

    if user["status"] != store.ACTIVE:
        # Deliberately after the password check: answering this before it
        # would confirm an address exists to anyone who typed it.
        response.status_code = 403
        return {
            "error": f"This account is {user['status']}.",
            "hint": "Ask whoever administers this Facet.",
        }

    store.clear_failures(email)

    # Transparent upgrade: a password hashed with older parameters is rehashed
    # now that we have the plaintext, which is the only moment it is possible.
    if auth.needs_rehash(user["password_hash"]):
        store.set_password(user["id"], auth.hash_password(body.password))
        logger.info("[Facet] rehashed %s's password with current parameters", email)

    _issue_session(response, user, request)
    store.record(email, "auth.login", email, remote or None)
    return {"ok": True, "user": _public_user(user)}


@router.post("/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(auth.SESSION_COOKIE)
    if token:
        store.revoke_session(auth.token_digest(token))
    # Cleared whether or not it matched anything: a cookie for a session that
    # no longer exists should not survive a deliberate sign-out.
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(request: Request):
    """Who is signed in. Answers "nobody" rather than 401.

    The frontend asks this on every page load to decide whether to show the
    app or the login page. A 401 here would be indistinguishable from a
    session that expired mid-use, and would send someone to the login page
    with an error they did not cause.
    """
    from services import identity

    if not identity.multiuser_enabled():
        return {"authenticated": True, "single_user": True, "user": None}

    token = request.cookies.get(auth.SESSION_COOKIE)
    user = store.session_user(auth.token_digest(token)) if token else None
    if user is None or user["status"] != store.ACTIVE:
        return {"authenticated": False, "single_user": False, "user": None}
    return {"authenticated": True, "single_user": False, "user": _public_user(user)}


def _invite_problem(state: dict) -> dict | None:
    """Turn a verdict into what to show, or None if the link is good.

    Every branch names the actual problem. The single "that link is not valid
    any more / invitations expire after a week" this replaced was wrong in
    three of the four cases, and the one time it was right it still didn't say
    what to do next. Two real users were locked out by it.
    """
    verdict = state["verdict"]
    if verdict == store.INVITE_OK:
        return None

    if verdict == store.INVITE_USED:
        return {
            "reason": verdict,
            "error": "That link has already been used.",
            "hint": "Your password is set - sign in with it. If you don't know it, "
                    "ask for a new link from the sign-in page.",
        }

    if verdict == store.INVITE_EXPIRED:
        when = time.strftime("%-d %B", time.localtime(state["invite"]["expires_at"]))
        return {
            "reason": verdict,
            "error": f"That link expired on {when}.",
            "hint": "Ask for a new one from the sign-in page - it takes a moment.",
        }

    return {
        "reason": store.INVITE_UNKNOWN,
        "error": "That link isn't one we recognise.",
        "hint": "Links are long and easy to truncate - check you copied the whole "
                "thing, including everything after `token=`.",
    }


@router.get("/invite-status")
async def invite_status(token: str = "", response: Response = None):  # noqa: B008
    """Is this link usable? Asked when the page loads, before anyone types.

    Making somebody choose a password, type it twice, and submit — only then
    to be told the link was dead before they started — is the difference
    between a minor annoyance and giving up. This is deliberately readable
    without any credential: the token *is* the credential, and answering
    "unknown" to a wrong guess reveals nothing a submission wouldn't.
    """
    state = store.invite_state(auth.token_digest(_clean_token(token)))
    problem = _invite_problem(state)
    if problem is None:
        return {
            "usable": True,
            "email": state["user"]["email"],
            "display_name": state["user"]["display_name"] or "",
            # An account still being set up, or one an administrator has
            # paused, cannot be signed into even with a perfect link. Say so
            # now rather than after the password is chosen.
            "account_ready": state["user"]["status"] == store.ACTIVE,
            "status": state["user"]["status"],
            "expires_at": state["invite"]["expires_at"],
        }
    return {"usable": False, **problem}


@router.post("/accept-invite")
async def accept_invite(body: AcceptInviteBody, request: Request, response: Response):
    """Set a first password from a one-time link, and sign in.

    Single-use: `store.set_password` marks every outstanding invite for the
    account used, in the same call that writes the hash. A link that still
    worked afterwards would be a permanent second key.

    The order here is load-bearing. Validate the link, then the account, then
    the password, and only then write anything. The previous version checked
    the password first (so a dead link reported a password problem) and wrote
    the hash before checking the account status (so a suspended user's link
    was consumed, no session was issued, and the response still said
    `{"ok": true}` — leaving them with a burnt link, a password they had no
    way to confirm, and no way in).
    """
    token = _clean_token(body.token)
    state = store.invite_state(auth.token_digest(token))

    # A lost response on a flaky connection is a real thing: the password was
    # set, the reply never arrived, and the retry hits a used token. If the
    # password they are submitting matches the one just written, that is proof
    # enough that this is the same person finishing the same action, so let it
    # through instead of stranding them. Bounded tightly in time.
    if (state["verdict"] == store.INVITE_USED and state["user"] is not None
            and state["invite"]["redeemed"]):
        since_used = time.time() - (state["invite"]["used_at"] or 0)
        if since_used <= auth.INVITE_RETRY_GRACE_SECONDS and auth.verify_password(
            body.password or "", state["user"]["password_hash"]
        ):
            user = state["user"]
            if user["status"] != store.ACTIVE:
                response.status_code = 403
                return _not_active(user)
            _issue_session(response, user, request)
            logger.info("[Facet] %s re-submitted a just-used invite; same password, "
                        "signing them in", user["email"])
            return {"ok": True, "user": _public_user(user)}

    problem = _invite_problem(state)
    if problem is not None:
        logger.warning("[Facet] invite rejected (%s) from %s", problem["reason"], _client(request))
        response.status_code = 400
        return {"error": problem["error"], "hint": problem["hint"], "reason": problem["reason"]}

    user = state["user"]

    # Before writing anything. An account that cannot be signed into must not
    # have its link consumed on the way to finding that out.
    if user["status"] != store.ACTIVE:
        response.status_code = 403
        return _not_active(user)

    # Last, so a dead link never reports itself as a password problem.
    auth.check_password_quality(body.password)

    store.set_password(user["id"], auth.hash_password(body.password))
    store.mark_invite_redeemed(auth.token_digest(token))
    # Any session predating a password being set is not this person's doing.
    store.revoke_user_sessions(user["id"])
    store.resolve_link_requests(user["email"])

    user = store.get_user(user["id"])
    _issue_session(response, user, request)
    store.record(user["email"], "auth.password_set", user["email"], "via invite")
    return {"ok": True, "user": _public_user(user)}


def _not_active(user: dict) -> dict:
    return {
        "error": f"This account is {user['status']}, so it can't be signed into yet.",
        "hint": "Your link is still good - ask whoever administers this Facet to "
                "activate the account, then use it again.",
        "reason": "account_" + user["status"],
    }


@router.post("/request-link")
async def request_link(body: RequestLinkBody, request: Request):
    """"I never got a link" / "mine doesn't work", from the sign-in page.

    Answers identically whether or not the address has an account. Anything
    else turns this into a free tool for discovering who is registered here,
    which is the property the rest of this module works to keep.

    There is no SMTP on this deployment, so the loop closes through a person:
    the request lands in a queue on the admin page. That is honest about how
    it actually works rather than pretending a mail went out.
    """
    email = (body.email or "").strip().lower()
    if email:
        store.record_link_request(email, _client(request))
        logger.info("[Facet] sign-in link requested for %r", email)
    return {
        "ok": True,
        "message": "Asked. Whoever administers this Facet will see the request and "
                   "can send you a fresh link.",
    }


@router.post("/change-password")
async def change_password(body: ChangePasswordBody, request: Request, response: Response):
    """Requires the current password, not merely a live session.

    A session alone is enough for someone at a borrowed laptop to lock the
    owner out of their own account.
    """
    token = request.cookies.get(auth.SESSION_COOKIE)
    user = store.session_user(auth.token_digest(token)) if token else None
    if user is None:
        response.status_code = 401
        return {"error": "Not signed in.", "hint": "Sign in again."}

    if not auth.verify_password(body.current_password or "", user["password_hash"]):
        store.record_failure(user["email"], _client(request))
        response.status_code = 403
        return {"error": "That is not your current password.", "hint": ""}

    auth.check_password_quality(body.new_password)
    store.set_password(user["id"], auth.hash_password(body.new_password))

    # Every session, then a fresh one for this browser. A password change is
    # the standard response to "I think someone has my account", and it has to
    # actually evict them.
    store.revoke_user_sessions(user["id"])
    _issue_session(response, store.get_user(user["id"]), request)
    store.record(user["email"], "auth.password_changed", user["email"], None)
    return {"ok": True}


@router.get("/sessions")
async def sessions(request: Request, response: Response):
    """Where this account is signed in. Digests are never returned."""
    token = request.cookies.get(auth.SESSION_COOKIE)
    user = store.session_user(auth.token_digest(token)) if token else None
    if user is None:
        response.status_code = 401
        return {"error": "Not signed in.", "hint": ""}

    current = auth.token_digest(token)
    return {
        "sessions": [
            {
                "created_at": s["created_at"],
                "last_seen_at": s["last_seen_at"],
                "user_agent": s["user_agent"],
                "expires_at": s["expires_at"],
                "current": s["token_hash"] == current,
            }
            for s in store.list_sessions(user["id"])
        ]
    }


@router.post("/sessions/revoke-others")
async def revoke_others(request: Request, response: Response):
    token = request.cookies.get(auth.SESSION_COOKIE)
    user = store.session_user(auth.token_digest(token)) if token else None
    if user is None:
        response.status_code = 401
        return {"error": "Not signed in.", "hint": ""}

    removed = store.revoke_user_sessions(user["id"])
    store.create_session(user["id"], auth.token_digest(token), auth.SESSION_TTL_SECONDS,
                         request.headers.get("User-Agent"))
    store.record(user["email"], "auth.sessions_revoked", user["email"],
                 f"{max(0, removed - 1)} other session(s)")
    return {"ok": True, "revoked": max(0, removed - 1)}


@router.get("/profile")
async def profile(request: Request, response: Response):
    """Everything this account is, in one call.

    The profile page asks once rather than fanning out to five endpoints —
    it is a summary screen, and five round trips to render one card is how a
    page ends up with five loading states.
    """
    token = request.cookies.get(auth.SESSION_COOKIE)
    user = store.session_user(auth.token_digest(token)) if token else None
    if user is None:
        response.status_code = 401
        return {"error": "Not signed in.", "hint": ""}

    from services import jobs, paths, retention

    current = auth.token_digest(token)

    def _size(path) -> int:
        if not path.exists():
            return 0
        return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())

    # The Stone: is there a profile, and whose name is on it.
    stone = {"imported": paths.PROFILE_PATH.exists()}
    if stone["imported"]:
        import json as _json

        try:
            stone["name"] = _json.loads(
                paths.PROFILE_PATH.read_text(encoding="utf-8")
            ).get("name")
        except (ValueError, OSError):
            # A corrupt profile is a real state, and the profile page is
            # exactly where somebody should find out about it.
            stone["error"] = "profile.json could not be read"

    return {
        "user": _public_user(user),
        "member_since": user["created_at"],
        "password_set_at": user["password_set_at"],
        "stone": stone,
        "cabinet": {
            "applications": await _count("SELECT COUNT(*) AS n FROM applications"),
            "contacts": await _count("SELECT COUNT(*) AS n FROM contacts"),
            "interviews": await _count("SELECT COUNT(*) AS n FROM interviews"),
            "postings_seen": await _count("SELECT COUNT(*) AS n FROM seen_postings"),
        },
        "storage": {
            "data": _size(paths.DATA_ROOT),
            "workspace": _size(paths.WORKSPACE_ROOT),
            "exports": _size(paths.EXPORTS_DIR),
        },
        "queue": await jobs.stats(),
        "sessions": [
            {
                "created_at": s["created_at"],
                "last_seen_at": s["last_seen_at"],
                "user_agent": s["user_agent"],
                "current": s["token_hash"] == current,
            }
            for s in store.list_sessions(user["id"])
        ],
    }


async def _count(sql: str) -> int:
    """A count against this user's own tracker.db.

    Wrapped because a brand-new account's database may not have been touched
    yet, and a profile page that 500s on a fresh sign-up is a bad first
    impression of an app that is working correctly.
    """
    from services import db

    try:
        row = await db.fetch_one(sql)
        return row["n"] if row else 0
    except Exception:  # noqa: BLE001 — any DB state should still render a page
        return 0
