"use client";

/**
 * The landing page as one continuous optical experiment.
 *
 *   JD → Light → Stone → Refraction → Facets → Applications → Outcomes
 *
 * Five scenes, one scroll, and — the point — one scene. The stone is a single
 * WebGL canvas that never unmounts and never restarts; scroll position drives
 * its camera, spin, dispersion, exposure and shaft strength through
 * `lib/gemStory.ts`. Nothing here is five independent animations sharing a
 * look, which is what makes the beams feel like they are *causing* the cards
 * rather than pointing at them.
 *
 * Two layers, and the split is deliberate:
 *
 *   WebGL   the stone, its light, its fire, its floor. Everything physical.
 *   SVG     the beams that leave the stone and land on a card. These have to
 *           terminate exactly on an HTML element, so they are drawn in the
 *           same coordinate space as that element — a 0..100 viewBox with
 *           `preserveAspectRatio="none"`, which is also what the cards use for
 *           their `left`/`top`. Two spaces would mean two rounding stories and
 *           a beam that misses its card at some viewport width. Stroke widths
 *           are held with `vector-effect="non-scaling-stroke"` so the skew
 *           never reaches the line weight.
 *
 * Colour is the design system's, and it means the same thing every time:
 *
 *   white   --story-white   the raw posting. Source truth, before the stone.
 *   cyan    --accent-text   discovery and matching
 *   glint   --glint         tailoring: the documents the cut produces
 *   green   --ok            applied, and offer
 *   amber   --warn          interview: attention required
 *   red     --danger        rejected
 *
 * The first beam is deliberately almost pure white. Colour is what the stone
 * *does*; if the light arrives already coloured, the refraction means nothing.
 *
 * Scroll drives motion values, not state — the stone's settings object is
 * mutated in place and the SVG is animated by framer-motion, so a full scroll
 * of this page causes zero React renders after mount.
 */

/* eslint-disable react-hooks/rules-of-hooks --
   `s`, `band` and `drawIn` are `useTransform` with the arguments spelled at
   the call site, and the `.map()`s below run over module-level constant
   arrays. The number of hooks and their order are therefore fixed for the life
   of the component, which is the property the rule exists to protect; the
   alternative is thirty near-identical inline `useTransform` calls. */
import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { ArrowRight } from "lucide-react";
import { gemInto, sceneProgress } from "@/lib/gemStory";
import GemLightning, { GEM_DEFAULTS, type GemSettings } from "./GemLightning";

/* ---------------------------------------------------------------- palette */

const WHITE = "var(--story-white)";
const CYAN = "var(--accent-text)";
const GLINT = "var(--glint)";
const OK = "var(--ok-text)";
const WARN = "var(--warn-text)";
const BAD = "var(--danger-text)";
const HUES = [CYAN, GLINT, OK, WARN, BAD, WHITE];

/* ------------------------------------------------------------------ beams */

/** One beam: a wide soft pass under a thin bright one. Three strokes rather
 *  than a blur filter — a Gaussian in a `preserveAspectRatio="none"` viewBox
 *  is skewed with the box, and this reads cleaner besides.
 *
 *  `width` is in CSS pixels, not viewBox units, because `non-scaling-stroke`
 *  is what stops the skew reaching the line weight — and that also means a
 *  width written as if it were a viewBox fraction draws a hairline nobody can
 *  see. It did, for one build. */
