"""Cheap local keyword-overlap scoring — no embeddings model, no agy call.

Shared by The Rough's feed scoring (Section 9) and the Cutting Pipeline's
local pre-check (Section 5) — both are the same "how much does this text
overlap with the candidate's keywords/skills" question.

WHOLE TOKENS, NOT SUBSTRINGS
----------------------------
This module used to join the posting's tokens into one string and ask
`needle in haystack`. That is a substring test, and it was wrong in a way
that got worse the shorter the keyword:

    keywords: ['Go', 'R', 'C', 'Java', 'React']
    posting:  "We are a Django shop. Great colleagues, good salary,
               career growth. Reach out!"
    -> matched ['Go', 'R', 'C'], scored 60%

`Go` came from *Django*, `R` from *career*, `C` from *Reach*. `Java` matched
`JavaScript`, and `C` matches essentially every posting ever written. A
posting mentioning none of the candidate's skills scored 60% and printed
three of them as evidence.

That mattered more than an ordinary inaccuracy, because the evidence line is
the product's whole claim: a score you can check rather than trust. Checking
it made it worse.

So a keyword now has to appear as a WHOLE token, and a multi-word keyword as
a contiguous run of tokens. The genuine matches that substring matching used
to buy — `postgres` for `postgresql`, `k8s` for `kubernetes` — are bought
back deliberately and by name in ALIASES below, where each one is a claim
someone can read and disagree with, rather than a side effect.

Kept honest by `demo()`, which asserts on the exact posting above.
"""

import re

_TOKEN_RE = re.compile(r"[a-z0-9+#.]+")

#: Spellings that mean the same technology. Variant -> canonical; a token not
#: listed is its own canonical form, so this only needs the differences.
#:
#: Every entry is a judgement that two words are interchangeable IN A JOB
#: POSTING, which is a narrower claim than in English generally — `node` is
#: ambiguous in a graph-theory paper and unambiguous in a backend advert.
#: The list is deliberately short. Each addition buys a real match and risks a
#: false one, and the false ones are what this module was just rescued from,
#: so the bar is "would a recruiter writing this ever mean anything else".
ALIASES = {
    # JavaScript ecosystem. Note `next` is absent on purpose: it is an
    # ordinary English word, so only the explicit `next.js` / `nextjs`
    # spellings count.
    "js": "javascript",
    "ts": "typescript",
    "node": "nodejs",
    "node.js": "nodejs",
    "react.js": "react",
    "reactjs": "react",
    "vue.js": "vue",
    "vuejs": "vue",
    "next.js": "nextjs",
    # Data stores
    "postgres": "postgresql",
    "psql": "postgresql",
    "mongo": "mongodb",
    "elastic": "elasticsearch",
    # Infrastructure
    "k8s": "kubernetes",
    # Languages. `golang` folds into `go` rather than the reverse, because
    # `Go` is what people put on a resume.
    "golang": "go",
    "c#": "csharp",
    "c++": "cpp",
    ".net": "dotnet",
    # Practices
    "restful": "rest",
}


def _normalize(raw: str) -> str:
    """One raw token to its canonical form, or "" if nothing survives.

    The trailing-dot strip is load-bearing. `.` is inside the token pattern so
    that `node.js` and `.net` survive as single tokens, which also means a word
    ending a sentence arrives as `python.`. Substring matching hid that — the
    old code found `python` inside `python.` — and whole-token matching would
    not. Leading dots are kept, because `.net` is a name.
    """
    token = raw.rstrip(".")
    return ALIASES.get(token, token)


def _tokenize(text: str) -> list[str]:
    """Ordered, canonicalised tokens. Order matters: multi-word keywords are
    matched as a contiguous run, so this cannot be a set."""
    return [token for raw in _TOKEN_RE.findall(text.lower()) if (token := _normalize(raw))]


class _Haystack:
    """A posting, tokenized once and asked about many times.

    Scoring one posting against twenty keywords used to re-join the token list
    per call. The set makes the common case — a single-word keyword — a hash
    lookup, and the list is kept for phrase matching.
    """

    __slots__ = ("tokens", "unique")

    def __init__(self, text: str) -> None:
        self.tokens = _tokenize(text)
        self.unique = set(self.tokens)

    def mentions(self, needle: list[str]) -> bool:
        if not needle:
            return False
        if len(needle) == 1:
            return needle[0] in self.unique
        # Cheap reject before the scan: every part must be present at all.
        if not all(part in self.unique for part in needle):
            return False
        span = len(needle)
        return any(
            self.tokens[i : i + span] == needle
            for i in range(len(self.tokens) - span + 1)
        )


def keyword_overlap_score(text: str, keywords: list[str]) -> float:
    """Fraction of `keywords` this text mentions. 0.0 if there are none.

    A blank keyword is skipped when counting hits but still counts in the
    denominator, so a stray empty entry in someone's Stone depresses every
    score very slightly. That is a wart, it is mirrored deliberately in
    `frontend/src/lib/match.ts`, and it is left alone here because this module
    is already changing every score in the app once and twice is worse.
    """
    if not keywords:
        return 0.0

    haystack = _Haystack(text)
    hits = sum(1 for keyword in keywords if haystack.mentions(_tokenize(keyword)))
    return hits / len(keywords)


