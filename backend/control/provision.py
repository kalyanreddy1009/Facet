"""Creating and removing a user's instance.

Provisioning is an ordered pipeline of idempotent steps, each recorded as it
completes. That combination is what makes a failure survivable: a break at
step 5 leaves the first four done and re-running resumes rather than
restarting, so a half-built user is always one retry from either working or
telling you exactly what is wrong.

Deprovisioning is the opposite problem. Deleting a user destroys their real
career record, so the irreversible part is separated from the click by a
grace period and preceded by an export they can actually keep.

Phase 2 covers steps 1-6 — filesystem and database. Steps 7-10 (compose,
tunnel ingress, Access policy) arrive in Phase 3; the pipeline is shaped to
take them without restructuring.
"""

import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import zipfile
from pathlib import Path

from services import paths as app_paths
from services.paths import ROOT
from . import cloudflare, runtime, store

# How long a deleted account is recoverable. The whole point: the click and
# the irreversible act are separated by a month.
PURGE_GRACE_SECONDS = 30 * 24 * 3600

INIT_DB_SCRIPT = ROOT / "backend" / "scripts" / "init_db.py"


class ProvisionError(Exception):
    def __init__(self, step: str, message: str):
        super().__init__(f"{step}: {message}")
        self.step = step
        self.message = message


