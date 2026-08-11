"""The login flow, end to end, against a real app.

    backend/.venv/bin/python scripts/test_auth.py

Facet holds credentials now. That is a different kind of responsibility from
the rest of this codebase: a bug here does not lose a feature, it hands
somebody else's job search to whoever is trying.

So this drives the real FastAPI app through the real database and asserts the
things that are invisible when the happy path works — that a wrong password
and a missing account are indistinguishable, that lockout actually locks,
that a suspended user's live cookie stops working, and that setting a
password ends the sessions that came before it.
"""

import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_TMP = Path(tempfile.mkdtemp(prefix="facet-auth-"))
os.environ.update({
    "FACET_HOST_ROOT": str(_TMP / "host"),
    "FACET_USERS_ROOT": str(_TMP / "host" / "users"),
    "FACET_DATA_DIR": str(_TMP / "data"),
    "FACET_WORKSPACE_DIR": str(_TMP / "workspace"),
    "FACET_QUEUE_DB": str(_TMP / "queue.db"),
    "FACET_MULTIUSER": "1",
    "FACET_BIND_HOST": "127.0.0.1",
    "FACET_INSECURE_COOKIES": "1",   # the test client speaks http
})

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from control import store  # noqa: E402
from services import auth  # noqa: E402

PASSWORD = "a perfectly ordinary passphrase"


def _make_user(email: str, status: str = store.ACTIVE, password: str | None = PASSWORD):
    user = store.get_user_by_email(email) or store.create_user_row(email, None)
    if password is not None:
        store.set_password(user["id"], auth.hash_password(password))
    store.set_status(user["id"], status)
    return store.get_user(user["id"])


def check_login_and_isolation(client: TestClient) -> None:
    alice = _make_user("alice@example.com")
    _make_user("bob@example.com")

    # Signed out: the app is closed, and says so without a stack trace.
    response = client.get("/api/applications")
    assert response.status_code == 401, response.status_code
    assert "error" in response.json(), response.json()

    # /me answers "nobody" rather than 401 — the frontend asks it on every
    # page load and must be able to tell "signed out" from "broken".
    body = client.get("/api/auth/me").json()
    assert body["authenticated"] is False, body

    # Wrong password.
    response = client.post("/api/auth/login",
                           json={"email": "alice@example.com", "password": "wrong"})
    assert response.status_code == 401, response.status_code
    wrong_password = response.json()

    # No such account — must be indistinguishable from the above.
    response = client.post("/api/auth/login",
                           json={"email": "nobody@example.com", "password": "wrong"})
    assert response.status_code == 401
    assert response.json() == wrong_password, (
        "a missing account answers differently from a wrong password - "
        "this endpoint tells you who has an account here"
    )

    # The real thing.
    response = client.post("/api/auth/login",
                           json={"email": "alice@example.com", "password": PASSWORD})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["email"] == "alice@example.com"

    cookie = response.cookies.get(auth.SESSION_COOKIE)
    assert cookie, "no session cookie was set"
    assert cookie != auth.token_digest(cookie)

    # The cookie must not be readable by JavaScript, or an XSS anywhere in
    # the app becomes a full account takeover.
    set_cookie = response.headers.get("set-cookie", "").lower()
    assert "httponly" in set_cookie, set_cookie
    assert "samesite=lax" in set_cookie, set_cookie

    # Signed in, alice sees her own (empty) tracker rather than a 401.
    assert client.get("/api/applications").status_code == 200
    assert client.get("/api/auth/me").json()["authenticated"] is True

    # What the database stores is a digest, never the token itself.
    rows = store.list_sessions(alice["id"])
    assert len(rows) == 1
    assert rows[0]["token_hash"] == auth.token_digest(cookie)
    assert cookie not in str(rows), "the raw session token is in the database"
    print("  login:      wrong password and unknown account are indistinguishable")


def check_password_is_not_recoverable() -> None:
    user = store.get_user_by_email("alice@example.com")
    stored = user["password_hash"]
    assert PASSWORD not in stored
    assert stored.startswith("scrypt$")
    # A second account with the same password must not produce the same hash,
    # or the table reveals who shares a password with whom.
    other = _make_user("same@example.com", password=PASSWORD)
    assert other["password_hash"] != stored, "identical passwords hashed identically"
    print("  storage:    salted, and the password is not in the row")


def check_suspension_kills_the_session(client: TestClient) -> None:
    """A live cookie must stop working the moment the account is suspended."""
    carol = _make_user("carol@example.com")
    client.cookies.clear()
    client.post("/api/auth/login",
                json={"email": "carol@example.com", "password": PASSWORD})
    assert client.get("/api/applications").status_code == 200

    store.set_status(carol["id"], store.SUSPENDED)

    # The cookie is still valid as a *session*; the status gate is what stops
    # it. Both layers are checked, so neither alone is load-bearing.
    response = client.get("/api/applications")
    assert response.status_code == 403, response.status_code
    assert client.get("/api/auth/me").json()["authenticated"] is False

    # And revoking really removes it.
    store.set_status(carol["id"], store.ACTIVE)
    assert client.get("/api/applications").status_code == 200
    store.revoke_user_sessions(carol["id"])
    assert client.get("/api/applications").status_code == 401
    print("  suspend:    a live cookie stops working immediately")


