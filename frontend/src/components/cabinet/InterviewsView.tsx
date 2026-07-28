"use client";

import { CalendarPlus, CalendarX } from "lucide-react";
import type { Application, Contact, Interview } from "@/lib/api";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { parseDate } from "@/lib/format";

interface InterviewsViewProps {
  interviews: Interview[];
  applicationsById: Map<number, Application>;
  contactsById: Map<number, Contact>;
}

/** Escapes per RFC 5545 — an unescaped comma in a company name silently
 *  truncates the event title in most calendar apps. */
function icsEscape(value: string): string {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

function downloadIcs(interview: Interview, application: Application) {
  const start = parseDate(interview.scheduled_at) ?? new Date();
  const end = new Date(start.getTime() + 3_600_000);
  const stamp = (d: Date) => `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Facet//Cabinet//EN",
    "BEGIN:VEVENT",
    `UID:facet-interview-${interview.id}@local`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${icsEscape(`${interview.round_name || "Interview"} — ${application.company}`)}`,
    `DESCRIPTION:${icsEscape(`${application.role_title} at ${application.company}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `interview-${interview.id}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function InterviewsView({
  interviews,
  applicationsById,
  contactsById,
}: InterviewsViewProps) {
  // Unscheduled sorts last, not first — Infinity, not 0.
  const sorted = [...interviews].sort((a, b) => {
    const at = parseDate(a.scheduled_at)?.getTime() ?? Infinity;
    const bt = parseDate(b.scheduled_at)?.getTime() ?? Infinity;
    return at - bt;
  });

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={CalendarX}
        title="No interviews yet"
        body="Interviews appear here once you add them, or when calendar sync spots one and you confirm it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((interview) => {
        const application = applicationsById.get(interview.application_id);
        if (!application) return null;
        const contact = interview.contact_id ? contactsById.get(interview.contact_id) : null;
        const when = parseDate(interview.scheduled_at);

        return (
          <Panel key={interview.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-text">
                  {application.company} · {interview.round_name || "Interview"}
                </p>
                <p className="text-sm text-text-dim mt-0.5">
                  {when ? when.toLocaleString() : "Unscheduled"}
                </p>
              </div>
              <Button icon={CalendarPlus} onClick={() => downloadIcs(interview, application)}>
                Add to calendar
              </Button>
            </div>

            {contact && (
              <p className="text-sm text-text-dim mt-2">
                {contact.name}
                {contact.role_title ? `, ${contact.role_title}` : ""}
                {contact.email ? ` · ${contact.email}` : ""}
              </p>
            )}

            <p className="text-xs text-text-faint mt-2">
              Facet used: {application.resume_path || "not yet cut"}
            </p>

            {interview.notes && (
              <p className="text-sm text-text-dim mt-2 text-pretty">{interview.notes}</p>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
