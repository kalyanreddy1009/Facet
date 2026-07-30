"use client";

import { memo } from "react";
import { ArrowUpRight, Scissors, X } from "lucide-react";
import type { Job } from "@/lib/api";
import { formatSalary, matchTone, plainText, timeAgo } from "@/lib/format";

interface JobCardProps {
  job: Job;
  onDismiss: (job: Job) => void;
  onTailor: (job: Job) => void;
  onOpen: (job: Job) => void;
}

/** A match score is a measured state, so it keeps its colour — but only at the
 *  top of the range. Everything else is neutral. */
const TONE_CLASS = {
  strong: "badge-ok",
  fair: "",
  weak: "",
  none: "",
} as const;

function MatchBadge({ score }: { score: number | null }) {
  const tone = matchTone(score);
  if (tone === "none") return null;
  return (
    <span
      className={`badge tnum ${TONE_CLASS[tone]}`}
      title="How much this posting overlaps with the skills in your Stone"
    >
      {Math.round(score!)}% match
    </span>
  );
}

/** The evidence behind the score. A percentage alone is a number to distrust;
 *  naming the skills that actually hit is what makes the ranking legible — and
 *  it's the fastest way to spot a posting that scored high off one stray word.
 *
 *  Plain text, not pills: these sit next to the tag line, and two rows of
 *  chips would read as decoration and out-shout the title. */
const MATCH_TERMS_SHOWN = 5;

function MatchTerms({ terms }: { terms: string[] }) {
  if (terms.length === 0) return null; // pre-migration row, or a genuine zero
  const shown = terms.slice(0, MATCH_TERMS_SHOWN);
  const rest = terms.length - shown.length;
  return (
    <p className="mt-2 text-xs text-text-faint">
      <span className="label">Matches</span>{" "}
      <span className="text-text-dim">{shown.join(" · ")}</span>
      {rest > 0 && (
        <span className="tnum" title={terms.slice(MATCH_TERMS_SHOWN).join(", ")}>
          {" "}
          +{rest} more
        </span>
      )}
    </p>
  );
}

/** Metadata as one line of plain text, middot-separated — a wall of pills
 *  reads as decoration, not information. */
function Meta({ items }: { items: string[] }) {
  const parts = items.filter(Boolean);
  if (parts.length === 0) return null;
  return <span>{parts.join(" · ")}</span>;
}

/**
 * One row of the results list. Memoized on the fields it renders: dismissing
 * one card must not re-render the other 29.
 */
function JobCardBase({ job, onDismiss, onTailor, onOpen }: JobCardProps) {
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency);
  const posted = timeAgo(job.posted_date || job.first_seen_at);
  // Several feeds store the description as HTML; it is displayed as text.
  const summary = plainText(job.summary);
  const remote = job.remote === 1 && !/remote/i.test(job.location || "") ? "Remote" : "";

  return (
    <article className="list-row panel row-hover p-4 flex flex-col sm:flex-row gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <h3 className="text-base font-semibold text-text leading-snug">
            {/* A posting without a URL is a row, not a link. `href={undefined}`
                still renders an <a>, which drops out of the tab order and
                reads to a screen reader as a link that goes nowhere — so the
                title falls back to plain text instead. */}
            {job.posting_url ? (
              <a
                href={job.posting_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onOpen(job)}
                title="Opens the posting in a new tab"
                className="hover:text-accent-text transition-colors duration-fast focus-visible:text-accent-text"
              >
                {job.title || "Untitled role"}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              job.title || "Untitled role"
            )}
          </h3>
          <MatchBadge score={job.match_score} />
          {job.promoted === 1 && <span className="badge">Tailored</span>}
        </div>

        <p className="mt-1 text-sm text-text-dim">
          <span className="text-text">{job.company || "Unknown company"}</span>
          {(job.location || remote || salary) && " · "}
          <Meta items={[job.location || "", remote, salary]} />
        </p>

        {summary && <p className="clamp-2 text-sm text-text-faint mt-2">{summary}</p>}

        <MatchTerms terms={job.match_terms} />

        <p className="text-xs text-text-faint mt-2">
          <Meta
            items={[
              job.source || "Feed",
              job.employment_type || "",
              ...job.tags.slice(0, 3),
              posted,
            ]}
          />
        </p>
      </div>

      <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0">
        <button type="button" className="btn btn-primary" onClick={() => onTailor(job)}>
          <Scissors className="w-3.5 h-3.5" aria-hidden />
          Tailor
        </button>
        {job.posting_url && (
          <a
            href={job.posting_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpen(job)}
            className="btn btn-ghost"
          >
            Open
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
          </a>
        )}
        <button
          type="button"
          onClick={() => onDismiss(job)}
          className="btn btn-ghost sm:mt-auto"
          aria-label={`Dismiss ${job.title ?? "posting"}`}
        >
          <X className="w-3.5 h-3.5" aria-hidden />
          <span className="sm:hidden">Dismiss</span>
        </button>
      </div>
    </article>
  );
}

/** Re-render only when something this card actually draws has changed.
 *
 *  The previous comparator watched `id` and `promoted` alone, which meant a
 *  re-scored row after a Sync kept the old match percentage and the old
 *  matching terms until the list unmounted — the numbers on screen quietly
 *  stopped agreeing with the sort order they were driving. Everything the
 *  card renders is compared here; `match_terms` by identity, because the API
 *  hands back a fresh array on every fetch and comparing the contents costs
 *  more than the render it would save. */
const JobCard = memo(
  JobCardBase,
  (a, b) =>
    a.job.id === b.job.id &&
    a.job.promoted === b.job.promoted &&
    a.job.title === b.job.title &&
    a.job.company === b.job.company &&
    a.job.match_score === b.job.match_score &&
    a.job.match_terms === b.job.match_terms &&
    a.job.summary === b.job.summary &&
    a.job.posting_url === b.job.posting_url
);

export default JobCard;
