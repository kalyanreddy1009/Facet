"""Who is this request, and whose data may it touch.

One process serves everyone, so this module is the only thing standing
between two people's job applications. It is written to fail closed: every
path that cannot positively identify a provisioned, active user ends in a
refusal, never in a fallback identity.

Where identity comes from
-------------------------
Facet's own session cookie. Someone signs in at `/login`, the server issues a
random token, stores its SHA-256 in `control.db`, and returns it as an
HttpOnly cookie. Every later request is identified by looking that digest up.

Server-side rather than a self-contained signed token, because revocation has
to be immediate: suspending or deleting someone must end their session now,
and a stateless token cannot be recalled before it expires.

An expired or unknown cookie is not an error to work around — it produces a
401 and the frontend sends the person to the login page.

The origin still binds loopback and still sits behind the tunnel. That is no
longer what authenticates anybody, but it is what keeps the app off the open
internet except through Cloudflare, so it stays enforced.

Single-user mode
----------------
With `FACET_MULTIUSER` unset, there is no header and no registry, and every
path resolves to the original single-user layout. That is a local checkout on
a laptop, and it is also what every self-check runs under.
"""

import logging
import os

from services import paths

logger = logging.getLogger("facet.identity")

# Paths served before anyone is identified.
#
# Deliberately a small, explicit set rather than a prefix match: `/api/auth`
# as a prefix would have exposed anything later added under it, and the
# things that must be reachable without a session are exactly the ones below.
PUBLIC_PATHS = frozenset({
    "/api/status/health", "/api/status/ready", "/health", "/api/health",
    "/api/auth/login",           # obviously
    "/api/auth/accept-invite",   # setting a first password, from a one-time link
    "/api/auth/invite-status",   # "is this link usable?", asked before anyone types
    "/api/auth/request-link",    # "mine doesn't work" — answers the same either way
    "/api/auth/me",              # answers "nobody" rather than 401, so the UI can ask
    "/api/auth/logout",          # clearing a dead cookie must not require a live one
})


class IdentityError(Exception):
    """No usable identity. Carries the status the caller should return."""

    def __init__(self, status: int, message: str, hint: str = ""):
        super().__init__(message)
        self.status = status
        self.message = message
        self.hint = hint


def multiuser_enabled() -> bool:
    return os.environ.get("FACET_MULTIUSER", "").strip().lower() in ("1", "true", "yes")


def _loopback(host: str) -> bool:
    return host in ("127.0.0.1", "::1", "localhost", "")


def assert_trustworthy_binding() -> None:
    """Refuse to serve multi-user on a port the world can reach.

    Called at startup. The header this module trusts is only trustworthy
    because cloudflared is the sole thing that can connect. Binding anywhere
    else turns a header into an authentication bypass, so this raises: a
    warning in a log nobody reads is not a boundary.
    """
    if not multiuser_enabled():
        return
    host = os.environ.get("FACET_BIND_HOST", "127.0.0.1").strip()
    if not _loopback(host):
        raise RuntimeError(
            f"FACET_MULTIUSER is on but the backend binds {host!r}. "
            "Facet is meant to be reached through the Cloudflare tunnel, not "
            "directly: binding a public interface puts the login endpoint on "
            "the open internet with nothing in front of it. Set "
            "FACET_BIND_HOST=127.0.0.1, or turn off FACET_MULTIUSER."
        )


def _lookup_session(token: str) -> dict | None:
    """The session store lives in the control plane; this is a read of it."""
    from control import store
    from services import auth

    return store.session_user(auth.token_digest(token))


def resolve(token: str | None) -> str | None:
    """Map a session cookie to the user slug whose data it may touch.

    Returns None in single-user mode. Raises IdentityError otherwise — there
    is deliberately no return value meaning "carry on as nobody", because
    that value would resolve to the shared directory.
    """
    if not multiuser_enabled():
        return None

    # Normalise *before* testing for emptiness. A cookie of "   " is truthy,
    # so checking first would send whitespace on to be looked up — a lookup
    # that should never be attempted, let alone match.
    token = (token or "").strip()
    if not token:
        raise IdentityError(401, "Not signed in.", "Sign in to use Facet.")

    user = _lookup_session(token)
    if user is None:
        # One message for "no such session" and "expired session" alike.
        # Telling them apart would confirm to an attacker which stolen tokens
        # were once real, and tells the person nothing they can act on.
        raise IdentityError(401, "Your session has ended.", "Sign in again.")

    # An account mid-provision has directories that may not exist yet, and a
    # suspended or deleted one must not be served at all. Only `active` is a
    # yes; anything else — including a status added later — is a no.
    if user["status"] != "active":
        raise IdentityError(
            403, f"This account is {user['status']}.",
            "It exists but is not currently being served.",
        )

    # The slug becomes a directory name, so it is validated here as well as at
    # creation. A registry row is not a reason to skip the traversal gate.
    return paths.validate_user_id(user["slug"])


