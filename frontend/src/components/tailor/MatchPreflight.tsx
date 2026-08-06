"use client";

/**
 * IMPROVEMENT 1 — the pre-check, moved in front of the cut.
 *
 * Facet already scored the posting against your Stone before running agy, and
 * already warned when the overlap was thin. It just did it *after* you pressed
 * the button and waited up to five minutes, which is the wrong end of the
 * transaction: by the time the warning arrived you had already spent the run.
 *
 * This is the same score, computed as you paste, with the evidence attached.
 * The percentage on its own would be a number to distrust — what makes it
 * usable is the list of your own terms the posting actually mentions, because
 * that is what tells you whether 60% means "genuinely a fit" or "one stray
 * word matched five times".
 *
 * It never blocks. A low score is a legitimate reason to cut anyway — you may
 * be changing field, and the whole point of a tailored application is to argue
 * for a role your resume does not already obviously fit.
 */

import { useMemo } from "react";
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { WEAK_MATCH_THRESHOLD, matchAgainst } from "@/lib/match";

/** How many matched terms to name before collapsing to a count. Enough to
 *  judge the score by, few enough to stay one line on a phone. */
const SHOWN = 8;

export default function MatchPreflight({
  jobDescription,
  keywords,
}: {
  jobDescription: string;
  keywords: string[] | null;
}) {
  // Recomputed on every keystroke of what may be a 15,000-character paste, so
  // it is memoised on the two things it actually depends on. The work is a
  // regex and a set of substring tests — cheap, but not free at that size.
  const result = useMemo(
    () => matchAgainst(jobDescription, keywords ?? []),
    [jobDescription, keywords]
  );

  // Nothing to say yet. A score computed from two words of a job description
  // is noise, and showing 0% while someone is still pasting reads as a verdict
  // rather than as "not enough to go on".
  if (!keywords || keywords.length === 0 || jobDescription.trim().length < 120) return null;

  const percent = Math.round(result.score * 100);
  const weak = result.score < WEAK_MATCH_THRESHOLD;
  const strong = result.score >= 0.45;
  const Icon = weak ? CircleAlert : strong ? CircleCheck : CircleDashed;

  return (
    <div
      className={`preflight ${weak ? "preflight-weak" : strong ? "preflight-strong" : ""}`}
      role="status"
      aria-live="polite"
    >
      <Icon
        className={`w-4 h-4 shrink-0 ${
          weak ? "text-warn-text" : strong ? "text-ok-text" : "text-text-faint"
        }`}
        aria-hidden
      />
      <div className="min-w-0 flex flex-col gap-1">
        <p className="text-sm text-text">
          {/* The explicit space matters: JSX drops whitespace that falls at
              the end of a line, and without it this rendered as "69%of". */}
          <span className="mono tnum font-semibold">{percent}%</span>{" "}
          of your Stone&apos;s terms appear in this posting
          {weak && <span className="text-warn-text"> — thin, but you can still cut it</span>}
        </p>
        {result.hits.length > 0 && (
          <p className="text-xs text-text-faint">
            <span className="label">Matches</span>{" "}
            <span className="text-text-dim">{result.hits.slice(0, SHOWN).join(" · ")}</span>
            {result.hits.length > SHOWN && (
              <span className="tnum" title={result.hits.slice(SHOWN).join(", ")}>
                {" "}
                +{result.hits.length - SHOWN} more
              </span>
            )}
          </p>
        )}
        {weak && (
          <p className="text-xs text-text-faint text-pretty">
            Facet will still only claim what your Stone supports, so a thin overlap usually means a
            shorter resume rather than a worse one.
          </p>
        )}
      </div>
    </div>
  );
}
