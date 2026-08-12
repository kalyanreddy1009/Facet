"use client";

/**
 * The 3D hero, on its own page, with the knobs exposed.
 *
 * `/test` exists because this scene cannot be judged from source. Every
 * decision in it — how often the bolt falls, how far the spectrum splits, how
 * hot the bloom runs — is a number that is either right or wrong on a real
 * screen and nowhere else, and the person who has to say which is not the one
 * who can run a dev server. So the page ships the scene at the size and
 * choreography the real hero would use, and puts the five numbers behind a
 * panel so feedback can be "dispersion 0.04" instead of "more rainbow".
 *
 * The choreography deliberately matches the live hero: two viewport heights,
 * a sticky stage, the masthead arriving in front of the stone and the copy
 * after it. Judging the stone against a different composition than the one it
 * would ship in is how you approve something that then looks wrong in place.
 *
 * Nothing here touches the live landing page.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { ArrowRight, Sliders, X } from "lucide-react";
import { heroProgress } from "@/lib/heroProgress";
import GemLightning, { GEM_DEFAULTS, type GemSettings } from "./GemLightning";

/** The knobs, in the order they matter when something looks wrong. */
const KNOBS: {
  key: keyof GemSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}[] = [
  {
    key: "dispersion",
    label: "Dispersion",
    min: 0,
    max: 0.07,
    step: 0.002,
    hint: "Spread between the red and blue indices. Diamond's real value is about 0.022.",
  },
  {
    key: "beam",
    label: "Beam",
    min: 0,
    max: 2,
    step: 0.05,
    hint: "The Bifrost column falling on the table. 0 removes it entirely.",
  },
  {
    key: "exposure",
    label: "Exposure",
    min: 0.4,
    max: 2.2,
    step: 0.05,
    hint: "Before tone mapping. Raise it if the stone reads grey rather than lit.",
  },
  {
    key: "bloom",
    label: "Bloom",
    min: 0,
    max: 1.6,
    step: 0.04,
    hint: "Glow around anything brighter than the threshold.",
  },
  {
    key: "spin",
    label: "Spin",
    min: 0,
    max: 0.2,
    step: 0.005,
    hint: "Turns per second. Above about 0.1 the facets stop resolving.",
  },
  {
    key: "camDist",
    label: "Camera distance",
    min: 3,
    max: 16,
    step: 0.05,
    hint: "How far back the eye sits. Closer crops the floor out of the frame.",
  },
  {
    key: "camHeight",
    label: "Camera height",
    min: -0.5,
    max: 2.5,
    step: 0.02,
    hint: "Above the stone's centre. Low reads across the table, high looks into it.",
  },
  {
    key: "zoom",
    label: "Lens",
    min: 1.2,
    max: 4.5,
    step: 0.05,
    hint: "Focal term. 2.35 is about 46 degrees vertical; higher is a longer lens.",
  },
  {
    key: "light",
    label: "Studio light",
    min: 0,
    max: 3,
    step: 0.05,
    hint: "The two studio sources and the overhead fill. The beam is unaffected.",
  },
  {
    key: "arc",
    label: "Bifröst",
    min: 0,
    max: 2.5,
    step: 0.05,
    hint: "The spectral bridge leaving the stone. Only the last scene opens it; pull the camera back past 13 to see its length.",
  },
];

