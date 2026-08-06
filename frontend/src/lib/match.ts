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
 * The algorithm, deliberately unclever: split the text into tokens of letters,
 * digits and the few punctuation marks that appear inside real technology
 * names (`c++`, `c#`, `node.js`), join them back into one haystack, and count
 * how many of the candidate's terms appear in it as substrings. Substring, not
 * whole token, is what lets "postgres" match "postgresql" — and it is also why
 * this is a *hint* and never a gate.
 */

/** Mirrors `_tokenize`: `re.findall(r"[a-z0-9+#.]+", text.lower())`. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [];
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
 *  `WEAK_MATCH_THRESHOLD` in routers/tailor.py, and asserted in the check. */
export const WEAK_MATCH_THRESHOLD = 0.15;

export function matchAgainst(text: string, keywords: string[]): MatchResult {
  if (keywords.length === 0) return { score: 0, hits: [], misses: [] };

  const haystack = tokenize(text).join(" ");
  const hits: string[] = [];
  const misses: string[] = [];

  for (const keyword of keywords) {
    const needle = keyword.toLowerCase().trim();
    if (!needle) continue;
    (haystack.includes(needle) ? hits : misses).push(keyword);
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
