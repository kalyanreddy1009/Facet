"use client";

/** v2's Cabinet — same four sections as v1's (frontend/src/app/cabinet/PageClient.tsx):
 *  what needs you, where things stand, is it moving, interviews. Ported to
 *  v2's flat-panel tokens; the section components live in components-v2/cabinet. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlugZap, RefreshCw } from "lucide-react";
import { api, type Application, type Contact, type DashboardSummary, type Interview } from "@/lib/api";
import {
  ActionQueue,
  ClaritySparkline,
  InterviewsView,
  PipelineView,
  SendingTrend,
  StatNumber,
} from "@/components-v2/cabinet/CabinetSections";
import V2Toaster from "@/components-v2/Toast";
import { useToasts } from "@/lib/useToasts";

export default function CabinetPage() {
  const { toasts, push, dismiss } = useToasts();
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
      setFailed(true);
      push(err instanceof Error ? err.message : "Couldn't load the Cabinet");
    } finally {
      setLoaded(true);
    }
  }, [push]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

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

  const applicationsById = useMemo(() => new Map(applications.map((a) => [a.id, a])), [applications]);
  const contactsById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  return (
    <main className="v2-main w-full">
      <header className="mb-6">
        <p className="v2-eyebrow mb-1">Tracker</p>
        <h1 className="v2-h1">The Cabinet</h1>
        <p className="v2-lede mt-1 max-w-prose text-pretty">
          What you&apos;ve cut, what you&apos;ve sent, and what&apos;s gone quiet.
        </p>
      </header>

      {!loaded ? (
        <div className="flex flex-col gap-4" role="status" aria-label="Loading your cabinet">
          <div className="v2-panel h-40 w-full animate-pulse" />
          <div className="v2-panel h-56 w-full animate-pulse" />
        </div>
      ) : failed || !summary ? (
        <div className="v2-panel flex flex-col items-center text-center gap-2 py-14">
          <PlugZap className="w-5 h-5 text-[var(--v2-danger)]" aria-hidden />
          <p className="v2-sans text-base font-semibold text-[var(--v2-text)]">
            Couldn&apos;t reach the backend
          </p>
          <p className="v2-sans text-sm text-[var(--v2-text-faint)] max-w-md text-pretty">
            The Cabinet lives in your own database on the server, and nothing answered. Your data is
            fine — this page just can&apos;t read it right now.
          </p>
          <button type="button" className="v2-btn v2-btn-primary mt-3" onClick={loadAll}>
            <RefreshCw className="w-3.5 h-3.5" aria-hidden />
            Try again
          </button>
        </div>
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
            <h2 id="standing-heading" className="v2-h2 mb-2">
              Where things stand
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="v2-panel flex flex-col gap-5">
                <StatNumber
                  label="Response rate"
                  value={
                    summary.response_rate === null ? "—" : `${Math.round(summary.response_rate * 100)}%`
                  }
                  hint="Interviewing plus offers, over everything you actually sent."
                />
                <div className="grid grid-cols-2 gap-4 pt-5 border-t border-[var(--v2-border)]">
                  <StatNumber label="Rejected" value={String(summary.rejected_count)} />
                  <StatNumber label="Offers" value={String(summary.funnel.Offer)} />
                </div>
                <div className="pt-5 border-t border-[var(--v2-border)]">
                  <ClaritySparkline trend={summary.clarity_score_trend ?? []} />
                </div>
              </div>

              <div className="v2-panel">
                <p className="v2-label mb-4">Pipeline</p>
                <PipelineView
                  funnel={summary.funnel}
                  rejected={summary.rejected_count}
                  rejectedFrom={summary.rejected_from ?? {}}
                />
              </div>
            </div>
          </section>

          <section aria-labelledby="moving-heading">
            <h2 id="moving-heading" className="v2-h2 mb-2">
              Is it moving
            </h2>
            <SendingTrend summary={summary} />
          </section>

          <section id="interviews" aria-labelledby="interviews-heading" className="scroll-mt-24">
            <h2 id="interviews-heading" className="v2-h2 mb-2">
              Interviews
            </h2>
            <InterviewsView interviews={interviews} applicationsById={applicationsById} contactsById={contactsById} />
          </section>
        </div>
      )}

      <V2Toaster toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}
