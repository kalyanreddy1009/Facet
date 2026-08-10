"use client";

/** v2's live match pre-check — same `lib/match.ts` scorer as v1's
 *  `components/tailor/MatchPreflight.tsx`, flat-panel styling. */

import { useMemo } from "react";
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { WEAK_MATCH_THRESHOLD, matchAgainst } from "@/lib/match";

const SHOWN = 8;

export default function MatchPreflight({
  jobDescription,
  keywords,
}: {
  jobDescription: string;
  keywords: string[] | null;
}) {
  const result = useMemo(
    () => matchAgainst(jobDescription, keywords ?? []),
    [jobDescription, keywords]
  );

  if (!keywords || keywords.length === 0 || jobDescription.trim().length < 120) return null;

  const percent = Math.round(result.score * 100);
  const weak = result.score < WEAK_MATCH_THRESHOLD;
  const strong = result.score >= 0.45;
  const Icon = weak ? CircleAlert : strong ? CircleCheck : CircleDashed;
  const tone = weak ? "var(--v2-warn)" : strong ? "var(--v2-ok)" : "var(--v2-text-faint)";

  return (
    <div
      className="v2-panel-tight v2-panel v2-sans flex items-start gap-2.5"
      role="status"
      aria-live="polite"
      style={{ borderColor: weak ? "var(--v2-warn)" : strong ? "var(--v2-ok)" : "var(--v2-border)" }}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: tone }} aria-hidden />
      <div className="min-w-0 flex flex-col gap-1">
        <p className="text-sm" style={{ color: "var(--v2-text)" }}>
          <span className="v2-mono font-semibold">{percent}%</span>{" "}
          of your Stone&apos;s terms appear in this posting
          {weak && <span style={{ color: "var(--v2-warn)" }}> — thin, but you can still cut it</span>}
        </p>
        {result.hits.length > 0 && (
          <p className="text-xs" style={{ color: "var(--v2-text-faint)" }}>
            <span className="v2-mono">Matches</span>{" "}
            <span style={{ color: "var(--v2-text-dim)" }}>{result.hits.slice(0, SHOWN).join(" · ")}</span>
            {result.hits.length > SHOWN && (
              <span className="v2-mono" title={result.hits.slice(SHOWN).join(", ")}>
                {" "}
                +{result.hits.length - SHOWN} more
              </span>
            )}
          </p>
        )}
        {weak && (
          <p className="text-xs text-pretty" style={{ color: "var(--v2-text-faint)" }}>
            Facet will still only claim what your Stone supports, so a thin overlap usually means a
            shorter resume rather than a worse one.
          </p>
        )}
      </div>
    </div>
  );
}
