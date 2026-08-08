"use client";

/**
 * One page, four sections, in the order the questions actually get asked:
 * what needs me now → where does everything stand → is it moving → the
 * interviews themselves.
 *
 * It used to be three tabs, and the tabs were drawn along the lines of the API
 * rather than along anything a person wants. "Needs a follow-up" sat under
 * Applications and "Cut, not sent yet" sat under Facets, so the two halves of
 * one to-do list were a click apart with nothing on either tab hinting that
 * the other had work in it. Meanwhile every tab re-answered "how many have I
 * cut" with a differently-computed number.
 *
 * The whole page is now roughly the height of what one tab used to be, because
 * removing the duplication removed most of the content. Sections carry `id`s,
 * so /cabinet#interviews still works as a link — it scrolls instead of
 * switching, which is what a fragment was always supposed to do.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlugZap, RefreshCw } from "lucide-react";
import { api, type Application, type Contact, type DashboardSummary, type Interview } from "@/lib/api";
import ActionQueue from "@/components/cabinet/ActionQueue";
import ClaritySparkline from "@/components/cabinet/ClaritySparkline";
import InterviewsView from "@/components/cabinet/InterviewsView";
import PipelineView from "@/components/cabinet/PipelineView";
import SendingTrend from "@/components/cabinet/SendingTrend";
import StatNumber from "@/components/cabinet/StatNumber";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import Toaster from "@/components/ui/Toaster";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToasts } from "@/lib/useToasts";

export default function CabinetPage() {
  const { toasts, push, dismiss, hold, resume } = useToasts();
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

  /** Optimistic status change — the row leaves the queue immediately, and a
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

      {!loaded ? (
        // Grey rectangles say nothing to a screen reader, so the region
        // announces that it is loading and, on replacement, that it is done.
        <div className="flex flex-col gap-4" role="status" aria-label="Loading your cabinet">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : failed || !summary ? (
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
        <div className="flex flex-col gap-8">
          <ActionQueue
            followups={summary.needs_followup}
            unsent={summary.cut_not_sent_yet}
            interviews={interviews}
            applicationsById={applicationsById}
            onUpdateStatus={setStatus}
            hasSentAnything={summary.funnel.Set > 0}
          />

          <section aria-labelledby="standing-heading">
            <h2 id="standing-heading" className="text-base font-semibold text-text mb-2">
              Where things stand
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Panel className="p-5 flex flex-col gap-5">
                <StatNumber
                  label="Response rate"
                  value={
                    summary.response_rate === null
                      ? "—"
                      : `${Math.round(summary.response_rate * 100)}%`
                  }
                  hint="Interviewing plus offers, over everything you actually sent."
                />
                <div className="grid grid-cols-2 gap-4 pt-5 border-t border-border">
                  <StatNumber label="Rejected" value={String(summary.rejected_count)} />
                  <StatNumber label="Offers" value={String(summary.funnel.Offer)} />
                </div>
                <div className="pt-5 border-t border-border">
                  <ClaritySparkline trend={summary.clarity_score_trend ?? []} />
                </div>
              </Panel>

              <Panel className="p-5">
                <p className="label mb-4">Pipeline</p>
                <PipelineView
                  funnel={summary.funnel}
                  rejected={summary.rejected_count}
                  rejectedFrom={summary.rejected_from ?? {}}
                />
              </Panel>
            </div>
          </section>

          <section aria-labelledby="moving-heading">
            <h2 id="moving-heading" className="text-base font-semibold text-text mb-2">
              Is it moving
            </h2>
            {/* The trajectory question, which the pipeline cannot answer: a
                snapshot on a bad week and a good week look identical. */}
            <SendingTrend summary={summary} />
          </section>

          <section id="interviews" aria-labelledby="interviews-heading" className="scroll-mt-24">
            <h2 id="interviews-heading" className="text-base font-semibold text-text mb-2">
              Interviews
            </h2>
            <InterviewsView
              interviews={interviews}
              applicationsById={applicationsById}
              contactsById={contactsById}
            />
          </section>
        </div>
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} onHold={hold} onResume={resume} />
    </main>
  );
}
