"""SQLite access for tracker.db — the Cabinet's applications/contacts/
interviews tables (Section 10), plus seen_postings (Section 9's feed dedup).

A single shared connection, serialized behind an asyncio.Lock and run in a
thread executor, stands in for "a small connection pool" (Section 14) —
SQLite itself only supports one writer at a time, so a real multi-connection
pool buys nothing here; this just keeps every call off the event loop.
"""

import asyncio
import sqlite3

from services.paths import DB_PATH  # noqa: F401  (re-exported; imported widely)

_connection: sqlite3.Connection | None = None
_lock = asyncio.Lock()


def apply_pragmas(conn: sqlite3.Connection) -> None:
    """WAL + a real page cache is the difference between The Rough feeling
    instant and feeling like a database. Applied to every connection,
    including the one the scheduler thread opens for itself."""
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA cache_size = -16000")  # ~16MB
    conn.execute("PRAGMA busy_timeout = 5000")


def _get_connection() -> sqlite3.Connection:
    global _connection
    if _connection is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _connection = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _connection.row_factory = sqlite3.Row
        apply_pragmas(_connection)
        # SQLite has no REGEXP, and the repost-suffix rule needs one. Registering
        # the same Python function the ingest side uses keeps one definition of
        # "these two rows are the same posting" instead of a SQL re-implementation
        # that drifts. Imported here, not at module scope: job_sources imports db.
        from services.job_sources import dedup_key

        _connection.create_function("dedup_key", 3, dedup_key, deterministic=True)
    return _connection


def init_db():
    conn = _get_connection()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company TEXT NOT NULL,
          role_title TEXT NOT NULL,
          target_role TEXT,
          job_description TEXT,
          ats_score INTEGER,
          resume_path TEXT,
          docx_path TEXT,
          cover_letter_path TEXT,
          recruiter_summary TEXT,
          status TEXT NOT NULL DEFAULT 'Saved',
          job_url TEXT,
          company_domain TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          notes TEXT
        );

        CREATE TABLE IF NOT EXISTS contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          application_id INTEGER NOT NULL REFERENCES applications(id),
          name TEXT NOT NULL,
          role_title TEXT,
          email TEXT,
          phone TEXT,
          linkedin_url TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS interviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          application_id INTEGER NOT NULL REFERENCES applications(id),
          contact_id INTEGER REFERENCES contacts(id),
          round_name TEXT,
          scheduled_at TEXT,
          completed INTEGER NOT NULL DEFAULT 0,
          outcome TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- The Rough (Section 9): feed dedup index AND the ranked-postings
        -- queue are the same table — a posting's dedup hash and its display
        -- row are the same real-world thing, no reason to split them.
        CREATE TABLE IF NOT EXISTS seen_postings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          posting_hash TEXT UNIQUE NOT NULL,
          source_feed TEXT,
          company TEXT,
          title TEXT,
          posting_url TEXT,
          posted_date TEXT,
          summary TEXT,
          match_score REAL,
          first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          promoted INTEGER NOT NULL DEFAULT 0,
          dismissed INTEGER NOT NULL DEFAULT 0
        );

        -- Calendar-sync suggestions (Section 10) — every match is a guess,
        -- never written straight into `interviews`. A person confirms or
        -- dismisses each one; `dismissed` doubles as "no longer pending"
        -- for both outcomes once a suggestion has been acted on.
        CREATE TABLE IF NOT EXISTS suggested_interviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          uid TEXT UNIQUE NOT NULL,
          application_id INTEGER REFERENCES applications(id),
          contact_id INTEGER REFERENCES contacts(id),
          confidence TEXT NOT NULL,
          event_title TEXT,
          scheduled_at TEXT,
          description TEXT,
          raw_attendees TEXT,
          first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          dismissed INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    _migrate(conn)
    conn.commit()


# Columns added to seen_postings after the aggregator landed. ALTER TABLE ADD
# COLUMN is the whole migration story here — SQLite makes it free, and an
# existing tracker.db must keep working without being rebuilt.
_POSTING_COLUMNS = {
    "source": "TEXT",
    "location": "TEXT",
    "remote": "INTEGER NOT NULL DEFAULT 0",
    "employment_type": "TEXT",
    "salary_min": "INTEGER",
    "salary_max": "INTEGER",
    "salary_currency": "TEXT",
    "tags": "TEXT",
    "last_seen_at": "TEXT",
    # Which of the Stone's skills this posting mentions — the evidence behind
    # match_score. Written by the same ingest pass that computes the score, so
    # existing rows fill in on the next sync.
    "match_terms": "TEXT",
}


def _migrate(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(seen_postings)")}
    for column, decl in _POSTING_COLUMNS.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE seen_postings ADD COLUMN {column} {decl}")

    # Rows written before the aggregator stored the *feed label* in `company`
    # ("Python.org — Official Job Board" is not an employer) and had no
    # `source` at all. Marking them with the literal 'RSS' — a value the new
    # ingest never writes, since it stores the feed's label there — makes them
    # identifiable exactly once.
    conn.execute("UPDATE seen_postings SET source = 'RSS' WHERE source IS NULL")
    conn.execute("UPDATE seen_postings SET last_seen_at = first_seen_at WHERE last_seen_at IS NULL")

    # ...then drop them. The sync that runs seconds after startup re-ingests
    # the same postings with a real company parsed out. Anything already
    # dismissed or promoted is kept: those carry a decision the person made,
    # and re-adding a dismissed posting would undo it.
    conn.execute("DELETE FROM seen_postings WHERE source = 'RSS' AND dismissed = 0 AND promoted = 0")

    conn.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_postings_rank
          ON seen_postings (dismissed, match_score DESC, posted_date DESC);
        CREATE INDEX IF NOT EXISTS idx_postings_source ON seen_postings (source);
        CREATE INDEX IF NOT EXISTS idx_postings_remote ON seen_postings (remote);
        CREATE INDEX IF NOT EXISTS idx_postings_posted ON seen_postings (posted_date DESC);
        CREATE INDEX IF NOT EXISTS idx_apps_status ON applications (status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_interviews_app ON interviews (application_id);
        CREATE INDEX IF NOT EXISTS idx_contacts_app ON contacts (application_id);
        """
    )


def _fetch_all_sync(query, params):
    conn = _get_connection()
    cur = conn.execute(query, params)
    return [dict(row) for row in cur.fetchall()]


def _execute_sync(query, params):
    conn = _get_connection()
    cur = conn.execute(query, params)
    conn.commit()
    return cur.lastrowid


async def fetch_all(query: str, params: tuple = ()) -> list[dict]:
    loop = asyncio.get_running_loop()
    async with _lock:
        return await loop.run_in_executor(None, _fetch_all_sync, query, params)


async def fetch_one(query: str, params: tuple = ()) -> dict | None:
    rows = await fetch_all(query, params)
    return rows[0] if rows else None


async def execute(query: str, params: tuple = ()) -> int:
    """Runs an INSERT/UPDATE/DELETE, returns lastrowid (for INSERTs)."""
    loop = asyncio.get_running_loop()
    async with _lock:
        return await loop.run_in_executor(None, _execute_sync, query, params)
