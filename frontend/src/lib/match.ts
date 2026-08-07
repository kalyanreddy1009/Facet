/**
 * The local match pre-check, in the browser.
 *
 * This is a second implementation of `backend/services/matching.py`'s
 * `keyword_overlap_score`, and a second implementation of anything is a place
 * two answers can disagree. It exists anyway for one reason: the Cut page
 * scores the job description on every keystroke of what is often a 15,000
 * character paste, and a network round trip per keystroke is a worse answer
 * than shipping the vocabulary once and doing the arithmetic locally.
 *
 * The risk is handled rather than accepted — `match.check.ts` runs both this
 * and the Python original over the same fixtures and asserts they agree to the
 * digit. If someone changes the tokenizer on one side, the check fails.
 *
 * THE ALGORITHM — whole tokens, not substrings.
 *
 * Both sides used to join the text into one string and ask whether the keyword
 * appeared anywhere in it. That is a substring test, and it was wrong in a way
 * that got worse the shorter the keyword: `Go` matched *Django*, `R` matched
 * *career*, `Java` matched *JavaScript*, and `C` matched essentially every
 * posting ever written. A posting naming none of your skills could score 60%
 * and print three of them as evidence — which mattered more than an ordinary
 * inaccuracy, because the evidence line is the whole claim. It is a score you
 * can check, and checking it made it worse.
 *
 * So a keyword must now appear as a whole token, and a multi-word keyword as a
 * contiguous run of tokens. The genuine matches substring matching used to buy
 * — `postgres` for `postgresql`, `k8s` for `kubernetes` — are bought back by
 * name in ALIASES, which mirrors the Python map exactly.
 */

/** Mirrors `_TOKEN_RE`: `re.findall(r"[a-z0-9+#.]+", text.lower())`. */
const TOKEN_RE = /[a-z0-9+#.]+/g;

/** Mirrors `matching.ALIASES`. Variant -> canonical; anything unlisted is its
 *  own canonical form. Kept identical to the Python map — `match.check.ts`
 *  compares the two implementations over fixtures that exercise it. */
const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  node: "nodejs",
  "node.js": "nodejs",
  "react.js": "react",
  reactjs: "react",
  "vue.js": "vue",
  vuejs: "vue",
  "next.js": "nextjs",
  postgres: "postgresql",
  psql: "postgresql",
  mongo: "mongodb",
  elastic: "elasticsearch",
  k8s: "kubernetes",
  golang: "go",
  "c#": "csharp",
  "c++": "cpp",
  ".net": "dotnet",
  restful: "rest",
};

/** Mirrors `_tokenize`. Ordered, because a multi-word keyword is matched as a
 *  contiguous run — this cannot become a Set.
 *
 *  The trailing-dot strip is load-bearing and mirrors the Python exactly: `.`
 *  is inside the token pattern so `node.js` and `.net` survive whole, which
 *  also means a word ending a sentence arrives as `python.`. Substring
 *  matching hid that; whole-token matching would not. Leading dots stay,
 *  because `.net` is a name. */
function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(TOKEN_RE) ?? []) {
    const token = raw.replace(/\.+$/, "");
    if (token) out.push(ALIASES[token] ?? token);
  }
  return out;
}

export interface MatchResult {
  /** Fraction of the candidate's terms found, 0–1. The same number the
   *  backend's pre-check compares against its weak-match threshold. */
  score: number;
  /** The terms that hit, in the order they appear in the profile. Evidence:
   *  a percentage on its own is a number to distrust, and this is the fastest
   *  way to see a score inflated by one stray word. */
  hits: string[];
  /** Terms the posting never mentions. Not "missing skills" — the posting may
   *  simply be about something else — so the UI calls them "not mentioned". */
  misses: string[];
}

/** Below this the backend flags the cut as a weak match. Kept in step with
 *  `WEAK_MATCH_THRESHOLD` in routers/tailor.py, and asserted in the check.
 *
 *  Deliberately unchanged when substring matching went away. Measured rather
 *  than assumed: over 670 real postings, the old matcher cleared 8 at this
 *  threshold and the new one clears 7, so the cut point still sits in the same
 *  place. See `backend/scripts/calibrate_matching.py`. */
export const WEAK_MATCH_THRESHOLD = 0.15;

export function matchAgainst(text: string, keywords: string[]): MatchResult {
  if (keywords.length === 0) return { score: 0, hits: [], misses: [] };

  const tokens = tokenize(text);
  const unique = new Set(tokens);

  const mentions = (needle: string[]): boolean => {
    if (needle.length === 0) return false;
    if (needle.length === 1) return unique.has(needle[0]);
    // Cheap reject before the scan: every part must be present at all.
    if (!needle.every((part) => unique.has(part))) return false;
    for (let i = 0; i + needle.length <= tokens.length; i++) {
      if (needle.every((part, j) => tokens[i + j] === part)) return true;
    }
    return false;
  };

  const hits: string[] = [];
  const misses: string[] = [];

  for (const keyword of keywords) {
    const needle = tokenize(keyword);
    if (needle.length === 0) continue;
    (mentions(needle) ? hits : misses).push(keyword);
  }

  // The denominator is EVERY keyword, including blank ones.
  //
  // That is a quirk, and it is the backend's quirk: `keyword_overlap_score`
  // skips an empty term when counting hits but still divides by the full
  // length, so a stray blank entry in someone's Stone depresses every score
  // very slightly. Mirroring it is deliberate. The alternative — quietly being
  // more correct here — puts a number on screen that disagrees with the one
  // the server used to decide whether to warn about a weak match, and a page
  // arguing with its own backend is worse than a page with a rounding quirk.
  // If it is ever worth fixing, it should be fixed in matching.py first and
  // this line follows; the check compares the two and will say so.
  return { score: hits.length / keywords.length, hits, misses };
}
