"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, FileDown, FileText, Mail } from "lucide-react";
import ScoreRing from "./ScoreRing";
import { API_BASE, type TailorResponse } from "@/lib/api";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="v2-btn"
      style={{ minHeight: "1.75rem", padding: "0 0.6rem", fontSize: "0.75rem" }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard permission denied — nothing useful to do.
        }
      }}
    >
      {copied ? <Check className="w-3 h-3" aria-hidden /> : <Copy className="w-3 h-3" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="v2-panel v2-sans">
      <div className="flex items-center justify-between gap-3 mb-3" style={{ minHeight: "1.75rem" }}>
        <p className="v2-label" style={{ marginBottom: 0 }}>
          {title}
        </p>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function TailorResult({ result }: { result: TailorResponse }) {
  const { tailored_fields: fields, application, weak_match } = result;

  const downloads = [
    { href: `/api/applications/${application.id}/resume-file`, label: "Resume PDF", icon: FileDown },
    { href: `/api/applications/${application.id}/docx-file`, label: "Resume DOCX", icon: FileText },
    { href: `/api/applications/${application.id}/cover-letter-file`, label: "Cover letter", icon: Mail },
  ];

  return (
    <div className="flex flex-col gap-4 v2-sans">
      {weak_match && (
        <div className="v2-panel flex items-start gap-2.5" style={{ borderColor: "var(--v2-warn)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" style={{ color: "var(--v2-warn)" }} aria-hidden />
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--v2-text)" }}>
              Weak match
            </p>
            <p className="text-sm mt-0.5 text-pretty" style={{ color: "var(--v2-text-dim)" }}>
              This description overlaps little with your Stone. Read the bullets closely before you send anything.
            </p>
          </div>
        </div>
      )}

      <div className="v2-panel flex flex-col sm:flex-row items-center gap-6">
        <ScoreRing score={fields.match_score} />
        <div className="flex-1 flex flex-col gap-3 text-center sm:text-left">
          <div>
            <p className="text-base font-semibold" style={{ color: "var(--v2-text)" }}>
              {application.role_title} · {application.company}
            </p>
            <p className="text-sm mt-0.5" style={{ color: "var(--v2-text-faint)" }}>
              Same layout every time — only the emphasis changed.
            </p>
          </div>
          <div className="flex flex-wrap justify-center sm:justify-start gap-2">
            {downloads.map((file) => (
              <a key={file.href} href={`${API_BASE}${file.href}`} className="v2-btn" download>
                <file.icon className="w-3.5 h-3.5" aria-hidden />
                {file.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      <Section title="Executive summary" action={<CopyButton text={fields.tailored_summary} />}>
        <p className="text-base text-pretty" style={{ color: "var(--v2-text)" }}>
          {fields.tailored_summary}
        </p>
      </Section>

      <Section title="Skill alignment">
        <div className="flex flex-wrap gap-1.5">
          {fields.matching_skills.map((skill) => (
            <span key={`m-${skill}`} className="v2-badge">
              {skill}
            </span>
          ))}
          {fields.inferred_skills.map((skill) => (
            <span key={`i-${skill}`} className="v2-badge v2-badge-warn">
              {skill} · inferred
            </span>
          ))}
        </div>
        {fields.missing_and_absent.length > 0 && (
          <>
            <p className="text-sm mt-4 text-pretty" style={{ color: "var(--v2-text-faint)" }}>
              Asked for by the posting, left out because your Stone doesn&apos;t support it:
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--v2-text-dim)" }}>
              {fields.missing_and_absent.join(" · ")}
            </p>
          </>
        )}
      </Section>

      <Section title="Tailored bullets">
        <div className="flex flex-col gap-3">
          {Object.entries(fields.role_bullets).map(([roleId, bullets]) => (
            <div key={roleId} className="v2-panel-tight v2-panel">
              <ul className="flex flex-col gap-2">
                {bullets.map((bullet, i) => (
                  <li key={i} className="text-sm flex gap-2.5 text-pretty" style={{ color: "var(--v2-text)" }}>
                    <span aria-hidden style={{ color: "var(--v2-text-faint)" }}>
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
        <p className="text-base text-pretty" style={{ color: "var(--v2-text)" }}>
          {fields.recruiter_summary}
        </p>
      </Section>
    </div>
  );
}
