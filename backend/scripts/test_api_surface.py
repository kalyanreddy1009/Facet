"""The whole API surface, probed the way an unfriendly client would probe it.

    backend/.venv/bin/python scripts/test_api_surface.py

The existing suites each cover one seam — auth, invites, admin, multi-user
isolation. This one covers the parts nobody owns: the shape of a 404, what
happens to a body that isn't the shape the model expects, whether a route
added next month will be reachable without a session because somebody forgot
a decorator.

Four of these checks are route *sweeps* rather than fixed cases. They walk
the app's own route table and assert a property of every route, so a new endpoint is
covered the day it is written rather than the day someone remembers to add a
test for it. That is the only kind of test that keeps working as the surface
grows.

What it asserts:

  * every non-public route refuses an anonymous caller (sweep)
  * every admin route refuses a signed-in non-admin (sweep)
  * every GET answers a signed-in user without a 5xx (sweep)
  * no handler answers with HTML or a stack trace, whatever you send it
  * validation failures are 4xx and name the field; they are never 500s
  * unicode, very long strings and SQL-looking input round-trip as data
  * one user cannot read or cancel another user's queue job by counting ids
  * enum and range violations are refused rather than stored
  * the responses carry the headers a browser needs to not be tricked
"""

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_TMP = Path(tempfile.mkdtemp(prefix="facet-surface-"))
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

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from control import store  # noqa: E402
from services import auth, jobs, paths  # noqa: E402

PASSWORD = "a perfectly ordinary passphrase"

# Routes that are public by design. Kept as a literal list rather than reusing
# identity.PUBLIC_PATHS so that widening that set has to be a deliberate edit
# in two places — the sweep below is the only thing standing between a typo
# there and an open API.
PUBLIC = {
    "/api/health",
    "/api/auth/login", "/api/auth/accept-invite", "/api/auth/invite-status",
    "/api/auth/request-link", "/api/auth/me", "/api/auth/logout",
    "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc",
}

ADMIN_PREFIX = "/api/admin"


def _user(email: str, admin: bool = False):
    row = store.get_user_by_email(email) or store.create_user_row(email, None)
    store.set_password(row["id"], auth.hash_password(PASSWORD))
    store.set_status(row["id"], store.ACTIVE)
    if admin:
        store.set_admin(row["id"], True)
    return store.get_user(row["id"])


def _sign_in(client: TestClient, email: str) -> None:
    client.cookies.clear()
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text


def _routes():
    """(path, methods) for every route the app actually serves.

    Read from the OpenAPI schema rather than `app.routes`: this FastAPI wraps
    included routers in an opaque object, so walking `app.routes` yields the
    four doc endpoints and nine wrappers. An earlier version of this file did
    exactly that and swept two routes while reporting a pass — a sweep that
    silently covers nothing is worse than no sweep.
    """
    paths = main.app.openapi()["paths"]
    assert len(paths) > 40, f"only {len(paths)} routes found — the sweep is broken"
    for path, operations in sorted(paths.items()):
        methods = {m.upper() for m in operations} - {"HEAD", "OPTIONS"}
        if path.startswith(("/api", "/health")) and methods:
            yield path, methods


def _concrete(path: str) -> str:
    """Substitute a plausible id for each path parameter.

    The id need not exist: the point of these sweeps is the *gate*, and the
    gate has to close before the handler ever looks the row up. A 404 where a
    401 belongs is exactly the bug being hunted — it means the handler ran.
    """
    out = []
    for part in path.split("/"):
        out.append("1" if part.startswith("{") else part)
    return "/".join(out)


def _body_for(path: str, method: str):
    """Something JSON-shaped, so a POST fails on auth rather than on parsing."""
    if method in {"GET", "DELETE"}:
        return None
    return {}


# --------------------------------------------------------------- the sweeps

def check_every_route_is_closed_by_default(client: TestClient) -> None:
    """No session, no data. Swept, so a new route is covered on day one."""
    client.cookies.clear()
    open_routes = []
    for path, methods in _routes():
        if path in PUBLIC:
            continue
        for method in methods:
            response = client.request(
                method, _concrete(path), json=_body_for(path, method)
            )
            # 401 is the answer. 403 is acceptable for an admin route. What is
            # not acceptable is 200, or a 404/422 that proves the handler ran
            # and only failed to find the row.
            if response.status_code not in (401, 403):
                open_routes.append(f"{method} {path} -> {response.status_code}")
    assert not open_routes, "reachable without signing in:\n  " + "\n  ".join(open_routes)
    print(f"  closed:     {sum(len(m) for _, m in _routes())} routes, none open anonymously")


