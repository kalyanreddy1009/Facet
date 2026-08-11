"use client";

import { ArrowDown } from "lucide-react";
import type { DashboardSummary } from "@/lib/api";

/**
 * Where applications actually are, and where they stop.
 *
 * This replaces a recharts funnel — four tapering bars restating four numbers
 * that were already printed beside them. A funnel looks like analysis and
 * isn't: it shows the counts you have, in an order you already know, and
 * answers nothing you would open the Cabinet to ask.
 *
 * The question worth answering is where applications *die*. So each stage
 * shows its count, the share of the previous stage that survived into it, and
 * — when that share is the weakest link in the chain — says so. Sending
 * twenty applications and getting two interviews is not a "funnel"; it is a
 * 10% conversion at one specific step, and knowing which step is the whole
 * point.
 *
 * The backend reports the funnel cumulatively ("reached this stage or later"),
 * which is exactly what makes stage-to-stage conversion meaningful rather than
 * double-counted. It now derives that from recorded status history rather than
 * from the current status alone, which is what lets a rejection be counted at
 * the stage it actually reached — so these conversion rates finally include
 * the outcomes they were previously computed without.
 *
 * It is also plain DOM. The chart it replaces pulled in ~150KB of recharts
 * behind a dynamic import for two SVG shapes.
 */

interface PipelineViewProps {
  funnel: DashboardSummary["funnel"];
  rejected: number;
  /** Where the rejections happened, keyed by the furthest stage reached.
   *  `unknown` is a real key — applications rejected before status history
   *  existed cannot say where they died. */
  rejectedFrom: DashboardSummary["rejected_from"];
}

const STAGES = [
  { key: "Cut", label: "Cut", hint: "tailored, not sent" },
  { key: "Set", label: "Set", hint: "actually sent" },
  { key: "Interviewing", label: "Interviewing", hint: "someone replied" },
  { key: "Offer", label: "Offer", hint: "they said yes" },
] as const;

export default function PipelineView({ funnel, rejected, rejectedFrom }: PipelineViewProps) {
  const top = funnel.Cut || 1;

  const rows = STAGES.map((stage, i) => {
    const value = funnel[stage.key];
    const previous = i === 0 ? null : funnel[STAGES[i - 1].key];
    // A conversion is only meaningful when something reached the stage above.
    const rate = previous && previous > 0 ? value / previous : null;
    return { ...stage, value, rate, share: value / top };
  });

  // The weakest surviving step — the one worth doing something about. Stages
  // that nothing has reached yet are not "0% conversion", they are unknown,
  // and calling them the bottleneck would be a lie told confidently.
  const measurable = rows.filter((row) => row.rate !== null && (row.value > 0 || row.rate < 1));
  const worst =
    measurable.length > 0
      ? measurable.reduce((low, row) => (row.rate! < low.rate! ? row : low))
      : null;

  if (funnel.Cut === 0) {
    return (
      <p className="text-sm text-text-faint py-10 text-center">
        Nothing in the pipeline yet - cut a facet and set it.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {rows.map((row, i) => (
        <div key={row.key}>
          {/* The gap between stages carries the conversion, because that is
              where the loss happens — putting it on the stage itself invites
              reading it as a property of the stage. */}
          {i > 0 && (
            <div className="flex items-center gap-2 pl-1 py-1.5">
              <ArrowDown className="w-3 h-3 text-text-ghost shrink-0" aria-hidden />
              <span
                className={`text-xs tnum ${
                  worst?.key === row.key ? "text-warn-text font-medium" : "text-text-faint"
                }`}
              >
                {row.rate === null
                  ? "-"
                  : `${Math.round(row.rate * 100)}% carried through${
                      worst?.key === row.key && row.rate < 1 ? " · weakest step" : ""
                    }`}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="w-28 shrink-0">
              <p className="text-sm font-medium text-text">{row.label}</p>
              <p className="text-xs text-text-faint">{row.hint}</p>
            </div>
            {/* The bar is proportional to the top of the pipeline, so the
                shape of the loss is visible at a glance without any of the
                distortion a tapering funnel introduces. */}
            <div className="flex-1 h-7 rounded-md bg-surface-3 overflow-hidden">
              {/* A solid fill rather than a tint: at 7px tall over a tinted
                  track, a 10%-alpha bar is a suggestion of a bar. */}
              <div
                className="h-full rounded-md shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] transition-[width] duration-slower ease-emph"
                style={{
                  width: `${Math.max(row.share * 100, row.value > 0 ? 4 : 0)}%`,
                  background: "linear-gradient(to bottom, var(--accent-hover), var(--accent-press))",
                }}
              />
            </div>
            <span className="w-8 text-right mono text-sm text-text tnum">{row.value}</span>
          </div>
        </div>
      ))}

      {rejected > 0 && (
        /* This used to read "rejected, and not counted above". That was true,
           and it was the problem: the backend had no status history, so a
           rejected row could not say which stage it died at and had to be
           dropped from the funnel entirely — which quietly removed the worst
           outcomes from every conversion rate. `application_events` fixed
           that, so rejections now sit inside the numbers above and this line
           says where they happened instead of apologising for their absence. */
        <div className="mt-4 pt-3 border-t border-border">
          <p className="text-xs text-text-faint">
            <span className="tnum text-text-dim">{rejected}</span>{" "}
            {rejected === 1 ? "rejection" : "rejections"}, counted at the stage each one reached
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {/* Ordered by the pipeline, not by count: "where do they die"
                reads along the process, and sorting by size would reshuffle
                the list every time a single application moved. */}
            {[...STAGES.map((s) => s.label), "unknown"]
              .filter((stage) => rejectedFrom[stage] > 0)
              .map((stage) => (
                <li key={stage} className="text-xs text-text-faint">
                  <span className="tnum text-text-dim">{rejectedFrom[stage]}</span>{" "}
                  {stage === "unknown" ? (
                    /* Not a stage — the honest name for a row that was already
                       rejected before any of this was recorded. Saying "Cut"
                       here would be inventing a fact to avoid a gap. */
                    <span title="Rejected before status history was recorded">
                      stage not recorded
                    </span>
                  ) : (
                    `at ${stage}`
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
