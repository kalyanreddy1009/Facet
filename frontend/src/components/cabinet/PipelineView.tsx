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
 * The backend already reports the funnel cumulatively ("reached this stage or
 * later"), which is exactly what makes stage-to-stage conversion meaningful
 * rather than double-counted. No API change: the same payload, read properly.
 *
 * It is also plain DOM. The chart it replaces pulled in ~150KB of recharts
 * behind a dynamic import for two SVG shapes.
 */

interface PipelineViewProps {
  funnel: DashboardSummary["funnel"];
  rejected: number;
}

const STAGES = [
  { key: "Cut", label: "Cut", hint: "tailored, not sent" },
  { key: "Set", label: "Set", hint: "actually sent" },
  { key: "Interviewing", label: "Interviewing", hint: "someone replied" },
  { key: "Offer", label: "Offer", hint: "they said yes" },
] as const;

export default function PipelineView({ funnel, rejected }: PipelineViewProps) {
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
        Nothing in the pipeline yet — cut a facet and set it.
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
                  ? "—"
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
              <div
                className="h-full rounded-md bg-accent-soft border border-accent-border transition-[width] duration-slower ease-emph"
                style={{ width: `${Math.max(row.share * 100, row.value > 0 ? 4 : 0)}%` }}
              />
            </div>
            <span className="w-8 text-right mono text-sm text-text tnum">{row.value}</span>
          </div>
        </div>
      ))}

      {rejected > 0 && (
        <p className="mt-4 pt-3 border-t border-border text-xs text-text-faint">
          <span className="tnum text-text-dim">{rejected}</span> rejected, and not counted above —
          a stage nobody reaches on purpose.
        </p>
      )}
    </div>
  );
}
