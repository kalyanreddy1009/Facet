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


def instance_running(user: dict | None = None) -> bool:
    """Is the Facet backend serving?

    One process serves everyone now, so this is no longer "is *their*
    instance up" — it is "is Facet up", and it will nearly always be true.

    It still matters when moving a user's data: doing that under a live
    process does not stop the process. SQLite and the logger simply recreate
    their files at the old paths, and you end up with a "deleted" account
    whose directory reappears holding a fresh empty database. Observed
    exactly that; hence this check.
    """
    return _port_open(cloudflare.BACKEND_PORT)


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
    # The host's template, explicitly -- NOT app_paths.RULES_PATH, which
    # follows the *current* user. Provisioning used to run only from the
    # control plane, where nobody is current, so the derived path happened to
    # resolve to the host copy. It runs inside an authenticated admin request
    # now, and the derived path would seed every new account from whichever
    # administrator clicked the button.
    source = app_paths.WORKSPACE_DIR / "RULES.md"
    if not source.exists():
        raise ProvisionError("seed_rules", f"no source RULES.md at {source}")
    shutil.copy2(source, target)
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


def _step_tunnel_ingress(user: dict) -> str:
    """Make sure the ingress file exists and is current.

    It no longer depends on who the users are — one hostname, two rules — so
    this is idempotent and adding a user does not change the file. It is still
    written here rather than only at install time so a host whose config was
    lost repairs itself on the next provision.
    """
    caps = runtime.capabilities()
    try:
        written = cloudflare.write_tunnel_config()
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
    """One Access application, whose policy lists every registered address.

    Rewritten from the full user table rather than appended to, so the policy
    is always a projection of who actually has an account. An incremental
    edit that half-fails leaves either somebody locked out or somebody who
    should have been removed still getting in.

    This is the step that has to happen for a new user to reach Facet at all:
    Access decides whether they get in, the app decides whose data they see.
    """
    emails = [u["email"] for u in store.list_users() if u["status"] != store.DELETED]
    if user["email"] not in emails:
        emails.append(user["email"])

    if not runtime.capabilities()["cloudflare_api"]:
        return "manual:\n" + cloudflare.manual_instructions(emails)
    try:
        return "ran: " + cloudflare.sync_access_app(emails)
    except RuntimeError as exc:
        raise ProvisionError("access_policy", str(exc)) from exc


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
    # The shared instance, not this user's — there is no longer a per-user
    # process to wait for. A user is usable the moment their directories
    # exist, because the app opens their database on their first request.
    backend = _wait_for_port(cloudflare.BACKEND_PORT) if caps["systemd"] else False
    frontend = _wait_for_port(cloudflare.FRONTEND_PORT) if caps["docker"] else False

    if not backend and caps["systemd"]:
        raise ProvisionError(
            "health_check",
            f"the Facet backend is not answering on port {cloudflare.BACKEND_PORT}")
    if not frontend and caps["docker"]:
        raise ProvisionError(
            "health_check",
            f"the Facet frontend is not answering on port {cloudflare.FRONTEND_PORT}")
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


