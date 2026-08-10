"use client";

/** v2's status dashboard — same data and behavior as v1's
 *  (frontend/src/app/status/PageClient.tsx): overall banner, key metrics, the
 *  AI queue, per-subsystem groups, traffic table, recent logs, versions. */

import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, ServerCrash } from "lucide-react";
import { AgyQueue, GroupSection, LogList, TrafficTable } from "@/components-v2/status/StatusSections";
import { OVERALL_LABEL, type OverallStatus } from "@/lib/status";
import { REFRESH_OPTIONS, useStatus } from "@/lib/useStatus";

const OVERALL_STYLE: Record<OverallStatus, { dot: string; text: string; border: string }> = {
  operational: { dot: "bg-[var(--v2-ok)]", text: "text-[var(--v2-ok)]", border: "border-[var(--v2-ok)]" },
  degraded: { dot: "bg-[var(--v2-warn)]", text: "text-[var(--v2-warn)]", border: "border-[var(--v2-warn)]" },
  down: { dot: "bg-[var(--v2-danger)]", text: "text-[var(--v2-danger)]", border: "border-[var(--v2-danger)]" },
};

const STARTUP_GRACE_ATTEMPTS = 4;

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="v2-label">{label}</p>
      <p className={`v2-mono text-lg font-semibold mt-1 ${tone ?? "text-[var(--v2-text)]"}`}>{value}</p>
    </div>
  );
}

