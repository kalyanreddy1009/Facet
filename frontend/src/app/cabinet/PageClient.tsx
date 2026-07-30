"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Archive, Calendar, Layers, PlugZap, RefreshCw } from "lucide-react";
import { api, type Application, type Contact, type DashboardSummary, type Interview } from "@/lib/api";
import InterviewsView from "@/components/cabinet/InterviewsView";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Segmented from "@/components/ui/Segmented";
import Toaster from "@/components/ui/Toaster";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToasts } from "@/lib/useToasts";
import { ENTER } from "@/lib/motion";

// Split out of the initial bundle so the shell and the tab strip paint before
// either view is parsed. (The 150KB of recharts this was originally written
// for is gone — the funnel is now the dependency-free PipelineView — but these
// are still the two heaviest views on the page and only one is ever visible.)
const viewSkeleton = () => <Skeleton className="h-64 w-full" />;
const ApplicationsView = dynamic(() => import("@/components/cabinet/ApplicationsView"), {
  ssr: false,
  loading: viewSkeleton,
});
const FacetsView = dynamic(() => import("@/components/cabinet/FacetsView"), {
  ssr: false,
  loading: viewSkeleton,
});

type ViewKey = "applications" | "facets" | "interviews";

const VIEWS = [
  { value: "applications" as const, label: "Applications", icon: Archive },
  { value: "facets" as const, label: "Facets", icon: Layers },
  { value: "interviews" as const, label: "Interviews", icon: Calendar },
];

export default function CabinetPage() {
  const reduced = useReducedMotion();
  const { toasts, push, dismiss, hold, resume } = useToasts();
  const [view, setView] = useState<ViewKey>("applications");

  /* The open tab lives in the URL fragment, so /cabinet#interviews is a link
     you can send yourself and a reload does not throw you back to
     Applications. Read in an effect rather than in the initial state: the
     server render has no fragment, and seeding state from `location` during
     render is a hydration mismatch. `replaceState` on change, not `push` —
     switching tabs should not fill the Back button with three entries of the
     same page. */
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (VIEWS.some((v) => v.value === fromHash)) setView(fromHash as ViewKey);
  }, []);

  const selectView = useCallback((next: ViewKey) => {
    setView(next);
    window.history.replaceState(null, "", next === "applications" ? " " : `#${next}`);
  }, []);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const loadAll = useCallback(async () => {
    setFailed(false);
    try {
      const [summaryRes, interviewsRes, applicationsRes, contactsRes] = await Promise.all([
        api.dashboardSummary(),
        api.listInterviews(),
        api.listApplications(),
        api.listContacts(),
      ]);
      setSummary(summaryRes);
      setInterviews(interviewsRes);
      setApplications(applicationsRes);
      setContacts(contactsRes);
    } catch (err) {
      // A toast is not enough here: it auto-dismisses and leaves an empty
      // page behind, which reads as "you have no applications" — the exact
      // wrong conclusion when the backend is simply down.
      setFailed(true);
      push(err instanceof Error ? err.message : "Couldn't load the Cabinet");
    } finally {
      setLoaded(true);
    }
  }, [push]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /** Optimistic status change — the row leaves its list immediately, and a
   *  failed write is reconciled by the reload either way. */
  const setStatus = async (id: number, status: Application["status"]) => {
    setSummary((prev) =>
      prev
        ? {
            ...prev,
            needs_followup: prev.needs_followup.filter((a) => a.id !== id),
            cut_not_sent_yet: prev.cut_not_sent_yet.filter((a) => a.id !== id),
          }
        : prev
    );
    try {
      await api.updateApplication(id, { status });
    } catch (err) {
      push(err instanceof Error ? err.message : "Couldn't update that application");
    } finally {
      await loadAll();
    }
  };

  const applicationsById = useMemo(
    () => new Map(applications.map((a) => [a.id, a])),
    [applications]
  );
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  return (
    <main className="max-w-shell mx-auto px-5 sm:px-8 py-8 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text">The Cabinet</h1>
        <p className="text-sm text-text-dim mt-1 max-w-prose text-pretty">
          What you&apos;ve cut, what you&apos;ve sent, and what&apos;s gone quiet.
        </p>
      </header>

      <Segmented value={view} segments={VIEWS} onChange={selectView} label="Cabinet view" />

      <div className="mt-5">
        {!loaded ? (
          // Two grey rectangles say nothing to a screen reader, and the page
          // announced neither that it was loading nor when it finished.
          <div className="flex flex-col gap-4" role="status" aria-label="Loading your cabinet">
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
        ) : failed ? (
          <EmptyState
            icon={PlugZap}
            title="Couldn't reach the backend"
            body="The Cabinet lives in your own database on the server, and nothing answered. Your data is fine — this page just can't read it right now."
            action={
              <Button variant="primary" icon={RefreshCw} onClick={loadAll}>
                Try again
              </Button>
            }
          />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -4 }}
              transition={ENTER}
            >
              {summary && view === "applications" && (
                <ApplicationsView summary={summary} onUpdateStatus={setStatus} />
              )}
              {summary && view === "facets" && (
                <FacetsView summary={summary} onSetFacet={(id) => setStatus(id, "Set")} />
              )}
              {view === "interviews" && (
                <InterviewsView
                  interviews={interviews}
                  applicationsById={applicationsById}
                  contactsById={contactsById}
                />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      <Toaster toasts={toasts} onDismiss={dismiss} onHold={hold} onResume={resume} />
    </main>
  );
}
