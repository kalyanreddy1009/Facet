"use client";

import type { Application, DashboardSummary } from "@/lib/api";
import Panel from "@/components/ui/Panel";
import SendingTrend from "@/components/cabinet/SendingTrend";
import Button from "@/components/ui/Button";
import StatNumber from "./StatNumber";
import PipelineView from "./PipelineView";
import { parseDate } from "@/lib/format";

interface ApplicationsViewProps {
  summary: DashboardSummary;
  onUpdateStatus: (id: number, status: Application["status"]) => void;
}

function daysAgo(value: string): number {
  const date = parseDate(value);
  if (!date) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

export default function ApplicationsView({ summary, onUpdateStatus }: ApplicationsViewProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel className="p-5 flex flex-col gap-5">
          <StatNumber
            label="Response rate"
            value={
              summary.response_rate === null ? "—" : `${Math.round(summary.response_rate * 100)}%`
            }
            hint="Interviewing plus offers, over everything you actually sent."
          />
          <div className="grid grid-cols-2 gap-4 pt-5 border-t border-border">
            <StatNumber label="Rejected" value={String(summary.rejected_count)} />
            <StatNumber label="Offers" value={String(summary.funnel.Offer)} />
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

      {/* The trajectory question, which the pipeline above cannot answer:
          a snapshot on a bad week and a good week look identical. */}
      <SendingTrend summary={summary} />

      <Panel className="p-5">
        <p className="label mb-2">Needs a follow-up — set 5+ days ago, still silent</p>
        {summary.needs_followup.length === 0 ? (
          <p className="text-sm text-text-faint text-pretty">
            {summary.funnel.Set > 0
              ? "Nothing waiting on you — everything you've sent is still inside the five-day window."
              : "Nothing waiting on you. Nothing has been marked Set yet, so nothing can be overdue."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {summary.needs_followup.map((application) => (
              <li
                key={application.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-border last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm text-text truncate">
                    {application.company} · {application.role_title}
                  </p>
                  <p className="text-xs text-text-faint mt-0.5 tnum">
                    Set {daysAgo(application.updated_at)} days ago
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button onClick={() => onUpdateStatus(application.id, "Interviewing")}>
                    Interviewing
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() => onUpdateStatus(application.id, "Rejected")}
                  >
                    Rejected
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
