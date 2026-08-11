"use client";

/**
 * The Cut a Facet form, revamped.
 *
 * The workflow is unchanged and deliberately so: company, role, optional URL,
 * job description, truthfulness mode, cut. Everything a returning user knows
 * still works, the handoff from The Rough still fills the fields, and the
 * draft still survives a mis-click on the nav.
 *
 * What changed is that the page now helps while you fill it in rather than
 * only after you submit. The improvements, each marked where it lives:
 *
 *   1. MatchPreflight — the overlap score and its evidence, as you paste,
 *      instead of a warning that arrives after a five-minute run.
 *   2. Keyboard — ⌘/Ctrl+Enter cuts from anywhere in the form.
 *   3. Draft notice — the restore is now visible and reversible.
 *   4. Boilerplate trim — offered when the description is long.
 *   5. Sticky action bar — the primary action stays reachable on a long form.
 *   6. Requirements digest — what the posting actually asks for, counted.
 *   7. Field grouping — the form is three labelled steps, not one wall.
 *
 * (The template picker is the eighth and lives in its own component.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ListChecks, RotateCcw, Scissors, Sparkles, Wand2 } from "lucide-react";
import Button from "@/components/ui/Button";
import OptionCards, { type Option } from "@/components/ui/OptionCards";
import MatchPreflight from "@/components/tailor/MatchPreflight";
import TemplatePicker from "@/components/tailor/TemplatePicker";
import { api, type TailorRequestBody } from "@/lib/api";
import { readHandoff, TAILOR_DRAFT_KEY as DRAFT_KEY } from "@/lib/handoff";
import { trimBoilerplate } from "@/lib/jdTrim";

const JD_MAX_CHARS = 15000;
/** Below this a description is too short to be worth analysing, and the
 *  helpers stay quiet rather than commenting on a half-finished paste. */
const JD_MEANINGFUL = 120;

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
      "Only claims stated outright in your Stone. Nothing inferred, nothing softened - the default for a reason.",
  },
  {
    value: "inferred_adjacent",
    label: "Infer adjacent skills",
    blurb:
      "Also claims skills genuinely implied by a real accomplishment - flagged separately so you can cut anything you won't stand behind.",
  },
];

/**
 * IMPROVEMENT 6 — the requirements digest.
 *
 * A long posting hides what it is actually asking for inside a wall of prose.
 * This counts the requirement-shaped lines — bullets, and sentences built
 * around "must have" / "you will" / "experience with" — so you can see at a
 * glance whether you have pasted a posting with ten requirements or one with
 * fifty, and whether the part that matters made it in before the cap.
 *
 * A count and nothing more. Extracting and re-displaying them would be a
 * second, worse copy of the posting; the number is the useful part.
 */
const REQUIREMENT_HINTS =
  /\b(must have|you (?:will|'ll)|experience (?:with|in|of)|proficien|familiar with|knowledge of|ability to|required|requirements?|responsib)/i;

function countRequirements(text: string): number {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length < 12 || line.length > 400) return false;
      const bulleted = /^[-–-•*·]|^\d+[.)]\s/.test(line);
      return bulleted || REQUIREMENT_HINTS.test(line);
    }).length;
}

/** A labelled step. Three of them, so the form reads as a sequence rather than
 *  as one long panel of inputs — which is most of the revamp. */