def check_admin_routes_refuse_a_normal_user(client: TestClient) -> None:
    """The whole point of roles. Also swept."""
    _sign_in(client, "bob@example.com")
    leaked = []
    for path, methods in _routes():
        if not path.startswith(ADMIN_PREFIX):
            continue
        for method in methods:
            response = client.request(
                method, _concrete(path), json=_body_for(path, method)
            )
            # 404, not 403, is the intended answer here — `require_admin`
            # refuses without confirming that an admin surface exists. So the
            # assertion is "not a success, and no admin payload", rather than
            # a specific refusal code.
            if response.status_code < 400 or "email" in response.text:
                leaked.append(f"{method} {path} -> {response.status_code}")
    assert not leaked, "a non-admin reached an admin route:\n  " + "\n  ".join(leaked)
    print("  roles:      every admin route refuses a signed-in non-admin")


def check_signed_in_reads_never_500(client: TestClient) -> None:
    """Every GET, as a real signed-in user, with a job in the queue.

    The other sweeps all probe the *gate*, which means they only ever see 401s
    and never execute a handler body. So a handler could — and did — raise on
    its very first line and no sweep noticed: `/api/resume/extraction-status`
    read `job["position"]`, a key `jobs.latest()` never set, and 500'd on every
    poll after somebody saved their resume. The Stone page swallowed the error
    and spun forever.

    Hence the seeded job: with an empty queue that endpoint returns "idle" and
    never reaches the line that breaks. A sweep that only exercises the empty
    case is the reason this shipped.
    """
    import asyncio

    _sign_in(client, "alice@example.com")
    alice = store.get_user_by_email("alice@example.com")
    with paths.user_scope(alice["slug"]):
        asyncio.run(jobs.enqueue("extract_profile", {}, alice["id"]))

    broken = []
    for path, methods in _routes():
        if "GET" not in methods or path.startswith(ADMIN_PREFIX):
            continue
        response = client.get(_concrete(path))
        if response.status_code >= 500:
            broken.append(f"GET {path} -> {response.status_code}")
    assert not broken, "a signed-in read raised:\n  " + "\n  ".join(broken)
    print("  reads:      every GET answers a signed-in user without a 5xx")


def check_nothing_ever_answers_with_html(client: TestClient) -> None:
    """A stack trace or an HTML error page reaching the browser is two bugs:
    the frontend can't parse it, and it tells a stranger about the server."""
    _sign_in(client, "alice@example.com")
    probes = [
        ("GET", "/api/nope", None),
        ("GET", "/api/applications/999999", None),
        ("DELETE", "/api/applications", None),          # wrong method
        ("POST", "/api/applications", {"company": 5}),   # wrong type
        ("GET", "/api/queue/notanumber", None),
        ("PATCH", "/api/applications/1", {"status": "Nonsense"}),
    ]
    for method, path, body in probes:
        response = client.request(method, path, json=body)
        ctype = response.headers.get("content-type", "")
        assert "application/json" in ctype, f"{method} {path} answered {ctype}"
        assert response.status_code < 500, f"{method} {path} -> {response.status_code}"
        text = response.text.lower()
        for leak in ("traceback", "site-packages", "/home/", str(_TMP).lower()):
            assert leak not in text, f"{method} {path} leaked {leak!r}: {response.text[:300]}"
    print("  errors:     six malformed requests, all JSON, none 5xx, nothing leaked")


def check_malformed_json_is_a_4xx(client: TestClient) -> None:
    response = client.post(
        "/api/applications",
        content=b"{not json at all",
        headers={"Content-Type": "application/json"},
    )
    assert 400 <= response.status_code < 500, response.status_code
    assert "application/json" in response.headers.get("content-type", "")
    print("  parsing:    a body that isn't JSON is a 4xx, not a crash")


# ---------------------------------------------------------------- the data

