"""Passwords, sessions and the things that stop people guessing them.

Facet now holds credentials, which it did not before. That is a real change
in what this codebase is responsible for: a bug here does not lose a feature,
it exposes ten people's job searches to whoever is trying.

So every choice below is the boring one.

Hashing
-------
`hashlib.scrypt`, from the standard library. Memory-hard, so a GPU farm gains
far less against it than against PBKDF2, and it needs no new dependency —
argon2-cffi would be marginally better and is not worth adding a compiled
package to a deployment that has to survive on an ARM VM.

Parameters are stored *with* each hash rather than as constants, so raising
them later does not invalidate existing passwords: an old hash keeps
verifying with its own parameters and is transparently upgraded on the next
successful login.

Sessions
--------
Server-side, in `control.db`, not a signed self-contained cookie. The
deciding factor is revocation: suspending or deleting someone has to end
their session *now*, and a stateless token cannot be taken back before it
expires. The cookie holds a random token; the database holds its SHA-256.

Hashing the token means a leaked database backup does not hand over live
sessions. SHA-256 rather than scrypt is correct here — the token is 256 bits
of `secrets` output, so there is no dictionary to attack and nothing for a
slow hash to buy.

What is deliberately absent
---------------------------
No password reset by email. It would need an SMTP dependency and a
deliverability problem, for ten people who have an administrator. Reset is
admin-issued: the portal produces a one-time link. See `create_invite`.

# ponytail: admin-issued invites, no email. Add SMTP if this ever outgrows a
# handful of users who can reach their administrator.
"""

import hashlib
import hmac
import logging
import os
import secrets
import time

logger = logging.getLogger("facet.auth")

# ------------------------------------------------------------------ tuning

# 2**15 * 8 * 128 bytes = 32 MB per hash. Comfortable on the target VM and
# expensive enough to make offline guessing painful. Raising N later is safe:
# stored hashes carry the parameters they were made with.
SCRYPT_N = 2 ** 15
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32
# hashlib refuses to allocate past maxmem, and its default is far below what
# the parameters above need. Getting this wrong raises rather than weakening
# anything, but it raises at login time, which is the worst moment to find out.
SCRYPT_MAXMEM = 64 * 1024 * 1024

SALT_BYTES = 16
TOKEN_BYTES = 32

SESSION_TTL_SECONDS = 14 * 24 * 3600      # two weeks
INVITE_TTL_SECONDS = 7 * 24 * 3600        # a week to set a first password

# How long after an invite is redeemed a resubmission of the *same* token
# with the *same* password is still honoured. Covers the case where the
# password was written but the response never made it back — a dropped
# mobile connection, a closed laptop — which otherwise strands somebody with
# a burnt link and no way to know their password worked. Short, because the
# window is the only thing bounding it, and re-use requires already knowing
# the password that was just set.
INVITE_RETRY_GRACE_SECONDS = 15 * 60

# Lockout. Counted per account, because that is what an attacker targets;
# counting per IP alone is defeated by anything with a proxy list.
MAX_FAILED_ATTEMPTS = 8
LOCKOUT_SECONDS = 15 * 60
ATTEMPT_WINDOW_SECONDS = 15 * 60

MIN_PASSWORD_LENGTH = 12


class AuthError(Exception):
    """Carries the status and a message safe to show the person trying."""

    def __init__(self, status: int, message: str, hint: str = ""):
        super().__init__(message)
        self.status = status
        self.message = message
        self.hint = hint


# ---------------------------------------------------------------- passwords

