"use client";

/**
 * The one question the Cabinet exists to answer: what needs me now.
 *
 * This used to be spread across two tabs. "Needs a follow-up" lived under
 * Applications, "Cut, not sent yet" lived under Facets, and an interview
 * happening tomorrow lived under Interviews — three clicks to assemble a
 * to-do list, with no indication from any one tab that the other two had
 * anything waiting. Somebody opening this page mid-hunt is not asking "how is
 * my Facets sub-domain performing"; they are asking what to do before they
 * close the laptop. So the three merge into one queue, ordered by how soon it
 * matters rather than by which endpoint returned it.
 *
 * Every row carries its action inline. A queue you have to navigate away from
 * to act on is a list of regrets.
 */

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, CheckCircle2 } from "lucide-react";
import type { Application, Interview } from "@/lib/api";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { parseDate } from "@/lib/format";

export interface ActionQueueProps {
  /** Overdue follow-ups: Set 5+ days ago and still silent. */
  followups: Application[];
  /** Cut but never sent. */
  unsent: Application[];
  /** All interviews; only the future ones surface here. */
  interviews: Interview[];
  applicationsById: Map<number, Application>;
  onUpdateStatus: (id: number, status: Application["status"]) => void;
  /** Anything already sent at all — decides which "nothing waiting" line is true. */
  hasSentAnything: boolean;
}

type Row = {
  id: string;
  /** Lower sorts first. Time-critical beats merely overdue beats idle. */
  rank: number;
  kind: string;
  title: string;
  detail: string;
  action: React.ReactNode;
};

const DAY = 86_400_000;

function daysAgo(value: string, now: number): number {
  const date = parseDate(value);
  if (!date) return 0;
  return Math.max(0, Math.floor((now - date.getTime()) / DAY));
}

/** "in 3 days", "tomorrow", "today" — a date needs arithmetic done in the
 *  reader's head before it means anything, and urgency is the whole point. */
function daysUntil(date: Date, now: number): string {
  const days = Math.round((date.getTime() - now) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export default function ActionQueue({
  followups,
  unsent,
  interviews,
  applicationsById,
  onUpdateStatus,
  hasSentAnything,
}: ActionQueueProps) {
  // The clock is read once per mount, not once per render: "in 3 days" must
  // not silently become "in 2 days" because an unrelated state change caused a
  // re-render, and a render that reads `Date.now()` is not idempotent. Every
  // action on this queue triggers a reload anyway, which is when the numbers
  // are meant to move.
  const [now] = useState(() => Date.now());
  const rows: Row[] = [];

  for (const interview of interviews) {
    const when = parseDate(interview.scheduled_at);
    // Unscheduled and past interviews are history, not a task. They stay in
    // the full list below; putting them here would dilute the one section
    // that is supposed to be entirely actionable.
    if (!when || when.getTime() < now) continue;
    const application = applicationsById.get(interview.application_id);
    if (!application) continue;
    rows.push({
      id: `interview-${interview.id}`,
      rank: when.getTime(),
      kind: "Interview",
      title: `${application.company} · ${interview.round_name || "Interview"}`,
      detail: `${daysUntil(when, now)} - ${when.toLocaleString()}`,
      action: (
        <Link href="#interviews" className="btn btn-default">
          <CalendarPlus className="w-3.5 h-3.5" aria-hidden />
          Details
        </Link>
      ),
    });
  }

  for (const application of followups) {
    const days = daysAgo(application.updated_at, now);
    rows.push({
      id: `followup-${application.id}`,
      // After the interviews (which are keyed on a real timestamp) but ordered
      // among themselves by how long the silence has run.
      rank: Number.MAX_SAFE_INTEGER - 1_000_000 - days,
      kind: "Silent",
      title: `${application.company} · ${application.role_title}`,
      detail: `Sent ${days} days ago, no reply`,
      action: (
        <>
          <Button onClick={() => onUpdateStatus(application.id, "Interviewing")}>
            Interviewing
          </Button>
          <Button variant="quiet" onClick={() => onUpdateStatus(application.id, "Rejected")}>
            Rejected
          </Button>
        </>
      ),
    });
  }

  for (const application of unsent) {
    rows.push({
      id: `unsent-${application.id}`,
      rank: Number.MAX_SAFE_INTEGER,
      kind: "Not sent",
      title: `${application.company} · ${application.role_title}`,
      detail:
        application.ats_score !== null
          ? `Cut, never sent · clarity ${application.ats_score}`
          : "Cut, never sent",
      action: (
        <Button icon={CheckCircle2} onClick={() => onUpdateStatus(application.id, "Set")}>
          Mark as sent
        </Button>
      ),
    });
  }

  rows.sort((a, b) => a.rank - b.rank);

  return (
    <section aria-labelledby="waiting-heading">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 id="waiting-heading" className="text-base font-semibold text-text">
          Waiting on you
        </h2>
        {rows.length > 0 && (
          <span className="text-xs text-text-faint tnum">
            {rows.length} {rows.length === 1 ? "item" : "items"}
          </span>
        )}
      </div>

      <Panel className="p-5">
        {rows.length === 0 ? (
          /* Two different silences, and conflating them is how a tracker
             tells a new user everything is under control when they have not
             started. */
          <p className="text-sm text-text-faint text-pretty">
            {hasSentAnything
              ? "Nothing waiting on you - everything you've cut has been sent, and nothing has gone quiet long enough to chase."
              : "Nothing waiting on you yet. Cut a facet on The Rough and it will show up here until you've sent it."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-border first:pt-0 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm text-text truncate">
                    <span className="label mr-2">{row.kind}</span>
                    {row.title}
                  </p>
                  <p className="text-xs text-text-faint mt-0.5 tnum">{row.detail}</p>
                </div>
                <div className="flex gap-2 shrink-0">{row.action}</div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