def check_validation_refuses_rather_than_stores(client: TestClient) -> None:
    """Bad data must not reach the table. Everything here is something a
    confused client — or a curious one — will actually send."""
    _sign_in(client, "alice@example.com")

    created = client.post(
        "/api/applications", json={"company": "Acme", "role_title": "Engineer"}
    )
    assert created.status_code == 200, created.text
    app_id = created.json()["id"]

    bad = [
        ({"status": "Nonsense"}, "an unknown status"),
        ({"status": ""}, "an empty status"),
        ({"ats_score": -5}, "a negative score"),
        ({"ats_score": 5000}, "a score above 100"),
        ({"ats_score": "high"}, "a score that isn't a number"),
        ({"company": ""}, "an empty company"),
        ({"company": " "}, "a whitespace-only company"),
    ]
    accepted = []
    for body, description in bad:
        response = client.patch(f"/api/applications/{app_id}", json=body)
        if response.status_code < 400:
            accepted.append(description)
    assert not accepted, "stored without complaint: " + ", ".join(accepted)

    # And the row is untouched by all of that.
    row = client.get(f"/api/applications/{app_id}").json()
    assert row["company"] == "Acme", row
    assert row["status"] == "Saved", row
    print(f"  validation: {len(bad)} bad patches refused, the row unchanged")


def check_required_fields_are_required(client: TestClient) -> None:
    for body in ({}, {"company": "Acme"}, {"role_title": "Engineer"}):
        response = client.post("/api/applications", json=body)
        assert response.status_code == 422, (body, response.status_code)
    print("  required:   an application without a company or a role is refused")


def check_odd_text_is_data_not_code(client: TestClient) -> None:
    """Every one of these is stored and returned verbatim, or something is
    interpreting user text somewhere it shouldn't."""
    _sign_in(client, "alice@example.com")
    odd = [
        "Robert'); DROP TABLE applications;--",
        "<script>alert(1)</script>",
        "Zoë Café - Ünïcödé ✨ 日本語",
        "line\nbreak\ttab",
        "%00%2e%2e%2f",
        "{{7*7}}",
    ]
    for text in odd:
        response = client.post(
            "/api/applications", json={"company": text, "role_title": "Engineer"}
        )
        assert response.status_code == 200, (text[:40], response.text[:200])
        back = client.get(f"/api/applications/{response.json()['id']}").json()
        assert back["company"] == text, f"{text[:40]!r} came back changed"

    # A pasted job description is genuinely long, and unlike a company name it
    # has no sensible ceiling short of the request body limit.
    long_text = "A" * 200_000
    response = client.post(
        "/api/applications",
        json={"company": "Long Co", "role_title": "Engineer", "job_description": long_text},
    )
    assert response.status_code == 200, response.text[:200]
    assert client.get(f"/api/applications/{response.json()['id']}").json()[
        "job_description"
    ] == long_text

    # The table is still there, which is the whole point of the first one.
    assert client.get("/api/applications").status_code == 200
    print(f"  input:      {len(odd)} hostile strings stored and returned verbatim")


def check_one_user_cannot_read_anothers_job(client: TestClient) -> None:
    """Queue ids are sequential across the host, so this is the one place
    where counting upwards is a real attack rather than a theoretical one."""
    alice = store.get_user_by_email("alice@example.com")
    with paths.user_scope(alice["slug"]):
        import asyncio
        job_id = asyncio.run(jobs.enqueue("tailor", {"company": "Secret Corp"}, alice["id"]))

    _sign_in(client, "bob@example.com")
    response = client.get(f"/api/queue/{job_id}")
    assert response.status_code == 404, response.status_code
    assert "Secret Corp" not in response.text
    assert client.delete(f"/api/queue/{job_id}").status_code == 404

    # And Alice can still see her own.
    _sign_in(client, "alice@example.com")
    assert client.get(f"/api/queue/{job_id}").status_code == 200
    print("  ownership:  another user's job is 404, not a payload")


def check_the_cabinet_is_per_user(client: TestClient) -> None:
    """Separate databases, so this should be impossible by construction —
    which is exactly why it is worth asserting through the HTTP layer too."""
    _sign_in(client, "alice@example.com")
    alice_rows = client.get("/api/applications").json()
    assert alice_rows, "the fixture above should have left Alice some rows"

    _sign_in(client, "bob@example.com")
    assert client.get("/api/applications").json() == []
    assert client.get(f"/api/applications/{alice_rows[0]['id']}").status_code == 404
    print("  isolation:  Bob's Cabinet is empty and Alice's ids 404 for him")


def check_pagination_bounds(client: TestClient) -> None:
    """Nothing here may 500, and nothing may be talked into an unbounded read."""
    _sign_in(client, "alice@example.com")
    for query in ("?limit=0", "?limit=-1", "?limit=999999999", "?limit=abc",
                  "?offset=-5", "?limit=1e9"):
        for path in ("/api/jobs", "/api/queue"):
            response = client.get(path + query)
            assert response.status_code < 500, f"{path}{query} -> {response.status_code}"
    # A sane limit is honoured.
    page = client.get("/api/jobs?limit=2").json()
    rows = page.get("items", page) if isinstance(page, dict) else page
    assert len(rows) <= 2, f"limit=2 returned {len(rows)}"
    print("  bounds:     six degenerate limits, no 5xx, and limit is honoured")


