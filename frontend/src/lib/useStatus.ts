"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import type { StatusReport } from "@/lib/status";

/** Poll intervals offered in the UI. `0` means "don't". */
export const REFRESH_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5_000 },
  { label: "15s", value: 15_000 },
  { label: "60s", value: 60_000 },
] as const;

class HttpError extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

/** Backoff while the backend is still coming up. `run.py` starts the API and
 *  the frontend together and the API needs ~15s, so the first few failures
 *  are expected startup, not an outage — retry quickly instead of showing a
 *  red error and then sitting idle for a full poll interval. */
const STARTUP_RETRIES_MS = [1_500, 3_000, 5_000, 8_000];

interface UseStatusResult {
  report: StatusReport | null;
  error: string | null;
  errorHint: string | null;
  /** True only for the very first load — refreshes must not blank the page. */
  initialLoading: boolean;
  /** True while any fetch is in flight, including background refreshes. */
  refreshing: boolean;
  lastUpdated: Date | null;
  /** Consecutive failures; drives the "backend unreachable" state. */
  failures: number;
  refresh: () => void;
}

/**
 * Fetches the service report on an interval.
 *
 * Deliberately keeps the previous report visible while refreshing — a status
 * page that blanks itself every few seconds is unreadable, and the moment you
 * most need it is the moment the backend is flaky.
 */
export function useStatus(intervalMs: number): UseStatusResult {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [failures, setFailures] = useState(0);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setRefreshing(true);

    // Longer than the endpoint's own budget, so a slow-but-working report
    // isn't reported as unreachable.
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${API_BASE}/api/status`, {
        signal: controller.signal,
        cache: "no-store",
      });
      // An HTTP error means the backend answered — saying "unreachable" here
      // sends you looking for a dead process that is in fact running.
      if (!res.ok) {
        throw new HttpError(
          `The status endpoint returned HTTP ${res.status}`,
          `The backend is running but /api/status failed. Check data/logs/facet.log.`
        );
      }
      setReport((await res.json()) as StatusReport);
      setLastUpdated(new Date());
      setError(null);
      setErrorHint(null);
      setFailures(0);
    } catch (err) {
      if (controller.signal.aborted && inFlight.current !== controller) return; // superseded
      setFailures((n) => n + 1);
      if (err instanceof HttpError) {
        setError(err.message);
        setErrorHint(err.hint);
      } else if (err instanceof Error && err.name === "AbortError") {
        setError("The status endpoint timed out");
        setErrorHint("It answered too slowly to be useful — the backend may be busy.");
      } else {
        // Only a genuine transport failure is "unreachable".
        setError("Can't reach the Facet backend on :8000");
        setErrorHint("Nothing answered on that port. Start it with `python run.py`.");
      }
    } finally {
      clearTimeout(timer);
      if (inFlight.current === controller) {
        setRefreshing(false);
        setInitialLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fast retries while nothing has ever loaded — that's a backend still
  // booting, and it resolves itself within seconds.
  useEffect(() => {
    if (report || failures === 0) return;
    const delay = STARTUP_RETRIES_MS[Math.min(failures - 1, STARTUP_RETRIES_MS.length - 1)];
    const id = setTimeout(refresh, delay);
    return () => clearTimeout(id);
  }, [failures, report, refresh]);

  useEffect(() => {
    if (!intervalMs) return;
    const id = setInterval(() => {
      // Polling a background tab burns battery and tells nobody anything.
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, refresh]);

  useEffect(() => () => inFlight.current?.abort(), []);

  return {
    report,
    error,
    errorHint,
    initialLoading,
    refreshing,
    lastUpdated,
    failures,
    refresh,
  };
}
