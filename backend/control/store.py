"""control.db — users and the audit log.

Deliberately a third database, touching neither `tracker.db` (the user's
record) nor `queue.db` (operational state). Nothing here can migrate, lock,
or corrupt data that belongs to a person: the control plane reads user
databases and never writes to them.

Layout it manages, rooted at FACET_HOST_ROOT:

    control.db
    users/<slug>/data/       tracker.db, settings.json, exports/, logs/
    users/<slug>/workspace/  profile.json, master_resume.md, RULES.md
    users/<slug>/.env        ports and FACET_* for that instance
    exports/                 account export bundles
    deleted/<slug>-<ts>/     soft-deleted accounts awaiting purge
"""

import json
import os
import re
import sqlite3
import time
from pathlib import Path

from services.paths import ROOT

# Default keeps a local checkout self-contained; the host sets this to
# /srv/facet. Gitignored either way.
HOST_ROOT = Path(
    os.environ.get("FACET_HOST_ROOT", "").strip() or ROOT / ".facet-host"
).expanduser()

CONTROL_DB = HOST_ROOT / "control.db"
USERS_DIR = HOST_ROOT / "users"
EXPORTS_DIR = HOST_ROOT / "exports"
DELETED_DIR = HOST_ROOT / "deleted"

# `web_port` and `api_port` are vestigial. One instance serves everyone now,
# so nobody has a port of their own; both are written as 0.
#
# The columns stay because removing one from SQLite means rebuilding the
# table, and the rule for user-owned data here is additive migrations only.
# An unused column costs nothing; a table rebuild on somebody's live record
# is exactly the kind of operation that loses data.

PROVISIONING, ACTIVE, SUSPENDED, DEPROVISIONING, DELETED = (
    "provisioning", "active", "suspended", "deprovisioning", "deleted",
)

_connection: sqlite3.Connection | None = None


def connect() -> sqlite3.Connection:
    global _connection
    if _connection is None:
        CONTROL_DB.parent.mkdir(parents=True, exist_ok=True)
        _connection = sqlite3.connect(CONTROL_DB, check_same_thread=False)
        _connection.row_factory = sqlite3.Row
        _connection.execute("PRAGMA journal_mode = WAL")
        _connection.execute("PRAGMA foreign_keys = ON")
        _connection.execute("PRAGMA busy_timeout = 5000")
        # The schema is created on first connect rather than only by an
        # explicit init call. The app reads this database to resolve
        # identities, and on a host where nobody has opened the admin portal
        # yet the table does not exist — which surfaced as a 500 on every
        # request instead of a clean "you are not registered". Every
        # statement in init_control_db is CREATE ... IF NOT EXISTS, so this
        # is idempotent and costs one no-op per process.
        _init_schema(_connection)
    return _connection


