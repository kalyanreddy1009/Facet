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

# Ports are derived from the user id, and ids are never recycled. That closes
# the nastiest failure available to this design: a deleted user's port being
# reassigned while a stale container or a cached tunnel rule still points at
# it, silently handing one person's Facet to someone else.
WEB_PORT_BASE = 3100
API_PORT_BASE = 8100

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
    return _connection


def init_control_db() -> None:
    conn = connect()
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
        """
    )
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
    conn.execute(
        "UPDATE users SET web_port = ?, api_port = ? WHERE id = ?",
        (WEB_PORT_BASE + user_id, API_PORT_BASE + user_id, user_id),
    )
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
