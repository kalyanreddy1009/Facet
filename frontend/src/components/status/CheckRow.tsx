"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { STATUS_LABEL, STATUS_STYLE, type Check } from "@/lib/status";

/** Sub-millisecond checks read as noise; round them honestly instead. */
function formatLatency(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export default function CheckRow({ check }: { check: Check }) {
  const [open, setOpen] = useState(false);
  const style = STATUS_STYLE[check.status];
  const meta = Object.entries(check.meta ?? {});
  const expandable = meta.length > 0 || Boolean(check.hint);
  const latency = formatLatency(check.latency_ms);

  return (
    <div className="divider last:border-0">
      <div
        className={`flex items-start gap-3 px-4 py-2.5 ${expandable ? "row-hover cursor-pointer" : ""}`}
        onClick={expandable ? () => setOpen((o) => !o) : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((o) => !o);
                }
              }
            : undefined
        }
      >
        <span
          className={`dot ${style.dot} mt-2`}
          role="img"
          aria-label={STATUS_LABEL[check.status]}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-medium text-text">{check.label}</span>
            {check.status !== "ok" && (
              <span className={`text-xs ${style.text}`}>{STATUS_LABEL[check.status]}</span>
            )}
          </div>
          <p className="text-xs text-text-dim mt-0.5 text-pretty">{check.detail}</p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {latency && <span className="text-2xs text-text-ghost tnum">{latency}</span>}
          {expandable && (
            <ChevronRight
              className={`w-3.5 h-3.5 text-text-ghost transition-transform duration-fast ${
                open ? "rotate-90" : ""
              }`}
              aria-hidden
            />
          )}
        </div>
      </div>

      {open && (
        <div className="px-4 pb-3 pl-10 flex flex-col gap-2.5">
          {check.hint && (
            <p className="text-xs text-text-dim panel-inset px-3 py-2 text-pretty">{check.hint}</p>
          )}
          {meta.length > 0 && (
            <dl className="grid grid-cols-[minmax(0,auto)_1fr] gap-x-4 gap-y-1">
              {meta.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-2xs text-text-faint py-0.5">{key}</dt>
                  <dd className="text-2xs text-text-dim mono tnum py-0.5 break-all">
                    {value === null ? "—" : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
