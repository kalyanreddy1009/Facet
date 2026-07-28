"""Cheap local keyword-overlap scoring — no embeddings model, no agy call.

Shared by The Rough's feed scoring (Section 9) and the Cutting Pipeline's
local pre-check (Section 5) — both are the same "how much does this text
overlap with the candidate's keywords/skills" question.
"""

import re


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9+#.]+", text.lower()))


def keyword_overlap_score(text: str, keywords: list[str]) -> float:
    """Fraction of `keywords` that appear (as substrings of tokens) in `text`.
    Returns 0.0 if there are no keywords to compare against."""
    if not keywords:
        return 0.0

    tokens = _tokenize(text)
    haystack = " ".join(tokens)

    hits = 0
    for keyword in keywords:
        needle = keyword.lower().strip()
        if not needle:
            continue
        if needle in haystack:
            hits += 1

    return hits / len(keywords)


# A posting's blurb only ever mentions a handful of your skills, so the raw
# fraction above lands near zero for even a great match. The Rough ranks on
# this instead: hits measured against a realistic ceiling, on the 0-100 scale
# the UI actually renders.
MATCH_CEILING = 12


def posting_match_terms(text: str, keywords: list[str]) -> list[str]:
    """Which of `keywords` this posting actually mentions, in the caller's own
    casing. The score is meaningless to a person without this — "72% match" is
    a number to argue with; "Python, FastAPI, Postgres" is a reason to click."""
    haystack = " ".join(_tokenize(text))
    seen: set[str] = set()
    hits = []
    for keyword in keywords:
        needle = keyword.lower().strip()
        if needle and needle not in seen and needle in haystack:
            seen.add(needle)
            hits.append(keyword.strip())
    return hits


def posting_match_score(text: str, keywords: list[str]) -> float:
    if not keywords:
        return 0.0
    hits = len(posting_match_terms(text, keywords))
    ceiling = min(len(keywords), MATCH_CEILING)
    return round(min(100.0, 100.0 * hits / ceiling), 1)


def demo() -> None:
    kws = ["Python", "FastAPI", "React"]
    assert keyword_overlap_score("we use python and react", kws) == 2 / 3
    assert keyword_overlap_score("anything", []) == 0.0
    assert posting_match_score("python fastapi react", kws) == 100.0
    assert posting_match_score("nothing here", kws) == 0.0
    assert posting_match_score("python", kws) == round(100 / 3, 1)
    # Never exceeds 100 even when a long keyword list all hits.
    many = [f"skill{i}" for i in range(50)]
    assert posting_match_score(" ".join(many), many) == 100.0

    # Terms come back in the caller's casing, only the ones present, no dupes.
    assert posting_match_terms("we use python and react", kws) == ["Python", "React"]
    assert posting_match_terms("nothing here", kws) == []
    assert posting_match_terms("python", ["Python", "python", "PYTHON"]) == ["Python"]
    # A repeated keyword can't inflate the score past its distinct-hit value.
    assert posting_match_score("python", ["Python", "python", "Go"]) == round(100 / 3, 1)
    print("matching: all checks passed")


if __name__ == "__main__":
    demo()
