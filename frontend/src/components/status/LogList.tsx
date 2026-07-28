"use client";

import { useState } from "react";
import type { LogEntry } from "@/lib/status";

const LEVEL_STYLE: Record<LogEntry["level"], string> = {
  CRITICAL: "badge-danger",
  ERROR: "badge-danger",
  WARNING: "badge-warn",
  INFO: "badge",
  DEBUG: "badge",
};

function timestamp(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toLocaleTimeString(undefined, { hour12: false });
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="divider last:border-0">
      <div
        className={`px-4 py-2 flex items-start gap-3 ${entry.traceback ? "row-hover cursor-pointer" : ""}`}
        onClick={entry.traceback ? () => setOpen((o) => !o) : undefined}
        role={entry.traceback ? "button" : undefined}
        tabIndex={entry.traceback ? 0 : undefined}
        onKeyDown={
          entry.traceback
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((o) => !o);
                }
              }
            : undefined
        }
      >
        <span className="text-2xs text-text-ghost tnum mono pt-0.5 shrink-0">
          {timestamp(entry.ts)}
        </span>
        <span className={`badge ${LEVEL_STYLE[entry.level]} shrink-0`}>{entry.level}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-text-dim break-words">{entry.message}</p>
          <p className="text-2xs text-text-ghost mt-0.5 mono">
            {entry.logger}
            {entry.path ? ` · ${entry.path}` : ""}
            {entry.traceback && !open ? " · click for traceback" : ""}
          </p>
        </div>
      </div>
      {open && entry.traceback && (
        <pre className="mx-4 mb-3 panel-inset p-3 text-2xs text-text-faint overflow-x-auto whitespace-pre">
          {entry.traceback}
        </pre>
      )}
    </div>
  );
}

export default function LogList({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="px-4 py-8 flex flex-col items-center gap-1.5">
        <span className="dot dot-ok" aria-hidden />
        <p className="text-xs text-text-dim">No warnings or errors logged.</p>
        <p className="text-2xs text-text-ghost">
          Everything since the backend started has run clean.
        </p>
      </div>
    );
  }

  return (
    <div>
      {entries.map((entry, i) => (
        <LogRow key={`${entry.ts}-${i}`} entry={entry} />
      ))}
    </div>
  );
}
