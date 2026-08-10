"use client";

/** v2's Rough — same data source and behaviour as `app/rough/PageClient.tsx`
 *  (useJobs, useListKeyboard, handoff into Tailor, dismiss/undo, infinite
 *  scroll, live search, sources sheet), restructured into v2's flat panel
 *  language instead of v1's floating-pill / glass cards. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Rows2, Rows3, Settings2, X } from "lucide-react";
import { api, type Job } from "@/lib/api";
import FilterRail from "@/components-v2/rough/FilterRail";
import JobCard from "@/components-v2/rough/JobCard";
import SearchBar from "@/components-v2/rough/SearchBar";
import SourcesSheet from "@/components-v2/rough/SourcesSheet";
import Toaster from "@/components-v2/Toaster";
import { useListKeyboard } from "@/lib/useListKeyboard";
import { plainText, pluralize } from "@/lib/format";
import { TAILOR_HANDOFF_KEY } from "@/lib/handoff";
import { useModal } from "@/lib/useModal";
import { useToasts } from "@/lib/useToasts";
import { activeFilterCount, EMPTY_FILTERS, useJobs, type Filters } from "@/lib/useJobs";

export default function RoughPage() {
  const router = useRouter();
  const { toasts, push, dismiss, hold, resume } = useToasts();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [dense, setDense] = useState(false);

  useEffect(() => {
    try {
      setDense(localStorage.getItem("facet.v2.rough.dense") === "1");
    } catch {
      // Private mode — comfortable is the right fallback.
    }
  }, []);
  const toggleDense = useCallback(() => {
    setDense((on) => {
      try {
        localStorage.setItem("facet.v2.rough.dense", on ? "0" : "1");
      } catch {
        // Not worth surfacing; the toggle still works this sitting.
      }
      return !on;
    });
  }, []);

  const mobileFiltersRef = useRef<HTMLDivElement>(null);
  const closeMobileFilters = useCallback(() => setMobileFiltersOpen(false), []);
  useModal(mobileFiltersOpen, closeMobileFilters, mobileFiltersRef);

  const { jobs, facets, total, loading, loadingMore, error, hasMore, loadMore, hide, unhide, reload } =
    useJobs(filters);

  const notify = useCallback(
    (text: string, tone: "error" | "info" | "success", hint?: string) => push(text, { tone, hint }),
    [push]
  );

  const patch = useCallback((update: Partial<Filters>) => setFilters((f) => ({ ...f, ...update })), []);

  useEffect(() => {
    if (error) notify(error, "error");
  }, [error, notify]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && loadMore(),
      { rootMargin: "600px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const runLiveSearch = async () => {
    setSearching(true);
    try {
      const report = await api.liveSearch(filters.q, filters.location);
      const failed = Object.entries(report.sources).filter(([, s]) => s.error);
      reload();
      notify(
        report.new > 0
          ? `${pluralize(report.new, "new posting")} found`
          : "No new postings — everything matching is already listed.",
        "success",
        failed.length ? `${failed.length} source(s) didn't respond: ${failed.map(([n]) => n).join(", ")}` : undefined
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Search failed", "error");
    } finally {
      setSearching(false);
    }
  };

  const handleDismiss = async (job: Job) => {
    hide(job.id);
    try {
      await api.dismissJob(job.id);
      push(`Dismissed "${job.title}"`, {
        tone: "info",
        action: {
          label: "Undo",
          run: () => {
            unhide(job.id);
            api.restoreJob(job.id).catch(() => reload());
          },
        },
      });
    } catch {
      unhide(job.id);
      notify("Couldn't dismiss that posting", "error");
    }
  };

  const handleTailor = (job: Job) => {
    sessionStorage.setItem(
      TAILOR_HANDOFF_KEY,
      JSON.stringify({
        company: job.company ?? "",
        role_title: job.title ?? "",
        job_description: plainText(job.summary),
        job_url: job.posting_url ?? "",
      })
    );
    api.promoteJob(job.id).catch(() => {});
    router.push("/v2/tailor");
  };

  const handleOpen = (job: Job) => {
    api.promoteJob(job.id).catch(() => {});
  };

  const { index: cursor, containerRef } = useListKeyboard<Job>(jobs, {
    onOpen: (job) => {
      handleOpen(job);
      if (job.posting_url) window.open(job.posting_url, "_blank", "noopener,noreferrer");
    },
    onPrimary: handleTailor,
    onDismiss: handleDismiss,
  });

  const activeFilters = activeFilterCount(filters);

  return (
    <main className="v2-main">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-7">
        <div>
          <p className="v2-eyebrow mb-1">The pool</p>
          <h1 className="v2-h1">The Rough</h1>
          <p className="v2-lede mt-1.5 max-w-prose text-pretty">
            Every posting Facet has gathered, ranked against your Stone. Search runs locally and
            instantly; &ldquo;Search all boards&rdquo; goes out and fetches fresh ones.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="v2-btn" onClick={toggleDense}>
            {dense ? <Rows3 className="w-3.5 h-3.5" aria-hidden /> : <Rows2 className="w-3.5 h-3.5" aria-hidden />}
            <span className="v2-sr-only">Row density: </span>
            {dense ? "Compact" : "Comfortable"}
          </button>
          <button type="button" className="v2-btn" onClick={() => setSourcesOpen(true)}>
            <Settings2 className="w-3.5 h-3.5" aria-hidden />
            Sources
          </button>
          <button type="button" className="v2-btn v2-btn-primary" onClick={runLiveSearch} disabled={searching}>
            <RefreshCw className={`w-3.5 h-3.5 ${searching ? "animate-spin" : ""}`} aria-hidden />
            Sync
          </button>
        </div>
      </header>

      <SearchBar
        filters={filters}
        onChange={patch}
        onLiveSearch={runLiveSearch}
        onOpenFilters={() => setMobileFiltersOpen(true)}
        activeFilters={activeFilters}
        searching={searching}
      />

      <div className="flex gap-8 mt-6">
        <aside className="hidden lg:block w-60 shrink-0">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-1 -mr-1">
            <FilterRail filters={filters} facets={facets} onChange={patch} />
          </div>
        </aside>

        <section className="flex-1 min-w-0" aria-label="Job results" aria-busy={loading}>
          <div className="flex items-center justify-between gap-3 mb-3 h-6">
            <p className="text-sm v2-mono" style={{ color: "var(--v2-text-faint)" }} role="status" aria-live="polite">
              {loading ? "Searching…" : pluralize(total, "posting")}
              {filters.q && !loading && (
                <span style={{ color: "var(--v2-text-dim)" }}> for &ldquo;{filters.q}&rdquo;</span>
              )}
            </p>
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q, sort: filters.sort })}
                className="v2-btn lg:hidden"
                style={{ minHeight: "1.75rem", padding: "0 0.5rem", fontSize: "0.75rem" }}
              >
                Clear filters
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col gap-2" aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="v2-panel" style={{ height: "6.5rem", opacity: 0.5 }} />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="v2-panel text-center py-10 flex flex-col items-center gap-3 v2-sans">
              <p className="v2-h2">{total === 0 && !filters.q ? "Nothing gathered yet" : "No postings match"}</p>
              <p className="text-sm max-w-prose text-pretty" style={{ color: "var(--v2-text-dim)" }}>
                {total === 0 && !filters.q
                  ? "Facet hasn't pulled any postings yet. Sync to fetch from every configured source, or add more in Sources."
                  : "Try a broader search, widen the date range, or fetch fresh postings from the boards."}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                <button type="button" className="v2-btn v2-btn-primary" onClick={runLiveSearch} disabled={searching}>
                  <RefreshCw className={`w-3.5 h-3.5 ${searching ? "animate-spin" : ""}`} aria-hidden />
                  Search all boards
                </button>
                {total === 0 && !filters.q && (
                  <button type="button" className="v2-btn" onClick={() => setSourcesOpen(true)}>
                    <Settings2 className="w-3.5 h-3.5" aria-hidden />
                    Check sources
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div ref={containerRef} className="flex flex-col gap-2">
                {jobs.map((job, i) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    active={i === cursor}
                    onDismiss={handleDismiss}
                    onTailor={handleTailor}
                    onOpen={handleOpen}
                  />
                ))}
              </div>

              <div ref={sentinelRef} className="h-px" aria-hidden />
              {loadingMore && (
                <div className="mt-2 flex flex-col gap-2" aria-hidden>
                  <div className="v2-panel" style={{ height: "6.5rem", opacity: 0.5 }} />
                  <div className="v2-panel" style={{ height: "6.5rem", opacity: 0.5 }} />
                </div>
              )}
              {!hasMore && jobs.length > 8 && (
                <p className="text-center text-sm py-8" style={{ color: "var(--v2-text-faint)" }}>
                  That&apos;s everything matching.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {mobileFiltersOpen && (
        <div
          ref={mobileFiltersRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
          className="fixed inset-0 z-50 lg:hidden flex flex-col outline-none"
          style={{ background: "var(--v2-bg)" }}
        >
          <div
            className="px-5 h-14 flex items-center justify-between shrink-0"
            style={{ borderBottom: "1px solid var(--v2-border)" }}
          >
            <p className="text-base font-semibold" style={{ color: "var(--v2-text)" }}>
              Filters
            </p>
            <button type="button" onClick={() => setMobileFiltersOpen(false)} className="v2-btn" aria-label="Close filters">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <FilterRail filters={filters} facets={facets} onChange={patch} />
          </div>
          <div className="p-5" style={{ borderTop: "1px solid var(--v2-border)" }}>
            <button type="button" className="v2-btn v2-btn-primary w-full justify-center" onClick={() => setMobileFiltersOpen(false)}>
              Show {pluralize(total, "posting")}
            </button>
          </div>
        </div>
      )}

      <SourcesSheet
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        query={filters.q}
        location={filters.location}
        onChanged={reload}
        notify={notify}
      />

      <Toaster toasts={toasts} onDismiss={dismiss} onHold={hold} onResume={resume} />
    </main>
  );
}
