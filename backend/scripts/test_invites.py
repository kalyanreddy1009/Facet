"""The sign-in link, and every way it went wrong.

    backend/.venv/bin/python scripts/test_invites.py

On 2026-07-29 two real people were locked out by this flow. Neither hit an
exotic case; they hit three ordinary ones, and every one of them reported
itself as "that link is not valid any more — invitations expire after a
week", which was false in all three.

What actually happened, from the audit log:

  1. An administrator issued a second link to one of them four minutes after
     the first. Invites lived in two columns on the user row, so the second
     link *overwrote* the first. The link already in their hands was dead and
     the message blamed expiry.
  2. Both accounts were briefly suspended. `accept_invite` wrote the password
     hash *before* checking status, so clicking during that window consumed
     the invite, issued no session, and still answered `{"ok": true}`. The
     link was gone, the password was set, and there was no way to discover
     either.
  3. Having failed, they tried the ordinary sign-in form. An invited account
     has no password, so that answers "email and password do not match" —
     correct, and a dead end, because nothing on the page offered a way to
     ask for another link.

Every check below is one of those, plus the paths that had to keep working.
"""

import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_TMP = Path(tempfile.mkdtemp(prefix="facet-invites-"))
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

(_TMP / "workspace").mkdir(parents=True, exist_ok=True)
(_TMP / "workspace" / "RULES.md").write_text("truthfulness contract", encoding="utf-8")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from control import store  # noqa: E402
from services import auth  # noqa: E402

PASSWORD = "a perfectly ordinary passphrase"


def _user(email: str) -> dict:
    user = store.get_user_by_email(email) or store.create_user_row(email, None)
    store.set_status(user["id"], store.ACTIVE)
    return store.get_user(user["id"])


def _invite(user_id: int, ttl: float = auth.INVITE_TTL_SECONDS) -> str:
    """Mint a link the way `provision.issue_invite` does, returning the token."""
    token, digest = auth.new_token()
    store.create_invite(user_id, digest, time.time() + ttl, "test")
    return token


def _accept(client, token, password=PASSWORD):
    client.cookies.clear()
    return client.post("/api/auth/accept-invite", json={"token": token, "password": password})


# --------------------------------------------------------------- the bugs

def check_a_second_link_does_not_kill_the_first(client) -> None:
    """Bug 1. The one that locked out a real user.

    An administrator re-issuing a link — to re-copy it, or because they
    weren't sure the first arrived — must not break the one already sent.
    """
    user = _user("first@example.com")
    older = _invite(user["id"])
    newer = _invite(user["id"])

    response = _accept(client, older)
    assert response.status_code == 200, (
        "the older link was rejected after a second was issued - this is the "
        f"exact regression that locked two users out: {response.text}"
    )

    # And the newer one is dead now, because a password exists.
    assert _accept(client, newer).status_code == 400, "every link must die once a password is set"


def check_suspended_does_not_consume_the_link(client) -> None:
    """Bug 2. Clicking while suspended used to burn the invite and lie."""
    user = _user("paused@example.com")
    token = _invite(user["id"])
    store.set_status(user["id"], store.SUSPENDED)

    response = _accept(client, token)
    assert response.status_code == 403, response.status_code
    assert "facet_session" not in response.cookies, "a suspended account must not get a session"

    after = store.get_user(user["id"])
    assert not after["password_hash"], "nothing may be written for an account that can't sign in"

    state = store.invite_state(auth.token_digest(token))
    assert state["verdict"] == store.INVITE_OK, (
        "the link must survive - being suspended for a minute cannot cost "
        "somebody the only credential they have"
    )

    # And once the administrator activates them, the same link works.
    store.set_status(user["id"], store.ACTIVE)
    assert _accept(client, token).status_code == 200


def check_sign_in_page_offers_a_way_out(client) -> None:
    """Bug 3. An invited user who tries the login form must not hit a wall."""
    _user("stuck@example.com")

    response = client.post("/api/auth/login",
                           json={"email": "stuck@example.com", "password": "guessing"})
    assert response.status_code == 401
    # Still no enumeration: the message cannot confirm the account exists.
    unknown = client.post("/api/auth/login",
                          json={"email": "nobody@example.com", "password": "guessing"})
    assert unknown.json()["error"] == response.json()["error"], (
        "a known and an unknown address must be indistinguishable"
    )

    # The way out is a control shown to everyone, which is why it leaks
    # nothing: asking about an address with no account is answered the same.
    for email in ("stuck@example.com", "nobody@example.com"):
        asked = client.post("/api/auth/request-link", json={"email": email})
        assert asked.status_code == 200 and asked.json()["ok"], asked.text

    queued = {r["email"] for r in store.pending_link_requests()}
    assert queued == {"stuck@example.com", "nobody@example.com"}, queued


# ----------------------------------------------------- honest diagnostics

def check_each_failure_says_which_one_it_is(client) -> None:
    """"Expired", "already used" and "never existed" need different answers —
    they need different actions from the person reading them."""
    user = _user("diag@example.com")

    expired = _invite(user["id"], ttl=-1)
    body = _accept(client, expired).json()
    assert body["reason"] == store.INVITE_EXPIRED, body
    assert "expired on" in body["error"], body["error"]

    unknown = _accept(client, "not-a-real-token").json()
    assert unknown["reason"] == store.INVITE_UNKNOWN, unknown

    live = _invite(user["id"])
    assert _accept(client, live).status_code == 200
    used = _accept(client, live, password="a different passphrase entirely").json()
    assert used["reason"] == store.INVITE_USED, used
    assert "already been used" in used["error"], used["error"]


