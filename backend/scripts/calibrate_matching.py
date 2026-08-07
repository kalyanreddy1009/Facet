"""Measure MATCH_CEILING against real postings, instead of guessing it.

    cd backend && env -u PYTHONPATH .venv/bin/python scripts/calibrate_matching.py

Read-only: opens every tracker.db it can find with `mode=ro` and touches
nothing. Not part of check_all.py — it depends on there being real postings
to measure, which a fresh install has none of.

WHY THIS EXISTS
---------------
MATCH_CEILING turns "how many of your skills does this posting name" into the
0-100 number the Rough sorts on. It was 12, chosen by eye, back when the
matcher counted `R` in `career` as a hit — so it was sized for an inflated
numerator. Removing substring matching cut real hit counts by roughly half,
and leaving the ceiling alone would have pinned genuinely good postings in the
thirties and made the whole list look like a bad week.

The ceiling is a product decision, not a fact: it says what "100%" means. The
target below states it plainly — a posting naming this many of your skills is
as good as the Rough needs to tell you it is.
"""

import glob
import json
import os
import sqlite3
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.feed_ingest import load_candidate_keywords  # noqa: E402
from services.matching import MATCH_CEILING, posting_match_terms  # noqa: E402


def _postings() -> list[tuple[str, str, float]]:
    """(title, haystack, old_score) per stored posting.

    The haystack is assembled exactly as `feed_ingest.store_postings` does it,
    because calibrating against a different text than the one the app scores
    would calibrate the wrong thing. `match_score` comes back too: it was
    written by the old substring matcher, so it is the before-picture.
    """
    rows: list[tuple[str, str, float]] = []
    for db in glob.glob("data/**/tracker.db", recursive=True) + glob.glob(
        "../data/**/tracker.db", recursive=True
    ):
        try:
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            for title, company, summary, tags, score in conn.execute(
                "SELECT title, company, summary, tags, match_score FROM seen_postings"
            ):
                rows.append(
                    (
                        title or "",
                        f"{title or ''} {company or ''} {summary or ''} "
                        f"{' '.join(json.loads(tags or '[]'))}",
                        score or 0.0,
                    )
                )
        except sqlite3.Error:
            continue
    return rows


def main() -> int:
    # The repo root, so this runs the same from backend/ or from the root.
    os.chdir(Path(__file__).resolve().parent.parent.parent)

    keywords = load_candidate_keywords()
    postings = _postings()
    if not keywords or not postings:
        print("nothing to calibrate against (no profile keywords, or no postings)")
        return 0

    scored = [(title, len(posting_match_terms(hay, keywords)), old) for title, hay, old in postings]
    counts = Counter(hits for _, hits, _ in scored)
    total = len(scored)

    print(f"{total} postings x {len(keywords)} keywords\n")
    print("  hits  postings   share   cumulative (>= hits)")
    running = 0
    for count in sorted(counts, reverse=True):
        running += counts[count]
        print(f"  {count:>4}  {counts[count]:>8}  {counts[count] / total:>6.1%}   {running / total:>6.1%}")

    ranked = sorted((hits for _, hits, _ in scored), reverse=True)
    top_decile = ranked[max(0, total // 10 - 1)]
    print(f"\nbest posting names {ranked[0]}; the top 10% name >= {top_decile}")

    # What each candidate ceiling does to the top of the list. The ceiling is
    # a statement about what "100%" means, so the useful view is what the good
    # postings would read as, not an abstract fit.
    print("\n  ceiling   top posting   top decile   postings at 100%")
    for ceiling in (3, 4, 5, 6, 8, 12):
        full = sum(1 for hits in ranked if hits >= ceiling)
        print(
            f"  {ceiling:>7}   {min(100, round(100 * ranked[0] / ceiling)):>10}%   "
            f"{min(100, round(100 * top_decile / ceiling)):>9}%   {full:>16}"
        )
    print(f"\n  (MATCH_CEILING is currently {MATCH_CEILING})")

    # Before/after on the postings a user would actually be looking at.
    print("\nthe ten postings the old matcher ranked highest:\n")
    print(f"  {'old':>5}  {'new':>5}   title")
    for title, hits, old in sorted(scored, key=lambda r: -r[2])[:10]:
        new = min(100.0, 100.0 * hits / MATCH_CEILING)
        print(f"  {old:>4.0f}%  {new:>4.0f}%   {title[:52]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
