"use client";

/**
 * The product, demonstrated.
 *
 * This replaces a pinned section about the optics of diamond — a genuinely
 * interesting thing to build that had no business on a landing page for a
 * job-search tool. A visitor arrives asking one question, what does this do,
 * and every pixel answering something else is spent badly.
 *
 * So the stage shows the four screens the app actually is, in the order you
 * meet them: the Stone you import once, the Rough that ranks postings against
 * it, the cut that turns one into documents, and the Cabinet that keeps what
 * happened next. The fragments are modelled on the real components — the match
 * badge, the "Matches" evidence line, the middot metadata, the status
 * vocabulary — so what the page shows and what the product does are the same
 * thing. Company names are plainly fictional; the source names (RemoteOK,
 * Adzuna, Arbeitnow) are the real providers, because those are a claim.
 *
 * MOTION — and this is the part that was rebuilt.
 *
 * The obvious way to drive a pinned sequence is to scrub every property from
 * the scroll position: read the offset each frame, hand it to React, let the
 * subtree re-render. It works, and it is wrong twice over. It re-renders four
 * beats sixty times a second in order to move two of them, and — worse — it
 * welds the choreography to the scroll wheel, so a fast flick plays the whole
 * sequence in three frames and the animation becomes a smear nobody sees.
 *
 * So scroll chooses *which* beat, and nothing else. That is an integer, it
 * changes four times in the whole section, and React renders four times rather
 * than several hundred. The choreography is CSS: a transition on the beat, and
 * one keyframe per element inside it on a `--i` stagger, playing at its own
 * honest speed however fast you arrived. Scroll past quickly and the last beat
 * still animates properly, because its animation belongs to it and not to your
 * wheel.
 *
 * The one genuinely continuous thing — the progress rule under the copy — is
 * written straight to the node's style inside the rAF callback. It never goes
 * near React, so a value that really does change every frame costs one
 * property write instead of a reconciliation.
 *
 * Below `lg`, and under reduced motion, the pinning and the choreography are
 * both dropped in CSS and the beats become an ordinary stack. That is not a
 * degraded version: it is the same information without the delivery.
 */

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Check, FileText, Lock } from "lucide-react";
// The four nouns are drawn from the app's own gem geometry rather than taken
// from a general icon set — see FacetIcons. Lucide keeps the ordinary verbs.
import { CabinetIcon, FacetIcon, RoughIcon, StoneIcon } from "@/components/ui/FacetIcons";

interface Beat {
  eyebrow: string;
  title: string;
  body: string;
  route: string;
  icon: (props: { className?: string }) => React.ReactElement;
}

const BEATS: Beat[] = [
  {
    eyebrow: "The Stone",
    title: "One honest record, imported once.",
    body: "Your resume becomes the fixed set of facts every application is built from — and the ceiling on what anything Facet writes is allowed to claim. You review it and correct it. Nothing else ever edits it.",
    route: "/stone",
    icon: StoneIcon,
  },
  {
    eyebrow: "The Rough",
    title: "Every posting, ranked against your Stone.",
    body: "Public job APIs and the alert feeds you subscribed to, deduplicated into one list and scored on the skills you actually have. The terms that matched sit next to the score, so a number you would otherwise have to trust is one you can check.",
    route: "/rough",
    icon: RoughIcon,
  },
  {
    eyebrow: "The cut",
    title: "One posting in. Three documents out.",
    body: "A tailored resume, a cover letter and a short recruiter pitch, as PDF or Word. The layout is fixed and identical every time — only the emphasis moves, and it can only move within what your Stone already says.",
    route: "/tailor",
    icon: FacetIcon,
  },
  {
    eyebrow: "The Cabinet",
    title: "And what came of it.",
    body: "Everything you have sent, what has gone quiet and needs a nudge, and the interviews on the other side of it. Point it at your calendar feed and it spots the invitations itself — then asks before filing them.",
    route: "/cabinet",
    icon: CabinetIcon,
  },
];

/** The Stone as /stone shows it: the fields of profile.json, and the skills
 *  the tailor is allowed to draw on. */
const STONE_SKILLS = [
  "python",
  "fastapi",
  "postgres",
  "async",
  "docker",
  "kubernetes",
  "sql",
  "react",
];
const STONE_ROLES = [
  ["Backend Engineer", "Meridian Pay · 2021–2025"],
  ["Software Engineer", "Copperline · 2018–2021"],
];

