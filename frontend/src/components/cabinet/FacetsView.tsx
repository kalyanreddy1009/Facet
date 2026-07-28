"use client";

import { useReducedMotion } from "framer-motion";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardSummary } from "@/lib/api";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import StatNumber from "./StatNumber";
import { CHART } from "./chartTheme";

interface FacetsViewProps {
  summary: DashboardSummary;
  onSetFacet: (id: number) => void;
}

function gapSentence(gap: number): string {
  if (gap === 0) return "Everything you've cut has been sent.";
  if (gap > 0) return `${gap} facet${gap === 1 ? "" : "s"} cut but not sent yet.`;
  return "You've sent more than you've cut recently — nothing waiting in the wings.";
}

export default function FacetsView({ summary, onSetFacet }: FacetsViewProps) {
  const reduced = useReducedMotion();
  const { cut, set, gap } = summary.cut_vs_set;
  const trend = summary.clarity_score_trend.map((row) => ({
    date: row.created_at.slice(5, 10),
    score: row.ats_score,
  }));

  return (
    <div className="flex flex-col gap-4">
      <Panel className="p-5">
        <div className="flex gap-10">
          <StatNumber label="Cut" value={String(cut)} />
          <StatNumber label="Sent" value={String(set)} />
        </div>
        <p className="text-sm text-text-faint mt-4">{gapSentence(gap)}</p>
      </Panel>

      <Panel className="p-5">
        <p className="label mb-4">Clarity score over time</p>
        {trend.length > 1 ? (
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="date" stroke={CHART.grid} tick={CHART.tick} tickLine={false} />
                <YAxis
                  domain={[0, 100]}
                  stroke={CHART.grid}
                  tick={CHART.tick}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip contentStyle={CHART.tooltip} cursor={{ stroke: CHART.grid }} />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke={CHART.accent}
                  strokeWidth={1.75}
                  dot={{ fill: CHART.accent, r: 2, strokeWidth: 0 }}
                  activeDot={{ r: 3.5 }}
                  // recharts animates in JS, so the reduced-motion block in
                  // globals.css can't reach it.
                  isAnimationActive={!reduced}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-text-faint py-10 text-center">
            Two facets needed before there&apos;s a trend to draw.
          </p>
        )}
      </Panel>

      <Panel className="p-5">
        <p className="label mb-2">Cut, not sent yet</p>
        {summary.cut_not_sent_yet.length === 0 ? (
          <p className="text-sm text-text-faint">Nothing sitting idle.</p>
        ) : (
          <ul className="flex flex-col">
            {summary.cut_not_sent_yet.map((application) => (
              <li
                key={application.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 border-b border-border last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm text-text truncate">
                    {application.company} · {application.role_title}
                  </p>
                  {application.ats_score !== null && (
                    <p className="text-xs text-text-faint mt-0.5 tnum">
                      Clarity score {application.ats_score}
                    </p>
                  )}
                </div>
                <Button onClick={() => onSetFacet(application.id)}>Mark as sent</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
