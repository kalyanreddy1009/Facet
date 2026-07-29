"""Only the administrator can administer.

    backend/.venv/bin/python scripts/test_admin.py

The Admin link is hidden from non-admins in the UI. That is presentation. The
question this file answers is what happens when somebody ignores the UI and
calls the endpoint anyway — with a valid session, from a real account, using
nothing more exotic than the browser console.

Every route is exercised twice: once as an ordinary user, who must be
refused, and once as the administrator, who must succeed. A test that only
checks the happy path would pass on an app with no authorisation at all.
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_TMP = Path(tempfile.mkdtemp(prefix="facet-admin-"))
os.environ.update({
    "FACET_HOST_ROOT": str(_TMP / "host"),
    "FACET_USERS_ROOT": str(_TMP / "host" / "users"),
    "FACET_DATA_DIR": str(_TMP / "data"),
    "FACET_WORKSPACE_DIR": str(_TMP / "workspace"),
    "FACET_QUEUE_DB": str(_TMP / "queue.db"),
    "FACET_MULTIUSER": "1",
    "FACET_BIND_HOST": "127.0.0.1",
    "FACET_INSECURE_COOKIES": "1",
})

# Provisioning seeds each new account's RULES.md from the host template, so
# the template has to exist before any user is created.
(_TMP / "workspace").mkdir(parents=True, exist_ok=True)
(_TMP / "workspace" / "RULES.md").write_text("truthfulness contract", encoding="utf-8")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from control import store  # noqa: E402
from services import auth  # noqa: E402

PASSWORD = "a perfectly ordinary passphrase"

# Every route an administrator may reach. Kept as data so a route added later
# without a `require_admin` dependency shows up here as a failure rather than
# as an omission nobody notices.
ADMIN_ROUTES = [
    ("GET", "/api/admin/users", None),
    ("POST", "/api/admin/users", {"email": "intruder@example.com"}),
    ("POST", "/api/admin/users/1/invite", {}),
    ("POST", "/api/admin/users/1/suspend", {}),
    ("POST", "/api/admin/users/1/resume", {}),
    ("POST", "/api/admin/users/1/revoke-sessions", {}),
    ("POST", "/api/admin/users/1/admin", {"is_admin": True}),
    ("GET", "/api/admin/audit", None),
]


def _make(client, email, admin=False):
    user = store.get_user_by_email(email) or store.create_user_row(email, None)
    store.set_password(user["id"], auth.hash_password(PASSWORD))
    store.set_status(user["id"], store.ACTIVE)
    store.set_admin(user["id"], admin)
    return store.get_user(user["id"])


def _sign_in(client, email):
    client.cookies.clear()
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return response


def check_ordinary_user_is_refused(client) -> None:
    """The one that matters. A signed-in, legitimate, non-admin user."""
    _sign_in(client, "bob@example.com")

    # Sanity: this session genuinely works for ordinary things, so a refusal
    # below is authorisation and not a broken cookie.
    assert client.get("/api/applications").status_code == 200

    for method, path, body in ADMIN_ROUTES:
        response = (client.get(path) if method == "GET"
                    else client.post(path, json=body))
        assert response.status_code == 404, (
            f"{method} {path} answered {response.status_code} to a non-admin"
        )

    # And nothing leaked: no user list, no email addresses, no audit trail.
    text = client.get("/api/admin/users").text.lower()
    assert "alice@example.com" not in text
    assert "admin" not in text or "not found" in text
    print(f"  refused:  all {len(ADMIN_ROUTES)} admin routes answer 404 to a real user")


def check_signed_out_is_refused(client) -> None:
    client.cookies.clear()
    for method, path, body in ADMIN_ROUTES:
        response = (client.get(path) if method == "GET"
                    else client.post(path, json=body))
        assert response.status_code in (401, 404), (method, path, response.status_code)
    print("  refused:  and to nobody at all")


def check_me_reports_the_flag(client) -> None:
    """The UI decides what to render from this, so it must be honest."""
    _sign_in(client, "bob@example.com")
    assert client.get("/api/auth/me").json()["user"]["is_admin"] is False

    _sign_in(client, "alice@example.com")
    assert client.get("/api/auth/me").json()["user"]["is_admin"] is True
    print("  /me:      reports is_admin truthfully for both")


def check_admin_can_administer(client) -> None:
    _sign_in(client, "alice@example.com")

    listing = client.get("/api/admin/users")
    assert listing.status_code == 200, listing.text
    users = listing.json()["users"]
    assert any(u["email"] == "bob@example.com" for u in users)

    # Password hashes must never reach a screen, an admin's included.
    body = listing.text
    assert "password_hash" not in body and "scrypt$" not in body, \
        "a password hash was returned to the admin UI"
    assert "invite_hash" not in body and "token_hash" not in body, body[:200]

    created = client.post("/api/admin/users",
                          json={"email": "new@example.com", "display_name": "New"})
    assert created.status_code == 201, created.text
    assert "/set-password?token=" in created.json()["invite_url"]

    bob = store.get_user_by_email("bob@example.com")
    assert client.post(f"/api/admin/users/{bob['id']}/suspend").status_code == 200
    assert store.get_user(bob["id"])["status"] == store.SUSPENDED
    assert client.post(f"/api/admin/users/{bob['id']}/resume").status_code == 200
    print("  allowed:  the administrator can list, create, suspend and resume")


def check_admin_cannot_lock_themselves_out(client) -> None:
    """The failure with no recovery short of editing control.db by hand."""
    _sign_in(client, "alice@example.com")
    alice = store.get_user_by_email("alice@example.com")

    response = client.post(f"/api/admin/users/{alice['id']}/suspend")
    assert response.status_code == 400, response.status_code

    # Nor drop their own admin rights while they are the only administrator.
    response = client.post(f"/api/admin/users/{alice['id']}/admin",
                           json={"is_admin": False})
    assert response.status_code == 400, response.status_code
    assert store.get_user(alice["id"])["is_admin"] == 1

    # With a second administrator it is still refused for oneself -- the
    # "last admin" rule and the "not yourself" rule are separate.
    bob = store.get_user_by_email("bob@example.com")
    client.post(f"/api/admin/users/{bob['id']}/admin", json={"is_admin": True})
    assert len(store.admin_emails()) == 2
    response = client.post(f"/api/admin/users/{alice['id']}/admin",
                           json={"is_admin": False})
    assert response.status_code == 400, "an admin removed their own rights"

    # But alice may demote bob.
    assert client.post(f"/api/admin/users/{bob['id']}/admin",
                       json={"is_admin": False}).status_code == 200
    print("  safety:   an admin cannot suspend or demote themselves")


def check_promotion_takes_effect_immediately(client) -> None:
    """A newly promoted user must not have to sign out and back in."""
    _sign_in(client, "alice@example.com")
    bob = store.get_user_by_email("bob@example.com")
    client.post(f"/api/admin/users/{bob['id']}/admin", json={"is_admin": True})

    _sign_in(client, "bob@example.com")
    assert client.get("/api/admin/users").status_code == 200, \
        "promotion did not apply to an existing session"
    assert client.get("/api/auth/me").json()["user"]["is_admin"] is True

    # And demotion likewise, on the session bob already holds.
    _sign_in(client, "alice@example.com")
    client.post(f"/api/admin/users/{bob['id']}/admin", json={"is_admin": False})

    _sign_in(client, "bob@example.com")
    assert client.get("/api/admin/users").status_code == 404, \
        "a demoted user kept admin access on their existing session"
    print("  live:     promotion and demotion apply without signing out")


def check_bootstrap(client) -> None:
    """FACET_ADMIN_EMAIL grants, and only grants."""
    carol = _make(client, "carol@example.com")
    assert not carol["is_admin"]

    os.environ["FACET_ADMIN_EMAIL"] = "carol@example.com"
    assert store.bootstrap_admin() == "carol@example.com"
    assert store.get_user(carol["id"])["is_admin"] == 1

    # Idempotent.
    assert store.bootstrap_admin() == "carol@example.com"

    # Pointing it elsewhere does NOT revoke carol. Silently demoting the
    # person who edited the env var is how a deployment ends up with no
    # administrator at all.
    os.environ["FACET_ADMIN_EMAIL"] = "alice@example.com"
    store.bootstrap_admin()
    assert store.get_user(carol["id"])["is_admin"] == 1, \
        "changing FACET_ADMIN_EMAIL silently revoked an administrator"

    # An address with no account is ignored rather than creating one.
    os.environ["FACET_ADMIN_EMAIL"] = "ghost@example.com"
    assert store.bootstrap_admin() is None
    os.environ.pop("FACET_ADMIN_EMAIL", None)

    store.set_admin(carol["id"], False)
    print("  bootstrap: FACET_ADMIN_EMAIL grants, never revokes")


def main_() -> None:
    with TestClient(main.app) as client:
        _make(client, "alice@example.com", admin=True)
        _make(client, "bob@example.com", admin=False)

        check_ordinary_user_is_refused(client)
        check_signed_out_is_refused(client)
        check_me_reports_the_flag(client)
        check_admin_can_administer(client)
        check_admin_cannot_lock_themselves_out(client)
        check_promotion_takes_effect_immediately(client)
        check_bootstrap(client)
    print("admin: all checks passed (the gate is the endpoint, not the link)")


if __name__ == "__main__":
    try:
        main_()
    finally:
        shutil.rmtree(_TMP, ignore_errors=True)