/** Illustrative postings. The companies are invented and read as invented; the
 *  sources are the real providers, because naming a source is a claim. */
const ROUGH = [
  {
    title: "Senior Backend Engineer",
    company: "Northwind Labs",
    meta: "London · Remote · £85k–£105k",
    score: 82,
    terms: "python · fastapi · postgres · async · docker",
    source: "RemoteOK · Full-time · 2d ago",
  },
  {
    title: "Platform Engineer",
    company: "Kestrel Systems",
    meta: "Manchester · Hybrid",
    score: 64,
    terms: "kubernetes · terraform · python",
    source: "Adzuna · Full-time · 4d ago",
  },
  {
    title: "Data Engineer",
    company: "Halden Data",
    meta: "Berlin · Remote",
    score: 51,
    terms: "airflow · sql",
    source: "Arbeitnow · Contract · 6d ago",
  },
];

/** The same fact, given the emphasis one posting asks for. Nothing in the
 *  second line is absent from the first. */
const CUT_BEFORE = "Worked on backend services for the payments team.";
const CUT_AFTER_LEAD = "Built backend services for the payments team, including the ";
const CUT_AFTER_MARK = "event-driven reconciliation pipeline";
const CUT_AFTER_TAIL = " the posting calls out.";

const OUTPUTS = ["Resume.pdf", "Cover letter.pdf", "Recruiter pitch"];

const CABINET = [
  { role: "Senior Backend Engineer", company: "Northwind Labs", status: "Set", tone: "badge-ok" },
  { role: "Staff Engineer", company: "Ardent Health", status: "Interviewing", tone: "badge-accent" },
  { role: "Platform Engineer", company: "Kestrel Systems", status: "Cut", tone: "" },
];

/** Stagger index. Every element that arrives inside a beat carries one and the
 *  CSS turns it into a delay — so the order of arrival is stated once, here,
 *  instead of as a scattering of magic numbers through the markup. */
const rise = (i: number) => ({ "--i": i }) as React.CSSProperties;

