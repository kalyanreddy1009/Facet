"use client";

import { memo } from "react";
import { ArrowUpRight, Scissors, X } from "lucide-react";
import type { Job } from "@/lib/api";
import { formatSalary, matchTone, plainText, timeAgo } from "@/lib/format";

interface JobCardProps {
  job: Job;
  active?: boolean;
  onDismiss: (job: Job) => void;
  onTailor: (job: Job) => void;
  onOpen: (job: Job) => void;
}

const TONE_CLASS = {
  strong: "v2-badge-ok",
  fair: "",
  weak: "",
  none: "",
} as const;

function MatchBadge({ score }: { score: number | null }) {
  const tone = matchTone(score);
  if (tone === "none") return null;
  return (
    <span className={`v2-badge v2-mono ${TONE_CLASS[tone]}`}>{Math.round(score!)}% match</span>
  );
}

const MATCH_TERMS_SHOWN = 5;

function MatchTerms({ terms }: { terms: string[] }) {
  if (terms.length === 0) return null;
  const shown = terms.slice(0, MATCH_TERMS_SHOWN);
  const rest = terms.length - shown.length;
  return (
    <p className="text-xs mt-2" style={{ color: "var(--v2-text-faint)" }}>
      <span className="v2-mono">Matches</span>{" "}
      <span style={{ color: "var(--v2-text-dim)" }}>{shown.join(" · ")}</span>
      {rest > 0 && (
        <span className="v2-mono" title={terms.slice(MATCH_TERMS_SHOWN).join(", ")}>
          {" "}
          +{rest} more
        </span>
      )}
    </p>
  );
}

function Meta({ items }: { items: string[] }) {
  const parts = items.filter(Boolean);
  if (parts.length === 0) return null;
  return <span>{parts.join(" · ")}</span>;
}

function JobCardBase({ job, active, onDismiss, onTailor, onOpen }: JobCardProps) {
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency);
  const posted = timeAgo(job.posted_date || job.first_seen_at);
  const summary = plainText(job.summary);
  const remote = job.remote === 1 && !/remote/i.test(job.location || "") ? "Remote" : "";

  return (
    <article
      className="v2-panel v2-sans flex flex-col sm:flex-row gap-4"
      style={active ? { borderColor: "var(--v2-accent)" } : undefined}
      aria-current={active ? "true" : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <h2 className="text-base font-semibold" style={{ color: "var(--v2-text)" }}>
            {job.posting_url ? (
              <a
                href={job.posting_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onOpen(job)}
                title="Opens the posting in a new tab"
                className="py-2 hover:underline"
                style={{ color: "inherit" }}
              >
                {job.title || "Untitled role"}
                <span className="v2-sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              job.title || "Untitled role"
            )}
          </h2>
          <MatchBadge score={job.match_score} />
          {job.promoted === 1 && <span className="v2-badge">Tailored</span>}
        </div>

        <p className="mt-1 text-sm" style={{ color: "var(--v2-text-dim)" }}>
          <span style={{ color: "var(--v2-text)" }}>{job.company || "Unknown company"}</span>
          {(job.location || remote || salary) && " · "}
          <Meta items={[job.location || "", remote, salary]} />
        </p>

        {summary && (
          <p
            className="text-sm mt-2 overflow-hidden"
            style={{
              color: "var(--v2-text-faint)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {summary}
          </p>
        )}

        <MatchTerms terms={job.match_terms} />

        <p className="text-xs mt-2" style={{ color: "var(--v2-text-faint)" }}>
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
        <button type="button" className="v2-btn v2-btn-primary" onClick={() => onTailor(job)}>
          <Scissors className="w-3.5 h-3.5" aria-hidden />
          Tailor
        </button>
        {job.posting_url && (
          <a
            href={job.posting_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpen(job)}
            className="v2-btn"
          >
            Open
            <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
          </a>
        )}
        <button
          type="button"
          onClick={() => onDismiss(job)}
          className="v2-btn sm:mt-auto"
          aria-label={`Dismiss ${job.title ?? "posting"}`}
        >
          <X className="w-3.5 h-3.5" aria-hidden />
          <span className="sm:hidden">Dismiss</span>
        </button>
      </div>
    </article>
  );
}

const JobCard = memo(
  JobCardBase,
  (a, b) =>
    a.active === b.active &&
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
