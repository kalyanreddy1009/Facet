"use client";

/**
 * Is this getting better?
 *
 * The Cabinet answered "where does everything stand" and never "is it moving".
 * Those are different questions and the second is the one that keeps someone
 * going: a job hunt is months long, the daily signal is mostly silence, and a
 * pipeline snapshot on a bad week looks identical to a pipeline snapshot on a
 * good one.
 *
 * So: applications sent per week, over the last eight. Bars, not a line — a
 * line implies a continuous quantity moving between its readings, and "four
 * applications in the week of the 3rd" is a count, not a sample of something
 * flowing. Nothing is smoothed, interpolated or projected. A week with no
 * applications is drawn as a week with no applications, because a flat gap is
 * the honest picture of a week you did not send anything and softening it
 * would be the one thing this product refuses to do.
 *
 * Built from `clarity_score_trend`, which carries a `created_at` per
 * application. No new endpoint: the data was already on the wire, unused.
 */

import { useMemo } from "react";
import type { DashboardSummary } from "@/lib/api";

const WEEKS = 8;
const DAY = 86_400_000;

interface Bucket {
  /** Monday of the week, for the label. */
  start: Date;
  count: number;
}

/** The last eight weeks, oldest first, including the empty ones. */
function bucketByWeek(rows: DashboardSummary["clarity_score_trend"]): Bucket[] {
  const now = new Date();
  // Monday of the current week, local time.
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  const buckets: Bucket[] = Array.from({ length: WEEKS }, (_, i) => ({
    start: new Date(monday.getTime() - (WEEKS - 1 - i) * 7 * DAY),
    count: 0,
  }));
  const floor = buckets[0].start.getTime();

  for (const row of rows) {
    const at = new Date(row.created_at).getTime();
    if (!Number.isFinite(at) || at < floor) continue;
    const index = Math.floor((at - floor) / (7 * DAY));
    if (index >= 0 && index < WEEKS) buckets[index].count += 1;
  }
  return buckets;
}

export default function SendingTrend({ summary }: { summary: DashboardSummary }) {
  const buckets = useMemo(
    () => bucketByWeek(summary.clarity_score_trend ?? []),
    [summary.clarity_score_trend]
  );

  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const peak = Math.max(1, ...buckets.map((b) => b.count));

  // Two weeks of data is not a trend, and drawing one from it would be the
  // chart asserting something the numbers cannot support.
  const weeksWithActivity = buckets.filter((b) => b.count > 0).length;
  if (total === 0) {
    return (
      <Panel>
        <p className="label mb-2">Sent per week</p>
        <p className="text-sm text-text-faint text-pretty">
          Nothing sent in the last eight weeks. This fills in once you mark a facet as Set —
          the point at which you have actually applied.
        </p>
      </Panel>
    );
  }

  const recent = buckets.slice(-4).reduce((s, b) => s + b.count, 0);
  const prior = buckets.slice(0, 4).reduce((s, b) => s + b.count, 0);

  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <p className="label">Sent per week</p>
        <p className="mono text-2xs text-text-ghost tnum">last {WEEKS} weeks</p>
      </div>

      {/* Bars drawn in CSS rather than through recharts. Eight values with no
          axes, no tooltip and no interaction do not need a charting library's
          SVG layer, and the whole component stays under one repaint. */}
      <div className="flex items-end gap-1.5 h-24" role="img"
        aria-label={`Applications sent per week over the last ${WEEKS} weeks: ${buckets
          .map((b) => `${b.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${b.count}`)
          .join(", ")}`}
      >
        {buckets.map((bucket) => (
          <div key={bucket.start.toISOString()} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
            <span className="mono text-2xs text-text-ghost tnum leading-none">
              {bucket.count || ""}
            </span>
            <div
              className={`w-full rounded-t ${bucket.count ? "trend-bar" : "trend-bar-empty"}`}
              style={{ height: `${Math.max(bucket.count ? 6 : 2, (bucket.count / peak) * 100)}%` }}
            />
            <span className="mono text-2xs text-text-ghost leading-none truncate w-full text-center">
              {bucket.start.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            </span>
          </div>
        ))}
      </div>

      {/* The comparison, stated only when there is enough to compare. Four
          weeks against four weeks — halves of the window, not a rolling
          average, because a rolling average over eight points is a smoothing
          that hides exactly the fortnight you stopped. */}
      <p className="text-xs text-text-dim mt-3 text-pretty">
        {weeksWithActivity < 3 ? (
          <>
            <span className="tnum">{total}</span> sent so far. Two or three weeks is not yet a
            trend, so there is nothing here to read into.
          </>
        ) : recent > prior ? (
          <>
            <span className="tnum text-ok-text">{recent}</span> in the last four weeks against{" "}
            <span className="tnum">{prior}</span> in the four before. You are sending more.
          </>
        ) : recent < prior ? (
          <>
            <span className="tnum">{recent}</span> in the last four weeks against{" "}
            <span className="tnum">{prior}</span> in the four before. The rate has dropped.
          </>
        ) : (
          <>
            <span className="tnum">{recent}</span> in each half of the window. Steady.
          </>
        )}
      </p>
    </Panel>
  );
}

/** Local wrapper so the empty and populated states share one shell. */
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel p-5">{children}</div>;
}