export default function ProductShowcase() {
  const frame = useRef<HTMLDivElement>(null);
  const ticks = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    // Neither the pinning nor the choreography exists below `lg` or under
    // reduced motion, so neither does this listener. The stack that renders
    // instead is pure CSS and needs nothing from here.
    const live = window.matchMedia(
      "(min-width: 1024px) and (prefers-reduced-motion: no-preference)"
    );
    if (!live.matches) return;

    let raf = 0;
    let shown = -1;
    const read = () => {
      raf = 0;
      const rect = node.getBoundingClientRect();
      // The pinned distance is the section height less one viewport. Measured
      // against the section height instead, the sequence would finish before
      // the stage unpins.
      const travel = rect.height - window.innerHeight;
      const p = travel <= 0 ? 0 : Math.min(Math.max(-rect.top / travel, 0), 1);

      // The continuous value, written straight to the DOM. This is the only
      // thing here that legitimately changes every frame, and it costs one
      // style write rather than a render.
      const bars = ticks.current;
      if (bars) {
        const at = p * BEATS.length;
        for (let i = 0; i < bars.children.length; i++) {
          const fill = bars.children[i].firstElementChild as HTMLElement | null;
          if (fill) fill.style.transform = `scaleX(${Math.min(Math.max(at - i, 0), 1)})`;
        }
      }

      // The discrete one. This changes four times in the whole section.
      const next = Math.min(Math.floor(p * BEATS.length), BEATS.length - 1);
      if (next !== shown) {
        shown = next;
        setActive(next);
      }
    };
    const onScroll = () => {
      // At most one measurement per frame. Reading layout inside the scroll
      // event itself is the classic way to make a page stutter.
      if (!raf) raf = requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section
      ref={frame}
      // `#how` is the hero's second button; it lands where the first beat is.
      id="how"
      className="relative scroll-mt-nav-block lg:motion-safe:h-[420vh]"
      aria-labelledby="showcase-title"
    >
      <div className="lg:motion-safe:sticky lg:motion-safe:top-0 lg:motion-safe:h-screen flex items-center">
        <div className="w-full max-w-shell mx-auto px-5 sm:px-8 py-14">
          <h2 id="showcase-title" className="sr-only">
            How Facet works
          </h2>

          {/* One grid, shared by every beat, on the same left edge as every
              other section's heading — so nothing shifts sideways as the
              sequence advances. `items-start` rather than `items-center`,
              because centring made each beat centre its own content height,
              and a two-line title next to a one-line one visibly jumped the
              eyebrow as you scrolled between them. */}
          <div className="relative grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-y-12 gap-x-8 lg:gap-14 items-start lg:motion-safe:min-h-[26rem]">
            {BEATS.map((beat, i) => {
              // Three states, and the direction matters: a beat that has not
              // arrived waits below, one that is finished leaves upward. Both
              // travel the way the page does.
              const state = i === active ? "is-active" : i < active ? "is-past" : "is-next";
              return (
                // `display: contents` in both modes, which is what gives the
                // fallback its layout for free: with the explicit placement
                // scoped to `lg`, the eight cells auto-place into rows.
                <div className="contents" key={beat.eyebrow}>
                  <div
                    className={`beat-cell ${state} min-w-0 lg:motion-safe:col-start-1 lg:motion-safe:row-start-1 flex flex-col gap-4`}
                  >
                    <p className="eyebrow beat-rise" style={rise(0)}>
                      {beat.eyebrow}
                    </p>
                    <h3
                      className="beat-rise text-3xl sm:text-4xl font-semibold text-text text-balance tracking-[-0.02em]"
                      style={rise(1)}
                    >
                      {beat.title}
                    </h3>
                    <p
                      className="beat-rise text-md text-text-dim max-w-prose text-pretty"
                      style={rise(2)}
                    >
                      {beat.body}
                    </p>
                    <p
                      className="beat-rise mono text-xs text-text-ghost"
                      style={rise(3)}
                      aria-hidden
                    >
                      {String(i + 1).padStart(2, "0")} · {beat.route}
                    </p>
                  </div>

                  <div
                    className={`beat-cell ${state} min-w-0 lg:motion-safe:col-start-2 lg:motion-safe:row-start-1`}
                  >
                    <div className="showcase-window">
                      {/* The window names its route. Not a browser chrome
                          mock — the app has a floating nav, not a title bar,
                          and drawing one would be showing a product that does
                          not exist. */}
                      <div className="showcase-bar">
                        <beat.icon className="w-3.5 h-3.5 text-accent-text" aria-hidden />
                        <span className="mono text-2xs uppercase tracking-[0.14em] text-text-faint">
                          {beat.route}
                        </span>
                      </div>
                      <div className="showcase-body">
                        {i === 0 && <StoneStage />}
                        {i === 1 && <RoughStage />}
                        {i === 2 && <CutStage />}
                        {i === 3 && <CabinetStage />}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Where you are. Four rules rather than four dots: a dot says
              "slide 2 of 4", a filling rule says how far through this one you
              are, which is what a scroll-driven section has to tell you.
              Filled by the rAF above, never by a render. */}
          <div
            ref={ticks}
            className="mt-10 hidden lg:motion-safe:flex gap-2 max-w-[22rem]"
            aria-hidden
          >
            {BEATS.map((beat) => (
              <span key={beat.eyebrow} className="showcase-tick">
                <span className="showcase-tick-fill" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The record: where it came from, what it holds, and the line that matters
 *  most — that the AI never writes to it. */
function StoneStage() {
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="beat-rise flex items-baseline justify-between gap-3" style={rise(2)}>
        <p className="text-sm font-semibold text-text">Ada Okonkwo</p>
        <p className="mono text-2xs text-text-ghost">imported from resume.pdf</p>
      </div>

      <div className="border-t border-border">
        <div className="ruled-row py-2.5">
          <p className="beat-rise label mb-1.5" style={rise(3)}>
            Skills
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STONE_SKILLS.map((skill, i) => (
              // Each lands on its own beat of the same stagger, so the set
              // fills in the way a parsed document actually resolves.
              <span
                key={skill}
                className="beat-rise showcase-chip showcase-chip-out"
                style={rise(4 + i * 0.5)}
              >
                {skill}
              </span>
            ))}
          </div>
        </div>

        {STONE_ROLES.map(([role, where], i) => (
          <div
            key={role}
            className="beat-rise ruled-row flex items-baseline justify-between gap-3 py-2.5"
            style={rise(8 + i)}
          >
            <p className="text-xs font-medium text-text">{role}</p>
            <p className="text-2xs text-text-faint mono">{where}</p>
          </div>
        ))}
      </div>

      <div
        className="beat-rise flex items-center gap-2 text-2xs text-text-dim mt-auto"
        style={rise(10)}
      >
        <Lock className="w-3 h-3 text-ok-text shrink-0" aria-hidden />
        Edited by you. Never by the AI.
      </div>
    </div>
  );
}

/** Rows arrive in rank order, then the evidence behind the top score. */
function RoughStage() {
  return (
    <div className="flex flex-col gap-2">
      {ROUGH.map((job, i) => (
        <div
          key={job.title}
          className={`beat-rise showcase-row ${i === 0 ? "showcase-row-lead" : ""}`}
          style={rise(2 + i * 1.2)}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-text truncate">{job.title}</span>
              <span className={`badge tnum ${i === 0 ? "badge-ok" : ""}`}>{job.score}% match</span>
            </div>
            <p className="text-xs text-text-dim mt-0.5 truncate">
              <span className="text-text">{job.company}</span> · {job.meta}
            </p>
            {/* The evidence line is the point of the beat — it is what turns a
                score into something checkable. It arrives last, and only on
                the leading row, where there is room to read it. */}
            {i === 0 && (
              <p className="beat-rise text-2xs text-text-faint mt-1.5 truncate" style={rise(6)}>
                <span className="label">Matches</span>{" "}
                <span className="text-text-dim">{job.terms}</span>
              </p>
            )}
            <p className="text-2xs text-text-ghost mt-1 truncate">{job.source}</p>
          </div>
          <span className="showcase-chip shrink-0">Tailor</span>
        </div>
      ))}
    </div>
  );
}

/** The line rewrites itself: the original recedes, the cut version writes over
 *  it with the added clause marked, then the outputs land. */
function CutStage() {
  return (
    <div className="flex flex-col gap-4 h-full">
      <div>
        <p className="beat-rise label mb-2" style={rise(2)}>
          From your Stone
        </p>
        <p className="beat-rise text-sm text-text-dim leading-relaxed" style={rise(2.5)}>
          &ldquo;{CUT_BEFORE}&rdquo;
        </p>
      </div>

      <div className="beat-rise showcase-cut" style={rise(4)}>
        <p className="label mb-2 !text-accent-text">Cut for this posting</p>
        <p className="text-sm text-text leading-relaxed">
          &ldquo;{CUT_AFTER_LEAD}
          {/* Marked so that "only the emphasis moves" is shown rather than
              asserted. The mark draws left to right at reading speed. */}
          <span className="showcase-mark">{CUT_AFTER_MARK}</span>
          {CUT_AFTER_TAIL}&rdquo;
        </p>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {OUTPUTS.map((out, i) => (
          <span
            key={out}
            className="beat-rise showcase-chip showcase-chip-out"
            style={rise(8 + i)}
          >
            <FileText className="w-3 h-3" aria-hidden />
            {out}
          </span>
        ))}
      </div>

      {/* The truthfulness mode — a real control on /tailor, and the one that
          decided what the sentence above was allowed to become. It belongs in
          the frame rather than being left to the FAQ. Shown at its default. */}
      <div
        className="beat-rise border-t border-border pt-3 mt-auto flex items-center justify-between gap-3"
        style={rise(11)}
      >
        <span className="label !normal-case !tracking-normal !text-text-dim">Truthfulness</span>
        <span className="mono text-2xs text-text-dim">
          strict · only what your Stone states outright
        </span>
      </div>
    </div>
  );
}

/** The record fills in, then the calendar offers something. */
function CabinetStage() {
  return (
    <div className="flex flex-col gap-2 h-full">
      {CABINET.map((row, i) => (
        <div key={row.role} className="beat-rise showcase-row" style={rise(2 + i * 1.2)}>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text truncate">{row.role}</p>
            <p className="text-xs text-text-dim mt-0.5 truncate">{row.company}</p>
          </div>
          <span className={`badge shrink-0 ${row.tone}`}>{row.status}</span>
        </div>
      ))}

      {/* A suggestion, not a booking. The app never writes an interview into
          the record on its own — showing it any other way would advertise a
          behaviour the product deliberately refuses to have. */}
      <div className="beat-rise showcase-suggest mt-auto" style={rise(7)}>
        <CalendarCheck className="w-4 h-4 text-accent-text shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs font-medium text-text">
            Interview found in your calendar feed — Ardent Health, Thursday 14:00
          </p>
          <p className="text-2xs text-text-faint mt-0.5">
            Matched to an application. Confirm to file it.
          </p>
        </div>
        <span className="showcase-chip shrink-0">
          <Check className="w-3 h-3" aria-hidden />
          Confirm
        </span>
      </div>
    </div>
  );
}
