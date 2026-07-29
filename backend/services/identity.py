"""Who is this request, and whose data may it touch.

One process serves everyone, so this module is the only thing standing
between two people's job applications. It is written to fail closed: every
path that cannot positively identify a provisioned, active user ends in a
refusal, never in a fallback identity.

Where identity comes from
-------------------------
Cloudflare Access authenticates at the edge and sets
`Cf-Access-Authenticated-User-Email` on every request it forwards. Facet
trusts that header, which is safe only because of a property enforced at
startup: **the backend binds loopback**, so the only thing that can reach it
is cloudflared on the same host. A client cannot supply the header itself
because a client cannot reach the port at all.

If that ever stops being true — if the port is bound to 0.0.0.0 or published
by a container — then anyone who can reach it becomes anyone they like by
typing a header. That is why `assert_trustworthy_binding()` exists and why it
raises rather than warns.

The stricter alternative is verifying the `Cf-Access-Jwt-Assertion` JWT
against Cloudflare's JWKS. That is the right upgrade if the origin ever needs
to be reachable beyond loopback; it costs a dependency and a key fetch, and
buys nothing while the loopback property holds.

# ponytail: header trust + loopback binding. Verify the Access JWT instead if
# the origin ever needs to accept traffic from anywhere but cloudflared.

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

ACCESS_EMAIL_HEADER = "Cf-Access-Authenticated-User-Email"

# Paths served before anyone is identified. Health is here so an operator can
# see a sick instance without holding an Access session.
PUBLIC_PATHS = frozenset({"/api/status/health", "/api/status/ready", "/health"})


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
            "Identity comes from a header that only cloudflared may set, so "
            "the origin must bind loopback. Set FACET_BIND_HOST=127.0.0.1, or "
            "turn off FACET_MULTIUSER."
        )


def _lookup(email: str) -> dict | None:
    """The registry lives in the control plane; this is a read of it."""
    from control import store

    return store.get_user_by_email(email)


def resolve(email: str | None) -> str | None:
    """Map an authenticated email to the user slug whose data it may touch.

    Returns None in single-user mode. Raises IdentityError otherwise — there
    is deliberately no return value meaning "carry on as nobody", because
    that value would resolve to the shared directory.
    """
    if not multiuser_enabled():
        return None

    # Normalise *before* testing for emptiness. A header of "   " is truthy,
    # so checking first sent a whitespace-only value on to the registry as an
    # empty email — a lookup that should never be attempted, let alone match.
    email = (email or "").strip().lower()
    if not email:
        raise IdentityError(
            401,
            "Not signed in.",
            "This Facet is behind Cloudflare Access and saw no identity on the "
            "request. Open it through your Facet address rather than directly.",
        )

    user = _lookup(email)
    if user is None:
        raise IdentityError(
            403, f"{email} has no Facet on this host.",
            "Ask whoever administers this deployment to add you.",
        )

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
        assert ident.resolve("anyone@example.com") is None
        ident.assert_trustworthy_binding()  # no-op when off

        # ---------------------------------------------------- multi-user
        os.environ["FACET_MULTIUSER"] = "1"
        assert ident.multiuser_enabled()

        # No header must NEVER become "the shared directory". This is the
        # single most important assertion in the file: the failure it guards
        # against is silent, and it serves one person's data to everyone.
        try:
            ident.resolve(None)
        except IdentityError as exc:
            assert exc.status == 401, exc.status
        else:
            raise AssertionError("a request with no identity was allowed through")

        try:
            ident.resolve("")
        except IdentityError as exc:
            assert exc.status == 401
        else:
            raise AssertionError("an empty identity was allowed through")

        # An unknown but well-formed email is a refusal, not a new account.
        # Auto-creating here would let anyone in the Access org provision
        # themselves by visiting the page.
        original_lookup = ident._lookup
        ident._lookup = lambda email: None
        try:
            ident.resolve("stranger@example.com")
        except IdentityError as exc:
            assert exc.status == 403, exc.status
        else:
            raise AssertionError("an unregistered email was allowed through")

        # Only `active` is served.
        for status in ("provisioning", "suspended", "deprovisioning", "deleted",
                       "something-invented-later"):
            ident._lookup = lambda email, s=status: {"slug": "alice", "status": s}
            try:
                ident.resolve("alice@example.com")
            except IdentityError as exc:
                assert exc.status == 403, (status, exc.status)
            else:
                raise AssertionError(f"a {status} account was served")

        # The happy path, including case-insensitivity — Access may report a
        # different case than the address was registered with.
        seen = {}

        def _record(email):
            seen["email"] = email
            return {"slug": "alice", "status": "active"}

        ident._lookup = _record
        assert ident.resolve("  Alice@Example.COM  ") == "alice"
        assert seen["email"] == "alice@example.com", seen

        # A registry row holding a hostile slug is still refused. The registry
        # is trusted to say *who*, never to say *where*.
        ident._lookup = lambda email: {"slug": "../bob", "status": "active"}
        try:
            ident.resolve("alice@example.com")
        except paths.InvalidUserId:
            pass
        else:
            raise AssertionError("a traversal slug survived the registry")

        ident._lookup = original_lookup

        # ------------------------------------------------ binding guard
        os.environ["FACET_BIND_HOST"] = "127.0.0.1"
        ident.assert_trustworthy_binding()
        os.environ["FACET_BIND_HOST"] = "::1"
        ident.assert_trustworthy_binding()

        for exposed in ("0.0.0.0", "10.0.0.5", "::"):
            os.environ["FACET_BIND_HOST"] = exposed
            try:
                ident.assert_trustworthy_binding()
            except RuntimeError:
                pass
            else:
                raise AssertionError(f"multi-user allowed on {exposed}")
    finally:
        restore()

    print("identity: all checks passed (fails closed, no fallback identity)")


if __name__ == "__main__":
    demo()