export default function StatusPage() {
  const [refreshMs, setRefreshMs] = useState<number>(15_000);
  const { report, error, errorHint, initialLoading, refreshing, lastUpdated, failures, refresh } =
    useStatus(refreshMs);

  const errorRate = report ? report.traffic.error_rate : 0;
  const totalChecks = useMemo(
    () => (report ? report.groups.reduce((n, g) => n + g.checks.length, 0) : 0),
    [report]
  );

  const unreachable = Boolean(error) && !report;
  const stillStarting = unreachable && failures <= STARTUP_GRACE_ATTEMPTS;

  return (
    <main className="v2-main w-full">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <p className="v2-eyebrow mb-1">Diagnostics</p>
          <h1 className="v2-h1">Service status</h1>
          <p className="v2-lede mt-1 max-w-prose text-pretty">
            Every subsystem Facet depends on, checked live against the running backend. Nothing here
            is cached or assumed — each row executed something just now.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Auto-refresh interval"
            className="flex items-center gap-0.5 p-0.5 rounded-[var(--v2-radius)] bg-[var(--v2-bg-raised)] border border-[var(--v2-border)]"
          >
            <span className="v2-label px-2 mb-0">Auto</span>
            {REFRESH_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                role="radio"
                aria-checked={refreshMs === option.value}
                onClick={() => setRefreshMs(option.value)}
                className={`px-2 min-h-[1.5rem] v2-sans text-xs rounded-[calc(var(--v2-radius)-1px)] transition-colors duration-150 ${
                  refreshMs === option.value
                    ? "bg-[var(--v2-accent)] text-[var(--v2-accent-ink)]"
                    : "text-[var(--v2-text-faint)] hover:text-[var(--v2-text-dim)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={refresh} className="v2-btn" disabled={refreshing}>
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </button>
        </div>
      </header>

      {stillStarting ? (
        <div className="v2-panel px-6 py-14 flex flex-col items-center text-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--v2-warn)] animate-pulse mb-1" aria-hidden />
          <p className="v2-sans text-base font-semibold text-[var(--v2-text)]">Waiting for the backend</p>
          <p className="v2-sans text-sm text-[var(--v2-text-faint)] max-w-md text-pretty">
            It takes about 15 seconds to start — retrying automatically.
          </p>
          <p className="v2-mono text-xs text-[var(--v2-text-faint)] mt-1">
            Attempt {failures} of {STARTUP_GRACE_ATTEMPTS}
          </p>
        </div>
      ) : unreachable ? (
        <div className="v2-panel px-6 py-14 flex flex-col items-center text-center gap-2">
          <ServerCrash className="w-5 h-5 text-[var(--v2-danger)] mb-1" aria-hidden />
          <p className="v2-sans text-base font-semibold text-[var(--v2-text)]">{error}</p>
          {errorHint && <p className="v2-sans text-sm text-[var(--v2-text-faint)] max-w-md text-pretty">{errorHint}</p>}
          <p className="v2-mono text-xs text-[var(--v2-text-faint)] mt-1">
            {failures} consecutive failed attempt{failures === 1 ? "" : "s"}
          </p>
          <button type="button" onClick={refresh} className="v2-btn v2-btn-primary mt-3" disabled={refreshing}>
            Try again
          </button>
        </div>
      ) : initialLoading || !report ? (
        <div className="flex flex-col gap-3" aria-busy>
          <div className="v2-panel h-20 w-full animate-pulse" />
          <div className="v2-panel h-24 w-full animate-pulse" />
          <div className="grid lg:grid-cols-2 gap-3">
            <div className="v2-panel h-64 w-full animate-pulse" />
            <div className="v2-panel h-64 w-full animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {error && (
            <div className="v2-panel v2-panel-tight flex items-center gap-2.5 border-[var(--v2-warn)] bg-[var(--v2-warn-soft)]">
              <AlertTriangle className="w-4 h-4 text-[var(--v2-warn)] shrink-0" aria-hidden />
              <p className="v2-sans text-xs text-[var(--v2-warn)] flex-1">
                Showing the last successful report — {error.toLowerCase()}.
              </p>
            </div>
          )}

          <section
            className={`v2-panel flex flex-wrap items-center justify-between gap-4 ${OVERALL_STYLE[report.overall].border}`}
            aria-label="Overall status"
          >
            <div className="flex items-center gap-3">
              <span
                className={`w-2.5 h-2.5 rounded-full ${OVERALL_STYLE[report.overall].dot} ${refreshing ? "animate-pulse" : ""}`}
                aria-hidden
              />
              <div>
                <p className={`v2-sans text-lg font-semibold ${OVERALL_STYLE[report.overall].text}`}>
                  {OVERALL_LABEL[report.overall]}
                </p>
                <p className="v2-mono text-xs text-[var(--v2-text-faint)] mt-0.5">
                  {report.counts.ok} operational · {report.counts.degraded} degraded ·{" "}
                  {report.counts.error} failing · {report.counts.disabled} not configured
                </p>
              </div>
            </div>
            <p className="v2-mono text-xs text-[var(--v2-text-faint)]">
              {lastUpdated ? `Checked ${lastUpdated.toLocaleTimeString(undefined, { hour12: false })}` : "—"}
              {" · "}
              report built in {Math.round(report.duration_ms)} ms
            </p>
          </section>

          <section
            className="v2-panel !p-0 grid grid-cols-2 md:grid-cols-4 divide-x divide-[var(--v2-border-soft)]"
            aria-label="Key metrics"
          >
            <Stat label="Uptime" value={formatUptime(report.uptime_seconds)} />
            <Stat label="Checks passing" value={`${report.counts.ok}/${totalChecks}`} />
            <Stat label="Requests served" value={report.traffic.total_requests.toLocaleString()} />
            <Stat
              label="Error rate"
              value={`${(errorRate * 100).toFixed(errorRate > 0 && errorRate < 0.001 ? 3 : 1)}%`}
              tone={
                report.traffic.total_errors === 0
                  ? "text-[var(--v2-text)]"
                  : errorRate > 0.05
                    ? "text-[var(--v2-danger)]"
                    : "text-[var(--v2-warn)]"
              }
            />
          </section>

          <AgyQueue />

          <div className="grid lg:grid-cols-2 gap-3 items-start">
            {report.groups.map((group) => (
              <GroupSection key={group.key} group={group} />
            ))}
          </div>

          <section className="v2-panel !p-0 overflow-hidden" aria-label="Request metrics">
            <header className="px-4 py-3 border-b border-[var(--v2-border-soft)]">
              <h2 className="v2-sans text-sm font-semibold text-[var(--v2-text)]">Endpoint traffic</h2>
              <p className="v2-sans text-xs text-[var(--v2-text-faint)] mt-0.5">
                Measured in-process since the backend started. {report.traffic.total_errors} error
                {report.traffic.total_errors === 1 ? "" : "s"} across{" "}
                {report.traffic.total_requests.toLocaleString()} requests.
              </p>
            </header>
            <TrafficTable rows={report.traffic.by_endpoint} />
          </section>

          <section className="v2-panel !p-0 overflow-hidden" aria-label="Recent errors">
            <header className="px-4 py-3 border-b border-[var(--v2-border-soft)] flex items-center justify-between gap-3">
              <div>
                <h2 className="v2-sans text-sm font-semibold text-[var(--v2-text)]">Recent warnings and errors</h2>
                <p className="v2-sans text-xs text-[var(--v2-text-faint)] mt-0.5">
                  Everything at WARNING or above since startup, newest first.
                </p>
              </div>
              {report.recent_errors.length > 0 && <span className="v2-badge">{report.recent_errors.length}</span>}
            </header>
            <LogList entries={report.recent_errors} />
          </section>

          <section className="v2-panel" aria-label="Versions">
            <h2 className="v2-label mb-2">Environment</h2>
            <dl className="flex flex-wrap gap-x-6 gap-y-1.5">
              {Object.entries(report.versions).map(([name, version]) => (
                <div key={name} className="flex items-baseline gap-1.5">
                  <dt className="v2-sans text-xs text-[var(--v2-text-faint)]">{name}</dt>
                  <dd className="v2-mono text-xs text-[var(--v2-text-dim)]">{version}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </main>
  );
}