def check_lockout(client: TestClient) -> None:
    _make_user("locked@example.com")
    client.cookies.clear()

    for attempt in range(auth.MAX_FAILED_ATTEMPTS):
        response = client.post("/api/auth/login",
                               json={"email": "locked@example.com", "password": "no"})
        assert response.status_code == 401, (attempt, response.status_code)

    # Now locked — and crucially, the *correct* password is refused too.
    # A lockout that lets the right password through stops nobody.
    response = client.post("/api/auth/login",
                           json={"email": "locked@example.com", "password": PASSWORD})
    assert response.status_code == 429, response.status_code
    assert "try again" in response.json()["hint"].lower()

    # A different account is unaffected, or one attacker locks out everybody.
    response = client.post("/api/auth/login",
                           json={"email": "alice@example.com", "password": PASSWORD})
    assert response.status_code == 200, "lockout leaked across accounts"

    # Clearing the failures lets them back in — what a successful login does.
    store.clear_failures("locked@example.com")
    response = client.post("/api/auth/login",
                           json={"email": "locked@example.com", "password": PASSWORD})
    assert response.status_code == 200
    print(f"  lockout:    {auth.MAX_FAILED_ATTEMPTS} failures locks the account, not the host")


def check_invites(client: TestClient) -> None:
    """A user with no password gets in exactly once, via a one-time link."""
    invitee = _make_user("dave@example.com", password=None)
    assert invitee["password_hash"] is None

    token, digest = auth.new_token()
    store.create_invite(invitee["id"], digest, time.time() + auth.INVITE_TTL_SECONDS)

    client.cookies.clear()
    # Before the password is set, logging in is impossible — not "possible
    # with a blank password", which is how invited accounts get taken.
    response = client.post("/api/auth/login",
                           json={"email": "dave@example.com", "password": ""})
    assert response.status_code == 401, response.status_code

    # A short password is refused.
    response = client.post("/api/auth/accept-invite",
                           json={"token": token, "password": "short"})
    assert response.status_code in (400, 422), response.status_code

    # The real thing signs them straight in.
    response = client.post("/api/auth/accept-invite",
                           json={"token": token, "password": PASSWORD})
    assert response.status_code == 200, response.text
    assert client.get("/api/applications").status_code == 200

    # The link is single-use. Left live it is a permanent second key.
    response = client.post("/api/auth/accept-invite",
                           json={"token": token, "password": "another passphrase here"})
    assert response.status_code == 400, "the invite link worked twice"

    # An expired invite is refused.
    token2, digest2 = auth.new_token()
    store.create_invite(invitee["id"], digest2, time.time() - 1)
    response = client.post("/api/auth/accept-invite",
                           json={"token": token2, "password": PASSWORD})
    assert response.status_code == 400, "an expired invite was accepted"

    # A made-up token is refused.
    response = client.post("/api/auth/accept-invite",
                           json={"token": "not-a-real-token", "password": PASSWORD})
    assert response.status_code == 400
    print("  invites:    single-use, expiring, and no blank-password window")


def check_change_password(client: TestClient) -> None:
    client.cookies.clear()
    client.post("/api/auth/login",
                json={"email": "alice@example.com", "password": PASSWORD})

    # A live session is not enough — the current password is required, or a
    # borrowed laptop is an account takeover.
    response = client.post("/api/auth/change-password",
                           json={"current_password": "wrong",
                                 "new_password": "a brand new passphrase"})
    assert response.status_code == 403, response.status_code

    alice = store.get_user_by_email("alice@example.com")
    store.clear_failures("alice@example.com")

    # Give alice a second session, from "another browser".
    second = auth.new_token()
    store.create_session(alice["id"], second[1], auth.SESSION_TTL_SECONDS, "other browser")
    assert len(store.list_sessions(alice["id"])) >= 2

    response = client.post("/api/auth/change-password",
                           json={"current_password": PASSWORD,
                                 "new_password": "a brand new passphrase"})
    assert response.status_code == 200, response.text

    # Every other session is gone. Changing a password is what someone does
    # when they think an account is compromised; it has to evict the intruder.
    remaining = store.list_sessions(alice["id"])
    assert len(remaining) == 1, f"other sessions survived a password change: {remaining}"
    assert client.get("/api/applications").status_code == 200, \
        "the browser that changed the password was signed out"

    # The old password no longer works.
    client.cookies.clear()
    response = client.post("/api/auth/login",
                           json={"email": "alice@example.com", "password": PASSWORD})
    assert response.status_code == 401
    print("  change:     needs the old password, and ends every other session")


def check_logout(client: TestClient) -> None:
    client.cookies.clear()
    client.post("/api/auth/login",
                json={"email": "bob@example.com", "password": PASSWORD})
    bob = store.get_user_by_email("bob@example.com")
    assert len(store.list_sessions(bob["id"])) == 1

    client.post("/api/auth/logout")
    assert store.list_sessions(bob["id"]) == [], "logout left the session in the database"
    assert client.get("/api/applications").status_code == 401
    print("  logout:     the session is deleted, not just the cookie")


def main_() -> None:
    with TestClient(main.app) as client:
        check_login_and_isolation(client)
        check_password_is_not_recoverable()
        check_suspension_kills_the_session(client)
        check_lockout(client)
        check_invites(client)
        check_change_password(client)
        check_logout(client)
    print("auth: all checks passed (real app, real database)")


if __name__ == "__main__":
    try:
        main_()
    finally:
        shutil.rmtree(_TMP, ignore_errors=True)
