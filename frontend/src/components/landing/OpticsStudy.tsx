"use client";

/**
 * The pinned study: why a cut stone is bright, drawn and computed at once.
 *
 * The stone in the hero is the product's whole metaphor, and until now the
 * page asserted the metaphor rather than showing it. This section pins the
 * profile and hands the reader the one variable that matters — the angle light
 * arrives at — then draws what happens and prints the numbers beside it.
 *
 * The drawing and the readout are not two implementations of the same idea.
 * They are one call to `traceStone`, which is a real ray trace against the
 * real facet coordinates, and there is a runnable check (`optics.check.ts`)
 * asserting that the verdict and the path can never disagree. That matters
 * more here than anywhere else on the page: this is a product whose closing
 * line is "without inventing a single thing", on a page that would be
 * inventing something the moment the drawing became decorative.
 *
 * Scroll-bound rather than looping, for the same reason the hero's beam is
 * continuous rather than a strike: a loop is something you wait for, but an
 * angle you are steering is something you are doing. Under reduced motion the
 * whole mechanism is dropped and the section states both cases side by side,
 * which is the actual information — the animation was only ever the delivery.
 */

import { useEffect, useRef, useState } from "react";
import { CROWN, PAVILION, PROFILE, PROFILE_VIEW_BOX } from "@/lib/gemProfile";
import { CRITICAL_ANGLE, brightestLimit, traceStone } from "@/lib/optics";

/** The sweep the section covers. Starts near the axis so the first thing seen
 *  is the stone working, and ends well past the crossover so the failure is
 *  unmistakable rather than marginal. */
const FROM = 4;
const TO = 78;

/** Found from the model, not typed in — see `brightestLimit`. */
const LIMIT = brightestLimit();

function fmt(n: number) {
  return `${n.toFixed(1)}°`;
}