function Step({
  index,
  title,
  hint,
  children,
  className = "",
}: {
  index: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-5 flex flex-col gap-4 ${className}`}>
      <div className="flex items-baseline gap-2.5">
        <span className="mono text-2xs text-text-ghost tnum shrink-0">
          {String(index).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text">{title}</h2>
          {hint && <p className="text-xs text-text-faint mt-0.5 text-pretty">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

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
  const [template, setTemplate] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [keywords, setKeywords] = useState<string[] | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const atCap = jobDescription.length >= JD_MAX_CHARS;

  // Arriving from a posting in The Rough — fill everything we already know.
  // A handoff always wins over a restored draft: it is the more recent
  // intention, and it is the reason this page was opened.
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
    // Otherwise pick up whatever was being typed before. Pasting a full job
    // description is the most tedious thing this app asks anyone to do, and
    // losing it to a mis-click on the nav — with no undo and nothing in the
    // back button — was the worst small failure left in the product.
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const draft = JSON.parse(saved) as Partial<Record<string, string>>;
      setCompany(draft.company ?? "");
      setRoleTitle(draft.roleTitle ?? "");
      setJobUrl(draft.jobUrl ?? "");
      setJobDescription(draft.jobDescription ?? "");
      // IMPROVEMENT 3. The restore used to be silent, which is unnerving when
      // you meant to start fresh and instead find someone else's posting in
      // the box — and there was no way back to empty except selecting it all.
      if (Object.values(draft).some(Boolean)) setRestored(true);
    } catch {
      // A corrupt draft is not worth a message; an empty form is the fallback.
    }
  }, [onPrefilled]);

  // The Stone's vocabulary for the live pre-check. One request, not one per
  // keystroke — see lib/match.ts.
  useEffect(() => {
    let live = true;
    api
      .profileKeywords()
      .then((data) => live && setKeywords(data.keywords))
      // No profile yet, or the backend is restarting. The pre-check simply
      // does not appear; it is a help, not a prerequisite.
      .catch(() => live && setKeywords([]));
    return () => {
      live = false;
    };
  }, []);

  // Kept in sessionStorage, not localStorage: a draft belongs to this tab and
  // this sitting, and a shared machine should not find someone's job hunt in
  // it tomorrow. Cleared the moment the fields are empty.
  useEffect(() => {
    const draft = { company, roleTitle, jobUrl, jobDescription };
    const empty = Object.values(draft).every((value) => !value);
    try {
      if (empty) sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Private mode, or a full quota. Losing the draft is survivable; a
      // crash while typing is not.
    }
  }, [company, roleTitle, jobUrl, jobDescription]);

  const canSubmit = Boolean(
    company.trim() && roleTitle.trim() && jobDescription.trim() && !disabled
  );

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({
      company: company.trim(),
      role_title: roleTitle.trim(),
      job_description: jobDescription,
      truthfulness_mode: mode,
      job_url: jobUrl.trim() || undefined,
      // Omitted rather than guessed if the picker never loaded — the server
      // then applies whichever template the last cut used.
      resume_template: template ?? undefined,
    });
  }, [canSubmit, company, roleTitle, jobDescription, mode, jobUrl, template, onSubmit]);

  // IMPROVEMENT 2. ⌘/Ctrl+Enter from anywhere in the form, including from
  // inside the textarea where Enter has to keep meaning "new line". This is
  // the one shortcut worth having here: the description is long, the button is
  // far away, and the gesture is the same one every mail client uses to send.
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

  // IMPROVEMENT 4. Only computed when it could matter — the trim is cheap but
  // pointless on a short posting, and the offer should not appear at all
  // unless it would actually save something worth having.
  const trim = useMemo(() => {
    // 1,500 rather than 3,000. The first threshold was set by guesswork and a
    // realistic posting — role, requirements, benefits, an EEO paragraph —
    // came to 2,200 characters, so the offer never appeared on exactly the
    // kind of posting it was built for. What actually decides whether the
    // offer is worth making is how much it would remove, which is the second
    // condition; the length check is only there to skip the work on a short
    // paste.
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
        <div className="preflight" role="status">
          <RotateCcw className="w-4 h-4 text-text-faint shrink-0" aria-hidden />
          <p className="text-sm text-text-dim min-w-0">
            Picked up where you left off in this tab.{" "}
            <button
              type="button"
              onClick={discardDraft}
              className="text-accent-text hover:underline focus-visible:underline underline-offset-2"
            >
              Start fresh
            </button>
          </p>
        </div>
      )}

      {/* IMPROVEMENT 7 — three labelled steps. The form was one long panel of
          six inputs; it is the same six inputs, grouped by what they are for,
          so the page can be scanned rather than read. */}
      <Step index={1} title="The posting" hint="What you are applying to, and where it came from.">
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

        <Field label="Posting URL" hint="Optional - stored with the application in your Cabinet.">
          <input
            className="field"
            type="url"
            value={jobUrl}
            onChange={(e) => setJobUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <label className="label" htmlFor="job-description">
              Job description
            </label>
            <div className="flex items-center gap-3">
              {requirements > 0 && (
                <span className="text-xs text-text-faint flex items-center gap-1.5">
                  <ListChecks className="w-3.5 h-3.5" aria-hidden />
                  <span className="tnum">{requirements}</span> requirement
                  {requirements === 1 ? "" : "s"}
                </span>
              )}
              <span
                className={`text-xs tnum ${
                  atCap
                    ? "text-danger-text"
                    : jobDescription.length > JD_MAX_CHARS * 0.9
                      ? "text-warn-text"
                      : "text-text-faint"
                }`}
              >
                {jobDescription.length.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}
              </span>
            </div>
          </div>
          <textarea
            id="job-description"
            className="field resize-y"
            rows={11}
            value={jobDescription}
            onChange={(e) => {
              // The cap was enforced by a silent `slice`: pasting a 20,000
              // character posting dropped a quarter of it, including the
              // requirements at the bottom, and the only evidence was a
              // counter nobody was looking at. Say it out loud instead.
              const next = e.target.value;
              setTruncated(next.length > JD_MAX_CHARS);
              setJobDescription(next.slice(0, JD_MAX_CHARS));
            }}
            placeholder="Paste the full job description…"
            aria-describedby={truncated ? "jd-truncated" : undefined}
            required
          />
          {truncated && (
            <p id="jd-truncated" role="status" className="text-xs text-danger-text">
              That was longer than {JD_MAX_CHARS.toLocaleString()} characters, so the end was cut.
              Trim the boilerplate - benefits, legal, company blurb - and keep the requirements.
            </p>
          )}

          {trim && (
            <div className="preflight">
              <Wand2 className="w-4 h-4 text-accent-text shrink-0" aria-hidden />
              <div className="min-w-0 flex flex-col gap-1">
                <p className="text-sm text-text">
                  Found <span className="tnum">{trim.saved.toLocaleString()}</span> characters of
                  boilerplate
                </p>
                <p className="text-xs text-text-faint text-pretty">
                  {[...new Set(trim.removed)].slice(0, 4).join(" · ")}
                  {new Set(trim.removed).size > 4 &&
                    ` +${new Set(trim.removed).size - 4} more`} - none of it
                  describes the job.{" "}
                  <button
                    type="button"
                    onClick={() => setJobDescription(trim.text)}
                    className="text-accent-text hover:underline focus-visible:underline underline-offset-2"
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

      <Step
        index={2}
        title="How it may argue"
        hint="Employers, titles and dates are never touched by either mode."
      >
        <OptionCards
          value={mode ?? "strict"}
          options={MODES}
          onChange={setMode}
          label="Truthfulness mode"
          className="sm:grid-cols-2"
        />
      </Step>

      <Step index={3} title="How it will look" hint="Applies to the resume. Remembered for next time.">
        <TemplatePicker value={template} onChange={setTemplate} disabled={disabled} />
      </Step>

      {/* IMPROVEMENT 5 — the action bar sticks to the bottom of the viewport.
          The form is now three panels tall and the primary action used to sit
          below all of them, so on a laptop you pasted a description, scrolled
          past everything, and hunted for the button. */}
      <div className="cut-bar">
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
          {canSubmit && !disabled && (
            <span className="text-xs text-text-faint hidden sm:flex items-center gap-1.5">
              <kbd className="kbd">⌘</kbd>
              <kbd className="kbd">↵</kbd>
              to cut
            </span>
          )}
          {!canSubmit && !disabled && (
            <span className="text-sm text-text-faint">
              Company, role and description are all required.
            </span>
          )}
          <span className="ml-auto text-xs text-text-faint hidden md:flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" aria-hidden />
            Resume, cover letter and pitch
          </span>
        </div>
      </div>
    </form>
  );
}