# A posting's blurb only ever mentions a handful of your skills, so the raw
# fraction above lands near zero for even a great match. The Rough ranks on
# this instead: hits measured against a realistic ceiling, on the 0-100 scale
# the UI actually renders.
#
# Lowered from 12 when substring matching went away — 12 was sized for a
# numerator inflated by hits like `R` in `career`, and against honest hit
# counts it pinned the best postings in the sixties.
#
# Measured, not guessed: `scripts/calibrate_matching.py` over 670 real postings
# and a 51-keyword profile. The best posting names 10 skills; the next tier
# names 7, 7, 6, 6, 6.
#
# 8 rather than 6, and the reason is ranking rather than generosity. At 6 every
# one of those six postings scores 100% and the top of the Rough is a six-way
# tie broken by date — which is the one place ordering matters most. At 8 they
# spread 100 / 88 / 88 / 75 / 75 / 75 and the list has a real first place.
MATCH_CEILING = 8


def posting_match_terms(text: str, keywords: list[str]) -> list[str]:
    """Which of `keywords` this posting actually mentions, in the caller's own
    casing. The score is meaningless to a person without this — "72% match" is
    a number to argue with; "Python, FastAPI, Postgres" is a reason to click."""
    haystack = _Haystack(text)
    seen: set[str] = set()
    hits = []
    for keyword in keywords:
        needle = _tokenize(keyword)
        if not needle:
            continue
        # Dedupe on the canonical form, so a Stone listing both "Postgres" and
        # "PostgreSQL" counts once rather than scoring itself twice.
        key = " ".join(needle)
        if key not in seen and haystack.mentions(needle):
            seen.add(key)
            hits.append(keyword.strip())
    return hits


def posting_match_score(text: str, keywords: list[str]) -> float:
    if not keywords:
        return 0.0
    hits = len(posting_match_terms(text, keywords))
    ceiling = min(len([k for k in keywords if k.strip()]) or 1, MATCH_CEILING)
    return round(min(100.0, 100.0 * hits / ceiling), 1)


def demo() -> None:
    # --- The regression this module exists to prevent ----------------------
    # A posting that mentions none of these skills. Under substring matching
    # it scored 60% and offered Go, R and C as evidence.
    noise = "We are a Django shop. Great colleagues, good salary, career growth. Reach out!"
    assert posting_match_terms(noise, ["Go", "R", "C", "Java", "React"]) == []
    assert posting_match_score(noise, ["Go", "R", "C", "Java", "React"]) == 0.0
    # Single letters are the worst case and must stay clean.
    assert posting_match_terms("a career in commerce", ["C", "R", "E"]) == []
    # ...but a language really named with one letter still matches itself.
    assert posting_match_terms("strong R and SQL skills", ["R"]) == ["R"]
    # Prefix collisions between real technologies.
    assert posting_match_terms("JavaScript and TypeScript", ["Java"]) == []
    assert posting_match_terms("we run Django", ["Go"]) == []
    assert posting_match_terms("goal-oriented team", ["Go"]) == []

    # --- Aliases: the genuine matches substrings used to buy, bought back --
    assert posting_match_terms("we run postgres", ["PostgreSQL"]) == ["PostgreSQL"]
    assert posting_match_terms("PostgreSQL 15", ["Postgres"]) == ["Postgres"]
    assert posting_match_terms("k8s in production", ["Kubernetes"]) == ["Kubernetes"]
    assert posting_match_terms("Golang services", ["Go"]) == ["Go"]
    assert posting_match_terms("built in Node.js", ["Node"]) == ["Node"]
    assert posting_match_terms("C# and .NET", ["C#", ".NET"]) == ["C#", ".NET"]
    # `next` alone is an ordinary word and must not satisfy Next.js.
    assert posting_match_terms("the next candidate", ["Next.js"]) == []
    assert posting_match_terms("built on Next.js", ["Next.js"]) == ["Next.js"]

    # --- Sentence punctuation must not hide a token ------------------------
    # `.` is inside the token pattern for `node.js`, so an end-of-sentence word
    # arrives as `python.` and has to be stripped back.
    assert posting_match_terms("The stack is Python.", ["Python"]) == ["Python"]
    assert posting_match_terms("Ships with Node.js.", ["Node.js"]) == ["Node.js"]

    # --- Multi-word keywords match as phrases, not loose words -------------
    assert posting_match_terms("event-driven architecture", ["Event-driven architecture"]) == [
        "Event-driven architecture"
    ]
    # Both words present but not adjacent: not a match.
    assert posting_match_terms("architecture that is event driven by design", ["event architecture"]) == []

    # --- Arithmetic --------------------------------------------------------
    kws = ["Python", "FastAPI", "React"]
    assert keyword_overlap_score("we use python and react", kws) == 2 / 3
    assert keyword_overlap_score("anything", []) == 0.0
    assert keyword_overlap_score("", kws) == 0.0
    assert posting_match_terms("we use python and react", kws) == ["Python", "React"]
    assert posting_match_terms("nothing here", kws) == []
    # Case folding, and no double-counting a term the Stone repeats.
    assert posting_match_terms("python", ["Python", "python", "PYTHON"]) == ["Python"]
    # ...including via an alias, which is why dedupe is on the canonical form.
    assert posting_match_terms("postgres", ["Postgres", "PostgreSQL"]) == ["Postgres"]

    # Score is hits over a ceiling, capped at 100.
    assert posting_match_score("python fastapi react", kws) == 100.0
    assert posting_match_score("nothing here", kws) == 0.0
    assert posting_match_score("python", kws) == round(100 / 3, 1)
    many = [f"skill{i}" for i in range(50)]
    assert posting_match_score(" ".join(many), many) == 100.0
    # A blank entry must not become the denominator or a free hit.
    assert posting_match_score("python", ["Python", "  "]) == 100.0
    assert posting_match_score("nothing", ["  "]) == 0.0

    print("matching: all checks passed")


if __name__ == "__main__":
    demo()