export default function OpticsStudy() {
  const frame = useRef<HTMLDivElement>(null);
  const [angle, setAngle] = useState(FROM);

  useEffect(() => {
    // Under reduced motion nothing subscribes, the angle stays at FROM, and
    // the section shows the stone working. The pinning and the extra travel
    // that make steering possible are dropped in CSS by `motion-safe:`, so
    // there is one layout here rather than two that can drift apart.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const read = () => {
      raf = 0;
      const node = frame.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      // How far through the section's own scroll the sticky stage is. The
      // travel is the section height minus one viewport, which is exactly the
      // distance the stage stays pinned.
      const travel = rect.height - window.innerHeight;
      const p = travel <= 0 ? 0 : Math.min(Math.max(-rect.top / travel, 0), 1);
      setAngle(FROM + (TO - FROM) * p);
    };

    const onScroll = () => {
      // One read per frame at most. A scroll handler that measures on every
      // event is the classic way to turn a smooth page into a stuttering one.
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

  const t = traceStone(angle);
  const d = t.path.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [hx, hy] = t.path[t.path.length - 1];

  const readout: [string, string, boolean][] = [
    ["Arrives at", fmt(t.incident), false],
    ["Bends to", fmt(t.refracted), false],
    ["Meets the pavilion at", fmt(t.pavilion), t.returned],
    ["Escapes past", fmt(CRITICAL_ANGLE), false],
  ];

  return (
    <section
      ref={frame}
      // Two viewports of travel: one to read, one to steer. Any less and the
      // crossover flies past before the eye has found the readout. Under
      // reduced motion the extra height and the pinning both go away, because
      // scrolling past two viewports of a figure that never changes is worse
      // than not having the figure.
      className="relative motion-safe:h-[220vh]"
      aria-labelledby="study-title"
    >
      <div className="motion-safe:sticky motion-safe:top-nav-block max-w-shell mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <div className="grid lg:grid-cols-[0.92fr_1.08fr] gap-8 lg:gap-12 items-center">
          {/* ---- the argument ---- */}
          <div className="flex flex-col gap-4">
            <p className="eyebrow">The model</p>
            <h2
              id="study-title"
              className="text-3xl sm:text-4xl font-semibold text-text text-balance tracking-[-0.02em]"
            >
              A stone is bright because of its angles
            </h2>
            <p className="text-md text-text-dim max-w-prose text-pretty">
              Light entering a diamond can never travel more than{" "}
              <span className="mono tnum text-text">{fmt(CRITICAL_ANGLE)}</span> off the vertical,
              however steeply it arrives. Cut the pavilion steeper than that and every beam near the
              axis is turned around and sent back out of the top. Cut it shallower and the same light
              passes straight through and is gone.
            </p>
            {/* Which sentence applies is a motion-preference question, so it
                is answered in CSS rather than by branching on state the server
                cannot know at render time. */}
            <p className="text-md text-text-dim max-w-prose text-pretty">
              <span className="motion-reduce:hidden">Scroll to steer the beam.</span>
              <span className="hidden motion-reduce:inline">
                Shown here at the angle a stone is cut to catch.
              </span>{" "}
              Nothing is drawn by hand — the path is traced against the real facet coordinates, and
              the numbers beside it are that same trace.
            </p>

            {/* The readout. Hairline rules and one monospaced column, because
                these are measurements and should look like measurements. */}
            <dl className="mt-2 border-t border-border">
              {readout.map(([term, value, good]) => (
                <div
                  key={term}
                  className="ruled-row grid grid-cols-[1fr_auto] items-baseline gap-4 py-2.5"
                >
                  <dt className="label !normal-case !tracking-normal !text-text-dim">{term}</dt>
                  <dd
                    className={`mono tnum text-sm ${
                      good ? "text-ok-text" : "text-text"
                    } tabular-nums`}
                  >
                    {value}
                  </dd>
                </div>
              ))}
              <div className="ruled-row grid grid-cols-[1fr_auto] items-baseline gap-4 py-2.5">
                <dt className="label !normal-case !tracking-normal !text-text-dim">
                  Steepest arrival still returned
                </dt>
                <dd className="mono tnum text-sm text-text-dim">{fmt(LIMIT)}</dd>
              </div>
            </dl>

            <p
              className={`text-sm font-medium ${t.returned ? "text-ok-text" : "text-warn-text"}`}
              role="status"
            >
              {t.returned
                ? "Held by the pavilion and returned through the crown."
                : "Past the critical angle — the light leaves through the bottom and is lost."}
            </p>
          </div>

          {/* ---- the drawing ---- */}
          <div className="relative grid place-items-center">
            <svg
              viewBox={PROFILE_VIEW_BOX}
              className="w-full max-w-[34rem]"
              role="img"
              aria-label={`A beam arriving at ${fmt(t.incident)} meets the pavilion at ${fmt(
                t.pavilion
              )} and is ${t.returned ? "returned through the top of the stone" : "lost through the bottom"}.`}
            >
              {/* Construction geometry: the stone as a drawing, not as an
                  object. Hairlines only, so the beam is the only thing with
                  weight in the frame. */}
              <g stroke="var(--border-strong)" strokeWidth="0.6" fill="none">
                {CROWN.map((f) => (
                  <path key={f.d} d={f.d} />
                ))}
                {PAVILION.map((f) => (
                  <path key={f.d} d={f.d} />
                ))}
              </g>
              <path d={PROFILE} fill="none" stroke="var(--text-ghost)" strokeWidth="1.1" />

              {/* The axis, so "off the vertical" has something to be off. */}
              <path
                d="M120 34 L120 214"
                stroke="var(--border-strong)"
                strokeWidth="0.6"
                strokeDasharray="3 5"
              />

              {/* The beam. One stroke, one colour — the artwork's dispersion
                  is deliberately absent here because this figure models a
                  single wavelength and should not imply otherwise. */}
              <path
                d={d}
                fill="none"
                stroke={t.returned ? "var(--accent)" : "var(--warn)"}
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle cx={hx} cy={hy} r="3.4" fill={t.returned ? "var(--accent)" : "var(--warn)"} />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
