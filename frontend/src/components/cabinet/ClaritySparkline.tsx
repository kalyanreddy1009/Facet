"use client";

/**
 * Clarity score, over the facets you have cut.
 *
 * This was a 200px-tall recharts `LineChart` with a grid, two axes and a
 * tooltip — and it was the last thing in the app importing recharts, ~150KB
 * behind a dynamic import to draw one polyline. PipelineView and SendingTrend
 * had already been rewritten as plain DOM for the same reason; this is the
 * third and it takes the dependency out of the route entirely.
 *
 * The size came down with it, and that is a judgement about the number rather
 * than only about the bundle. "Is my clarity score trending up" is a mild
 * question with no action attached to either answer, and a full-width panelled
 * chart claimed the visual weight of something you should act on. It reads
 * better as what it is: a small line, next to the count it describes.
 *
 * Drawn on a fixed 0–100 domain, not a fitted one. Auto-fitting the y-axis to
 * the data turns a wobble between 71 and 74 into a dramatic climb, which is
 * the most common way a chart lies without a single wrong number in it.
 */

import type { DashboardSummary } from "@/lib/api";

const W = 160;
const H = 36;

export default function ClaritySparkline({
  trend,
}: {
  trend: DashboardSummary["clarity_score_trend"];
}) {
  const scores = trend.map((row) => row.ats_score).filter((s): s is number => s !== null);

  if (scores.length < 2) {
    // Keeps the label. Without it the sentence sits under "Offers 0" with no
    // subject, and a reader has to guess what needs two facets.
    return (
      <div className="flex flex-col gap-1.5">
        <span className="label">Clarity score</span>
        <p className="text-xs text-text-faint">
          Two facets needed before there&apos;s a trend to draw.
        </p>
      </div>
    );
  }

  // Fixed domain: 0 at the bottom, 100 at the top, whatever the data does.
  const points = scores
    .map((score, i) => {
      const x = (i / (scores.length - 1)) * W;
      const y = H - (Math.max(0, Math.min(100, score)) / 100) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const latest = scores[scores.length - 1];
  const first = scores[0];
  const delta = latest - first;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">Clarity score</span>
      <div className="flex items-end gap-3">
        <span className="mono text-2xl leading-none text-text tnum">{latest}</span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="overflow-visible"
          role="img"
          aria-label={`Clarity score across ${scores.length} facets, from ${first} to ${latest}, on a scale of 0 to 100`}
        >
          <polyline
            points={points}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <span className="text-xs text-text-faint tnum">
        {delta === 0
          ? `Flat across ${scores.length} facets`
          : `${delta > 0 ? "+" : ""}${delta} across ${scores.length} facets`}
      </span>
    </div>
  );
}
