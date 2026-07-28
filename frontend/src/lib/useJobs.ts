"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, isAborted, type Job, type JobFacets, type JobQuery } from "@/lib/api";

export interface Filters {
  q: string;
  location: string;
  sources: string[];
  remote: boolean | null;
  employmentType: string;
  minScore: number;
  maxAgeDays: number | null;
  salaryMin: number | null;
  sort: NonNullable<JobQuery["sort"]>;
}

export const EMPTY_FILTERS: Filters = {
  q: "",
  location: "",
  sources: [],
  remote: null,
  employmentType: "",
  minScore: 0,
  maxAgeDays: null,
  salaryMin: null,
  sort: "match",
};

export const PAGE_SIZE = 30;
const DEBOUNCE_MS = 220;

export function activeFilterCount(filters: Filters): number {
  return (
    (filters.location ? 1 : 0) +
    filters.sources.length +
    (filters.remote !== null ? 1 : 0) +
    (filters.employmentType ? 1 : 0) +
    (filters.minScore > 0 ? 1 : 0) +
    (filters.maxAgeDays ? 1 : 0) +
    (filters.salaryMin ? 1 : 0)
  );
}

function toQuery(filters: Filters): JobQuery {
  return {
    q: filters.q.trim(),
    location: filters.location.trim(),
    source: filters.sources,
    remote: filters.remote,
    employment_type: filters.employmentType,
    min_score: filters.minScore || undefined,
    max_age_days: filters.maxAgeDays,
    salary_min: filters.salaryMin,
    sort: filters.sort,
  };
}

/**
 * Filtering, sorting and paging all happen in SQLite; this hook only ever
 * holds one page of rows. Text input is debounced and every request is
 * abortable, so typing fast cancels its own in-flight queries instead of
 * racing them — the last response is always the one rendered.
 */
export function useJobs(filters: Filters) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [facets, setFacets] = useState<JobFacets | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());

  const inFlight = useRef<AbortController | null>(null);
  // `loadMore` needs its own controller: it runs alongside the page-1 fetch,
  // not instead of it, so it can't share `inFlight` without cancelling it.
  const moreInFlight = useRef<AbortController | null>(null);
  const offset = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);

  // Text fields debounce; everything else (a checkbox, a sort) applies now.
  const [debouncedText, setDebouncedText] = useState({ q: filters.q, location: filters.location });
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedText({ q: filters.q, location: filters.location }),
      DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [filters.q, filters.location]);

  const effective = useMemo<Filters>(
    () => ({ ...filters, ...debouncedText }),
    [filters, debouncedText]
  );

  // A primitive key means the effect re-runs when a filter's *value* changes,
  // not every time the parent re-renders a new object identity.
  const key = JSON.stringify(toQuery(effective));

  useEffect(() => {
    inFlight.current?.abort();
    // A page-2 request issued under the *previous* filters must die here.
    // Without this it lands later and appends rows from the old query onto
    // the new query's first page, and overwrites the new total with the old.
    moreInFlight.current?.abort();
    moreInFlight.current = null;
    const controller = new AbortController();
    inFlight.current = controller;
    offset.current = 0;
    setLoading(true);

    const query = toQuery(effective);
    Promise.all([
      api.jobs({ ...query, limit: PAGE_SIZE, offset: 0 }, controller.signal),
      api.jobFacets({ ...query, source: undefined }, controller.signal),
    ])
      .then(([page, facetData]) => {
        setJobs(page.items);
        setTotal(page.total);
        setFacets(facetData);
        setHidden(new Set());
        setError(null);
      })
      .catch((err) => {
        if (isAborted(err)) return; // superseded by a newer keystroke
        setError(err instanceof ApiError ? err.message : "Couldn't load jobs");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      moreInFlight.current?.abort();
    };
    // `effective` is derived from `key`; depending on the string keeps this
    // from re-firing on identity-only changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadToken]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || jobs.length >= total) return;
    const controller = new AbortController();
    moreInFlight.current = controller;
    setLoadingMore(true);
    try {
      const next = offset.current + PAGE_SIZE;
      const page = await api.jobs(
        { ...toQuery(effective), limit: PAGE_SIZE, offset: next },
        controller.signal
      );
      // Superseded while we were waiting — this page belongs to a query that
      // is no longer on screen. Drop it whole.
      if (moreInFlight.current !== controller) return;
      offset.current = next;
      // De-dup on append: a concurrent sync can shift rows between pages.
      setJobs((prev) => {
        const seen = new Set(prev.map((job) => job.id));
        return [...prev, ...page.items.filter((job) => !seen.has(job.id))];
      });
      setTotal(page.total);
    } catch (err) {
      if (!isAborted(err)) setError(err instanceof ApiError ? err.message : "Couldn't load more");
    } finally {
      if (moreInFlight.current === controller) {
        moreInFlight.current = null;
        setLoadingMore(false);
      }
    }
  }, [effective, jobs.length, loading, loadingMore, total]);

  /** Optimistic hide, so Dismiss is instant and undoable. */
  const hide = useCallback((id: number) => {
    setHidden((prev) => new Set(prev).add(id));
  }, []);

  const unhide = useCallback((id: number) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const visible = useMemo(() => jobs.filter((job) => !hidden.has(job.id)), [jobs, hidden]);

  return {
    jobs: visible,
    facets,
    // Optimistically-dismissed rows are gone from the list, so they have to be
    // gone from the count too — "906 postings" over 905 cards is a small lie
    // that lasts until the next fetch. `hasMore` still compares the raw
    // numbers, because paging is about what the server has, not what's shown.
    total: Math.max(0, total - hidden.size),
    loading,
    loadingMore,
    error,
    hasMore: jobs.length < total,
    loadMore,
    hide,
    unhide,
    reload,
  };
}