function Beam({
  from,
  to,
  colour,
  draw,
  width = 2,
  soft = true,
  start = 0,
}: {
  from: [number, number];
  to: [number, number];
  colour: string;
  draw: MotionValue<number>;
  width?: number;
  soft?: boolean;
  /** Fraction of the way to `to` at which the beam actually begins. The stone
   *  is a solid object about a fifth of the frame wide, so a beam drawn from
   *  its centre spends its first moments inside it and appears to start late.
   *  This starts it at the girdle instead. */
  start?: number;
}) {
  // The beam grows by moving its far end, not by dashing its stroke. The
  // obvious implementation is framer's `pathLength`, and it cannot be used
  // here: `pathLength` animates `stroke-dasharray`, `non-scaling-stroke`
  // reinterprets a dash array in screen units rather than viewBox units, and
  // the two together draw a dotted line. Moving the endpoint also happens to
  // be the more literal thing — this is light travelling outward.
  const span = (v: number, i: 0 | 1) => from[i] + (to[i] - from[i]) * (start + (1 - start) * v);
  const x2 = useTransform(draw, (v) => span(v, 0));
  const y2 = useTransform(draw, (v) => span(v, 1));
  const common = {
    x1: span(0, 0),
    y1: span(0, 1),
    x2,
    y2,
    stroke: colour,
    strokeLinecap: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  };
  return (
    <>
      {soft ? (
        <motion.line {...common} strokeWidth={width * 8} opacity={0.1} strokeMiterlimit={1} />
      ) : null}
      <motion.line {...common} strokeWidth={width * 2.6} opacity={0.3} />
      <motion.line {...common} strokeWidth={width} opacity={0.95} />
    </>
  );
}

/** A card at the far end of a beam. Positioned in the beam's own 0..100
 *  space, so it cannot drift away from where the light lands. */
function Node({
  at,
  colour,
  eyebrow,
  title,
  meta,
  opacity,
  wide,
}: {
  at: [number, number];
  colour: string;
  eyebrow?: string;
  title: string;
  meta?: string;
  opacity: MotionValue<number>;
  wide?: boolean;
}) {
  return (
    <motion.div
      className="story-node liquid-glass"
      style={{
        left: `${at[0]}%`,
        top: `${at[1]}%`,
        opacity,
        borderColor: `color-mix(in srgb, ${colour} 38%, transparent)`,
        boxShadow: `0 0 2.5rem -0.75rem color-mix(in srgb, ${colour} 55%, transparent)`,
        width: wide ? "13rem" : "11rem",
      }}
    >
      {eyebrow ? (
        <p className="story-node-eyebrow" style={{ color: colour }}>
          {eyebrow}
        </p>
      ) : null}
      <p className="story-node-title">{title}</p>
      {meta ? <p className="story-node-meta">{meta}</p> : null}
    </motion.div>
  );
}

/** The caption block for a scene: the number, the claim, the sentence. */
function Caption({
  index,
  name,
  claim,
  body,
  opacity,
  y,
}: {
  index: string;
  name: string;
  claim: string;
  body: string;
  opacity: MotionValue<number>;
  y: MotionValue<number>;
}) {
  return (
    <motion.div
      className="story-caption"
      style={{ opacity, y }}
    >
      <p className="story-index">
        {index} <span aria-hidden>—</span> {name}
      </p>
      <h2 className="story-claim">{claim}</h2>
      <p className="story-body">{body}</p>
    </motion.div>
  );
}

/* ----------------------------------------------------------------- layout */

const GEM: [number, number] = [50, 50];

const JOBS: { at: [number, number]; title: string; meta: string }[] = [
  { at: [14, 26], title: "Staff Engineer", meta: "88% — 14 of 16 terms" },
  { at: [86, 22], title: "Platform Lead", meta: "81% — 13 of 16 terms" },
  { at: [12, 64], title: "Backend, Payments", meta: "76% — 12 of 16 terms" },
  { at: [88, 60], title: "Infrastructure", meta: "69% — 11 of 16 terms" },
];

const DOCS: { at: [number, number]; title: string; meta: string }[] = [
  { at: [83, 26], title: "Résumé", meta: "Chicago — one page" },
  { at: [88, 50], title: "Cover letter", meta: "Grounded in the Stone" },
  { at: [83, 74], title: "Recruiter pitch", meta: "120 words" },
];