def hash_password(password: str) -> str:
    """`scrypt$N$r$p$salt$hash`, hex-encoded.

    Self-describing on purpose: the parameters travel with the hash, so
    verification never has to guess which era it came from.
    """
    salt = secrets.token_bytes(SALT_BYTES)
    derived = hashlib.scrypt(
        password.encode("utf-8"), salt=salt,
        n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=SCRYPT_DKLEN,
        maxmem=SCRYPT_MAXMEM,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time check against a stored hash.

    A `None` hash — an invited user who has not set a password yet — still
    performs the work before returning False. Returning early would make
    "this account exists but is unclaimed" measurable with a stopwatch.
    """
    if not stored:
        _burn_time()
        return False

    try:
        scheme, n, r, p, salt_hex, hash_hex = stored.split("$")
        if scheme != "scrypt":
            raise ValueError(scheme)
        derived = hashlib.scrypt(
            password.encode("utf-8"), salt=bytes.fromhex(salt_hex),
            n=int(n), r=int(r), p=int(p), dklen=len(bytes.fromhex(hash_hex)),
            maxmem=SCRYPT_MAXMEM,
        )
    except (ValueError, TypeError) as exc:
        # A malformed hash is a corrupt row, not a valid password. Log it —
        # silently returning False would lock someone out with no explanation
        # anywhere.
        logger.error("[Facet] unusable password hash: %s", exc)
        return False

    return hmac.compare_digest(derived.hex(), hash_hex)


def needs_rehash(stored: str | None) -> bool:
    """True when a hash was made with weaker parameters than current."""
    if not stored:
        return False
    try:
        _, n, r, p, _, _ = stored.split("$")
    except ValueError:
        return True
    return (int(n), int(r), int(p)) != (SCRYPT_N, SCRYPT_R, SCRYPT_P)


def _burn_time() -> None:
    """Spend roughly what a real verification costs, and discard it."""
    hashlib.scrypt(b"absent", salt=b"0" * SALT_BYTES,
                   n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=SCRYPT_DKLEN,
                   maxmem=SCRYPT_MAXMEM)


def check_password_quality(password: str) -> None:
    """Length, and nothing else.

    Composition rules — a digit, a symbol, a capital — push people towards
    `Password1!` and are worse than a length floor. Twelve characters is the
    floor; a passphrase clears it without trying.
    """
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        raise AuthError(
            400, f"Use at least {MIN_PASSWORD_LENGTH} characters.",
            "A short phrase you can remember beats a short password you cannot.",
        )
    if len(password) > 1024:
        # Long inputs are a denial-of-service against a memory-hard hash.
        raise AuthError(400, "That password is too long.", "1024 characters is the limit.")


# ----------------------------------------------------------------- tokens

def new_token() -> tuple[str, str]:
    """A secret to hand out, and the digest to store. Never both in one place."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    return token, token_digest(token)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ----------------------------------------------------------------- lockout

def lockout_remaining(failures: list[float], now: float | None = None) -> float:
    """Seconds until this account may try again; 0 when it may try now.

    Takes the failure timestamps rather than reading the database, so the
    policy is a pure function and can be tested without one.
    """
    now = time.time() if now is None else now
    recent = [t for t in failures if now - t < ATTEMPT_WINDOW_SECONDS]
    if len(recent) < MAX_FAILED_ATTEMPTS:
        return 0.0
    return max(0.0, LOCKOUT_SECONDS - (now - max(recent)))


# ------------------------------------------------------------------ cookies

SESSION_COOKIE = "facet_session"


def cookie_secure() -> bool:
    """Whether to mark the session cookie Secure.

    On by default: this is served over HTTPS in every real deployment, and a
    cookie without Secure can be stripped onto a plain-HTTP request. It is
    only turned off for local development over http://localhost, where a
    Secure cookie is simply never sent and login appears to silently fail.
    """
    return os.environ.get("FACET_INSECURE_COOKIES", "").strip().lower() not in (
        "1", "true", "yes",
    )


def cookie_kwargs(max_age: int = SESSION_TTL_SECONDS) -> dict:
    return {
        "key": SESSION_COOKIE,
        "max_age": max_age,
        "httponly": True,      # JavaScript must never read it
        "secure": cookie_secure(),
        "samesite": "lax",     # blocks the cross-site POST that CSRF needs
        "path": "/",
    }


def demo() -> None:
    """Self-check:  backend/.venv/bin/python -m services.auth"""
    import services.auth as auth

    AuthError_ = auth.AuthError

    # ---------------------------------------------------------- hashing
    stored = auth.hash_password("correct horse battery staple")
    assert stored.startswith("scrypt$"), stored
    assert "correct horse" not in stored, "the password must not survive in the hash"
    assert auth.verify_password("correct horse battery staple", stored)
    assert not auth.verify_password("Correct horse battery staple", stored)
    assert not auth.verify_password("", stored)

    # Two hashes of the same password differ — the salt is doing its job. A
    # deterministic hash would let anyone spot shared passwords across rows.
    assert auth.hash_password("same") != auth.hash_password("same")

    # An account with no password set verifies nothing.
    assert not auth.verify_password("anything", None)
    assert not auth.verify_password("anything", "")

    # A corrupt hash is refused rather than crashing a login request.
    for broken in ("nonsense", "scrypt$bad", "bcrypt$1$2$3$4$5", "scrypt$x$8$1$aa$bb"):
        assert not auth.verify_password("anything", broken), broken

    # Parameters travel with the hash, so raising them does not lock anyone
    # out: an old hash still verifies, and is flagged for upgrade.
    weak = stored.replace(f"scrypt${auth.SCRYPT_N}$", "scrypt$16384$", 1)
    assert auth.needs_rehash(weak), "an old-parameter hash should be flagged"
    assert not auth.needs_rehash(stored)

    # ------------------------------------------------------- quality
    for bad in ("", "short", "elevenchar", "a" * 11):
        try:
            auth.check_password_quality(bad)
        except AuthError_ as exc:
            assert exc.status == 400
        else:
            raise AssertionError(f"accepted a weak password: {bad!r}")

    auth.check_password_quality("a" * 12)
    auth.check_password_quality("a perfectly ordinary passphrase")

    # A megabyte password is a denial-of-service against a memory-hard hash.
    try:
        auth.check_password_quality("x" * 2000)
    except AuthError_ as exc:
        assert exc.status == 400
    else:
        raise AssertionError("an unbounded password length was accepted")

    # -------------------------------------------------------- tokens
    token, digest = auth.new_token()
    assert len(token) > 32, token
    assert digest == auth.token_digest(token)
    assert token not in digest, "the digest must not contain the token"
    assert auth.new_token()[0] != auth.new_token()[0], "tokens must be unique"

    # ------------------------------------------------------- lockout
    now = 1_000_000.0
    assert auth.lockout_remaining([], now) == 0
    assert auth.lockout_remaining([now - 1] * (auth.MAX_FAILED_ATTEMPTS - 1), now) == 0

    locked = auth.lockout_remaining([now - 1] * auth.MAX_FAILED_ATTEMPTS, now)
    assert locked > 0, "the account should be locked after the limit"

    # Failures age out, or a single bad week would lock someone out forever.
    old = [now - auth.ATTEMPT_WINDOW_SECONDS - 1] * (auth.MAX_FAILED_ATTEMPTS * 2)
    assert auth.lockout_remaining(old, now) == 0, "stale failures must not count"

    # The window slides from the most recent failure, so guessing during a
    # lockout extends it rather than running the clock down.
    assert auth.lockout_remaining([now] * auth.MAX_FAILED_ATTEMPTS, now) >= \
        auth.lockout_remaining([now - 60] * auth.MAX_FAILED_ATTEMPTS, now)

    # ------------------------------------------------------- cookies
    before = os.environ.get("FACET_INSECURE_COOKIES")
    try:
        os.environ.pop("FACET_INSECURE_COOKIES", None)
        kwargs = auth.cookie_kwargs()
        assert kwargs["httponly"] is True, "the session cookie must not be readable by JS"
        assert kwargs["secure"] is True, "Secure must be the default"
        assert kwargs["samesite"] == "lax", kwargs

        os.environ["FACET_INSECURE_COOKIES"] = "1"
        assert auth.cookie_kwargs()["secure"] is False
        # Even opted out, the flags that are not about transport stay on.
        assert auth.cookie_kwargs()["httponly"] is True
    finally:
        if before is None:
            os.environ.pop("FACET_INSECURE_COOKIES", None)
        else:
            os.environ["FACET_INSECURE_COOKIES"] = before

    print("auth: all checks passed (scrypt, salts, lockout, cookie flags)")


if __name__ == "__main__":
    demo()
