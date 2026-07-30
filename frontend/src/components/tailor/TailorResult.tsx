"use client";

import { AlertTriangle, FileDown, FileText, Mail } from "lucide-react";
import CopyButton from "@/components/ui/CopyButton";
import Panel from "@/components/ui/Panel";
import ScoreRing from "./ScoreRing";
import { API_BASE, type TailorResponse } from "@/lib/api";

interface TailorResultProps {
  result: TailorResponse;
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Panel className="p-5">
      {/* Reserves the height of the optional `.btn-sm` action so a section
          with one and a section without still line up. */}
      <div className="flex items-center justify-between gap-3 mb-3 min-h-[var(--control-h-sm)]">
        <p className="label">{title}</p>
        {action}
      </div>
      {children}
    </Panel>
  );
}

export default function TailorResult({ result }: TailorResultProps) {
  const { tailored_fields: fields, application, weak_match } = result;

  const downloads = [
    { href: `/api/applications/${application.id}/resume-file`, label: "Resume PDF", icon: FileDown },
    { href: `/api/applications/${application.id}/docx-file`, label: "Resume DOCX", icon: FileText },
    {
      href: `/api/applications/${application.id}/cover-letter-file`,
      label: "Cover letter",
      icon: Mail,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {weak_match && (
        <div className="panel p-4 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-px" aria-hidden />
          <div>
            <p className="text-sm font-medium text-text">Weak match</p>
            <p className="text-sm text-text-dim mt-0.5 text-pretty">
              This description overlaps little with your Stone. Read the bullets closely before you
              send anything.
            </p>
          </div>
        </div>
      )}

      <Panel className="p-5 flex flex-col sm:flex-row items-center gap-6">
        <ScoreRing score={fields.match_score} />
        <div className="flex-1 flex flex-col gap-3 text-center sm:text-left">
          <div>
            <p className="text-base font-semibold text-text">
              {application.role_title} · {application.company}
            </p>
            <p className="text-sm text-text-faint mt-0.5">
              Same layout every time — only the emphasis changed.
            </p>
          </div>
          <div className="flex flex-wrap justify-center sm:justify-start gap-2">
            {downloads.map((file) => (
              <a key={file.href} href={`${API_BASE}${file.href}`} className="btn btn-default" download>
                <file.icon className="w-3.5 h-3.5" aria-hidden />
                {file.label}
              </a>
            ))}
          </div>
        </div>
      </Panel>

      <Section title="Executive summary" action={<CopyButton text={fields.tailored_summary} />}>
        <p className="text-base text-text text-pretty">{fields.tailored_summary}</p>
      </Section>

      <Section title="Skill alignment">
        <div className="flex flex-wrap gap-1.5">
          {fields.matching_skills.map((skill) => (
            <span key={`m-${skill}`} className="badge">
              {skill}
            </span>
          ))}
          {/* Inferred claims are the one thing here you have to review, so they
              carry the warn tone. Everything else stays neutral. */}
          {fields.inferred_skills.map((skill) => (
            <span key={`i-${skill}`} className="badge badge-warn">
              {skill} · inferred
            </span>
          ))}
        </div>
        {fields.missing_and_absent.length > 0 && (
          <>
            <p className="text-sm text-text-faint mt-4 text-pretty">
              Asked for by the posting, left out because your Stone doesn&apos;t support it:
            </p>
            <p className="text-sm text-text-dim mt-1">
              {fields.missing_and_absent.join(" · ")}
            </p>
          </>
        )}
      </Section>

      <Section title="Tailored bullets">
        <div className="flex flex-col gap-3">
          {Object.entries(fields.role_bullets).map(([roleId, bullets]) => (
            <div key={roleId} className="panel-inset p-4">
              <ul className="flex flex-col gap-2">
                {bullets.map((bullet, i) => (
                  <li key={i} className="text-sm text-text flex gap-2.5 text-pretty">
                    <span className="text-text-ghost select-none" aria-hidden>
                      —
                    </span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Recruiter pitch" action={<CopyButton text={fields.recruiter_summary} />}>
        <p className="text-base text-text text-pretty">{fields.recruiter_summary}</p>
      </Section>
    </div>
  );
}