def check_status_is_readable_before_typing(client) -> None:
    """The page asks on load, so nobody chooses a password for a dead link."""
    user = _user("ahead@example.com")
    token = _invite(user["id"])

    good = client.get("/api/auth/invite-status", params={"token": token}).json()
    assert good["usable"] and good["email"] == "ahead@example.com", good
    assert good["account_ready"] is True

    dead = client.get("/api/auth/invite-status", params={"token": "nope"}).json()
    assert dead["usable"] is False and dead["reason"] == store.INVITE_UNKNOWN, dead

    # An account not yet active is reported before the password is chosen,
    # not after.
    store.set_status(user["id"], store.SUSPENDED)
    paused = client.get("/api/auth/invite-status", params={"token": token}).json()
    assert paused["usable"] and paused["account_ready"] is False, paused
    store.set_status(user["id"], store.ACTIVE)


def check_mangled_links_still_work(client) -> None:
    """Links travel through chat clients, which punctuate them."""
    user = _user("pasted@example.com")
    token = _invite(user["id"])

    for mangled in (
        f" {token} ",                                            # copied with space
        f"{token}\n",                                            # trailing newline
        f"<{token}>",                                            # mail client brackets
        f"{token}.",                                             # end of a sentence
        f"https://facet.example/set-password?token={token}",     # the whole URL pasted
    ):
        state = store.invite_state(auth.token_digest(token))
        if state["verdict"] != store.INVITE_OK:
            token = _invite(user["id"])
            mangled = mangled.replace(mangled.strip(" \n<>."), token)
        response = _accept(client, mangled)
        assert response.status_code == 200, f"{mangled!r} was rejected: {response.text}"
        # Re-mint for the next variant, since accepting consumes it.
        token = _invite(user["id"])


def check_a_lost_response_is_recoverable(client) -> None:
    """Password written, reply never arrived, user presses the button again.

    Without the grace window this strands them: the link is used, and they
    have no way to know the password they chose is now real.
    """
    user = _user("flaky@example.com")
    token = _invite(user["id"])
    assert _accept(client, token).status_code == 200

    retry = _accept(client, token)
    assert retry.status_code == 200, (
        f"the same token with the same password must be honoured briefly: {retry.text}"
    )
    assert "facet_session" in retry.cookies

    # But only with the right password. A used token is not a free pass.
    assert _accept(client, token, password="something else entirely").status_code == 400


def check_link_is_single_use_after_the_grace(client) -> None:
    """The grace window is time-bounded, not a permanent second key."""
    user = _user("expiredgrace@example.com")
    token = _invite(user["id"])
    assert _accept(client, token).status_code == 200

    # Age the redemption past the window.
    conn = store.connect()
    conn.execute(
        "UPDATE invites SET used_at = ? WHERE token_hash = ?",
        (time.time() - auth.INVITE_RETRY_GRACE_SECONDS - 60, auth.token_digest(token)),
    )
    conn.commit()

    stale = _accept(client, token)
    assert stale.status_code == 400, "a used link must stop working once the grace lapses"
    assert stale.json()["reason"] == store.INVITE_USED


def check_password_quality_reported_after_the_link(client) -> None:
    """A dead link must not report itself as a password problem."""
    body = _accept(client, "not-a-real-token", password="short").json()
    assert body["reason"] == store.INVITE_UNKNOWN, (
        f"the link was the problem, not the password: {body}"
    )

    # With a good link, the password check does still apply.
    user = _user("quality@example.com")
    weak = _accept(client, _invite(user["id"]), password="short")
    assert weak.status_code == 400
    assert "reason" not in weak.json() or weak.json().get("reason") != store.INVITE_UNKNOWN


def check_issuing_a_link_clears_the_request(client) -> None:
    """The queue drains by doing the thing, not by a dismiss button."""
    from control import provision

    user = _user("asked@example.com")
    store.record_link_request("asked@example.com", "1.2.3.4")
    assert any(r["email"] == "asked@example.com" for r in store.pending_link_requests())

    provision.issue_invite(user["id"], "admin@example.com")
    assert not any(r["email"] == "asked@example.com" for r in store.pending_link_requests())


def check_old_column_invites_still_work(client) -> None:
    """A link issued before this change, sitting in somebody's inbox.

    The migration copies the old two-column invite into the new table. If it
    didn't, this upgrade would itself have locked out everyone mid-invite —
    which is precisely the failure being fixed.
    """
    user = _user("legacy@example.com")
    token, digest = auth.new_token()

    conn = store.connect()
    conn.execute("DELETE FROM invites WHERE user_id = ?", (user["id"],))
    conn.execute("UPDATE users SET invite_hash = ?, invite_expires = ? WHERE id = ?",
                 (digest, time.time() + 3600, user["id"]))
    conn.commit()

    store._init_schema(conn)  # the migration, as it runs on startup

    assert _accept(client, token).status_code == 200, (
        "a link already in somebody's hands must survive the upgrade"
    )


def main_() -> None:
    with TestClient(main.app) as client:
        check_a_second_link_does_not_kill_the_first(client)
        check_suspended_does_not_consume_the_link(client)
        check_sign_in_page_offers_a_way_out(client)
        check_each_failure_says_which_one_it_is(client)
        check_status_is_readable_before_typing(client)
        check_mangled_links_still_work(client)
        check_a_lost_response_is_recoverable(client)
        check_link_is_single_use_after_the_grace(client)
        check_password_quality_reported_after_the_link(client)
        check_issuing_a_link_clears_the_request(client)
        check_old_column_invites_still_work(client)
    print("invites: all checks passed (every failure names itself, and no link "
          "dies for a reason the person can't act on)")


if __name__ == "__main__":
    try:
        main_()
    finally:
        shutil.rmtree(_TMP, ignore_errors=True)