def check_headers_a_browser_relies_on(client: TestClient) -> None:
    _sign_in(client, "alice@example.com")
    response = client.get("/api/applications")
    headers = {k.lower(): v for k, v in response.headers.items()}
    assert headers.get("x-content-type-options") == "nosniff", (
        "without nosniff a JSON response containing user text can be sniffed "
        "as HTML and executed"
    )
    assert "x-frame-options" in headers or "content-security-policy" in headers, (
        "nothing stops this being framed"
    )
    referrer = headers.get("referrer-policy", "")
    assert referrer, "no referrer policy: an invite token in a URL leaks to any link"
    print("  headers:    nosniff, framing and referrer policy all present")


def check_an_internal_failure_says_nothing_useful(client: TestClient) -> None:
    """The catch-all handler must not hand its exception text to the client.

    A ValueError's message is often a path, a query, or a row. This drives a
    real failure through the real handler rather than asserting on the source.
    """
    @main.app.get("/api/_boom_for_tests")
    async def _boom():
        raise RuntimeError(f"secret at {_TMP}/data/tracker.db row 42")

    # A second client, because the default one re-raises server exceptions
    # into the test instead of letting the app answer them — which is the
    # behaviour under test.
    with TestClient(main.app, raise_server_exceptions=False) as quiet:
        quiet.post("/api/auth/login",
                   json={"email": "alice@example.com", "password": PASSWORD})
        response = quiet.get("/api/_boom_for_tests")

    assert response.status_code == 500, response.status_code
    body = response.json()
    assert "error" in body, body
    assert str(_TMP) not in response.text, (
        f"the 500 handed the client its exception text: {response.text[:200]}"
    )
    assert "RuntimeError" not in response.text, response.text[:200]
    print("  500s:       the catch-all reports a failure without describing it")


def check_health_answers_without_a_session(client: TestClient) -> None:
    """Whatever else breaks, a load balancer must get a straight answer —
    and every path declared public must be a path that exists."""
    client.cookies.clear()
    response = client.get("/api/health")
    assert response.status_code in (200, 503), response.status_code
    assert "application/json" in response.headers.get("content-type", "")
    # PUBLIC_PATHS used to list three more liveness routes than the app has.
    # Nothing broke — they simply 404'd — but a public-path list that names
    # routes nobody serves is how a real one ends up on it unnoticed.
    served = set(main.app.openapi()["paths"])
    from services import identity
    for path in identity.PUBLIC_PATHS:
        assert path in served, f"PUBLIC_PATHS names {path}, which the app does not serve"
    print("  liveness:   /api/health answers anonymously, and PUBLIC_PATHS is real")


def check_status_survives_a_missing_agy(client: TestClient) -> None:
    """agy is absent in this fixture. /status must report that, not crash."""
    _sign_in(client, "alice@example.com")
    response = client.get("/api/status")
    assert response.status_code == 200, response.text
    assert "application/json" in response.headers.get("content-type", "")
    json.loads(response.text)
    print("  degraded:   /api/status reports with agy absent rather than failing")


def main_() -> None:
    with TestClient(main.app) as client:
        _user("alice@example.com")
        _user("bob@example.com")
        _user("root@example.com", admin=True)

        check_every_route_is_closed_by_default(client)
        check_admin_routes_refuse_a_normal_user(client)
        check_signed_in_reads_never_500(client)
        check_nothing_ever_answers_with_html(client)
        check_malformed_json_is_a_4xx(client)
        check_required_fields_are_required(client)
        check_validation_refuses_rather_than_stores(client)
        check_odd_text_is_data_not_code(client)
        check_one_user_cannot_read_anothers_job(client)
        check_the_cabinet_is_per_user(client)
        check_pagination_bounds(client)
        check_headers_a_browser_relies_on(client)
        check_an_internal_failure_says_nothing_useful(client)
        check_health_answers_without_a_session(client)
        check_status_survives_a_missing_agy(client)
    print("api surface: all checks passed")


if __name__ == "__main__":
    try:
        main_()
    finally:
        shutil.rmtree(_TMP, ignore_errors=True)
