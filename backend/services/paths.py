"""Every filesystem location Facet uses, in one place.

Before this module, ten modules each computed their own paths from
`Path(__file__).parent.parent.parent`, which hardcoded one rule: data lives
inside the repo. That is right for a laptop and wrong for a host serving
several people, where each one's data lives under its own directory.

The environment variables below move `data/` and `workspace/` anywhere. When
unset the defaults reproduce the old behaviour exactly, so a local checkout
with no environment set behaves as it always has.

Imported by `logging_setup`, which main.py loads before anything else — so
this module must not import from `services`.

Multi-user
----------
One process serves everyone, so a path cannot be a constant: `DB_PATH` means
a different file depending on who is asking. The current user is held in a
`ContextVar`, which is the right tool rather than a global because asyncio
tasks inherit a *copy* of the context — two requests in flight cannot
overwrite each other's identity the way a module global would.

Accessing these names goes through `__getattr__` (PEP 562), so they resolve
at the moment of use rather than at import. This is why every consumer must
write `paths.DB_PATH` and never `from services.paths import DB_PATH` — a
`from` import copies the value once, at startup, and would hand every user
whichever directory happened to be current at import time.

With no user set, every path collapses to the original single-user layout.
That keeps a local checkout, the migration script, and the self-checks
working against the same code the server runs.
"""

import os
import re
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def _dir(env_var: str, default: Path) -> Path:
    """An override wins only if it is actually set to something."""
    value = os.environ.get(env_var, "").strip()
    return Path(value).expanduser().resolve() if value else default


# The three roots. Everything else is derived, so a deployment only ever
# needs to set these.
DATA_DIR = _dir("FACET_DATA_DIR", ROOT / "data")
WORKSPACE_DIR = _dir("FACET_WORKSPACE_DIR", ROOT / "workspace")
TEMPLATES_DIR = _dir("FACET_TEMPLATES_DIR", ROOT / "templates")

# Where each user's home directory lives.
#
# This must agree with `control.store.user_paths`, which provisioning uses to
# create the directories — two layouts would mean the control plane building
# a home the app never looks in. The control plane sets FACET_USERS_ROOT to
# $FACET_HOST_ROOT/users; the default keeps a local checkout self-contained.
#
# paths.py cannot import control.store to share the constant: store imports
# this module, so the dependency only runs one way. The env var is the seam.
USERS_ROOT = _dir("FACET_USERS_ROOT", DATA_DIR / "users")

_current_user: ContextVar[str | None] = ContextVar("facet_current_user", default=None)

# A user id becomes a directory name, so it is a path-traversal sink. Anything
# outside this alphabet is rejected at the door rather than sanitised: a
# silently rewritten id would point two different people at one directory.
_VALID_USER_ID = re.compile(r"\A[a-z0-9][a-z0-9._-]{0,63}\Z")


class InvalidUserId(ValueError):
    """A user id that must never be turned into a directory name."""


def validate_user_id(user_id: str) -> str:
    """The only way a user id is allowed to become part of a path."""
    if not isinstance(user_id, str) or not _VALID_USER_ID.match(user_id):
        raise InvalidUserId(f"not a usable user id: {user_id!r}")
    # Belt and braces. The regex already excludes both, but this is the
    # assertion that survives someone widening the regex later.
    if user_id in (".", "..") or "/" in user_id or "\\" in user_id:
        raise InvalidUserId(f"not a usable user id: {user_id!r}")
    return user_id


def set_user(user_id: str | None):
    """Make `user_id` current. Returns the token needed to restore."""
    if user_id is not None:
        validate_user_id(user_id)
    return _current_user.set(user_id)


def get_user() -> str | None:
    return _current_user.get()


def reset_user(token) -> None:
    _current_user.reset(token)


@contextmanager
def user_scope(user_id: str | None):
    """Run a block as `user_id`, restoring the previous identity after.

    Used by the scheduler and the queue worker, which serve every user from
    one thread and must not leak the last one they touched into the next.
    """
    token = set_user(user_id)
    try:
        yield
    finally:
        reset_user(token)


def data_dir() -> Path:
    """This user's `data/`, or the shared one when nobody is current."""
    user = _current_user.get()
    return USERS_ROOT / user / "data" if user else DATA_DIR


def workspace_dir() -> Path:
    """This user's `workspace/`, or the shared one when nobody is current."""
    user = _current_user.get()
    return USERS_ROOT / user / "workspace" if user else WORKSPACE_DIR


def user_roots(user_id: str) -> tuple[Path, Path]:
    """Both roots for a named user, without making them current.

    The migration and the admin portal need to create or inspect someone's
    directories from outside a request.
    """
    validate_user_id(user_id)
    return USERS_ROOT / user_id / "data", USERS_ROOT / user_id / "workspace"


# The derived paths. Each is a function of the current user, so they are
# computed on access rather than stored. `__getattr__` below exposes them
# under the original constant names.
_DERIVED = {
    # data/ — per-user state. Gitignored, backed up, never in an image layer.
    "DB_PATH": lambda: data_dir() / "tracker.db",
    "SETTINGS_PATH": lambda: data_dir() / "settings.json",
    "FEEDS_PATH": lambda: data_dir() / "feeds.json",
    "CALENDAR_CONFIG_PATH": lambda: data_dir() / "calendar_config.json",
    "EXPORTS_DIR": lambda: data_dir() / "exports",
    "LOG_DIR": lambda: data_dir() / "logs",
    "LOG_PATH": lambda: data_dir() / "logs" / "facet.log",
    # workspace/ — the Stone and the agy file-handoff scratch.
    "PROFILE_PATH": lambda: workspace_dir() / "profile.json",
    "MASTER_RESUME_PATH": lambda: workspace_dir() / "master_resume.md",
    "RULES_PATH": lambda: workspace_dir() / "RULES.md",
    "JOB_DESCRIPTION_PATH": lambda: workspace_dir() / "job_description.md",
    "TAILORED_FIELDS_PATH": lambda: workspace_dir() / "tailored_fields.json",
    # The two roots, under their original names, following the current user.
    "DATA_ROOT": data_dir,
    "WORKSPACE_ROOT": workspace_dir,
}