function TunePanel({
  settings,
  onChange,
}: {
  settings: GemSettings;
  onChange: (next: GemSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  // The trace buffer size, polled rather than lifted into state: it is a
  // diagnostic, it changes on its own schedule, and nothing renders from it.
  const [render, setRender] = useState("");
  useEffect(() => {
    if (!open) return;
    const read = () => {
      const el = document.querySelector<HTMLCanvasElement>("canvas[data-render]");
      setRender(el?.dataset.render ?? "");
    };
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="liquid-glass fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full px-4 py-2 text-sm text-text"
      >
        <Sliders className="h-4 w-4" aria-hidden />
        Tune
      </button>
    );
  }

  return (
    <div className="liquid-glass fixed bottom-6 right-6 z-50 w-[min(22rem,calc(100vw-3rem))] rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent-text">Tune</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close the tuning panel"
          className="rounded-full p-1 text-text-dim hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {KNOBS.map((knob) => (
          <div key={knob.key}>
            <label
              htmlFor={`knob-${knob.key}`}
              className="flex items-baseline justify-between text-xs text-text-dim"
            >
              <span>{knob.label}</span>
              <span className="mono tnum text-accent-text">{settings[knob.key].toFixed(3)}</span>
            </label>
            <input
              id={`knob-${knob.key}`}
              // Both: the <label> is the real association, and the aria-label
              // is what the static interface check can actually see through a
              // template-literal id.
              aria-label={knob.label}
              type="range"
              min={knob.min}
              max={knob.max}
              step={knob.step}
              value={settings[knob.key]}
              onChange={(e) => onChange({ ...settings, [knob.key]: Number(e.target.value) })}
              className="mt-1 w-full accent-[color:var(--accent)]"
            />
            <p className="mt-1 text-xs leading-snug text-text-dim opacity-70">{knob.hint}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange(GEM_DEFAULTS)}
        className="mt-4 w-full rounded-lg border border-[color:var(--border)] px-3 py-2 text-xs text-text-dim hover:text-text"
      >
        Reset to defaults
      </button>

      {render ? (
        <p className="mt-3 text-center text-xs text-text-dim opacity-70">
          tracing at <span className="mono tnum text-accent-text">{render}</span>
        </p>
      ) : null}
    </div>
  );
}

export default function TestHero() {
  const [settings, setSettings] = useState<GemSettings>(GEM_DEFAULTS);
  // `?t=<seconds>` pins the scene clock, which is the only way to photograph a
  // 300ms strike from a machine that cannot watch the page.
  const [fixedTime, setFixedTime] = useState<number | undefined>(undefined);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (t !== null && Number.isFinite(Number(t))) setFixedTime(Number(t));
  }, []);
  const reduced = useReducedMotion();
  const heroRef = useRef<HTMLElement>(null);

  // Same measurement as the live hero, for the same reason: `useScroll` on
  // this layout returns a value that rises and then falls over one downward
  // scroll. See `lib/heroProgress.ts`.
  const progress = useMotionValue(0);
  useEffect(() => {
    const node = heroRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      progress.set(heroProgress(rect.top, rect.height, window.innerHeight));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [progress]);

  const gemScale = useTransform(progress, [0, 0.55], [1, 0.86]);
  const gemFade = useTransform(progress, [0.25, 0.7], [1, 0.55]);
  const mastOpacity = useTransform(progress, [0.12, 0.42], [0, 1]);
  const mastY = useTransform(progress, [0.12, 0.55], [220, 0]);
  const mastScale = useTransform(progress, [0.12, 0.55], [0.7, 1]);
  const copyOpacity = useTransform(progress, [0.55, 0.78], [0, 1]);
  const copyY = useTransform(progress, [0.55, 0.82], [48, 0]);
  const hintOpacity = useTransform(progress, [0.02, 0.16], [1, 0]);

  return (
    <main className="landing-dark relative">
      <section ref={heroRef} className="hero-stage">
        <div className="hero-pin">
          {/* The stone owns the whole stage rather than a box inside it: this
              is a rendered scene with its own floor, fog and lighting, and
              cropping it to a square would throw away the caustics that are
              half of what the light is doing. */}
          <motion.div
            className="absolute inset-0"
            style={reduced ? undefined : { scale: gemScale, opacity: gemFade }}
            aria-hidden
          >
            <GemLightning className="h-full w-full" settings={settings} fixedTime={fixedTime} />
          </motion.div>

          <div className="hero-stack pointer-events-none">
            <motion.div
              aria-hidden
              className="hero-mast"
              style={reduced ? undefined : { opacity: mastOpacity, y: mastY, scale: mastScale }}
            >
              FACET
            </motion.div>

            <motion.div
              className="hero-copy pointer-events-auto"
              style={reduced ? undefined : { opacity: copyOpacity, y: copyY }}
            >
              <p className="badge badge-accent">Hero candidate</p>
              <h1 className="mt-4 text-3xl sm:text-4xl font-semibold text-accent-text text-balance tracking-[-0.02em]">
                One stone. A facet for every job.
              </h1>
              <p className="mt-4 text-lg text-text-dim max-w-prose mx-auto text-pretty">
                The light above is traced, not drawn: it enters the table, splits by wavelength
                inside the crystal, turns on the pavilion facets and leaves as fire. Everything on
                the floor is what escaped downward.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/" className="btn btn-primary">
                  Back to the live page
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </motion.div>
          </div>

          <motion.div
            className="hero-scroll-hint"
            style={reduced ? undefined : { opacity: hintOpacity }}
            aria-hidden
          >
            Scroll
          </motion.div>
        </div>
      </section>

      <TunePanel settings={settings} onChange={setSettings} />
    </main>
  );
}
