"use client";

import type { StatusSample } from "@/lib/useStatus";

/**
 * Every poll this session, oldest on the left.
 *
 * The page had no memory at all before this: each figure was a snapshot, so a
 * backend that failed one poll in six looked identical to one that had never
 * failed — you had to be watching at the exact second it happened. A row of
 * bars is the smallest thing that answers "has this been steady?", which is
 * the question a status page is actually opened with.
 *
 * Height encodes how long the report took to build, on a fixed 0–600ms
 * domain rather than one fitted to the data. Fitting would turn a flat 40ms
 * session into a dramatic mountain range — the most common way a chart lies
 * with no wrong number in it, and the same call ClaritySparkline makes.
 *
 * Colour encodes the outcome, so the two readings are independent: a tall
 * green bar is slow-but-healthy, a red stub is a poll that never answered.
 */

const FLOOR = 0.18; // a healthy 8ms report still needs to be visible as a bar
const CEILING_MS = 600;

const TONE: Record<string, string> = {
  operational: "bg-ok",
  degraded: "bg-warn",
  down: "bg-danger",
  failed: "bg-danger",
};

function label(sample: StatusSample): string {
  const at = new Date(sample.at).toLocaleTimeString(undefined, { hour12: false });
  if (!sample.overall) return `${at} - no answer`;
  return `${at} - ${sample.overall}, ${Math.round(sample.durationMs)} ms`;
}

export default function HealthRibbon({ samples }: { samples: StatusSample[] }) {
  if (samples.length < 2) {
    // One bar is not a history, and a lone bar next to "Recent polls" reads as
    // a broken chart rather than as a session that has only just started.
    return (
      <p className="text-xs text-text-faint">
        Watching. A second poll draws the first stretch of history.
      </p>
    );
  }

  const failed = samples.filter((s) => !s.overall).length;
  const answered = samples.filter((s) => s.overall);
  const slowest = answered.reduce((m, s) => Math.max(m, s.durationMs), 0);

  return (
    <div className="flex flex-col gap-2">
      {/* Capped width, left aligned. Bars that share the full width evenly
          are 250px each at the start of a session, which reads as three
          stacked blocks rather than as a history with a direction — and then
          silently reflows to something else entirely as the session fills
          up. A fixed ceiling means the ribbon grows rightward from the same
          shape it started in. */}
      <div className="flex items-end justify-start gap-[2px] h-10" role="img" aria-label={
        `${samples.length} polls this session, ${failed} without an answer, slowest ${Math.round(slowest)} milliseconds`
      }>
        {samples.map((sample, i) => {
          const scale = sample.overall
            ? FLOOR + (1 - FLOOR) * Math.min(sample.durationMs / CEILING_MS, 1)
            : 1;
          return (
            <span
              key={sample.at}
              /* `ribbon-bar` grows from the baseline as it arrives, so the
                 newest poll is visible as an event rather than appearing
                 already-drawn among forty identical siblings. */
              className={`ribbon-bar flex-1 min-w-[3px] max-w-[12px] rounded-sm ${
                TONE[sample.overall ?? "failed"]
              } ${sample.overall ? "" : "ribbon-bar-failed"}`}
              style={{ height: `${(scale * 100).toFixed(1)}%`, "--i": i } as React.CSSProperties}
              title={label(sample)}
            />
          );
        })}
      </div>
      <p className="text-xs text-text-faint tnum">
        {samples.length} poll{samples.length === 1 ? "" : "s"} this session
        {failed > 0 ? ` · ${failed} without an answer` : " · all answered"}
        {answered.length > 0 ? ` · slowest ${Math.round(slowest)} ms` : ""}
      </p>
    </div>
  );
}
