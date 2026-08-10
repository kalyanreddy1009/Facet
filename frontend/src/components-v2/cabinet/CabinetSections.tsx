"use client";

/**
 * v2's Cabinet body — same four sections as v1
 * (frontend/src/app/cabinet/PageClient.tsx): what needs you, where things
 * stand, is it moving, interviews. All plain DOM/SVG in v1 already (no
 * recharts left in the Cabinet), so it's ported directly with v2 tokens
 * instead of forked chart logic.
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, CalendarPlus, CalendarX, CheckCircle2 } from "lucide-react";
import type { Application, Contact, DashboardSummary, Interview } from "@/lib/api";
import { parseDate } from "@/lib/format";

const DAY = 86_400_000;

function daysAgo(value: string, now: number): number {
  const date = parseDate(value);
  if (!date) return 0;
  return Math.max(0, Math.floor((now - date.getTime()) / DAY));
}

function daysUntil(date: Date, now: number): string {
  const days = Math.round((date.getTime() - now) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/* ---------------------------------------------------------- ActionQueue */

type Row = { id: string; rank: number; kind: string; title: string; detail: string; action: React.ReactNode };

export function ActionQueue({
  followups,
  unsent,
  interviews,
  applicationsById,
  onUpdateStatus,
  hasSentAnything,
}: {
  followups: Application[];
  unsent: Application[];
  interviews: Interview[];
  applicationsById: Map<number, Application>;
  onUpdateStatus: (id: number, status: Application["status"]) => void;
  hasSentAnything: boolean;
}) {
  const [now] = useState(() => Date.now());
  const rows: Row[] = [];

  for (const interview of interviews) {
    const when = parseDate(interview.scheduled_at);
    if (!when || when.getTime() < now) continue;
    const application = applicationsById.get(interview.application_id);
    if (!application) continue;
    rows.push({
      id: `interview-${interview.id}`,
      rank: when.getTime(),
      kind: "Interview",
      title: `${application.company} · ${interview.round_name || "Interview"}`,
      detail: `${daysUntil(when, now)} — ${when.toLocaleString()}`,
      action: (
        <Link href="#interviews" className="v2-btn">
          <CalendarPlus className="w-3.5 h-3.5" aria-hidden />
          Details
        </Link>
      ),
    });
  }

  for (const application of followups) {
    const days = daysAgo(application.updated_at, now);
    rows.push({
      id: `followup-${application.id}`,
      rank: Number.MAX_SAFE_INTEGER - 1_000_000 - days,
      kind: "Silent",
      title: `${application.company} · ${application.role_title}`,
      detail: `Sent ${days} days ago, no reply`,
      action: (
        <>
          <button type="button" className="v2-btn" onClick={() => onUpdateStatus(application.id, "Interviewing")}>
            Interviewing
          </button>
          <button type="button" className="v2-btn" onClick={() => onUpdateStatus(application.id, "Rejected")}>
            Rejected
          </button>
        </>
      ),
    });
  }

  for (const application of unsent) {
    rows.push({
      id: `unsent-${application.id}`,
      rank: Number.MAX_SAFE_INTEGER,
      kind: "Not sent",
      title: `${application.company} · ${application.role_title}`,
      detail:
        application.ats_score !== null
          ? `Cut, never sent · clarity ${application.ats_score}`
          : "Cut, never sent",
      action: (
        <button type="button" className="v2-btn v2-btn-primary" onClick={() => onUpdateStatus(application.id, "Set")}>
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
          Mark as sent
        </button>
      ),
    });
  }

  rows.sort((a, b) => a.rank - b.rank);

  return (
    <section aria-labelledby="waiting-heading">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 id="waiting-heading" className="v2-h2">
          Waiting on you
        </h2>
        {rows.length > 0 && (
          <span className="v2-mono text-xs text-[var(--v2-text-faint)]">
            {rows.length} {rows.length === 1 ? "item" : "items"}
          </span>
        )}
      </div>

      <div className="v2-panel">
        {rows.length === 0 ? (
          <p className="v2-sans text-sm text-[var(--v2-text-faint)] text-pretty">
            {hasSentAnything
              ? "Nothing waiting on you — everything you've cut has been sent, and nothing has gone quiet long enough to chase."
              : "Nothing waiting on you yet. Cut a facet on The Rough and it will show up here until you've sent it."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li key={row.id} className="v2-row flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="v2-sans text-sm text-[var(--v2-text)] truncate">
                    <span className="v2-label inline mr-2">{row.kind}</span>
                    {row.title}
                  </p>
                  <p className="v2-mono text-xs text-[var(--v2-text-faint)] mt-0.5">{row.detail}</p>
                </div>
                <div className="flex gap-2 shrink-0">{row.action}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- StatNumber */

export function StatNumber({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="v2-label">{label}</span>
      <span className="v2-mono text-2xl leading-none text-[var(--v2-text)]">{value}</span>
      {hint && <span className="v2-sans text-xs text-[var(--v2-text-faint)] mt-0.5">{hint}</span>}
    </div>
  );
}

/* ---------------------------------------------------------- ClaritySparkline */

export function ClaritySparkline({ trend }: { trend: DashboardSummary["clarity_score_trend"] }) {
  const W = 160;
  const H = 36;
  const scores = trend.map((row) => row.ats_score).filter((s): s is number => s !== null);

  if (scores.length < 2) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="v2-label">Clarity score</span>
        <p className="v2-sans text-xs text-[var(--v2-text-faint)]">
          Two facets needed before there&apos;s a trend to draw.
        </p>
      </div>
    );
  }

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
      <span className="v2-label">Clarity score</span>
      <div className="flex items-end gap-3">
        <span className="v2-mono text-2xl leading-none text-[var(--v2-text)]">{latest}</span>
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
            stroke="var(--v2-accent)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <span className="v2-mono text-xs text-[var(--v2-text-faint)]">
        {delta === 0
          ? `Flat across ${scores.length} facets`
          : `${delta > 0 ? "+" : ""}${delta} across ${scores.length} facets`}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------- Pipeline */

const STAGES = [
  { key: "Cut", label: "Cut", hint: "tailored, not sent" },
  { key: "Set", label: "Set", hint: "actually sent" },
  { key: "Interviewing", label: "Interviewing", hint: "someone replied" },
  { key: "Offer", label: "Offer", hint: "they said yes" },
] as const;

export function PipelineView({
  funnel,
  rejected,
  rejectedFrom,
}: {
  funnel: DashboardSummary["funnel"];
  rejected: number;
  rejectedFrom: DashboardSummary["rejected_from"];
}) {
  const top = funnel.Cut || 1;

  const rows = STAGES.map((stage, i) => {
    const value = funnel[stage.key];
    const previous = i === 0 ? null : funnel[STAGES[i - 1].key];
    const rate = previous && previous > 0 ? value / previous : null;
    return { ...stage, value, rate, share: value / top };
  });

  const measurable = rows.filter((row) => row.rate !== null && (row.value > 0 || row.rate < 1));
  const worst =
    measurable.length > 0 ? measurable.reduce((low, row) => (row.rate! < low.rate! ? row : low)) : null;

  if (funnel.Cut === 0) {
    return (
      <p className="v2-sans text-sm text-[var(--v2-text-faint)] py-10 text-center">
        Nothing in the pipeline yet — cut a facet and set it.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {rows.map((row, i) => (
        <div key={row.key}>
          {i > 0 && (
            <div className="flex items-center gap-2 pl-1 py-1.5">
              <ArrowDown className="w-3 h-3 text-[var(--v2-text-faint)] shrink-0" aria-hidden />
              <span
                className={`v2-mono text-xs ${
                  worst?.key === row.key ? "text-[var(--v2-warn)] font-medium" : "text-[var(--v2-text-faint)]"
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
              <p className="v2-sans text-sm font-medium text-[var(--v2-text)]">{row.label}</p>
              <p className="v2-sans text-xs text-[var(--v2-text-faint)]">{row.hint}</p>
            </div>
            <div className="flex-1 h-7 rounded-[var(--v2-radius)] bg-[var(--v2-bg)] border border-[var(--v2-border-soft)] overflow-hidden">
              <div
                className="h-full bg-[var(--v2-accent)] transition-[width] duration-300"
                style={{ width: `${Math.max(row.share * 100, row.value > 0 ? 4 : 0)}%` }}
              />
            </div>
            <span className="w-8 text-right v2-mono text-sm text-[var(--v2-text)]">{row.value}</span>
          </div>
        </div>
      ))}

      {rejected > 0 && (
        <div className="mt-4 pt-3 border-t border-[var(--v2-border)]">
          <p className="v2-sans text-xs text-[var(--v2-text-faint)]">
            <span className="v2-mono text-[var(--v2-text-dim)]">{rejected}</span>{" "}
            {rejected === 1 ? "rejection" : "rejections"}, counted at the stage each one reached
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {[...STAGES.map((s) => s.label), "unknown"]
              .filter((stage) => rejectedFrom[stage] > 0)
              .map((stage) => (
                <li key={stage} className="v2-sans text-xs text-[var(--v2-text-faint)]">
                  <span className="v2-mono text-[var(--v2-text-dim)]">{rejectedFrom[stage]}</span>{" "}
                  {stage === "unknown" ? (
                    <span title="Rejected before status history was recorded">stage not recorded</span>
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

/* --------------------------------------------------------------- SendingTrend */

const WEEKS = 8;

interface Bucket {
  start: Date;
  count: number;
}

function bucketByWeek(rows: DashboardSummary["clarity_score_trend"]): Bucket[] {
  const now = new Date();
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

export function SendingTrend({ summary }: { summary: DashboardSummary }) {
  const buckets = bucketByWeek(summary.clarity_score_trend ?? []);
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const peak = Math.max(1, ...buckets.map((b) => b.count));
  const weeksWithActivity = buckets.filter((b) => b.count > 0).length;

  if (total === 0) {
    return (
      <div className="v2-panel">
        <p className="v2-label mb-2">Sent per week</p>
        <p className="v2-sans text-sm text-[var(--v2-text-faint)] text-pretty">
          Nothing sent in the last eight weeks. This fills in once you mark a facet as Set — the
          point at which you have actually applied.
        </p>
      </div>
    );
  }

  const recent = buckets.slice(-4).reduce((s, b) => s + b.count, 0);
  const prior = buckets.slice(0, 4).reduce((s, b) => s + b.count, 0);

  return (
    <div className="v2-panel">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <p className="v2-label">Sent per week</p>
        <p className="v2-mono text-xs text-[var(--v2-text-faint)]">last {WEEKS} weeks</p>
      </div>

      <div
        className="flex items-end gap-1.5 h-24"
        role="img"
        aria-label={`Applications sent per week over the last ${WEEKS} weeks: ${buckets
          .map((b) => `${b.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${b.count}`)
          .join(", ")}`}
      >
        {buckets.map((bucket) => (
          <div key={bucket.start.toISOString()} className="flex-1 h-full flex flex-col items-center gap-1.5 min-w-0">
            <span className="v2-mono text-xs text-[var(--v2-text-faint)] leading-none">{bucket.count || ""}</span>
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max(bucket.count ? 6 : 2, (bucket.count / peak) * 100)}%`,
                  background: bucket.count ? "var(--v2-accent)" : "var(--v2-border-soft)",
                }}
              />
            </div>
            <span className="v2-mono text-xs text-[var(--v2-text-faint)] leading-tight w-full text-center">
              {bucket.start.toLocaleDateString(undefined, { month: "short" })}
              <br />
              {bucket.start.getDate()}
            </span>
          </div>
        ))}
      </div>

      <p className="v2-sans text-xs text-[var(--v2-text-dim)] mt-3 text-pretty">
        {weeksWithActivity < 3 ? (
          <>
            <span className="v2-mono">{total}</span> sent so far. Two or three weeks is not yet a trend, so
            there is nothing here to read into.
          </>
        ) : recent > prior ? (
          <>
            <span className="v2-mono text-[var(--v2-ok)]">{recent}</span> in the last four weeks against{" "}
            <span className="v2-mono">{prior}</span> in the four before. You are sending more.
          </>
        ) : recent < prior ? (
          <>
            <span className="v2-mono">{recent}</span> in the last four weeks against{" "}
            <span className="v2-mono">{prior}</span> in the four before. The rate has dropped.
          </>
        ) : (
          <>
            <span className="v2-mono">{recent}</span> in each half of the window. Steady.
          </>
        )}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- Interviews */

function icsEscape(value: string): string {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

function downloadIcs(interview: Interview, application: Application) {
  const start = parseDate(interview.scheduled_at) ?? new Date();
  const end = new Date(start.getTime() + 3_600_000);
  const stamp = (d: Date) => `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Facet//Cabinet//EN",
    "BEGIN:VEVENT",
    `UID:facet-interview-${interview.id}@local`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${icsEscape(`${interview.round_name || "Interview"} — ${application.company}`)}`,
    `DESCRIPTION:${icsEscape(`${application.role_title} at ${application.company}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `interview-${interview.id}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

export function InterviewsView({
  interviews,
  applicationsById,
  contactsById,
}: {
  interviews: Interview[];
  applicationsById: Map<number, Application>;
  contactsById: Map<number, Contact>;
}) {
  const sorted = [...interviews].sort((a, b) => {
    const at = parseDate(a.scheduled_at)?.getTime() ?? Infinity;
    const bt = parseDate(b.scheduled_at)?.getTime() ?? Infinity;
    return at - bt;
  });

  if (sorted.length === 0) {
    return (
      <div className="v2-panel flex flex-col items-center text-center gap-2 py-10">
        <CalendarX className="w-5 h-5 text-[var(--v2-text-faint)]" aria-hidden />
        <p className="v2-sans text-sm font-medium text-[var(--v2-text)]">No interviews yet</p>
        <p className="v2-sans text-xs text-[var(--v2-text-faint)] max-w-md text-pretty">
          Two ways one lands here: add it yourself against an application, or point Facet at your
          calendar feed and confirm the ones it spots. It never files an interview without asking.
        </p>
        <Link href="/v2/status" className="v2-btn mt-1">
          Connect a calendar feed
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((interview) => {
        const application = applicationsById.get(interview.application_id);
        if (!application) return null;
        const contact = interview.contact_id ? contactsById.get(interview.contact_id) : null;
        const when = parseDate(interview.scheduled_at);

        return (
          <div key={interview.id} className="v2-panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="v2-sans text-base font-semibold text-[var(--v2-text)]">
                  {application.company} · {interview.round_name || "Interview"}
                </p>
                <p className="v2-sans text-sm text-[var(--v2-text-dim)] mt-0.5">
                  {when ? when.toLocaleString() : "Unscheduled"}
                </p>
              </div>
              <button type="button" className="v2-btn" onClick={() => downloadIcs(interview, application)}>
                <CalendarPlus className="w-3.5 h-3.5" aria-hidden />
                Add to calendar
              </button>
            </div>

            {contact && (
              <p className="v2-sans text-sm text-[var(--v2-text-dim)] mt-2">
                {contact.name}
                {contact.role_title ? `, ${contact.role_title}` : ""}
                {contact.email ? ` · ${contact.email}` : ""}
              </p>
            )}

            <p className="v2-mono text-xs text-[var(--v2-text-faint)] mt-2">
              Facet used: {application.resume_path || "not yet cut"}
            </p>

            {interview.notes && (
              <p className="v2-sans text-sm text-[var(--v2-text-dim)] mt-2 text-pretty">{interview.notes}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
