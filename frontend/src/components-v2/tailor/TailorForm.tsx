"use client";

/**
 * v2's Cut a Facet form — mirrors `components/tailor/TailorForm.tsx` field
 * for field and improvement for improvement (match preflight, ⌘/Ctrl+Enter,
 * visible/reversible draft restore, boilerplate trim offer, requirements
 * digest, template picker, sticky action bar), restructured as a numbered
 * `.v2-row` sequence instead of stacked `.panel` cards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ListChecks, RotateCcw, Scissors, Wand2 } from "lucide-react";
import MatchPreflight from "@/components-v2/tailor/MatchPreflight";
import TemplatePicker from "@/components-v2/tailor/TemplatePicker";
import { api, type TailorRequestBody } from "@/lib/api";
import { readHandoff, TAILOR_DRAFT_KEY as DRAFT_KEY } from "@/lib/handoff";
import { trimBoilerplate } from "@/lib/jdTrim";

const JD_MAX_CHARS = 15000;
const JD_MEANINGFUL = 120;

interface TailorFormProps {
  onSubmit: (body: TailorRequestBody) => void;
  disabled: boolean;
  onPrefilled?: (company: string) => void;
}

const MODES: Array<{
  value: NonNullable<TailorRequestBody["truthfulness_mode"]>;
  label: string;
  blurb: string;
}> = [
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

const REQUIREMENT_HINTS =
  /\b(must have|you (?:will|'ll)|experience (?:with|in|of)|proficien|familiar with|knowledge of|ability to|required|requirements?|responsib)/i;

function countRequirements(text: string): number {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length < 12 || line.length > 400) return false;
      const bulleted = /^[-–—•*·]|^\d+[.)]\s/.test(line);
      return bulleted || REQUIREMENT_HINTS.test(line);
    }).length;
}

function Step({
  index,
  title,
  hint,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="v2-panel v2-sans flex flex-col gap-4">
      <div className="flex items-baseline gap-2.5">
        <span className="v2-mono text-xs shrink-0" style={{ color: "var(--v2-text-faint)" }}>
          {String(index).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold" style={{ color: "var(--v2-text)" }}>
            {title}
          </h2>
          {hint && (
            <p className="text-xs mt-0.5 text-pretty" style={{ color: "var(--v2-text-faint)" }}>
              {hint}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="v2-label" style={{ marginBottom: 0 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-xs" style={{ color: "var(--v2-text-faint)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export default function TailorForm({ onSubmit, disabled, onPrefilled }: TailorFormProps) {
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [mode, setMode] = useState<TailorRequestBody["truthfulness_mode"]>("strict");
  const [template, setTemplate] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [keywords, setKeywords] = useState<string[] | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const atCap = jobDescription.length >= JD_MAX_CHARS;

  useEffect(() => {
    const handoff = readHandoff();
    if (handoff) {
      setCompany(handoff.company);
      setRoleTitle(handoff.role_title);
      setJobDescription(handoff.job_description);
      setJobUrl(handoff.job_url);
      onPrefilled?.(handoff.company);
      return;
    }
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const draft = JSON.parse(saved) as Partial<Record<string, string>>;
      setCompany(draft.company ?? "");
      setRoleTitle(draft.roleTitle ?? "");
      setJobUrl(draft.jobUrl ?? "");
      setJobDescription(draft.jobDescription ?? "");
      if (Object.values(draft).some(Boolean)) setRestored(true);
    } catch {
      // A corrupt draft is not worth a message; an empty form is the fallback.
    }
  }, [onPrefilled]);

  useEffect(() => {
    let live = true;
    api
      .profileKeywords()
      .then((data) => live && setKeywords(data.keywords))
      .catch(() => live && setKeywords([]));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const draft = { company, roleTitle, jobUrl, jobDescription };
    const empty = Object.values(draft).every((value) => !value);
    try {
      if (empty) sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Private mode, or a full quota. Losing the draft is survivable.
    }
  }, [company, roleTitle, jobUrl, jobDescription]);

  const canSubmit = Boolean(company.trim() && roleTitle.trim() && jobDescription.trim() && !disabled);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({
      company: company.trim(),
      role_title: roleTitle.trim(),
      job_description: jobDescription,
      truthfulness_mode: mode,
      job_url: jobUrl.trim() || undefined,
      resume_template: template ?? undefined,
    });
  }, [canSubmit, company, roleTitle, jobDescription, mode, jobUrl, template, onSubmit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      if (!formRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit]);

  const trim = useMemo(() => {
    if (jobDescription.length < 1500) return null;
    const result = trimBoilerplate(jobDescription);
    return result.saved > 300 ? result : null;
  }, [jobDescription]);

  const requirements = useMemo(
    () => (jobDescription.length >= JD_MEANINGFUL ? countRequirements(jobDescription) : 0),
    [jobDescription]
  );

  const discardDraft = () => {
    setCompany("");
    setRoleTitle("");
    setJobUrl("");
    setJobDescription("");
    setRestored(false);
  };

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      {restored && (
        <div className="v2-panel-tight v2-panel v2-sans flex items-center gap-2.5" role="status">
          <RotateCcw className="w-4 h-4 shrink-0" style={{ color: "var(--v2-text-faint)" }} aria-hidden />
          <p className="text-sm min-w-0" style={{ color: "var(--v2-text-dim)" }}>
            Picked up where you left off in this tab.{" "}
            <button
              type="button"
              onClick={discardDraft}
              className="underline"
              style={{ color: "var(--v2-accent)" }}
            >
              Start fresh
            </button>
          </p>
        </div>
      )}

      <Step index={1} title="The posting" hint="What you are applying to, and where it came from.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company">
            <input
              className="v2-field"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Stripe"
              required
            />
          </Field>
          <Field label="Role title">
            <input
              className="v2-field"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="Senior Backend Engineer"
              required
            />
          </Field>
        </div>

        <Field label="Posting URL" hint="Optional — stored with the application in your Cabinet.">
          <input
            className="v2-field"
            type="url"
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label className="v2-label" style={{ marginBottom: 0 }} htmlFor="v2-job-description">
              Job description
            </label>
            <div className="flex items-center gap-3">
              {requirements > 0 && (
                <span className="text-xs flex items-center gap-1.5" style={{ color: "var(--v2-text-faint)" }}>
                  <ListChecks className="w-3.5 h-3.5" aria-hidden />
                  <span className="v2-mono">{requirements}</span> requirement
                  {requirements === 1 ? "" : "s"}
                </span>
              )}
              <span
                className="text-xs v2-mono"
                style={{
                  color: atCap
                    ? "var(--v2-danger)"
                    : jobDescription.length > JD_MAX_CHARS * 0.9
                      ? "var(--v2-warn)"
                      : "var(--v2-text-faint)",
                }}
              >
                {jobDescription.length.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}
              </span>
            </div>
          </div>
          <textarea
            id="v2-job-description"
            className="v2-field resize-y"
            rows={11}
            value={jobDescription}
            onChange={(e) => {
              const next = e.target.value;
              setTruncated(next.length > JD_MAX_CHARS);
              setJobDescription(next.slice(0, JD_MAX_CHARS));
            }}
            placeholder="Paste the full job description…"
            aria-describedby={truncated ? "v2-jd-truncated" : undefined}
            required
          />
          {truncated && (
            <p id="v2-jd-truncated" role="status" className="text-xs" style={{ color: "var(--v2-danger)" }}>
              That was longer than {JD_MAX_CHARS.toLocaleString()} characters, so the end was cut.
              Trim the boilerplate — benefits, legal, company blurb — and keep the requirements.
            </p>
          )}

          {trim && (
            <div className="v2-panel-tight v2-panel flex items-start gap-2.5">
              <Wand2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--v2-accent)" }} aria-hidden />
              <div className="min-w-0 flex flex-col gap-1">
                <p className="text-sm" style={{ color: "var(--v2-text)" }}>
                  Found <span className="v2-mono">{trim.saved.toLocaleString()}</span> characters of boilerplate
                </p>
                <p className="text-xs text-pretty" style={{ color: "var(--v2-text-faint)" }}>
                  {[...new Set(trim.removed)].slice(0, 4).join(" · ")}
                  {new Set(trim.removed).size > 4 && ` +${new Set(trim.removed).size - 4} more`} — none of it
                  describes the job.{" "}
                  <button
                    type="button"
                    onClick={() => setJobDescription(trim.text)}
                    className="underline"
                    style={{ color: "var(--v2-accent)" }}
                  >
                    Remove it
                  </button>
                </p>
              </div>
            </div>
          )}

          <MatchPreflight jobDescription={jobDescription} keywords={keywords} />
        </div>
      </Step>

      <Step index={2} title="How it may argue" hint="Employers, titles and dates are never touched by either mode.">
        <div role="radiogroup" aria-label="Truthfulness mode" className="grid gap-2 sm:grid-cols-2">
          {MODES.map((option) => {
            const active = option.value === (mode ?? "strict");
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setMode(option.value)}
                className="text-left p-3"
                style={{
                  borderRadius: "var(--v2-radius)",
                  border: `1px solid ${active ? "var(--v2-accent)" : "var(--v2-border)"}`,
                  background: "var(--v2-bg)",
                }}
              >
                <span className="text-sm font-medium" style={{ color: active ? "var(--v2-text)" : "var(--v2-text-dim)" }}>
                  {option.label}
                </span>
                <p className="text-xs mt-1 text-pretty" style={{ color: "var(--v2-text-faint)" }}>
                  {option.blurb}
                </p>
              </button>
            );
          })}
        </div>
      </Step>

      <Step index={3} title="How it will look" hint="Applies to the resume. Remembered for next time.">
        <TemplatePicker value={template} onChange={setTemplate} disabled={disabled} />
      </Step>

      <div className="v2-actionbar">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="v2-btn v2-btn-primary"
            style={{ minHeight: "2.5rem", padding: "0 1.25rem" }}
          >
            <Scissors className="w-4 h-4" aria-hidden />
            {disabled ? "Cutting…" : "Cut a facet"}
            {canSubmit && !disabled && <ArrowRight className="w-4 h-4" aria-hidden />}
          </button>
          {canSubmit && !disabled && (
            <span className="text-xs hidden sm:flex items-center gap-1.5 v2-mono" style={{ color: "var(--v2-text-faint)" }}>
              ⌘↵ to cut
            </span>
          )}
          {!canSubmit && !disabled && (
            <span className="text-sm" style={{ color: "var(--v2-text-faint)" }}>
              Company, role and description are all required.
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