def __getattr__(name: str) -> Path:
    """PEP 562: resolve the derived paths at access time.

    Only fires for names not already module globals, which is why `DATA_DIR`
    and `WORKSPACE_DIR` above stay host-wide constants and the per-user
    versions are `data_dir()` / `workspace_dir()`.
    """
    try:
        return _DERIVED[name]()
    except KeyError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None


def __dir__() -> list[str]:
    return sorted([*globals().keys(), *_DERIVED.keys()])


def demo() -> None:
    """Self-check:  backend/.venv/bin/python -m services.paths"""
    import services.paths as p

    # ---------------------------------------------------------- single user
    # With nobody current, everything lands where it always did. This is the
    # pre-multi-user behaviour, and a local checkout depends on it.
    assert p.get_user() is None
    assert p.DB_PATH == ROOT / "data" / "tracker.db", p.DB_PATH
    assert p.PROFILE_PATH == ROOT / "workspace" / "profile.json", p.PROFILE_PATH

    # Derived paths must follow their root, or a deployment that moves DATA_DIR
    # would move the database and silently leave exports behind.
    assert p.EXPORTS_DIR.parent == DATA_DIR
    assert p.LOG_PATH.parent == p.LOG_DIR == DATA_DIR / "logs"
    assert p.MASTER_RESUME_PATH.parent == WORKSPACE_DIR

    # ----------------------------------------------------------- many users
    # The point of the whole module: the same name, two different files.
    with p.user_scope("alice"):
        alice_db, alice_profile = p.DB_PATH, p.PROFILE_PATH
        assert p.get_user() == "alice"
    with p.user_scope("bob"):
        bob_db, bob_profile = p.DB_PATH, p.PROFILE_PATH

    assert alice_db != bob_db, "two users resolved to one database"
    assert alice_profile != bob_profile, "two users resolved to one profile"
    assert alice_db == USERS_ROOT / "alice" / "data" / "tracker.db", alice_db
    assert bob_profile == USERS_ROOT / "bob" / "workspace" / "profile.json"

    # The layout must match what control.store.user_paths creates, or
    # provisioning builds a home the app never reads from.
    assert p.user_roots("alice") == (USERS_ROOT / "alice" / "data",
                                     USERS_ROOT / "alice" / "workspace")

    # Neither user's directory may contain the other's.
    assert not str(alice_db).startswith(str(USERS_ROOT / "bob"))

    # The scope must restore, or the worker leaks one user into the next.
    assert p.get_user() is None
    with p.user_scope("alice"):
        with p.user_scope("bob"):
            assert p.get_user() == "bob"
        assert p.get_user() == "alice", "nested scope did not restore"
    assert p.get_user() is None

    # ------------------------------------------------------- traversal gate
    # A user id becomes a directory name. These are the inputs that would
    # turn a request into a read of someone else's data, or of /etc.
    for hostile in ("../bob", "..", ".", "a/b", "a\\b", "", "/etc/passwd",
                    "Alice", "-leading", "x" * 65, "al ice"):
        try:
            p.validate_user_id(hostile)
        except p.InvalidUserId:
            pass
        else:
            raise AssertionError(f"accepted a hostile user id: {hostile!r}")

    # And set_user must refuse them too, not merely validate on request.
    try:
        p.set_user("../bob")
    except p.InvalidUserId:
        pass
    else:
        raise AssertionError("set_user accepted a traversal")
    assert p.get_user() is None, "a rejected id must not become current"

    # Ordinary ids still work, including the shapes an email slug produces.
    for ok in ("alice", "alice.rivera", "a", "user-1", "kalyanreddym1009"):
        assert p.validate_user_id(ok) == ok

    # ------------------------------------------------------------ overrides
    # An override is honoured; empty or whitespace is treated as unset, so a
    # blank line in an env file can't silently relocate someone's data.
    os.environ["FACET_TEST_DIR"] = str(Path.home() / "facet-test")
    assert _dir("FACET_TEST_DIR", ROOT) != ROOT
    os.environ["FACET_TEST_DIR"] = "   "
    assert _dir("FACET_TEST_DIR", ROOT) == ROOT
    del os.environ["FACET_TEST_DIR"]
    assert _dir("FACET_DEFINITELY_UNSET_VAR", ROOT) == ROOT

    # A name that does not exist must still raise AttributeError, not
    # KeyError — `getattr(paths, x, default)` is used in a few places.
    try:
        p.NO_SUCH_PATH
    except AttributeError:
        pass
    else:
        raise AssertionError("unknown attribute did not raise AttributeError")

    print("paths ok")
    print(f"  data:      {DATA_DIR}")
    print(f"  workspace: {WORKSPACE_DIR}")
    print(f"  templates: {TEMPLATES_DIR}")
    print(f"  per-user:  {USERS_ROOT / '<user>'}")


if __name__ == "__main__":
    demo()