def instance_running(user: dict) -> bool:
    """Is this user's backend still serving?

    Until Phase 3 the control plane cannot stop an instance — there is no
    compose project to bring down yet. So it has to detect one and refuse,
    because moving the data out from under a live process does not stop it:
    SQLite and the logger simply recreate their files at the old paths, and
    you end up with a "deleted" account whose directory reappears holding a
    fresh empty database. Observed exactly that; hence this check.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.4)
        return probe.connect_ex(("127.0.0.1", user["api_port"])) == 0


# ------------------------------------------------------------ the pipeline

def _step_directories(user: dict) -> str:
    paths = store.user_paths(user["slug"])
    for key in ("data", "workspace", "exports"):
        paths[key].mkdir(parents=True, exist_ok=True)
    (paths["data"] / "logs").mkdir(parents=True, exist_ok=True)
    return str(paths["home"])


def _step_seed_rules(user: dict) -> str:
    """RULES.md is the truthfulness contract every tailoring run reads.

    Seeded from this deployment's copy so a new user starts under the same
    rules as everyone else. Never overwritten: once an instance exists, its
    RULES.md is that instance's, and silently replacing it would change the
    terms a person's resumes are written under.
    """
    target = store.user_paths(user["slug"])["workspace"] / "RULES.md"
    if target.exists():
        return "already present"
    if not app_paths.RULES_PATH.exists():
        raise ProvisionError("seed_rules", f"no source RULES.md at {app_paths.RULES_PATH}")
    shutil.copy2(app_paths.RULES_PATH, target)
    return str(target)


def _step_init_db(user: dict) -> str:
    """Create tracker.db with the app's own schema.

    A subprocess with FACET_DATA_DIR set, rather than importing init_db here:
    the app binds its connection to a module-level path at import time, and
    reusing the real script means the schema can never drift from what the
    app expects.
    """
    paths = store.user_paths(user["slug"])
    if paths["tracker_db"].exists():
        return "already initialized"

    env = {**os.environ, "FACET_DATA_DIR": str(paths["data"]),
           "FACET_WORKSPACE_DIR": str(paths["workspace"])}
    result = subprocess.run(
        [sys.executable, str(INIT_DB_SCRIPT)],
        cwd=str(ROOT / "backend"), env=env, capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0 or not paths["tracker_db"].exists():
        raise ProvisionError("init_db", (result.stderr or result.stdout).strip()[:400])
    return str(paths["tracker_db"])


def _step_ports(user: dict) -> str:
    # Assigned from the id at row creation; this step verifies rather than
    # allocates, so the pipeline has a place to fail loudly if they collide.
    conflict = [
        u for u in store.list_users(include_deleted=True)
        if u["id"] != user["id"]
        and (u["web_port"] == user["web_port"] or u["api_port"] == user["api_port"])
    ]
    if conflict:
        raise ProvisionError(
            "ports", f"ports {user['web_port']}/{user['api_port']} already "
                     f"belong to {conflict[0]['slug']}"
        )
    return f"web {user['web_port']}, api {user['api_port']}"


def _step_env_file(user: dict) -> str:
    paths = store.user_paths(user["slug"])
    paths["env"].write_text(
        "\n".join([
            f"# Facet instance for {user['email']} — generated, do not hand-edit.",
            f"# Regenerate by re-running provisioning for user {user['id']}.",
            "",
            f"FACET_USER_EMAIL={user['email']}",
            f"FACET_USER_SLUG={user['slug']}",
            f"FRONTEND_PORT={user['web_port']}",
            f"BACKEND_PORT={user['api_port']}",
            f"FACET_DATA_DIR={paths['data']}",
            f"FACET_WORKSPACE_DIR={paths['workspace']}",
            "",
            "# The one lock every instance contends on.",
            "#",
            "# This MUST be outside the per-user data directory. There is a",
            "# single authenticated agy CLI on this host, so serializing runs",
            "# is the entire reason the queue exists — and a lock file each",
            "# user owns privately serializes nothing. Left unset, that is",
            "# exactly what happens: agy_runner falls back to",
            "# $FACET_DATA_DIR/agy.lock, ten instances take ten different",
            "# locks, and they all call one CLI at once.",
            f"FACET_AGY_LOCK={store.HOST_ROOT / 'agy.lock'}",
            "",
        ]),
        encoding="utf-8",
    )
    return str(paths["env"])


def _step_backend_service(user: dict) -> str:
    """Start the user's backend as a native systemd service.

    Native, not containerised: it shells out to agy, whose credentials live
    in ~/.gemini on the host. The cross-process lock from Phase 1 is what
    keeps every instance serialized against the one authenticated CLI.
    """
    caps = runtime.capabilities()
    result = runtime.service_start(user["slug"], caps["systemd"])
    if not result.ok:
        raise ProvisionError("backend_service", result.detail)
    return f"{result.mode}: {result.detail}"


def _step_frontend_container(user: dict) -> str:
    caps = runtime.capabilities()
    paths = store.user_paths(user["slug"])
    result = runtime.compose_up(user["slug"], paths["env"], caps["docker"])
    if not result.ok:
        raise ProvisionError("frontend_container", result.detail)
    return f"{result.mode}: {result.detail}"


def _step_tunnel_ingress(user: dict) -> str:
    """Rebuild the whole ingress file, then reload.

    Rebuilt rather than appended: an incremental scheme drifts as soon as one
    edit half-fails, and drift here means a hostname pointing at the wrong
    port — one person's Facet served to someone else. The user table is the
    truth and the config is a projection of it.
    """
    caps = runtime.capabilities()
    users = [u for u in store.list_users() if u["status"] != store.DELETED]
    try:
        written = cloudflare.write_tunnel_config(users)
    except OSError as exc:
        # /etc/cloudflared isn't writable on a dev box, and that is not a
        # provisioning failure — it is a host that hasn't been set up yet.
        return f"manual: could not write {cloudflare.TUNNEL_CONFIG} ({exc})"

    reload_result = runtime.run(
        ["systemctl", "reload", "cloudflared"], "reload tunnel",
        caps["systemd"] and caps["cloudflared"],
    )
    return f"{reload_result.mode}: wrote {written}"


def _step_access_policy(user: dict) -> str:
    """One Access application per hostname, allowing exactly one address."""
    if not runtime.capabilities()["cloudflare_api"]:
        return "manual:\n" + cloudflare.manual_instructions(user["slug"], user["email"])
    try:
        if cloudflare.find_access_app(user["slug"]) is not None:
            return "ran: application already exists"
        cloudflare.create_access_app(user["slug"], user["email"])
    except RuntimeError as exc:
        raise ProvisionError("access_policy", str(exc)) from exc
    return f"ran: Access application for {cloudflare.hostname_for(user['slug'])}"


def _step_health_check(user: dict) -> str:
    """Confirm the instance actually answers.

    Skipped rather than failed when earlier steps were manual: nothing was
    started, so there is nothing to check, and failing here would make a
    correctly-provisioned host look broken.
    """
    caps = runtime.capabilities()
    if not (caps["systemd"] or caps["docker"]):
        return "skipped: nothing was started on this host"

    # Give the services a moment to bind.
    #
    # `systemctl start` returns once the process has been forked, not once
    # uvicorn is listening — roughly a second apart on this host, and longer
    # on a cold page cache. Probing immediately failed provisioning for
    # instances that were about to come up perfectly well, which is the worst
    # kind of wrong answer: the user gets an error and a working service.
    backend = _wait_for_port(user["api_port"]) if caps["systemd"] else False
    frontend = _wait_for_port(user["web_port"]) if caps["docker"] else False

    if not backend and caps["systemd"]:
        raise ProvisionError("health_check",
                             f"backend is not answering on port {user['api_port']}")
    if not frontend and caps["docker"]:
        raise ProvisionError("health_check",
                             f"frontend is not answering on port {user['web_port']}")
    return f"backend={'up' if backend else 'n/a'} frontend={'up' if frontend else 'n/a'}"


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.4)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def _wait_for_port(port: int, timeout: float = 30.0) -> bool:
    """Poll until something is listening, or give up.

    Returns as soon as the port answers, so the common case costs about as
    much as a single probe; the timeout only matters when the service is
    genuinely not coming up, and then waiting 30s to say so is far better
    than declaring failure at 0.4s.
    """
    deadline = time.monotonic() + timeout
    while True:
        if _port_open(port):
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.5)


# Order matters. Directories before anything written into them; ports checked
# before the env file that records them; services before the tunnel that
# routes to them; the health check last, once there is something to check.
STEPS: list[tuple[str, callable]] = [
    ("directories", _step_directories),
    ("seed_rules", _step_seed_rules),
    ("init_db", _step_init_db),
    ("ports", _step_ports),
    ("env_file", _step_env_file),
    ("backend_service", _step_backend_service),
    ("frontend_container", _step_frontend_container),
    ("tunnel_ingress", _step_tunnel_ingress),
    ("access_policy", _step_access_policy),
    ("health_check", _step_health_check),
]


def provision(user_id: int, actor: str) -> dict:
    """Run every step not yet recorded as done. Safe to call repeatedly."""
    user = store.get_user(user_id)
    if user is None:
        raise ProvisionError("lookup", f"no user {user_id}")

    steps = dict(user["steps"])
    for name, fn in STEPS:
        if steps.get(name, {}).get("ok"):
            continue
        try:
            detail = fn(user)
        except Exception as exc:
            message = exc.message if isinstance(exc, ProvisionError) else str(exc)
            steps[name] = {"ok": False, "detail": message, "at": time.time()}
            store.set_steps(user_id, steps)
            store.record(actor, "user.provision_failed", user["email"], f"{name}: {message}")
            raise ProvisionError(name, message) from exc
        steps[name] = {"ok": True, "detail": detail, "at": time.time()}
        store.set_steps(user_id, steps)

    store.set_status(user_id, store.ACTIVE)
    store.record(actor, "user.provisioned", user["email"], f"{len(STEPS)} steps")
    return store.get_user(user_id)


def create_user(email: str, display_name: str | None, actor: str) -> dict:
    existing = store.get_user_by_email(email)
    if existing is not None:
        raise ProvisionError("create", f"{email} already exists (id {existing['id']})")
    user = store.create_user_row(email, display_name)
    store.record(actor, "user.created", email, f"slug={user['slug']} id={user['id']}")
    return provision(user["id"], actor)


# ------------------------------------------------------------------ export

def export_account(user_id: int, actor: str) -> Path:
    """Everything the user would want if they left, as one zip.

    Offered before every deletion and available any time. This is what makes
    deletion safe to offer at all — the answer to "can I get my stuff back"
    has to be yes before the answer to "delete this" can be yes.
    """
    user = store.get_user(user_id)
    if user is None:
        raise ProvisionError("export", f"no user {user_id}")

    paths = store.user_paths(user["slug"])
    store.EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    bundle = store.EXPORTS_DIR / f"{user['slug']}-{stamp}.zip"

    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as zf:
        if paths["tracker_db"].exists():
            # VACUUM INTO, never a plain copy: WAL keeps recent writes in a
            # sidecar file, and copying the .db alone silently loses them.
            # Measured here once — a cp showed 906 rows against a live 1,166.
            snapshot = bundle.with_suffix(".tracker.db")
            snapshot.unlink(missing_ok=True)
            conn = sqlite3.connect(paths["tracker_db"])
            try:
                conn.execute("VACUUM INTO ?", (str(snapshot),))
            finally:
                conn.close()
            zf.write(snapshot, "data/tracker.db")
            snapshot.unlink(missing_ok=True)

        for folder, arc in ((paths["workspace"], "workspace"),
                            (paths["exports"], "data/exports")):
            if not folder.exists():
                continue
            for item in folder.rglob("*"):
                if item.is_file():
                    zf.write(item, f"{arc}/{item.relative_to(folder).as_posix()}")

    store.record(actor, "user.exported", user["email"], bundle.name)
    return bundle


# ---------------------------------------------------------------- teardown

def suspend(user_id: int, actor: str) -> dict:
    """Stop serving without touching data. Reversible in one click.

    This is the button that is almost always wanted when someone stops using
    Facet; deletion rarely is.
    """
    user = store.get_user(user_id)
    if user is None:
        raise ProvisionError("suspend", f"no user {user_id}")

    caps = runtime.capabilities()
    paths = store.user_paths(user["slug"])
    stopped = [
        runtime.service_stop(user["slug"], caps["systemd"]),
        runtime.compose_stop(user["slug"], paths["env"], caps["docker"]),
    ]
    store.set_status(user_id, store.SUSPENDED)
    store.record(actor, "user.suspended", user["email"],
                 "; ".join(r.detail for r in stopped))
    return store.get_user(user_id)


def resume(user_id: int, actor: str) -> dict:
    user = store.get_user(user_id)
    if user is None:
        raise ProvisionError("resume", f"no user {user_id}")

    caps = runtime.capabilities()
    paths = store.user_paths(user["slug"])
    started = [
        runtime.service_start(user["slug"], caps["systemd"]),
        runtime.compose_start(user["slug"], paths["env"], caps["docker"]),
    ]
    failed = [r for r in started if not r.ok]
    if failed:
        raise ProvisionError("resume", failed[0].detail)

    store.set_status(user_id, store.ACTIVE)
    store.record(actor, "user.resumed", user["email"],
                 "; ".join(r.detail for r in started))
    return store.get_user(user_id)


def stop_instance(user: dict) -> list[runtime.Result]:
    """Bring down both halves of a user's instance.

    Deletion's precondition. Moving data out from under a live process does
    not stop it — SQLite and the logger simply recreate their files at the
    old paths, and the "deleted" account reappears holding a fresh empty
    database. Observed exactly that in Phase 2, which is why deletion refused
    outright until there was something able to stop the instance.
    """
    caps = runtime.capabilities()
    paths = store.user_paths(user["slug"])
    return [
        runtime.service_disable(user["slug"], caps["systemd"]),
        runtime.compose_down(user["slug"], paths["env"], caps["docker"]),
    ]


def delete_user(user_id: int, confirm_email: str, actor: str) -> dict:
    """Soft delete: the data is moved aside, not removed.

    The typed-email confirmation is not ceremony. The caller has to name the
    account, so deleting the wrong row requires getting the address right,
    which is a different and much rarer mistake than clicking the wrong line.
    """
    user = store.get_user(user_id)
    if user is None:
        raise ProvisionError("delete", f"no user {user_id}")
    if confirm_email.strip().lower() != user["email"].lower():
        raise ProvisionError(
            "delete", "confirmation does not match this account's email address"
        )
    store.set_status(user_id, store.DEPROVISIONING)

    # Stop first, then verify it is actually down. A live process would
    # recreate its directory moments after the data moved.
    stopped = stop_instance(user)
    if instance_running(user):
        store.set_status(user_id, user["status"])
        raise ProvisionError(
            "delete",
            f"{user['slug']}'s backend is still serving on port {user['api_port']} "
            f"after being asked to stop. Stop it by hand before deleting — moving "
            f"data out from under a live process leaves it recreating the directory.",
        )

    export_account(user_id, actor)  # always, before anything moves

    paths = store.user_paths(user["slug"])
    store.DELETED_DIR.mkdir(parents=True, exist_ok=True)
    grave = store.DELETED_DIR / f"{user['slug']}-{time.strftime('%Y%m%d-%H%M%S')}"
    if paths["home"].exists():
        shutil.move(str(paths["home"]), str(grave))

    store.mark_deleted(user_id, time.time() + PURGE_GRACE_SECONDS)

    # Drop this hostname from the tunnel. Left in place it would point at a
    # port that could later belong to someone else — the exact failure that
    # never-recycling ids exists to prevent, reintroduced through the router.
    sync_ingress()

    store.record(actor, "user.deleted", user["email"],
                 f"moved to {grave.name}, purges after "
                 f"{PURGE_GRACE_SECONDS // 86400}d; "
                 + "; ".join(r.detail for r in stopped))
    return store.get_user(user_id)


def sync_ingress() -> str:
    """Rebuild the tunnel config from the current user table and reload."""
    caps = runtime.capabilities()
    users = [u for u in store.list_users() if u["status"] != store.DELETED]
    try:
        written = cloudflare.write_tunnel_config(users)
    except OSError as exc:
        return f"manual: could not write {cloudflare.TUNNEL_CONFIG} ({exc})"
    runtime.run(["systemctl", "reload", "cloudflared"], "reload tunnel",
                caps["systemd"] and caps["cloudflared"])
    return str(written)


def undelete(user_id: int, actor: str) -> dict:
    """Undo a soft delete, any time before the purge."""
    user = store.get_user(user_id)
    if user is None or user["status"] != store.DELETED:
        raise ProvisionError("undelete", "not a deleted account")

    graves = sorted(store.DELETED_DIR.glob(f"{user['slug']}-*"))
    if not graves:
        raise ProvisionError("undelete", "the data directory is already purged")

    paths = store.user_paths(user["slug"])
    if paths["home"].exists():
        raise ProvisionError(
            "undelete",
            f"{paths['home']} already exists — refusing to merge into it. "
            f"Move or remove it first, then restore.",
        )
    shutil.move(str(graves[-1]), str(paths["home"]))

    store.restore(user_id)
    # Restored as suspended, so the hostname routes again but nothing starts
    # serving until it is explicitly resumed.
    sync_ingress()
    store.record(actor, "user.undeleted", user["email"], graves[-1].name)
    return store.get_user(user_id)


def purge_expired(actor: str = "retention") -> list[str]:
    """Permanently remove accounts whose grace period has run out.

    The only function here that destroys data. It refuses to touch anything
    still inside its window, and every purge is written to the audit log
    before the files go.
    """
    now = time.time()
    purged = []
    for user in store.list_users(include_deleted=True):
        # `is None`, not a falsy check: purge_after is a timestamp, and 0 is a
        # perfectly good "due now" that a truthiness test would skip forever.
        if user["status"] != store.DELETED or user["purge_after"] is None:
            continue
        if now < user["purge_after"]:
            continue
        for grave in store.DELETED_DIR.glob(f"{user['slug']}-*"):
            shutil.rmtree(grave, ignore_errors=True)
        store.record(actor, "user.purged", user["email"], "grace period expired")
        store.forget(user["id"])
        purged.append(user["email"])
    return purged


# ------------------------------------------------------------------ import

def import_existing(email: str, source_data: Path, source_workspace: Path,
                    actor: str) -> dict:
    """Adopt an existing single-user installation as a user of this host.

    Copies — never moves. The original installation keeps working untouched
    until the copy has been verified serving real traffic, which is the whole
    safety argument for doing the migration this way.
    """
    user = store.get_user_by_email(email) or create_user(email, None, actor)
    paths = store.user_paths(user["slug"])

    tracker = source_data / "tracker.db"
    if tracker.exists():
        target = paths["tracker_db"]
        target.unlink(missing_ok=True)
        conn = sqlite3.connect(tracker)
        try:
            conn.execute("VACUUM INTO ?", (str(target),))  # WAL-safe, see export
        finally:
            conn.close()

    for name in ("settings.json", "feeds.json", "calendar_config.json"):
        if (source_data / name).exists():
            shutil.copy2(source_data / name, paths["data"] / name)

    if (source_data / "exports").exists():
        shutil.copytree(source_data / "exports", paths["exports"], dirs_exist_ok=True)

    if source_workspace.exists():
        shutil.copytree(source_workspace, paths["workspace"], dirs_exist_ok=True)

    store.record(actor, "user.imported", email, f"from {source_data}")
    return store.get_user(user["id"])


def demo() -> None:
    """Self-check:  backend/.venv/bin/python -m control.provision

    Exercises the whole lifecycle against a throwaway host root. Nothing here
    touches a real installation.
    """
    import tempfile
    import zipfile as _zip

    root = Path(tempfile.mkdtemp()) / "host"
    store.HOST_ROOT = root
    store.CONTROL_DB = root / "control.db"
    store.USERS_DIR = root / "users"
    store.EXPORTS_DIR = root / "exports"
    store.DELETED_DIR = root / "deleted"
    store._connection = None
    store.init_control_db()
    # Keep the tunnel config inside the temp root — the real default is
    # /etc/cloudflared, which a test has no business writing to.
    cloudflare.TUNNEL_CONFIG = root / "cloudflared.yml"
    cloudflare.BASE_DOMAIN = "facet.test"

    # Report no host tools, so every step takes its manual branch.
    #
    # This used to be true by accident: the machine this was written on had
    # no systemd, so the assertions below passed without anyone saying what
    # they depended on. On the deployment host systemd is real, and an
    # unpinned self-check would enable and start actual units named after a
    # fictional user. A test must not reconfigure the host it runs on.
    real_capabilities = runtime.capabilities
    runtime.capabilities = lambda: {k: False for k in real_capabilities()}
    try:
        _demo_lifecycle(root, _zip)
    finally:
        runtime.capabilities = real_capabilities


def _demo_lifecycle(root: Path, _zip) -> None:

    user = create_user("alice@example.com", "Alice", "test")
    paths = store.user_paths(user["slug"])

    assert user["slug"] == "alice", user
    assert user["status"] == store.ACTIVE, user
    # Ports derive from the id, so they are stable and never recycled.
    assert user["web_port"] == store.WEB_PORT_BASE + user["id"]
    assert user["api_port"] == store.API_PORT_BASE + user["id"]

    assert paths["data"].is_dir() and paths["workspace"].is_dir()
    assert paths["tracker_db"].exists(), "tracker.db should be initialized"
    assert (paths["workspace"] / "RULES.md").exists(), "truthfulness contract seeded"
    env_text = paths["env"].read_text(encoding="utf-8")
    assert f"FACET_DATA_DIR={paths['data']}" in env_text

    # The agy lock must be shared, not per-user. This assertion exists
    # because the failure mode is invisible in every test that runs one
    # instance: nothing breaks until two real users tailor at the same
    # moment against a CLI that can only serve one.
    lock_line = next(l for l in env_text.splitlines() if l.startswith("FACET_AGY_LOCK="))
    lock_path = Path(lock_line.split("=", 1)[1])
    assert lock_path == store.HOST_ROOT / "agy.lock", lock_path
    assert paths["data"] not in lock_path.parents, \
        f"the agy lock is inside {user['slug']}'s data dir — it would serialize nobody"
    assert all(s["ok"] for s in user["steps"].values()), user["steps"]

    # Every step ran, including the Phase 3 ones. With no systemd, docker or
    # Cloudflare token on this machine they land in manual mode — which must
    # still count as provisioned, or a host that hasn't been set up yet would
    # look broken instead of unfinished.
    assert set(user["steps"]) == {name for name, _ in STEPS}, user["steps"]
    for name in ("backend_service", "frontend_container", "access_policy"):
        assert user["steps"][name]["detail"].startswith(("manual", "ran", "skipped")), \
            user["steps"][name]
    assert "manual" in user["steps"]["access_policy"]["detail"]
    assert "alice.facet.test" in user["steps"]["access_policy"]["detail"]

    # The tunnel config was generated, and routes /api before the catch-all.
    config = cloudflare.TUNNEL_CONFIG.read_text(encoding="utf-8")
    assert "alice.facet.test" in config, config
    assert config.index("^/api/") < config.index(f"127.0.0.1:{user['web_port']}"), config

    # The new database really is the app's schema, not an empty file.
    conn = sqlite3.connect(paths["tracker_db"])
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert {"applications", "contacts", "interviews", "seen_postings"} <= tables, tables

    # Re-provisioning is idempotent — that is what makes a failed step
    # retryable rather than a dead end.
    (paths["workspace"] / "RULES.md").write_text("edited by the user", encoding="utf-8")
    provision(user["id"], "test")
    assert (paths["workspace"] / "RULES.md").read_text(encoding="utf-8") == "edited by the user", \
        "re-provisioning must not overwrite an existing RULES.md"

    # A duplicate address is refused rather than silently reusing a directory.
    try:
        create_user("alice@example.com", None, "test")
        raise AssertionError("expected duplicate email to be rejected")
    except ProvisionError as exc:
        assert "already exists" in exc.message

    # Same local part, different domain, gets its own slug and directory.
    other = create_user("alice@other.com", None, "test")
    assert other["slug"] == "alice-2", other
    assert store.user_paths(other["slug"])["home"] != paths["home"]

    # Suspend is reversible and leaves data alone.
    suspend(user["id"], "test")
    assert store.get_user(user["id"])["status"] == store.SUSPENDED
    assert paths["tracker_db"].exists()
    resume(user["id"], "test")
    assert store.get_user(user["id"])["status"] == store.ACTIVE

    # Export contains the record, and the tracker copy is a real database.
    (paths["exports"] / "acme.pdf").write_bytes(b"%PDF-1.4 fake")
    bundle = export_account(user["id"], "test")
    with _zip.ZipFile(bundle) as zf:
        names = set(zf.namelist())
    assert "data/tracker.db" in names, names
    assert "workspace/RULES.md" in names, names
    assert "data/exports/acme.pdf" in names, names

    # Deletion requires naming the account.
    try:
        delete_user(user["id"], "wrong@example.com", "test")
        raise AssertionError("expected mismatched confirmation to be rejected")
    except ProvisionError as exc:
        assert "confirmation" in exc.message

    # A live instance blocks deletion. Bound a real socket on the user's api
    # port to prove the guard fires against something actually listening,
    # rather than against a mocked-out check.
    import socket as _socket
    listener = _socket.socket()
    listener.bind(("127.0.0.1", 0))  # ephemeral: don't fight whatever else runs here
    # Backlog well above the number of probes: nothing accepts these
    # connections, and a backlog of 1 fills after the first one, making the
    # next probe look like a refusal.
    listener.listen(128)
    conn_ = store.connect()
    conn_.execute("UPDATE users SET api_port = ? WHERE id = ?",
                  (listener.getsockname()[1], user["id"]))
    conn_.commit()
    user = store.get_user(user["id"])
    try:
        assert instance_running(user) is True
        delete_user(user["id"], "alice@example.com", "test")
        raise AssertionError("expected deletion of a running instance to be refused")
    except ProvisionError as exc:
        assert "still serving" in exc.message, exc.message
        # A refused delete must leave the account exactly as it was, not
        # stranded in `deprovisioning`.
        assert store.get_user(user["id"])["status"] != store.DEPROVISIONING
    finally:
        listener.close()
    assert instance_running(user) is False
    assert paths["home"].exists(), "a refused delete must not have moved anything"

    # Soft delete moves the data aside rather than removing it.
    delete_user(user["id"], "ALICE@example.com", "test")  # case-insensitive
    assert store.get_user(user["id"])["status"] == store.DELETED
    assert not paths["home"].exists(), "home should have moved"
    graves = list(store.DELETED_DIR.glob("alice-*"))
    assert len(graves) == 1 and (graves[0] / "data" / "tracker.db").exists()

    # The hostname is gone from the tunnel. Left behind it would point at a
    # port that could later belong to someone else.
    config = cloudflare.TUNNEL_CONFIG.read_text(encoding="utf-8")
    assert "alice.facet.test" not in config, config
    assert "alice-2.facet.test" in config, "the other user must be untouched"

    # Nothing is purged while inside the grace window.
    assert purge_expired("test") == []
    assert (graves[0] / "data" / "tracker.db").exists()

    # Undo restores it completely.
    undelete(user["id"], "test")
    assert store.get_user(user["id"])["status"] == store.SUSPENDED
    assert paths["tracker_db"].exists(), "restored data must be back in place"

    # Once the window has passed, purge really does remove it.
    delete_user(user["id"], "alice@example.com", "test")
    conn = store.connect()
    conn.execute("UPDATE users SET purge_after = 0 WHERE id = ?", (user["id"],))
    conn.commit()
    assert purge_expired("test") == ["alice@example.com"]
    assert not list(store.DELETED_DIR.glob("alice-*")), "purged for real"
    assert store.get_user(user["id"]) is None

    # The audit log kept the whole story, including the purge.
    actions = [a["action"] for a in store.audit_log(100)]
    for expected in ("user.created", "user.provisioned", "user.suspended",
                     "user.exported", "user.deleted", "user.undeleted", "user.purged"):
        assert expected in actions, (expected, actions)

    print("control.provision: all checks passed (full lifecycle, temp host root)")


if __name__ == "__main__":
    demo()
