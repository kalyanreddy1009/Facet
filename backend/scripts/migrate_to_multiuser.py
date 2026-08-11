"""Move a single-user installation into a user's own directory.

    backend/.venv/bin/python scripts/migrate_to_multiuser.py --owner alice@example.com
    backend/.venv/bin/python scripts/migrate_to_multiuser.py --owner alice@example.com --apply

Dry run by default. Nothing moves until `--apply`, and even then nothing is
deleted: the original `data/` and `workspace/` are left exactly where they
are, and the new layout is a *copy*. Reclaiming the old copy is a separate,
manual decision — this script's job is to make the new layout work, not to
free disk.

That is deliberate and not merely cautious. The thing being moved is the only
record of where somebody has applied for work. A move that half-succeeds and
then removes its source has destroyed something no backup of the code can
rebuild.

The database is copied with SQLite's own `VACUUM INTO` rather than `cp`. A
live database in WAL mode keeps recent commits in a sidecar file; copying
only `tracker.db` silently loses them. This was measured during Phase 6 — a
file copy produced 906 rows where the database held 1,166.
"""

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from control import store  # noqa: E402
from services import paths  # noqa: E402


def _copy_database(source: Path, target: Path) -> tuple[int, int]:
    """Copy via VACUUM INTO and return (source rows, target rows)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise SystemExit(f"refusing to overwrite an existing database: {target}")

    conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        conn.execute("VACUUM INTO ?", (str(target),))
        before = conn.execute("SELECT count(*) FROM applications").fetchone()[0]
    finally:
        conn.close()

    check = sqlite3.connect(f"file:{target}?mode=ro", uri=True)
    try:
        after = check.execute("SELECT count(*) FROM applications").fetchone()[0]
        # The copy has to be readable *and* intact, not merely present.
        integrity = check.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise SystemExit(f"the copied database failed its integrity check: {integrity}")
    finally:
        check.close()

    return before, after


def migrate(email: str, apply: bool) -> None:
    user = store.get_user_by_email(email.strip().lower())
    if user is None:
        raise SystemExit(
            f"{email} is not a registered user. Add them in the admin portal "
            "first - this script moves data to an account, it does not create one."
        )

    slug = paths.validate_user_id(user["slug"])
    target_data, target_workspace = paths.user_roots(slug)

    source_data = paths.DATA_DIR
    source_workspace = paths.WORKSPACE_DIR

    print(f"owner:     {email}  (slug: {slug})")
    print(f"data:      {source_data}\n        -> {target_data}")
    print(f"workspace: {source_workspace}\n        -> {target_workspace}")
    print()

    if not source_data.exists() and not source_workspace.exists():
        raise SystemExit("nothing to migrate: neither data/ nor workspace/ exists")

    # Refuse to migrate into a home that is already in use. Merging two
    # people's records is not something to attempt automatically.
    if (target_data / "tracker.db").exists():
        raise SystemExit(
            f"{slug} already has a tracker.db at {target_data}. "
            "Migrating on top of it could merge two different people's records."
        )

    plan: list[str] = []
    source_db = source_data / "tracker.db"
    if source_db.exists():
        plan.append(f"copy tracker.db via VACUUM INTO -> {target_data / 'tracker.db'}")

    loose_files = [
        name for name in ("settings.json", "feeds.json", "calendar_config.json")
        if (source_data / name).exists()
    ]
    plan += [f"copy {name}" for name in loose_files]

    if (source_data / "exports").exists():
        count = len(list((source_data / "exports").rglob("*")))
        plan.append(f"copy exports/ ({count} entries)")

    if source_workspace.exists():
        count = len([p for p in source_workspace.iterdir()])
        plan.append(f"copy workspace/ ({count} entries)")

    for line in plan:
        print(f"  {line}")
    print()

    if not apply:
        print("dry run - nothing was written. Re-run with --apply to do it.")
        return

    target_data.mkdir(parents=True, exist_ok=True)

    if source_db.exists():
        before, after = _copy_database(source_db, target_data / "tracker.db")
        if before != after:
            raise SystemExit(
                f"row count changed during the copy: {before} -> {after}. "
                "The original is untouched; investigate before retrying."
            )
        print(f"  tracker.db copied and verified ({after} applications)")

    for name in loose_files:
        shutil.copy2(source_data / name, target_data / name)
        print(f"  {name} copied")

    if (source_data / "exports").exists():
        shutil.copytree(source_data / "exports", target_data / "exports",
                        dirs_exist_ok=True)
        print("  exports/ copied")

    if source_workspace.exists():
        shutil.copytree(source_workspace, target_workspace, dirs_exist_ok=True)
        print("  workspace/ copied")

    print()
    print(f"done. {slug} now has their own copy.")
    print("The originals are untouched - delete them yourself once you have")
    print("signed in as this user and confirmed the record looks right.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", required=True,
                        help="email of the registered user this data belongs to")
    parser.add_argument("--apply", action="store_true",
                        help="actually copy; without this it is a dry run")
    args = parser.parse_args()
    migrate(args.owner, args.apply)


if __name__ == "__main__":
    main()
