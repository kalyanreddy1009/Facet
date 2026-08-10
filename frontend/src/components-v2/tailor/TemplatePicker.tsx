"use client";

/** v2's template picker — same collapsed-by-default contract and same
 *  `/resume-templates/{id}.webp` previews as v1's `components/tailor/
 *  TemplatePicker.tsx`. Server-published `traits`/`selected` are the only
 *  source of truth; nothing about the seven templates is hardcoded here. */

import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { api, type ResumeTemplate } from "@/lib/api";

function Preview({ id, name }: { id: string; name: string }) {
  return (
    <img
      src={`/resume-templates/${id}.webp`}
      alt={`${name} template, one page`}
      style={{ width: "100%", height: "auto", border: "1px solid var(--v2-border)", borderRadius: "2px" }}
      width={560}
      height={725}
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}

export default function TemplatePicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [templates, setTemplates] = useState<ResumeTemplate[] | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .resumeTemplates()
      .then((data) => {
        if (!live) return;
        setTemplates(data.templates);
        if (value === null) onChange(data.selected);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return null;

  const current = templates?.find((t) => t.id === value) ?? null;

  return (
    <section className="v2-panel v2-sans" style={{ padding: 0, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="v2-template-grid"
        className="w-full flex items-center justify-between gap-4 p-4 text-left"
      >
        <span className="flex flex-col gap-1 min-w-0">
          <span className="v2-label" style={{ marginBottom: 0 }}>
            Resume template
          </span>
          <span className="text-sm truncate" style={{ color: "var(--v2-text)" }}>
            {current ? (
              <>
                {current.name}
                <span style={{ color: "var(--v2-text-faint)" }}> · {current.best_for}</span>
              </>
            ) : (
              <span style={{ color: "var(--v2-text-faint)" }}>Loading…</span>
            )}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-xs hidden sm:inline" style={{ color: "var(--v2-text-faint)" }}>
            {open ? "Close" : "Change"}
          </span>
          <ChevronDown
            className="w-4 h-4"
            style={{ color: "var(--v2-text-faint)", transform: open ? "rotate(180deg)" : undefined, transition: "transform 200ms" }}
            aria-hidden
          />
        </span>
      </button>

      {open && templates && (
        <div
          id="v2-template-grid"
          role="radiogroup"
          aria-label="Resume template"
          className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3"
          style={{ borderTop: "1px solid var(--v2-border)" }}
        >
          {templates.map((template) => {
            const selected = template.id === value;
            return (
              <button
                key={template.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange(template.id)}
                className="text-left"
                style={{
                  border: `1px solid ${selected ? "var(--v2-accent)" : "var(--v2-border)"}`,
                  borderRadius: "var(--v2-radius)",
                  padding: "0.6rem",
                  background: "var(--v2-bg)",
                }}
              >
                <Preview id={template.id} name={template.name} />
                <span className="flex items-center gap-1.5 mt-2">
                  <span className="text-sm font-medium" style={{ color: "var(--v2-text)" }}>
                    {template.name}
                  </span>
                  {selected && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--v2-accent)" }} aria-hidden />}
                </span>
                <span className="text-xs text-pretty leading-snug mt-0.5 block" style={{ color: "var(--v2-text-faint)" }}>
                  {template.best_for}
                </span>
              </button>
            );
          })}
          {current && (
            <p className="col-span-2 md:col-span-4 text-xs text-pretty" style={{ color: "var(--v2-text-faint)" }}>
              {current.blurb} All seven are single-column with standard section headings, so they
              parse the same way — what changes is how it reads to the person who opens it.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
