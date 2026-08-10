"use client";

/**
 * v2's status subsystem components — ports of components/status/* onto v2
 * tokens. Logic (polling, expand/collapse, latency formatting) is unchanged;
 * only the classnames and color source differ.
 */

import { useEffect, useState } from "react";
import { ChevronRight, Clock, Loader2 } from "lucide-react";
import { STATUS_LABEL, worstStatus, type Check, type CheckGroup, type CheckStatus, type LogEntry, type RequestMetric } from "@/lib/status";

const STATUS_DOT: Record<CheckStatus, string> = {
  ok: "bg-[var(--v2-ok)]",
  degraded: "bg-[var(--v2-warn)]",
  error: "bg-[var(--v2-danger)]",
  disabled: "bg-[var(--v2-text-faint)]",
  unknown: "bg-[var(--v2-text-faint)]",
};

const STATUS_TEXT: Record<CheckStatus, string> = {
  ok: "text-[var(--v2-ok)]",
  degraded: "text-[var(--v2-warn)]",
  error: "text-[var(--v2-danger)]",
  disabled: "text-[var(--v2-text-faint)]",
  unknown: "text-[var(--v2-text-faint)]",
};

const STATUS_BADGE: Record<CheckStatus, string> = {
  ok: "v2-badge-ok",
  degraded: "v2-badge-warn",
  error: "v2-badge-danger",
  disabled: "v2-badge",
  unknown: "v2-badge",
};