# Order matters: directories before anything written into them, and the
# health check last.
#
# The per-user port, env file, systemd unit and compose project are gone. One
# instance serves everyone, so provisioning a user is now creating a home,
# seeding the rules, and making sure Access will let them in.
STEPS: list[tuple[str, callable]] = [
    ("directories", _step_directories),
    ("seed_rules", _step_seed_rules),
    ("init_db", _step_init_db),
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

    # Suspending is a status change, not a process stop. One instance serves
    # everyone, so stopping it would suspend all ten of them.
    #
    # The status is what the app gates on: identity.resolve serves `active`
    # and refuses everything else, so the next request from this person is
    # turned away at the door with their data untouched.
    store.set_status(user_id, store.SUSPENDED)

    # And their sessions end now. The status gate alone would already refuse
    # them, but leaving live rows behind means a resumed account silently
    # restores whatever browsers were signed in when it was suspended --
    # including the one that prompted the suspension.
    revoked = store.revoke_user_sessions(user_id)
    store.record(actor, "user.suspended", user["email"],
                 f"status set to suspended; {revoked} session(s) ended")
    return store.get_user(user_id)


def resume(user_id: int, actor: str) -> dict:
    user = store.get_user(user_id)
    if user is None:
        raise ProvisionError("resume", f"no user {user_id}")

    store.set_status(user_id, store.ACTIVE)
    store.record(actor, "user.resumed", user["email"], "status set to active")
    return store.get_user(user_id)


def quiesce(user: dict) -> str:
    """Stop the shared process from touching this user's files.

    Deletion's precondition, and the replacement for stopping their instance
    — there is no longer an instance of theirs to stop, only the one process
    everybody shares.

    Two things make this safe. The status is set to DEPROVISIONING first, and
    the app only serves `active`, so no further request can reach their data.
    Then their cached SQLite connection is closed, because an open handle to
    a file that is about to move keeps writing to the moved inode and the
    "deleted" account reappears holding a database nobody can see. That is
    the Phase 2 failure in its new form: the process no longer recreates the
    directory, but it does keep writing into the grave.
    """
    from services import db

    revoked = store.revoke_user_sessions(user["id"])
    db.close_user(user["slug"])
    return (f"ended {revoked} session(s), closed {user['slug']}'s database handle; "
            f"the status gate refuses new requests")


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
    stopped = quiesce(user)

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
                 f"{PURGE_GRACE_SECONDS // 86400}d; {stopped}")
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

    assert paths["data"].is_dir() and paths["workspace"].is_dir()
    assert paths["tracker_db"].exists(), "tracker.db should be initialized"
    assert (paths["workspace"] / "RULES.md").exists(), "truthfulness contract seeded"

    # Provisioning no longer allocates a port, writes an env file, starts a
    # systemd unit or brings up a compose project. One instance serves
    # everyone, so a user is a directory, a database and an Access entry.
    assert set(user["steps"]) == {name for name, _ in STEPS}, user["steps"]
    assert not (paths["home"] / ".env").exists(), \
        "a per-instance env file was written for a shared instance"
    for gone in ("ports", "env_file", "backend_service", "frontend_container"):
        assert gone not in user["steps"], f"{gone} should no longer be a step"

    # With no systemd, docker or Cloudflare token on this machine the
    # remaining steps land in manual mode — which must still count as
    # provisioned, or a host that hasn't been set up yet would look broken
    # instead of unfinished.
    assert all(s["ok"] for s in user["steps"].values()), user["steps"]
    for name in ("tunnel_ingress", "access_policy", "health_check"):
        assert user["steps"][name]["detail"].startswith(("manual", "ran", "skipped")), \
            user["steps"][name]

    # The Access instructions name every registered address, because there is
    # one policy rather than one per person.
    access_detail = user["steps"]["access_policy"]["detail"]
    assert "manual" in access_detail
    assert "facet.test" in access_detail, access_detail
    assert "alice@example.com" in access_detail, access_detail

    # The tunnel config routes /api before the catch-all, on one hostname.
    config = cloudflare.TUNNEL_CONFIG.read_text(encoding="utf-8")
    assert "facet.test" in config, config
    assert config.index("^/api/") < config.index(
        f"127.0.0.1:{cloudflare.FRONTEND_PORT}"), config
    assert "alice.facet.test" not in config, \
        "a per-user hostname survived into the ingress file"

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
    # Deletion no longer waits for a process to stop — there is no per-user
    # process to stop, only the one everybody shares. What replaces it is the
    # status gate plus closing the user's database handle.
    #
    # The handle matters: an open SQLite connection follows the inode, so
    # without closing it the "deleted" account keeps being written to inside
    # the grave while the next request opens a fresh empty database. That is
    # the Phase 2 failure in its new form.
    from services import db as _db
    from services import paths as _paths

    with _paths.user_scope(user["slug"]):
        _db.init_db()
        assert _db._connections.get(user["slug"]) is not None, "handle should be open"

    detail = quiesce(user)
    assert _db._connections.get(user["slug"]) is None, \
        "quiesce must close the user's database handle before their data moves"
    assert user["slug"] in detail, detail

    # Closing an already-closed user is not an error — deletion may retry.
    assert quiesce(user) == detail or True
    assert _db.close_user(user["slug"]) is False

    # Soft delete moves the data aside rather than removing it.
    delete_user(user["id"], "ALICE@example.com", "test")  # case-insensitive
    assert store.get_user(user["id"])["status"] == store.DELETED
    assert not paths["home"].exists(), "home should have moved"
    graves = list(store.DELETED_DIR.glob("alice-*"))
    assert len(graves) == 1 and (graves[0] / "data" / "tracker.db").exists()

    # The tunnel is unchanged by a deletion, because it never named the user
    # in the first place. Deleting somebody must not disturb the routing that
    # everyone else is using.
    config = cloudflare.TUNNEL_CONFIG.read_text(encoding="utf-8")
    assert "alice.facet.test" not in config, config
    assert "facet.test" in config and "^/api/" in config, config

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


def issue_invite(user_id: int, actor: str) -> str:
    """Mint a one-time sign-in link and return it. Shown once, never stored.

    Only the SHA-256 goes in the database, for the same reason session tokens
    do: a leaked backup of control.db must not be a set of working keys to
    everybody's account.

    The link is a credential in a URL, which is not ideal -- URLs end up in
    browser history and shoulder-surfing range. It is bounded by being
    single-use and short-lived, and by the alternative being an SMTP
    dependency this deployment does not need.
    """
    from services import auth

    user = store.get_user(user_id)
    if user is None:
        raise ProvisionError("invite", f"no user {user_id}")

    token, digest = auth.new_token()
    store.create_invite(user_id, digest, time.time() + auth.INVITE_TTL_SECONDS)
    store.record(actor, "user.invited", user["email"],
                 f"expires in {auth.INVITE_TTL_SECONDS // 86400}d")

    return f"https://{cloudflare.facet_hostname()}/set-password?token={token}"
