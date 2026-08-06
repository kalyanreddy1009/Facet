"use client";

/**
 * Which of the seven resume templates this cut will use.
 *
 * The picker sits *before* the cut rather than after it, because the template
 * is an input to the render and re-cutting to change it would spend another
 * agy run — up to five minutes — on a decision that costs nothing to make
 * first.
 *
 * IT REMEMBERS, AND THAT IS THE WHOLE INTERACTION. The server stores the last
 * template used in settings.json, hands it back with the catalog, and applies
 * it whether or not this page sends one. So the ordinary path is: arrive,
 * ignore this section entirely, get the same template as last time. Choosing
 * is the exception, and the section is built to be skipped — collapsed to a
 * single line naming the current choice, and opened only if you want to look.
 *
 * THE PREVIEWS ARE DRAWN, NOT SCREENSHOTTED. Seven thumbnail images would be
 * seven files to keep in step with seven templates, and they would go stale
 * silently the first time a template changed. Instead each card renders a
 * miniature from the same `traits` the backend publishes alongside the
 * template — serif or sans, centred or ranged left, where the rules fall, how
 * dense the lines are. A preview cannot claim a layout the registry does not
 * describe, and a template whose traits change redraws its own preview.
 */

import { useEffect, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { api, type ResumeTemplate } from "@/lib/api";

/* The miniature, in three pieces hoisted to module scope.
   Declaring these inside Preview would recreate them on every render, which
   resets their identity each time — React's `static-components` rule catches
   it, and it is a real cost here because seven previews redraw whenever the
   picker opens. */

/** A hairline, standing in for a rule under a heading or between roles. */
function Rule() {
  return <div className="tpl-rule" />;
}

/** A line of body text. Bars rather than lorem ipsum: at 96px wide real words
 *  are unreadable noise, and a bar reads instantly as "this is a page". */
function Line({ w, h }: { w: number; h: number }) {
  return <div className="tpl-line" style={{ width: `${w}%`, height: h }} />;
}

/** A section: whatever heading treatment the template uses, then body lines. */
function Section({
  traits,
  widths,
  gap,
  lineH,
  serif,
}: {
  traits: ResumeTemplate["traits"];
  widths: number[];
  gap: number;
  lineH: number;
  serif: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {traits.rules === "band" ? (
        <div className="tpl-band" />
      ) : (
        <div className="tpl-head" style={{ fontFamily: serif ? "Georgia, serif" : undefined }} />
      )}
      {traits.rules === "heading" && <Rule />}
      {widths.map((w, i) => (
        <Line key={i} w={w} h={lineH} />
      ))}
    </div>
  );
}

/** The whole page, drawn from the traits the backend publishes for this
 *  template — so a preview can never claim a layout the renderer lacks. */
function Preview({ traits }: { traits: ResumeTemplate["traits"] }) {
  const serif = traits.family === "serif" || traits.family === "mixed";
  const dense = traits.density === "dense";
  const airy = traits.density === "airy";
  const gap = dense ? 2.5 : airy ? 5 : 3.5;
  const lineH = dense ? 1.5 : 2;

  return (
    <div className="tpl-page" aria-hidden>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap,
          alignItems: traits.align === "center" ? "center" : "stretch",
        }}
      >
        {/* The name block. Centred templates centre it; everything else ranges
            left, which is the most visible difference between Chicago and the
            rest at thumbnail size. */}
        <div
          className="tpl-name"
          style={{
            width: traits.align === "center" ? "58%" : "44%",
            fontFamily: serif ? "Georgia, serif" : undefined,
          }}
        />
        <Line w={traits.align === "center" ? 76 : 62} h={1.5} />
      </div>
      {traits.rules === "header" && <Rule />}
      <div style={{ display: "flex", flexDirection: "column", gap: gap * 2 }}>
        <Section traits={traits} widths={[100, 88]} gap={gap} lineH={lineH} serif={serif} />
        <Section traits={traits} widths={[100, 72]} gap={gap} lineH={lineH} serif={serif} />
        {/* The experience block, where the templates differ most: dates above
            the role, company leading, or a rule between entries. */}
        <div style={{ display: "flex", flexDirection: "column", gap }}>
          {traits.rules === "band" ? <div className="tpl-band" /> : <div className="tpl-head" />}
          {traits.rules === "heading" && <Rule />}
          {[0, 1].map((role) => (
            <div key={role} style={{ display: "flex", flexDirection: "column", gap: gap * 0.7 }}>
              {role > 0 && traits.rules === "between" && <Rule />}
              {traits.dates === "above" && <Line w={26} h={lineH} />}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                <div
                  className="tpl-line tpl-line-strong"
                  style={{ width: "46%", height: lineH + 0.5 }}
                />
                {traits.dates !== "above" && <Line w={28} h={lineH} />}
              </div>
              <Line w={34} h={lineH} />
              <Line w={96} h={lineH} />
              <Line w={dense ? 90 : 78} h={lineH} />
            </div>
          ))}
        </div>
      </div>
    </div>
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
        // Only adopt the server's remembered choice if this page has not
        // already made one — otherwise a slow response would silently undo a
        // click the user has already made.
        if (value === null) onChange(data.selected);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // Deliberately once: the catalog is seven hardcoded rows and does not
    // change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The backend applies the remembered template when the request omits one, so
  // a failed catalog fetch costs the *choice*, not the cut. Saying nothing at
  // all is right here: an error about a picker would imply the cut is at risk.
  if (failed) return null;

  const current = templates?.find((t) => t.id === value) ?? null;

  return (
    <section className="panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="template-grid"
        className="w-full flex items-center justify-between gap-4 p-5 text-left row-hover"
      >
        <span className="flex flex-col gap-1 min-w-0">
          <span className="label">Resume template</span>
          <span className="text-sm text-text truncate">
            {current ? (
              <>
                {current.name}
                <span className="text-text-faint"> · {current.best_for}</span>
              </>
            ) : (
              <span className="text-text-faint">Loading…</span>
            )}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-text-faint hidden sm:inline">
            {open ? "Close" : "Change"}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-text-faint transition-transform duration-slow ease-emph ${
              open ? "rotate-180" : ""
            }`}
            aria-hidden
          />
        </span>
      </button>

      {open && templates && (
        <div
          id="template-grid"
          role="radiogroup"
          aria-label="Resume template"
          className="border-t border-border p-5 grid grid-cols-2 md:grid-cols-4 gap-3"
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
                className={`tpl-card ${selected ? "tpl-card-on" : ""}`}
              >
                <Preview traits={template.traits} />
                <span className="flex items-center gap-1.5 mt-2.5">
                  <span className="text-sm font-medium text-text">{template.name}</span>
                  {selected && <Check className="w-3.5 h-3.5 text-accent-text shrink-0" aria-hidden />}
                </span>
                <span className="text-2xs text-text-faint text-pretty leading-snug mt-0.5">
                  {template.best_for}
                </span>
              </button>
            );
          })}
          {current && (
            <p className="col-span-2 md:col-span-4 text-xs text-text-faint text-pretty">
              {current.blurb} All seven are single-column with standard section headings, so they
              parse the same way — what changes is how it reads to the person who opens it.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
