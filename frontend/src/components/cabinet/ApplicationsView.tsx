"use client";

import { useReducedMotion } from "framer-motion";
import { Funnel, FunnelChart, LabelList, ResponsiveContainer, Tooltip } from "recharts";
import type { Application, DashboardSummary } from "@/lib/api";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import StatNumber from "./StatNumber";
import { CHART, FUNNEL_COLORS } from "./chartTheme";
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
  const reduced = useReducedMotion();
  const funnelData = Object.entries(summary.funnel).map(([stage, value]) => ({
    name: stage,
    value,
    fill: FUNNEL_COLORS[stage],
  }));
  const hasFunnel = funnelData.some((entry) => entry.value > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel className="p-5 flex flex-col justify-between gap-4">
          <StatNumber
            label="Response rate"
            value={
              summary.response_rate === null ? "—" : `${Math.round(summary.response_rate * 100)}%`
            }
            hint="Interviewing plus offers, over everything you actually sent."
          />
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
            <StatNumber label="Rejected" value={String(summary.rejected_count)} />
            <StatNumber label="Offers" value={String(summary.funnel.Offer)} />
          </div>
        </Panel>

        <Panel className="p-5">
          <p className="label mb-4">Funnel</p>
          {hasFunnel ? (
            <div style={{ width: "100%", height: 190 }}>
              <ResponsiveContainer>
                <FunnelChart>
                  <Tooltip contentStyle={CHART.tooltip} cursor={false} />
                  {/* recharts animates in JS, out of reach of the
                      reduced-motion block in globals.css. */}
                  <Funnel dataKey="value" data={funnelData} isAnimationActive={!reduced}>
                    <LabelList
                      position="right"
                      dataKey="name"
                      fill={CHART.label}
                      stroke="none"
                      fontSize={12}
                    />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-text-faint py-10 text-center">
              Nothing to plot yet — cut a facet and set it.
            </p>
          )}
        </Panel>
      </div>

      <Panel className="p-5">
        <p className="label mb-2">Needs a follow-up — set 5+ days ago, still silent</p>
        {summary.needs_followup.length === 0 ? (
          <p className="text-sm text-text-faint">Nothing waiting on you.</p>
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
