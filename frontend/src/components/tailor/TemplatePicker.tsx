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

/** The preview: a real render of the real template.
 *
 *  This replaced a miniature drawn from each template's declared `traits` —
 *  bars standing in for text. The drawn version could not go stale, which was
 *  the point, but it also could not answer the only question the picker exists
 *  to answer: would you send this? A bar diagram shows the shape of a page.
 *  Choosing a resume template without seeing the resume is choosing blind.
 *
 *  Staleness is handled rather than avoided. `build_template_previews.py`
 *  records the hash of each template's HTML beside its image, and the backend
 *  check fails by name if a template changes without the preview following —
 *  verified by editing one line of CSS and watching it fire.
 *
 *  `loading="lazy"` matters: the ordinary path through this control is to
 *  arrive, accept the remembered template and never open the picker, and that
 *  path should fetch none of the 258 KB.
 */
function Preview({ id, name }: { id: string; name: string }) {
  return (
    <img
      src={`/resume-templates/${id}.webp`}
      // The page IS the preview, so the alt text says what it is rather than
      // describing a picture of it. The name and "best for" line sit beside
      // this; "screenshot of" would be noise.
      alt={`${name} template, one page`}
      className="tpl-page"
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
                <Preview id={template.id} name={template.name} />
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
