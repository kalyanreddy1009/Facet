"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Scissors } from "lucide-react";
import Button from "@/components/ui/Button";
import OptionCards, { type Option } from "@/components/ui/OptionCards";
import Panel from "@/components/ui/Panel";
import type { TailorRequestBody } from "@/lib/api";
import { readHandoff } from "@/lib/handoff";

const JD_MAX_CHARS = 15000;

interface TailorFormProps {
  onSubmit: (body: TailorRequestBody) => void;
  disabled: boolean;
  onPrefilled?: (company: string) => void;
}

const MODES: Option<NonNullable<TailorRequestBody["truthfulness_mode"]>>[] = [
  {
    value: "strict",
    label: "Strict",
    blurb:
      "Only claims stated outright in your Stone. Nothing inferred, nothing softened — the default for a reason.",
  },
  {
    value: "inferred_adjacent",
    label: "Infer adjacent skills",
    blurb:
      "Also claims skills genuinely implied by a real accomplishment — flagged separately so you can cut anything you won't stand behind.",
  },
];

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-xs text-text-faint">{hint}</span>}
    </label>
  );
}

export default function TailorForm({ onSubmit, disabled, onPrefilled }: TailorFormProps) {
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [mode, setMode] = useState<TailorRequestBody["truthfulness_mode"]>("strict");

  // Arriving from a posting in The Rough — fill everything we already know.
  useEffect(() => {
    const handoff = readHandoff();
    if (!handoff) return;
    setCompany(handoff.company);
    setRoleTitle(handoff.role_title);
    setJobDescription(handoff.job_description);
    setJobUrl(handoff.job_url);
    onPrefilled?.(handoff.company);
  }, [onPrefilled]);

  const canSubmit = Boolean(
    company.trim() && roleTitle.trim() && jobDescription.trim() && !disabled
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          company: company.trim(),
          role_title: roleTitle.trim(),
          job_description: jobDescription,
          truthfulness_mode: mode,
          job_url: jobUrl.trim() || undefined,
        });
      }}
      className="flex flex-col gap-4"
    >
      <Panel className="p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company">
            <input
              className="field"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Stripe"
              required
            />
          </Field>
          <Field label="Role title">
            <input
              className="field"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="Senior Backend Engineer"
              required
            />
          </Field>
        </div>

        <Field label="Posting URL" hint="Optional — stored with the application in your Cabinet.">
          <input
            className="field"
            type="url"
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="label">Job description</span>
            <span
              className={`text-xs tnum ${
                jobDescription.length > JD_MAX_CHARS * 0.9 ? "text-warn" : "text-text-faint"
              }`}
            >
              {jobDescription.length.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}
            </span>
          </div>
          <textarea
            className="field resize-y"
            rows={11}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value.slice(0, JD_MAX_CHARS))}
            placeholder="Paste the full job description…"
            required
          />
        </div>
      </Panel>

      <Panel className="p-5 flex flex-col gap-3">
        <p className="label">Truthfulness</p>

        <OptionCards
          value={mode ?? "strict"}
          options={MODES}
          onChange={setMode}
          label="Truthfulness mode"
          className="sm:grid-cols-2"
        />

        <p className="text-xs text-text-faint text-pretty">
          Employers, titles and dates are never touched by either mode.
        </p>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={!canSubmit}
          loading={disabled}
          icon={Scissors}
          cap={canSubmit ? ArrowRight : undefined}
          className="btn-lg"
        >
          Cut a facet
        </Button>
        {!canSubmit && !disabled && (
          <span className="text-sm text-text-faint">
            Company, role and description are all required.
          </span>
        )}
      </div>
    </form>
  );
}
