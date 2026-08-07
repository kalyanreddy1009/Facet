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
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import paths  # noqa: E402
from services.db import apply_pragmas  # noqa: E402
from services.feed_ingest import load_candidate_keywords  # noqa: E402
from services.matching import posting_match_score, posting_match_terms  # noqa: E402


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
            db_path = paths.DB_PATH
            if not db_path.exists():
                continue
            keywords = load_candidate_keywords()
            label = user or "(single-user root)"
            if not keywords:
                print(f"{label}: no profile keywords, skipped")
                continue

            conn = sqlite3.connect(str(db_path))
            try:
                apply_pragmas(conn)
                rows = conn.execute(
                    "SELECT id, title, company, summary, tags, match_score FROM seen_postings"
                ).fetchall()
                moved = 0
                for row_id, title, company, summary, tags, old in rows:
                    # Assembled exactly as store_postings does it; scoring a
                    # different text than the app scores would be worse than
                    # leaving the old number alone.
                    haystack = (
                        f"{title or ''} {company or ''} {summary or ''} "
                        f"{' '.join(json.loads(tags or '[]'))}"
                    )
                    score = posting_match_score(haystack, keywords)
                    terms = posting_match_terms(haystack, keywords)
                    touched += 1
                    if abs((old or 0.0) - score) < 1e-9:
                        continue
                    moved += 1
                    changed += 1
                    if not dry_run:
                        conn.execute(
                            "UPDATE seen_postings SET match_score = ?, match_terms = ? WHERE id = ?",
                            (score, json.dumps(terms), row_id),
                        )
                if not dry_run:
                    conn.commit()
                print(f"{label}: {len(rows)} postings, {moved} scores moved")
            finally:
                conn.close()

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