function formatLatency(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function CheckRow({ check }: { check: Check }) {
  const [open, setOpen] = useState(false);
  const meta = Object.entries(check.meta ?? {});
  const expandable = meta.length > 0 || Boolean(check.hint);
  const latency = formatLatency(check.latency_ms);

  return (
    <div className="border-b border-[var(--v2-border-soft)] last:border-0">
      <div
        className={`flex items-start gap-3 px-4 py-2.5 ${expandable ? "cursor-pointer hover:bg-[var(--v2-bg-raised)]" : ""}`}
        onClick={expandable ? () => setOpen((o) => !o) : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((o) => !o);
                }
              }
            : undefined
        }
      >
        <span
          className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${STATUS_DOT[check.status]}`}
          role="img"
          aria-label={STATUS_LABEL[check.status]}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="v2-sans text-sm font-medium text-[var(--v2-text)]">{check.label}</span>
            {check.status !== "ok" && (
              <span className={`v2-sans text-xs ${STATUS_TEXT[check.status]}`}>{STATUS_LABEL[check.status]}</span>
            )}
          </div>
          <p className="v2-sans text-xs text-[var(--v2-text-dim)] mt-0.5 text-pretty">{check.detail}</p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {latency && <span className="v2-mono text-xs text-[var(--v2-text-faint)]">{latency}</span>}
          {expandable && (
            <ChevronRight
              className={`w-3.5 h-3.5 text-[var(--v2-text-faint)] transition-transform duration-150 ${open ? "rotate-90" : ""}`}
              aria-hidden
            />
          )}
        </div>
      </div>

      {open && (
        <div className="px-4 pb-3 pl-10 flex flex-col gap-2.5">
          {check.hint && (
            <p className="v2-sans text-xs text-[var(--v2-text-dim)] bg-[var(--v2-bg)] border border-[var(--v2-border-soft)] rounded-[var(--v2-radius)] px-3 py-2 text-pretty">
              {check.hint}
            </p>
          )}
          {meta.length > 0 && (
            <dl className="grid grid-cols-[minmax(0,auto)_1fr] gap-x-4 gap-y-1">
              {meta.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="v2-mono text-xs text-[var(--v2-text-faint)] py-0.5">{key}</dt>
                  <dd className="v2-mono text-xs text-[var(--v2-text-dim)] py-0.5 break-all">
                    {value === null ? "—" : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

export function GroupSection({ group }: { group: CheckGroup }) {
  const worst = worstStatus(group.checks);
  const applicable = group.checks.filter((c) => c.status !== "disabled");
  const healthy = applicable.filter((c) => c.status === "ok").length;

  return (
    <section className="v2-panel !p-0 overflow-hidden" aria-label={group.label}>
      <header className="flex items-start justify-between gap-4 px-4 py-3 border-b border-[var(--v2-border-soft)]">
        <div className="min-w-0">
          <h2 className="v2-sans text-sm font-semibold text-[var(--v2-text)]">{group.label}</h2>
          <p className="v2-sans text-xs text-[var(--v2-text-faint)] mt-0.5 text-pretty">{group.description}</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="v2-mono text-xs text-[var(--v2-text-faint)]">
            {applicable.length > 0 ? `${healthy}/${applicable.length}` : "—"}
          </span>
          <span className={`v2-badge ${STATUS_BADGE[worst]}`}>{STATUS_LABEL[worst]}</span>
        </div>
      </header>

      <div>
        {group.checks.length === 0 ? (
          <p className="px-4 py-6 v2-sans text-xs text-[var(--v2-text-faint)] text-center">
            Nothing to report here.
          </p>
        ) : (
          group.checks.map((check) => <CheckRow key={check.key} check={check} />)
        )}
      </div>
    </section>
  );
}

const LEVEL_BADGE: Record<LogEntry["level"], string> = {
  CRITICAL: "v2-badge-danger",
  ERROR: "v2-badge-danger",
  WARNING: "v2-badge-warn",
  INFO: "v2-badge",
  DEBUG: "v2-badge",
};

function timestamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString(undefined, { hour12: false });
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[var(--v2-border-soft)] last:border-0">
      <div
        className={`px-4 py-2 flex items-start gap-3 ${entry.traceback ? "cursor-pointer hover:bg-[var(--v2-bg-raised)]" : ""}`}
        onClick={entry.traceback ? () => setOpen((o) => !o) : undefined}
        role={entry.traceback ? "button" : undefined}
        tabIndex={entry.traceback ? 0 : undefined}
        onKeyDown={
          entry.traceback
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((o) => !o);
                }
              }
            : undefined
        }
      >
        <span className="v2-mono text-xs text-[var(--v2-text-faint)] pt-0.5 shrink-0">{timestamp(entry.ts)}</span>
        <span className={`v2-badge ${LEVEL_BADGE[entry.level]} shrink-0`}>{entry.level}</span>
        <div className="min-w-0 flex-1">
          <p className="v2-sans text-xs text-[var(--v2-text-dim)] break-words">{entry.message}</p>
          <p className="v2-mono text-xs text-[var(--v2-text-faint)] mt-0.5">
            {entry.logger}
            {entry.path ? ` · ${entry.path}` : ""}
            {entry.traceback && !open ? " · click for traceback" : ""}
          </p>
        </div>
      </div>
      {open && entry.traceback && (
        <pre className="mx-4 mb-3 bg-[var(--v2-bg)] border border-[var(--v2-border-soft)] rounded-[var(--v2-radius)] p-3 text-xs text-[var(--v2-text-faint)] overflow-x-auto whitespace-pre">
          {entry.traceback}
        </pre>
      )}
    </div>
  );
}

export function LogList({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="px-4 py-8 flex flex-col items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--v2-ok)]" aria-hidden />
        <p className="v2-sans text-xs text-[var(--v2-text-dim)]">No warnings or errors logged.</p>
        <p className="v2-mono text-xs text-[var(--v2-text-faint)]">Everything since the backend started has run clean.</p>
      </div>
    );
  }

  return (
    <div>
      {entries.map((entry, i) => (
        <LogRow key={`${entry.ts}-${i}`} entry={entry} />
      ))}
    </div>
  );
}

export function TrafficTable({ rows }: { rows: RequestMetric[] }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 v2-sans text-xs text-[var(--v2-text-faint)] text-center">
        No requests recorded since the backend started.
      </p>
    );
  }

  const slowest = Math.max(...rows.map((r) => r.p95_ms), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[var(--v2-text-faint)]">
            <th scope="col" className="text-left font-medium px-4 py-2 v2-sans">Endpoint</th>
            <th scope="col" className="text-right font-medium px-3 py-2 v2-sans">Calls</th>
            <th scope="col" className="text-right font-medium px-3 py-2 v2-sans">Errors</th>
            <th scope="col" className="text-right font-medium px-3 py-2 v2-sans">p50</th>
            <th scope="col" className="text-right font-medium px-3 py-2 v2-sans">p95</th>
            <th scope="col" className="text-right font-medium px-4 py-2 v2-sans">Max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-t border-[var(--v2-border-soft)]">
              <td className="px-4 py-2 v2-mono text-[var(--v2-text-dim)] max-w-0 truncate" title={row.path}>
                {row.path}
              </td>
              <td className="px-3 py-2 text-right v2-mono text-[var(--v2-text-dim)]">{row.count.toLocaleString()}</td>
              <td
                className={`px-3 py-2 text-right v2-mono ${row.errors > 0 ? "text-[var(--v2-danger)]" : "text-[var(--v2-text-faint)]"}`}
              >
                {row.errors.toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right v2-mono text-[var(--v2-text-dim)]">{Math.round(row.p50_ms)}</td>
              <td className="px-3 py-2 text-right v2-mono text-[var(--v2-text-dim)] relative">
                <span
                  className="absolute inset-y-1 right-3 bg-[var(--v2-bg)] rounded-sm -z-0"
                  style={{ width: `${Math.max(2, (row.p95_ms / slowest) * 44)}px` }}
                  aria-hidden
                />
                <span className="relative">{Math.round(row.p95_ms)}</span>
              </td>
              <td className="px-4 py-2 text-right v2-mono text-[var(--v2-text-faint)]">{Math.round(row.max_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 v2-mono text-xs text-[var(--v2-text-faint)]">Latencies in milliseconds.</p>
    </div>
  );
}

/* --------------------------------------------------------------- AgyQueue */

interface AgyQueueData {
  mine: {
    queued: { id: number; kind: string; queued_at: number; position: number; ahead: number }[];
    running: { id: number; kind: string; started_at: number }[];
  };
  system: { queued: number; running: number; busy_with_someone_else: boolean };
}

const KIND_LABEL: Record<string, string> = {
  tailor: "Cutting a facet",
  extract_profile: "Reading your resume",
};

function elapsed(since: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - since));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function AgyQueue({ refreshMs = 5000 }: { refreshMs?: number }) {
  const [data, setData] = useState<AgyQueueData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const response = await fetch("/api/queue/agy", { credentials: "include" });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json();
        if (alive) {
          setData(body);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    }

    poll();
    const timer = window.setInterval(poll, refreshMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshMs]);

  if (failed && !data) return null;

  if (!data) {
    return (
      <div className="v2-panel v2-panel-tight v2-sans text-sm text-[var(--v2-text-faint)] flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
        Checking the queue…
      </div>
    );
  }

  const { mine, system } = data;
  const idle = mine.running.length === 0 && mine.queued.length === 0 && system.running === 0;

  return (
    <section className="v2-panel !p-0">
      <header className="px-4 py-3 border-b border-[var(--v2-border-soft)] flex items-center justify-between">
        <h2 className="v2-sans text-sm font-semibold flex items-center gap-2 text-[var(--v2-text)]">
          <Clock className="w-4 h-4" aria-hidden />
          AI queue
        </h2>
        <span className="v2-mono text-xs text-[var(--v2-text-faint)]">
          {system.running} running · {system.queued} waiting
        </span>
      </header>

      <div className="px-4 py-3 space-y-2">
        {mine.running.map((job) => (
          <p key={job.id} className="v2-sans text-sm flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--v2-ok)] animate-pulse" aria-hidden />
            <span className="text-[var(--v2-text)]">
              {KIND_LABEL[job.kind] || job.kind} — running for {elapsed(job.started_at)}
            </span>
          </p>
        ))}

        {mine.queued.map((job) => (
          <p key={job.id} className="v2-sans text-sm text-[var(--v2-text-dim)]">
            {KIND_LABEL[job.kind] || job.kind} —{" "}
            {job.ahead === 0 ? "next up" : `${job.ahead} job${job.ahead === 1 ? "" : "s"} ahead of yours`}
          </p>
        ))}

        {mine.running.length === 0 && mine.queued.length === 0 && (
          <p className="v2-sans text-sm text-[var(--v2-text-dim)]">
            {system.busy_with_someone_else
              ? "Nothing of yours is queued. Someone else is using the AI, so a cut started now would wait."
              : idle
                ? "Nothing queued. The AI is free."
                : "Nothing of yours is queued."}
          </p>
        )}

        {failed && (
          <p className="v2-sans text-xs text-[var(--v2-text-faint)]">
            Last refresh failed — showing the previous reading.
          </p>
        )}
      </div>
    </section>
  );
}
