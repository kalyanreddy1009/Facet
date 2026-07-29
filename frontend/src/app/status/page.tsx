"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw, ServerCrash } from "lucide-react";
import AgyQueue from "@/components/status/AgyQueue";
import GroupSection from "@/components/status/GroupSection";
import LogList from "@/components/status/LogList";
import TrafficTable from "@/components/status/TrafficTable";
import { OVERALL_LABEL, type OverallStatus } from "@/lib/status";
import { REFRESH_OPTIONS, useStatus } from "@/lib/useStatus";

const OVERALL_STYLE: Record<OverallStatus, { dot: string; text: string; border: string }> = {
  operational: { dot: "dot-ok", text: "text-ok", border: "border-ok-border" },
  degraded: { dot: "dot-warn", text: "text-warn", border: "border-warn-border" },
  down: { dot: "dot-danger", text: "text-danger", border: "border-danger-border" },
};

/** Roughly the first ~18s of retries — how long the API takes to boot. */
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
      <p className="label">{label}</p>
      <p className={`text-lg font-semibold tnum mt-1 ${tone ?? "text-text"}`}>{value}</p>
    </div>
  );
}

export default function StatusPage() {
  const [interval, setInterval] = useState<number>(15_000);
  const { report, error, errorHint, initialLoading, refreshing, lastUpdated, failures, refresh } =
    useStatus(interval);

  const errorRate = report ? report.traffic.error_rate : 0;
  const totalChecks = useMemo(
    () => (report ? report.groups.reduce((n, g) => n + g.checks.length, 0) : 0),
    [report]
  );

  // The backend being down is itself a status result — say so plainly rather
  // than showing an empty page or a spinner that never resolves. But the
  // first few seconds after `python run.py` are the API still booting, not an
  // outage: `run.py` starts both servers together and the API needs ~15s.
  const unreachable = Boolean(error) && !report;
  const stillStarting = unreachable && failures <= STARTUP_GRACE_ATTEMPTS;

  return (
    <main className="max-w-shell mx-auto px-5 sm:px-8 py-8 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-text">Service status</h1>
          <p className="text-sm text-text-dim mt-1 max-w-prose text-pretty">
            Every subsystem Facet depends on, checked live against the running backend. Nothing here
            is cached or assumed — each row executed something just now.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Auto-refresh interval"
            className="flex items-center gap-0.5 p-0.5 rounded bg-surface-1 border border-border"
          >
            <span className="label px-2">Auto</span>
            {REFRESH_OPTIONS.map((option) => (
              <button
                key={option.value}
                role="radio"
                aria-checked={interval === option.value}
                onClick={() => setInterval(option.value)}
                className={`px-2 h-6 text-xs rounded-sm transition-colors duration-fast ${
                  interval === option.value
                    ? "bg-surface-3 text-text"
                    : "text-text-faint hover:text-text-dim"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button onClick={refresh} className="btn btn-default" disabled={refreshing}>
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </button>
        </div>
      </header>

      {stillStarting ? (
        <div className="panel px-6 py-14 flex flex-col items-center text-center gap-2">
          <span className="dot dot-warn dot-pulse !w-2.5 !h-2.5 mb-1" aria-hidden />
          <p className="text-base font-semibold text-text">Waiting for the backend</p>
          <p className="text-sm text-text-dim max-w-md text-pretty">
            It takes about 15 seconds to start — retrying automatically.
          </p>
          <p className="text-xs text-text-faint mt-1 tnum">
            Attempt {failures} of {STARTUP_GRACE_ATTEMPTS}
          </p>
        </div>
      ) : unreachable ? (
        <div className="panel px-6 py-14 flex flex-col items-center text-center gap-2">
          <ServerCrash className="w-5 h-5 text-danger mb-1" aria-hidden />
          <p className="text-base font-semibold text-text">{error}</p>
          {errorHint && (
            <p className="text-sm text-text-dim max-w-md text-pretty">{errorHint}</p>
          )}
          <p className="text-xs text-text-faint mt-1 tnum">
            {failures} consecutive failed attempt{failures === 1 ? "" : "s"}
          </p>
          <button onClick={refresh} className="btn btn-primary mt-3" disabled={refreshing}>
            Try again
          </button>
        </div>
      ) : initialLoading || !report ? (
        <div className="flex flex-col gap-3" aria-busy>
          <div className="skeleton h-20 w-full" />
          <div className="skeleton h-24 w-full" />
          <div className="grid lg:grid-cols-2 gap-3">
            <div className="skeleton h-64 w-full" />
            <div className="skeleton h-64 w-full" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* A stale report during a backend blip is still useful — flag it
              rather than replacing everything with an error. */}
          {error && (
            <div className="panel px-4 py-2.5 flex items-center gap-2.5 border-warn-border bg-warn-soft">
              <AlertTriangle className="w-4 h-4 text-warn shrink-0" aria-hidden />
              <p className="text-xs text-warn flex-1">
                Showing the last successful report — {error.toLowerCase()}.
              </p>
            </div>
          )}

          <section
            className={`panel px-5 py-4 flex flex-wrap items-center justify-between gap-4 ${
              OVERALL_STYLE[report.overall].border
            }`}
            aria-label="Overall status"
          >
            <div className="flex items-center gap-3">
              <span
                className={`dot ${OVERALL_STYLE[report.overall].dot} ${
                  refreshing ? "dot-pulse" : ""
                } !w-2.5 !h-2.5`}
                aria-hidden
              />
              <div>
                <p className={`text-lg font-semibold ${OVERALL_STYLE[report.overall].text}`}>
                  {OVERALL_LABEL[report.overall]}
                </p>
                <p className="text-xs text-text-faint mt-0.5 tnum">
                  {report.counts.ok} operational · {report.counts.degraded} degraded ·{" "}
                  {report.counts.error} failing · {report.counts.disabled} not configured
                </p>
              </div>
            </div>
            <p className="text-xs text-text-faint tnum">
              {lastUpdated ? `Checked ${lastUpdated.toLocaleTimeString(undefined, { hour12: false })}` : "—"}
              {" · "}
              report built in {Math.round(report.duration_ms)} ms
            </p>
          </section>

          <section
            className="panel grid grid-cols-2 md:grid-cols-4 divide-x divide-border"
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
                  ? "text-text"
                  : errorRate > 0.05
                    ? "text-danger"
                    : "text-warn"
              }
            />
          </section>

          {/* Above the subsystem groups on purpose: "what is happening to my
              work right now" is the question someone opens this page with.
              Whether every dependency is healthy is the follow-up. */}
          <AgyQueue />

          <div className="grid lg:grid-cols-2 gap-3 items-start">
            {report.groups.map((group) => (
              <GroupSection key={group.key} group={group} />
            ))}
          </div>

          <section className="panel overflow-hidden" aria-label="Request metrics">
            <header className="px-4 py-3 divider">
              <h2 className="text-sm font-semibold text-text">Endpoint traffic</h2>
              <p className="text-xs text-text-faint mt-0.5">
                Measured in-process since the backend started. {report.traffic.total_errors} error
                {report.traffic.total_errors === 1 ? "" : "s"} across{" "}
                {report.traffic.total_requests.toLocaleString()} requests.
              </p>
            </header>
            <TrafficTable rows={report.traffic.by_endpoint} />
          </section>

          <section className="panel overflow-hidden" aria-label="Recent errors">
            <header className="px-4 py-3 divider flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-text">Recent warnings and errors</h2>
                <p className="text-xs text-text-faint mt-0.5">
                  Everything at WARNING or above since startup, newest first.
                </p>
              </div>
              {report.recent_errors.length > 0 && (
                <span className="badge">{report.recent_errors.length}</span>
              )}
            </header>
            <LogList entries={report.recent_errors} />
          </section>

          <section className="panel px-4 py-3" aria-label="Versions">
            <h2 className="label mb-2">Environment</h2>
            <dl className="flex flex-wrap gap-x-6 gap-y-1.5">
              {Object.entries(report.versions).map(([name, version]) => (
                <div key={name} className="flex items-baseline gap-1.5">
                  <dt className="text-xs text-text-faint">{name}</dt>
                  <dd className="text-xs text-text-dim mono">{version}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </main>
  );
}