const MILESTONES: {
  at: [number, number];
  dot?: [number, number];
  colour: string;
  title: string;
  meta: string;
}[] = [
  // The cards sit off the ray, alternating above and below it, with a dot on
  // the ray itself where each one attaches: four 13rem cards laid along 24% of
  // the frame overlap each other and hide the ray they are describing.
  { at: [62, 33], dot: [62, 50] as [number, number], colour: OK, title: "Applied", meta: "12 Mar" },
  { at: [74, 64], dot: [74, 50] as [number, number], colour: WARN, title: "Interview", meta: "21 Mar, 14:00" },
  { at: [88, 30], colour: OK, title: "Offer", meta: "2 Apr" },
  { at: [88, 70], colour: BAD, title: "Rejected", meta: "logged, with the reason" },
];

/** When each stop on the application ray lights up, as a fraction of scene 04.
 *  The two branch outcomes wait for the branch beams to reach them. */
const STOP_IN = [0.22, 0.36, 0.64, 0.72];

/* ------------------------------------------------------------------- page */

export default function StoryHero() {
  const reduced = useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);

  // The stone's settings object is created once and mutated. `GemLightning`
  // holds this identity in a ref and reads it every frame, so the whole scroll
  // costs zero renders.
  const gem = useRef<GemSettings>({ ...GEM_DEFAULTS });

  const p = useMotionValue(0);
  useEffect(() => {
    const node = wrap.current;
    if (!node) return;
    // Scroll events are steps, not a signal: one wheel notch moves the page a
    // fixed distance and fires once, so every knob downstream — the camera,
    // the exposure, the length of every beam — stepped with it. The fix is not
    // to smooth the events but to stop reading them directly: scroll writes a
    // target, and a frame loop walks the live value toward it. That also puts
    // the update on the compositor's clock rather than the input device's.
    let target = 0;
    let live = 0;
    let raf = 0;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      target = Math.min(1, Math.max(0, -rect.top / travel));
    };
    // Framerate-independent damping. `1 - exp(-k*dt)` rather than a fixed
    // fraction per frame: the fixed fraction is a different time constant on a
    // 60Hz screen and a 144Hz one, which is how a page ends up feeling
    // sluggish on exactly the hardware that should make it feel best.
    const K = 9.5;
    let last = performance.now();
    const frame = (now: number) => {
      // Clamped generously rather than tightly: the clamp only exists to stop
      // a backgrounded tab resuming with a one-minute step, and a tight one
      // turns into its own lag on a machine that is genuinely rendering at
      // fifteen frames a second.
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      live += (target - live) * (1 - Math.exp(-K * dt));
      // Snap once it is close enough to matter to nobody: without this the
      // loop runs forever chasing the last thousandth.
      if (Math.abs(target - live) < 1e-4) live = target;
      p.set(live);
      gemInto(gem.current, live);
      if (reduced) gem.current.spin = 0;
      raf = requestAnimationFrame(frame);
    };
    measure();
    live = target;
    raf = requestAnimationFrame(frame);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [p, reduced]);

  /** A scene's own 0..1, for anything that should track it exactly. */
  const s = (i: number) => useTransform(p, (v) => sceneProgress(v, i));
  /** Fade a layer in over the first fifth of its scene and out at the end. */
  const band = (a: number, b: number) =>
    useTransform(p, [a - 0.035, a + 0.03, b - 0.045, b], [0, 1, 1, 0]);
  /** Absolute progress from a scene index and a fraction inside it. Every
   *  range below is written this way, because the arithmetic done inline is
   *  how the first version ended up with non-monotonic input ranges — which
   *  framer silently accepts and then holds every card visible at once. */
  const at = (i: number, f: number) => (i + f) / 5;
  /** A beam draws itself over the first half of its own scene. */
  const drawIn = (i: number, from: number, to: number) =>
    useTransform(p, [at(i, from), at(i, to)], [0, 1], { clamp: true });

  const s0 = s(0);

  const capOpacity = [band(0.0, 0.2), band(0.2, 0.4), band(0.4, 0.6), band(0.6, 0.8), band(0.8, 1.0)];
  const capY = [0, 1, 2, 3, 4].map((i) => useTransform(p, [i / 5, i / 5 + 0.08], [26, 0]));

  // 02 — the fan. Each job beam starts a little after the last, so the split
  // reads as a spectrum opening rather than four lines switching on.
  const jobDraw = JOBS.map((_, i) => drawIn(1, 0.08 + i * 0.05, 0.42 + i * 0.05));
  const jobOpacity = JOBS.map((_, i) =>
    useTransform(
      p,
      [at(1, 0.46 + i * 0.05), at(1, 0.6 + i * 0.05), at(1, 0.88), at(1, 1)],
      [0, 1, 1, 0],
    ),
  );
  const fanOpacity = band(0.2, 0.4);

  // 03 — one posting in, three documents out. The chosen posting's beam runs
  // back into the stone, and three leave it.
  const chosenDraw = drawIn(2, 0.02, 0.24);
  const docDraw = DOCS.map((_, i) => drawIn(2, 0.28 + i * 0.06, 0.5 + i * 0.06));
  const docOpacity = DOCS.map((_, i) =>
    useTransform(
      p,
      [at(2, 0.54 + i * 0.06), at(2, 0.68 + i * 0.06), at(2, 0.9), at(2, 1)],
      [0, 1, 1, 0],
    ),
  );
  const cutOpacity = band(0.4, 0.6);

  // 04 — the three collapse back into one application ray, which then travels
  // and branches at the outcome.
  const trackDraw = drawIn(3, 0.05, 0.35);
  const branchDraw = drawIn(3, 0.5, 0.72);
  const stopOpacity = MILESTONES.map((_, i) =>
    useTransform(
      p,
      [at(3, STOP_IN[i]), at(3, STOP_IN[i] + 0.12), at(3, 0.9), at(3, 1)],
      [0, 1, 1, 0],
    ),
  );
  const cabOpacity = band(0.6, 0.8);

  // 05 — the pull back and the bridge, both of which are the shader's. The one
  // thing left here is the payoff copy, which waits until the Bifröst is open.
  const payoffOpacity = useTransform(p, [0.9, 0.97], [0, 1]);

  return (
    <main className="landing-dark relative">
      <div ref={wrap} className="story-scroll">
        <div className="story-stage">
          {/* The stone. One canvas, mounted once, for the whole page. */}
          <div className="absolute inset-0" aria-hidden>
            <GemLightning className="h-full w-full" settings={gem.current} />
          </div>

          {/* Everything the stone throws. Decorative: the same information is
              in the captions, which are real text. */}
          <svg
            className="story-beams"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
            focusable="false"
          >
            {/* 01 has no beam here: the column that falls on the stone is
                drawn by the shader, in the same space as the stone it lands
                on. An SVG line over the top of it was a second, flatter beam
                that never lined up under the parallax. */}
            {/* 02 — it splits, and the postings appear at the ends */}
            <motion.g style={{ opacity: fanOpacity }}>
              {JOBS.map((j, i) => (
                <Beam key={j.title} from={GEM} to={j.at} colour={HUES[i]} draw={jobDraw[i]} start={0.22} />
              ))}
            </motion.g>

            {/* 03 — one back in, three out */}
            <motion.g style={{ opacity: cutOpacity }}>
              <Beam from={JOBS[0].at} to={GEM} colour={CYAN} draw={chosenDraw} width={3.2} />
              {DOCS.map((d, i) => (
                <Beam key={d.title} from={GEM} to={d.at} colour={GLINT} draw={docDraw[i]} start={0.24} />
              ))}
            </motion.g>

            {/* 04 — one application ray, with stops on it */}
            <motion.g style={{ opacity: cabOpacity }}>
              <Beam from={GEM} to={[82, 50]} colour={OK} draw={trackDraw} width={2.6} start={0.3} />
              <Beam from={[82, 50]} to={[88, 34]} colour={OK} draw={branchDraw} />
              <Beam from={[82, 50]} to={[88, 66]} colour={BAD} draw={branchDraw} />
              {MILESTONES.map((m, i) =>
                m.dot ? (
                  <g key={m.title}>
                    <motion.line
                      x1={m.dot[0]}
                      y1={m.dot[1]}
                      x2={m.at[0]}
                      y2={m.at[1] + (m.at[1] < 50 ? 5 : -5)}
                      stroke={m.colour}
                      strokeWidth={1}
                      opacity={0.4}
                      vectorEffect="non-scaling-stroke"
                      style={{ opacity: stopOpacity[i] }}
                    />
                    <motion.circle
                      cx={m.dot[0]}
                      cy={m.dot[1]}
                      r={0.7}
                      fill={m.colour}
                      style={{ opacity: stopOpacity[i] }}
                    />
                  </g>
                ) : null,
              )}
            </motion.g>

            {/* 05 has no SVG at all. The ending is the Bifröst, and it is a
                sheet of light with a normal, a spectrum across its width and a
                thickness the view ray travels through — none of which an SVG
                stroke has. It is drawn by the shader, in the same space as the
                stone it leaves. The fan of fifty-four strokes that used to be
                here read as fifty-four lines, because that is what it was. */}
          </svg>

          {/* The cards, in the beams' coordinate space */}
          <div className="story-nodes" aria-hidden>
            {JOBS.map((j, i) => (
              <Node
                key={j.title}
                at={j.at}
                colour={HUES[i]}
                eyebrow="Posting"
                title={j.title}
                meta={j.meta}
                opacity={jobOpacity[i]}
              />
            ))}
            {DOCS.map((d, i) => (
              <Node
                key={d.title}
                at={d.at}
                colour={GLINT}
                eyebrow="Cut"
                title={d.title}
                meta={d.meta}
                opacity={docOpacity[i]}
              />
            ))}
            {MILESTONES.map((m, i) => (
              <Node
                key={m.title}
                at={m.at}
                colour={m.colour}
                title={m.title}
                meta={m.meta}
                opacity={stopOpacity[i]}
                wide
              />
            ))}
          </div>

          {/* The words. Real text, in the document, in reading order. */}
          <div className="story-copy">
            <Caption
              index="01"
              name="The Stone"
              claim="Everything starts as one record."
              body="A job description is white light: undifferentiated, and true of nobody in particular. Your Stone is what it lands on — one profile, written once, the only thing Facet is ever allowed to claim about you."
              opacity={capOpacity[0]}
              y={capY[0]}
            />
            <Caption
              index="02"
              name="The Rough"
              claim="Matches are what the light does, not a list you were handed."
              body="The beam enters the table and leaves as a spectrum. Each ray is a posting scored against your own vocabulary — the terms in your Stone, counted, with the evidence attached. No scraping: postings arrive from a provider's public API or a feed you subscribed to."
              opacity={capOpacity[1]}
              y={capY[1]}
            />
            <Caption
              index="03"
              name="The Cut"
              claim="One posting in. Three documents out."
              body="Choose a ray and it travels back through the stone. What leaves is a résumé on the template you picked, a cover letter, and a recruiter pitch — each of them cut from the same record, none of them inventing anything that is not in it."
              opacity={capOpacity[2]}
              y={capY[2]}
            />
            <Caption
              index="04"
              name="The Cabinet"
              claim="The ray keeps going after you send it."
              body="Applied, interview, offer, rejected — every state is a stop on the same ray, with the date it happened and the reason it ended. What Facet knows about a job after you apply is the part most tools drop."
              opacity={capOpacity[3]}
              y={capY[3]}
            />

            <motion.div className="story-payoff" style={{ opacity: payoffOpacity }}>
              <h2 className="story-payoff-claim">
                One stone.
                <br />
                Infinite facets.
              </h2>
              <p className="story-body mx-auto">
                Your record stays the same. Every opportunity gets its own cut.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/tailor" className="btn btn-primary">
                  Cut your first facet
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/" className="btn btn-ghost">
                  Back to the live page
                </Link>
              </div>
            </motion.div>
          </div>

          <motion.p className="story-hint" style={{ opacity: useTransform(s0, [0.03, 0.2], [1, 0]) }} aria-hidden>
            Scroll
          </motion.p>
        </div>
      </div>
    </main>
  );
}
