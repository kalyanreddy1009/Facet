/**
 * Contract for GET /api/status — the service dashboard.
 *
 * This file is the single source of truth for the shape. The backend
 * (backend/services/health.py) must serialize exactly this; the dashboard
 * page renders exactly this and nothing else.
 */

export type CheckStatus =
  | "ok" // working, verified just now
  | "degraded" // working, but something is wrong or slow
  | "error" // not working
  | "disabled" // deliberately not configured; not a failure
  | "unknown"; // hasn't been checked yet this run

export type OverallStatus = "operational" | "degraded" | "down";

export interface Check {
  /** Stable identifier, e.g. "db.connectivity". Used as a React key. */
  key: string;
  label: string;
  status: CheckStatus;
  /** One line, human-readable, always present. e.g. "495 postings, 2.2 MB". */
  detail: string;
  /** What to do about it, when status isn't ok. */
  hint?: string | null;
  /** How long this specific check took. */
  latency_ms?: number | null;
  /** ISO-8601 UTC. */
  last_checked: string;
  /** Arbitrary extra key/values rendered as a definition list. */
  meta?: Record<string, string | number | boolean | null>;
}

export interface CheckGroup {
  key: string;
  label: string;
  /** One line describing what this group covers. */
  description: string;
  checks: Check[];
}

export interface LogEntry {
  ts: string;
  level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  logger: string;
  message: string;
  /** Present for request-scoped entries. */
  path?: string | null;
  traceback?: string | null;
}

export interface RequestMetric {
  path: string;
  count: number;
  errors: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
}

export interface StatusReport {
  generated_at: string;
  overall: OverallStatus;
  /** Seconds since the backend process started. */
  uptime_seconds: number;
  /** How long the whole report took to assemble. */
  duration_ms: number;
  versions: Record<string, string>;
  groups: CheckGroup[];
  counts: {
    ok: number;
    degraded: number;
    error: number;
    disabled: number;
  };
  traffic: {
    total_requests: number;
    total_errors: number;
    error_rate: number;
    by_endpoint: RequestMetric[];
  };
  recent_errors: LogEntry[];
}

/* ------------------------------------------------------------------ shared */

export const STATUS_ORDER: CheckStatus[] = ["error", "degraded", "unknown", "ok", "disabled"];

export const STATUS_LABEL: Record<CheckStatus, string> = {
  ok: "Operational",
  degraded: "Degraded",
  error: "Failing",
  disabled: "Not configured",
  unknown: "Unknown",
};

/** Tailwind class fragments per status. Keeps colour decisions in one place. */
export const STATUS_STYLE: Record<CheckStatus, { dot: string; badge: string; text: string }> = {
  ok: { dot: "dot-ok", badge: "badge-ok", text: "text-ok" },
  degraded: { dot: "dot-warn", badge: "badge-warn", text: "text-warn" },
  error: { dot: "dot-danger", badge: "badge-danger", text: "text-danger" },
  disabled: { dot: "dot-neutral", badge: "badge", text: "text-text-faint" },
  unknown: { dot: "dot-neutral", badge: "badge", text: "text-text-faint" },
};

export const OVERALL_LABEL: Record<OverallStatus, string> = {
  operational: "All systems operational",
  degraded: "Partial degradation",
  down: "Major outage",
};

/** Worst status wins — one failing check can't be hidden by ten healthy ones. */
export function worstStatus(checks: Check[]): CheckStatus {
  for (const status of STATUS_ORDER) {
    if (checks.some((check) => check.status === status)) return status;
  }
  return "ok";
}
