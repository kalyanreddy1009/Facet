"""Recompute stored posting scores after a change to services.matching.

    cd backend && env -u PYTHONPATH .venv/bin/python scripts/rescore_postings.py --dry-run
    cd backend && env -u PYTHONPATH .venv/bin/python scripts/rescore_postings.py

WHY THIS IS NEEDED AT ALL
-------------------------
`match_score` is derived data, but The Rough sorts on it in SQL, so it cannot
be recomputed on read without giving up ordering and pagination. It has to be
written down, which means a change to the matcher leaves every stored row
carrying an answer the current code would not give.

`store_postings` already refreshes the score when it re-sees a posting, so the
feeds heal themselves over time. This script is for the rows that never come
back: a posting that has aged out of its feed keeps its old score forever,
which is exactly the posting someone saved because the old score looked good.

SAFE TO RUN, SAFE TO RE-RUN
---------------------------
It touches two derived columns and nothing else. It reads the same stored text
`store_postings` scored in the first place, so it is idempotent — running it
twice changes nothing the second time. It never inserts, never deletes, and
never touches `promoted` or `dismissed`, because those are decisions the user
made and no scoring change gets to revisit them.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import paths  # noqa: E402
from services.feed_ingest import rescore_stored_postings  # noqa: E402


def _users() -> list[str | None]:
    """Every scope with its own database: the single-user root, then each
    provisioned user. `None` means "not inside a user scope"."""
    scopes: list[str | None] = [None]
    if paths.USERS_ROOT.is_dir():
        scopes += sorted(p.name for p in paths.USERS_ROOT.iterdir() if p.is_dir())
    return scopes


def rescore(dry_run: bool) -> tuple[int, int]:
    touched = 0
    changed = 0

    for user in _users():
        with paths.user_scope(user):
            label = user or "(single-user root)"
            # Same function the profile extraction calls, so a manual rescore
            # and an automatic one can never produce different numbers.
            examined, moved = rescore_stored_postings(dry_run)
            touched += examined
            changed += moved
            print(f"{label}: {examined} postings, {moved} scores moved")

    return touched, changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="report what would change, write nothing"
    )
    args = parser.parse_args()

    touched, changed = rescore(args.dry_run)
    verb = "would change" if args.dry_run else "changed"
    print(f"\n{touched} postings examined, {changed} {verb}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