def demo() -> None:
    """Self-check:  backend/.venv/bin/python -m services.identity"""
    # Imported rather than used directly: run as __main__ this file is a
    # *different* module object from services.identity, so `IdentityError`
    # here and the class actually raised are two distinct classes.
    import services.identity as ident
    IdentityError = ident.IdentityError

    original = os.environ.get("FACET_MULTIUSER")
    original_host = os.environ.get("FACET_BIND_HOST")

    def restore():
        for key, value in (("FACET_MULTIUSER", original),
                           ("FACET_BIND_HOST", original_host)):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    try:
        # --------------------------------------------------- single-user
        os.environ.pop("FACET_MULTIUSER", None)
        assert not ident.multiuser_enabled()
        assert ident.resolve(None) is None, "single-user must stay single-user"
        assert ident.resolve("any-token") is None
        ident.assert_trustworthy_binding()  # no-op when off

        # ---------------------------------------------------- multi-user
        os.environ["FACET_MULTIUSER"] = "1"
        assert ident.multiuser_enabled()

        # No cookie must NEVER become "the shared directory". This is the
        # single most important assertion in the file: the failure it guards
        # against is silent, and it serves one person's data to everyone.
        for missing in (None, "", "   "):
            try:
                ident.resolve(missing)
            except IdentityError as exc:
                assert exc.status == 401, exc.status
            else:
                raise AssertionError(f"identity {missing!r} was allowed through")

        # An unknown or expired session is refused, not treated as new.
        original_lookup = ident._lookup_session
        ident._lookup_session = lambda token: None
        try:
            ident.resolve("a-token-that-is-not-in-the-database")
        except IdentityError as exc:
            assert exc.status == 401, exc.status
        else:
            raise AssertionError("an unknown session was allowed through")

        # Only `active` is served. A suspended account holding a live cookie
        # must be turned away -- this is what makes suspension mean anything.
        for status in ("provisioning", "suspended", "deprovisioning", "deleted",
                       "something-invented-later"):
            ident._lookup_session = lambda token, s=status: {"slug": "alice", "status": s}
            try:
                ident.resolve("live-token")
            except IdentityError as exc:
                assert exc.status == 403, (status, exc.status)
            else:
                raise AssertionError(f"a {status} account was served")

        # The happy path.
        ident._lookup_session = lambda token: {"slug": "alice", "status": "active"}
        assert ident.resolve("live-token") == "alice"

        # A session row holding a hostile slug is still refused. The store is
        # trusted to say *who*, never to say *where*.
        ident._lookup_session = lambda token: {"slug": "../bob", "status": "active"}
        try:
            ident.resolve("live-token")
        except paths.InvalidUserId:
            pass
        else:
            raise AssertionError("a traversal slug survived the session lookup")

        ident._lookup_session = original_lookup

        # ------------------------------------------------ binding guard
        for loopback in ("127.0.0.1", "::1", "localhost"):
            os.environ["FACET_BIND_HOST"] = loopback
            ident.assert_trustworthy_binding()

        for exposed in ("0.0.0.0", "10.0.0.5", "::"):
            os.environ["FACET_BIND_HOST"] = exposed
            try:
                ident.assert_trustworthy_binding()
            except RuntimeError:
                pass
            else:
                raise AssertionError(f"multi-user allowed on {exposed}")

        # --------------------------------------------- the public paths
        # Whatever else changes, these must not require a session -- and
        # nothing else may sneak in by sharing a prefix with them.
        assert "/api/auth/login" in ident.PUBLIC_PATHS
        assert "/api/applications" not in ident.PUBLIC_PATHS
        assert "/api/auth/change-password" not in ident.PUBLIC_PATHS, \
            "changing a password must require being signed in"
        assert "/api/auth/sessions" not in ident.PUBLIC_PATHS
    finally:
        restore()

    print("identity: all checks passed (sessions, fails closed, no fallback)")


if __name__ == "__main__":
    demo()
