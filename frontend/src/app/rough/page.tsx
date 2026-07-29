"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, SearchX, Settings2, X } from "lucide-react";
import { api, type Job } from "@/lib/api";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { JobListSkeleton } from "@/components/ui/Skeleton";
import Toaster from "@/components/ui/Toaster";
import FilterRail from "@/components/jobs/FilterRail";
import JobCard from "@/components/jobs/JobCard";
import SearchBar from "@/components/jobs/SearchBar";
import SourcesSheet from "@/components/jobs/SourcesSheet";
import { pluralize } from "@/lib/format";
import { TAILOR_HANDOFF_KEY } from "@/lib/handoff";
import { useModal } from "@/lib/useModal";
import { useToasts } from "@/lib/useToasts";
import { activeFilterCount, EMPTY_FILTERS, useJobs, type Filters } from "@/lib/useJobs";

export default function RoughPage() {
  const router = useRouter();
  const { toasts, push, dismiss } = useToasts();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  // Full-screen and modal, so it owes the keyboard the same contract Sheet
  // does — Escape, focus in, Tab trap, scroll lock, focus restore.
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

  /* Infinite scroll — an observer on a sentinel, not a scroll listener, so
     nothing runs on the main thread while you're actually scrolling. */
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && loadMore(),
      { rootMargin: "600px" } // start fetching before the list runs out
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
    hide(job.id); // instant; the network call catches up
    try {
      await api.dismissJob(job.id);
      push(`Dismissed “${job.title}”`, {
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
        job_description: job.summary ?? "",
        job_url: job.posting_url ?? "",
      })
    );
    api.promoteJob(job.id).catch(() => {}); // bookkeeping, not worth blocking on
    router.push("/tailor");
  };

  const handleOpen = (job: Job) => {
    api.promoteJob(job.id).catch(() => {});
  };

  const activeFilters = activeFilterCount(filters);

  return (
    <main className="max-w-shell mx-auto px-5 sm:px-8 py-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-7">
        <div>
          <h1 className="text-2xl font-semibold text-text">The Rough</h1>
          <p className="text-sm text-text-dim mt-1 max-w-prose text-pretty">
            Every posting Facet has gathered, ranked against your Stone. Search runs locally and
            instantly; &ldquo;Search all boards&rdquo; goes out and fetches fresh ones.
          </p>
        </div>
        <div className="flex gap-2">
          <Button icon={Settings2} onClick={() => setSourcesOpen(true)}>
            Sources
          </Button>
          <Button icon={RefreshCw} onClick={runLiveSearch} loading={searching}>
            Sync
          </Button>
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
          <div className="sticky top-[calc(var(--nav-h)+1.5rem)] max-h-[calc(100vh-var(--nav-h)-3rem)] overflow-y-auto pr-1 -mr-1">
            <FilterRail filters={filters} facets={facets} onChange={patch} />
          </div>
        </aside>

        <section className="flex-1 min-w-0" aria-label="Job results" aria-busy={loading}>
          <div className="flex items-center justify-between gap-3 mb-3 h-6">
            <p className="text-sm text-text-faint tnum" role="status" aria-live="polite">
              {loading ? "Searching…" : pluralize(total, "posting")}
              {filters.q && !loading && <span className="text-text-dim"> for “{filters.q}”</span>}
            </p>
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={() => setFilters({ ...EMPTY_FILTERS, q: filters.q, sort: filters.sort })}
                className="btn btn-ghost btn-sm lg:hidden"
              >
                Clear filters
              </button>
            )}
          </div>

          {loading ? (
            <JobListSkeleton />
          ) : jobs.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={total === 0 && !filters.q ? "Nothing gathered yet" : "No postings match"}
              body={
                total === 0 && !filters.q
                  ? "Facet hasn't pulled any postings yet. Sync to fetch from every configured source, or add more in Sources."
                  : "Try a broader search, widen the date range, or fetch fresh postings from the boards."
              }
              action={
                <Button variant="primary" icon={RefreshCw} onClick={runLiveSearch} loading={searching}>
                  Search all boards
                </Button>
              }
            />
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onDismiss={handleDismiss}
                    onTailor={handleTailor}
                    onOpen={handleOpen}
                  />
                ))}
              </div>

              <div ref={sentinelRef} className="h-px" aria-hidden />
              {loadingMore && (
                <div className="mt-2">
                  <JobListSkeleton count={2} />
                </div>
              )}
              {!hasMore && jobs.length > 8 && (
                <p className="text-center text-sm text-text-faint py-8">
                  That&apos;s everything matching.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      {/* Filters as a full-screen layer on small screens — a 240px rail has
          nowhere to live under 1024px. */}
      {mobileFiltersOpen && (
        <div
          ref={mobileFiltersRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
          className="fixed inset-0 z-50 bg-bg lg:hidden flex flex-col outline-none"
        >
          <div className="divider px-5 h-nav flex items-center justify-between shrink-0">
            <p className="text-base font-semibold text-text">Filters</p>
            <button type="button" onClick={() => setMobileFiltersOpen(false)} className="btn btn-ghost" aria-label="Close filters">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <FilterRail filters={filters} facets={facets} onChange={patch} />
          </div>
          <div className="p-5 border-t border-border shrink-0">
            <Button variant="primary" className="w-full" onClick={() => setMobileFiltersOpen(false)}>
              Show {pluralize(total, "posting")}
            </Button>
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

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}
