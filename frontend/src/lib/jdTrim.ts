/**
 * IMPROVEMENT 4 — trimming the boilerplate out of a job description.
 *
 * The Cut page caps a description at 15,000 characters, and the cap is real:
 * past it the end of the posting is dropped, which is usually where the
 * requirements live. The page already says so out loud. What it could not do
 * was help.
 *
 * Most postings that blow the cap are not 15,000 characters of role. They are
 * four thousand characters of role followed by benefits, equal-opportunity
 * statements, legal notices, and a paragraph about the company's values —
 * none of which the tailoring pass has any use for, because none of it
 * describes what the job needs.
 *
 * So this finds those sections and offers to remove them. It is offered, never
 * applied: a heading this recognises might genuinely be the substance of the
 * posting, the person pasting is the one who can tell, and silently editing
 * someone's input is exactly the kind of thing this product does not do.
 *
 * The heuristic is deliberately conservative — a heading has to be short, sit
 * on its own line, and match one of the known section names. A line that
 * merely mentions "benefits" in a sentence is not a heading and is left alone.
 */

/** Section headings whose content is boilerplate for tailoring purposes.
 *  Ordered roughly by how often they appear at the foot of a posting. */
const BOILERPLATE = [
  "benefits",
  "what we offer",
  "what's in it for you",
  "whats in it for you",
  "perks",
  "perks and benefits",
  "our benefits",
  "compensation and benefits",
  "equal opportunity",
  "equal opportunity employer",
  "equal employment opportunity",
  "eeo statement",
  "diversity and inclusion",
  "diversity, equity and inclusion",
  "our commitment to diversity",
  "legal",
  "legal notice",
  "privacy notice",
  "privacy policy",
  "data protection",
  "about us",
  "about the company",
  "who we are",
  "our values",
  "our culture",
  "life at",
  "how to apply",
  "application process",
  "disclaimer",
];

/** A heading is short, alone on its line, and not a sentence. Twelve words is
 *  generous for a heading and still excludes almost every prose line. */
const MAX_HEADING_WORDS = 12;

function isHeading(line: string): string | null {
  const bare = line
    .trim()
    .replace(/^[#*\-–—•\d.)\s]+/, "")
    .replace(/[:：]\s*$/, "")
    .trim();
  if (!bare || bare.split(/\s+/).length > MAX_HEADING_WORDS) return null;
  const lower = bare.toLowerCase();
  for (const name of BOILERPLATE) {
    // Exact, or the heading starts with the name — "Benefits & Perks" counts,
    // "We think benefits matter" does not, because it is a sentence and fails
    // either the word count or the prefix test.
    if (lower === name || lower.startsWith(name + " ") || lower.startsWith(name + ":")) {
      return bare;
    }
  }
  // "Life at Acme" — the only entry that needs a prefix rather than a whole
  // match, handled above by the startsWith on "life at".
  return null;
}

export interface TrimResult {
  /** The description with recognised boilerplate sections removed. */
  text: string;
  /** The headings that were removed, in document order — shown to the user so
   *  the offer names what it would take out rather than just a byte count. */
  removed: string[];
  /** Characters saved. */
  saved: number;
}

/**
 * Remove recognised boilerplate sections.
 *
 * A section runs from its heading to the next heading-shaped line, so removing
 * "Benefits" takes the list under it too. A boilerplate heading at the very
 * end removes everything after it, which is the common case.
 */
export function trimBoilerplate(text: string): TrimResult {
  const lines = text.split(/\r?\n/);
  const keep: string[] = [];
  const removed: string[] = [];
  let dropping = false;

  for (const line of lines) {
    const heading = isHeading(line);
    if (heading) {
      dropping = true;
      removed.push(heading);
      continue;
    }
    // Any other short, title-ish line ends the dropped section. Without this a
    // "Benefits" heading halfway up a posting would swallow the requirements
    // below it — which would be far worse than not trimming at all.
    if (dropping && looksLikeAnyHeading(line)) dropping = false;
    if (!dropping) keep.push(line);
  }

  // Collapse the runs of blank lines a removal leaves behind.
  const out = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: out, removed, saved: Math.max(0, text.length - out.length) };
}

/** Six, not twelve.
 *
 *  This is the limit for deciding that some *other* line is a heading and
 *  therefore ends a dropped section. It has to be much stricter than the limit
 *  for recognising a known boilerplate heading, because the failure modes are
 *  not symmetrical. Too strict and a section runs on a little further than it
 *  should; too loose and an ordinary sentence ends the section early, leaving
 *  the boilerplate in.
 *
 *  At twelve, the first line of a wrapped EEO paragraph — "We are committed to
 *  building a diverse team and welcome applications from" — is exactly twelve
 *  words, starts with a capital and ends without punctuation, so it read as a
 *  heading and the paragraph survived the trim. Six excludes it and every
 *  other wrapped prose line, while still admitting every real heading a job
 *  posting uses: Requirements, Nice to have, About us, What you'll do.
 */
const MAX_GENERIC_HEADING_WORDS = 6;

/** Any line that reads as a heading: short, no terminal punctuation, and not
 *  a bullet. Used only to decide where a dropped section ends. */
function looksLikeAnyHeading(line: string): boolean {
  const bare = line.trim();
  if (!bare || bare.length > 60) return false;
  if (/^[-–—•*]/.test(bare)) return false;
  if (/[.,;]$/.test(bare)) return false;
  const words = bare.replace(/^#+\s*/, "").split(/\s+/);
  if (words.length > MAX_GENERIC_HEADING_WORDS) return false;
  // A heading is usually Title Case, ALL CAPS, or markdown-hashed.
  return (
    /^#/.test(bare) ||
    bare === bare.toUpperCase() ||
    /^[A-Z]/.test(bare) ||
    /[:：]$/.test(bare)
  );
}