def init_control_db() -> None:
    _init_schema(connect())


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          email         TEXT UNIQUE NOT NULL,
          slug          TEXT UNIQUE NOT NULL,
          display_name  TEXT,
          status        TEXT NOT NULL,
          web_port      INTEGER NOT NULL,
          api_port      INTEGER NOT NULL,
          steps         TEXT NOT NULL DEFAULT '{}',
          created_at    REAL NOT NULL,
          deleted_at    REAL,
          purge_after   REAL,
          last_seen_at  REAL
        );

        CREATE TABLE IF NOT EXISTS audit (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          at      REAL NOT NULL,
          actor   TEXT NOT NULL,
          action  TEXT NOT NULL,
          target  TEXT,
          detail  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at DESC);

        -- Sessions are server-side so they can be revoked. Suspending or
        -- deleting somebody has to end their session now, and a stateless
        -- token cannot be taken back before it expires.
        --
        -- `token_hash`, never the token: a leaked backup of this file must
        -- not hand over live sessions.
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash  TEXT PRIMARY KEY,
          user_id     INTEGER NOT NULL REFERENCES users(id),
          created_at  REAL NOT NULL,
          expires_at  REAL NOT NULL,
          last_seen_at REAL,
          user_agent  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

        -- Failed logins, for lockout. Kept per account because that is what
        -- an attacker targets; per-IP alone is defeated by a proxy list.
        CREATE TABLE IF NOT EXISTS login_attempts (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          email    TEXT NOT NULL,
          at       REAL NOT NULL,
          remote   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_attempts_email ON login_attempts(email, at DESC);
        """
    )

    # Additive, like tracker.db's. A control.db from before passwords existed
    # opens unchanged and its users simply have no password set yet — which
    # is exactly the state an invited user is in.
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    for column, decl in {
        "password_hash": "TEXT",
        "password_set_at": "REAL",
        "invite_hash": "TEXT",
        "invite_expires": "REAL",
    }.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE users ADD COLUMN {column} {decl}")

    conn.commit()
    for directory in (USERS_DIR, EXPORTS_DIR, DELETED_DIR):
        directory.mkdir(parents=True, exist_ok=True)


# ------------------------------------------------------------------- audit

def record(actor: str, action: str, target: str | None = None,
           detail: str | None = None) -> None:
    """Every state-changing action lands here.

    Never auto-pruned. The audit log is the only place that can answer "who
    deleted that account and when", which is exactly the question asked after
    something has already gone wrong.
    """
    conn = connect()
    conn.execute(
        "INSERT INTO audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)",
        (time.time(), actor, action, target, detail),
    )
    conn.commit()


def audit_log(limit: int = 100) -> list[dict]:
    conn = connect()
    return [dict(r) for r in conn.execute(
        "SELECT * FROM audit ORDER BY at DESC LIMIT ?", (limit,)
    )]


# ------------------------------------------------------------------- users

def slugify_email(email: str) -> str:
    """A filesystem- and compose-safe name derived from the address.

    Compose project names must be lowercase alphanumeric with dashes, and
    this doubles as a directory name, so it is stricter than it looks.
    """
    local = email.split("@")[0].lower()
    slug = re.sub(r"[^a-z0-9]+", "-", local).strip("-")
    return slug or "user"


def unique_slug(email: str) -> str:
    """alice@a.com and alice@b.com both want "alice"; the second gets
    "alice-2". Collisions are rare and silently overwriting someone's
    directory is not an acceptable way to handle them."""
    conn = connect()
    base = slugify_email(email)
    slug, n = base, 1
    while conn.execute("SELECT 1 FROM users WHERE slug = ?", (slug,)).fetchone():
        n += 1
        slug = f"{base}-{n}"
    return slug


def user_paths(slug: str) -> dict[str, Path]:
    home = USERS_DIR / slug
    return {
        "home": home,
        "data": home / "data",
        "workspace": home / "workspace",
        "exports": home / "data" / "exports",
        "env": home / ".env",
        "tracker_db": home / "data" / "tracker.db",
        "queue_db": home / "data" / "queue.db",
    }


def create_user_row(email: str, display_name: str | None) -> dict:
    conn = connect()
    slug = unique_slug(email)
    cur = conn.execute(
        "INSERT INTO users (email, slug, display_name, status, web_port, api_port, "
        "created_at) VALUES (?, ?, ?, ?, 0, 0, ?)",
        (email, slug, display_name, PROVISIONING, time.time()),
    )
    user_id = cur.lastrowid
    conn.commit()
    return get_user(user_id)


def get_user(user_id: int) -> dict | None:
    conn = connect()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _hydrate(row)


def get_user_by_email(email: str) -> dict | None:
    conn = connect()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    return _hydrate(row)


def list_users(include_deleted: bool = False) -> list[dict]:
    conn = connect()
    sql = "SELECT * FROM users"
    if not include_deleted:
        sql += f" WHERE status != '{DELETED}'"
    sql += " ORDER BY id"
    return [_hydrate(r) for r in conn.execute(sql)]


def _hydrate(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    user = dict(row)
    user["steps"] = json.loads(user["steps"] or "{}")
    return user


def set_status(user_id: int, status: str) -> None:
    conn = connect()
    conn.execute("UPDATE users SET status = ? WHERE id = ?", (status, user_id))
    conn.commit()


def set_steps(user_id: int, steps: dict) -> None:
    conn = connect()
    conn.execute("UPDATE users SET steps = ? WHERE id = ?", (json.dumps(steps), user_id))
    conn.commit()


def mark_deleted(user_id: int, purge_after: float) -> None:
    conn = connect()
    conn.execute(
        "UPDATE users SET status = ?, deleted_at = ?, purge_after = ? WHERE id = ?",
        (DELETED, time.time(), purge_after, user_id),
    )
    conn.commit()


def restore(user_id: int) -> None:
    conn = connect()
    conn.execute(
        "UPDATE users SET status = ?, deleted_at = NULL, purge_after = NULL WHERE id = ?",
        (SUSPENDED, user_id),
    )
    conn.commit()


def forget(user_id: int) -> None:
    """Drop the row entirely — only after the data is already purged."""
    conn = connect()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()


# ---------------------------------------------------------------- sessions
#
# The credential half of the user table. Kept here rather than in
# services/auth.py so that module stays pure -- it decides *policy* (how to
# hash, when to lock out) and this decides *storage*.

def set_password(user_id: int, password_hash: str) -> None:
    """Set the password and consume any outstanding invite.

    Clearing the invite matters: a link that still works after the password
    is set is a second, permanent way into the account.
    """
    conn = connect()
    conn.execute(
        "UPDATE users SET password_hash = ?, password_set_at = ?, "
        "invite_hash = NULL, invite_expires = NULL WHERE id = ?",
        (password_hash, time.time(), user_id),
    )
    conn.commit()


def create_invite(user_id: int, invite_hash: str, expires_at: float) -> None:
    """Store the digest of a one-time link. Replaces any previous one."""
    conn = connect()
    conn.execute(
        "UPDATE users SET invite_hash = ?, invite_expires = ? WHERE id = ?",
        (invite_hash, expires_at, user_id),
    )
    conn.commit()


def user_by_invite(invite_hash: str) -> dict | None:
    """The user holding this unexpired invite, if any."""
    conn = connect()
    row = conn.execute(
        "SELECT * FROM users WHERE invite_hash = ? AND invite_expires > ?",
        (invite_hash, time.time()),
    ).fetchone()
    return _hydrate(row)


def create_session(user_id: int, token_hash: str, ttl_seconds: float,
                   user_agent: str | None = None) -> None:
    now = time.time()
    conn = connect()
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, "
        "last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
        (token_hash, user_id, now, now + ttl_seconds, now, (user_agent or "")[:200]),
    )
    conn.commit()


def session_user(token_hash: str) -> dict | None:
    """The user this session belongs to, or None if it is unknown or expired.

    Expiry is enforced in the query rather than after it, so there is no path
    where an expired session is read and then forgotten to be checked.
    """
    conn = connect()
    row = conn.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = ? AND s.expires_at > ?",
        (token_hash, time.time()),
    ).fetchone()
    if row is None:
        return None
    conn.execute("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
                 (time.time(), token_hash))
    conn.execute("UPDATE users SET last_seen_at = ? WHERE id = ?",
                 (time.time(), row["id"]))
    conn.commit()
    return _hydrate(row)


def revoke_session(token_hash: str) -> None:
    conn = connect()
    conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
    conn.commit()


def revoke_user_sessions(user_id: int) -> int:
    """End every session this user holds. Suspension and deletion depend on
    it: a status change that leaves a live session running has not actually
    stopped anybody."""
    conn = connect()
    cur = conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    conn.commit()
    return cur.rowcount


def purge_expired_sessions() -> int:
    conn = connect()
    cur = conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (time.time(),))
    conn.commit()
    return cur.rowcount


def list_sessions(user_id: int) -> list[dict]:
    conn = connect()
    return [dict(r) for r in conn.execute(
        "SELECT token_hash, created_at, expires_at, last_seen_at, user_agent "
        "FROM sessions WHERE user_id = ? ORDER BY created_at DESC", (user_id,)
    )]


# ----------------------------------------------------------- login attempts

def record_failure(email: str, remote: str | None) -> None:
    conn = connect()
    conn.execute("INSERT INTO login_attempts (email, at, remote) VALUES (?, ?, ?)",
                 (email.lower(), time.time(), (remote or "")[:64]))
    conn.commit()


def recent_failures(email: str, window_seconds: float) -> list[float]:
    conn = connect()
    return [r["at"] for r in conn.execute(
        "SELECT at FROM login_attempts WHERE email = ? AND at > ? ORDER BY at",
        (email.lower(), time.time() - window_seconds),
    )]


def clear_failures(email: str) -> None:
    """Called on a successful login. Without it a person who mistyped four
    times and then got it right stays four failures closer to a lockout."""
    conn = connect()
    conn.execute("DELETE FROM login_attempts WHERE email = ?", (email.lower(),))
    conn.commit()
