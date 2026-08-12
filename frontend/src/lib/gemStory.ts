/**
 * The scroll-to-scene maths for the landing story.
 *
 * The page is one continuous optical experiment, not five hero sections: a
 * single WebGL stone stays on screen for the whole scroll and every visible
 * difference between "scenes" is an interpolation of the same ten knobs
 * `GemSettings` already exposes. That is why this file exists and why it holds
 * no React — the choreography is arithmetic, it is the part that is either
 * right or wrong, and it is the part worth having a check for.
 *
 * Six keyframes, one per scene boundary. `gemAt()` lerps between the two that
 * bracket the scroll position. Nothing in the shader changed to make this
 * work.
 */

import type { GemSettings } from "@/components/landing/GemLightning";

export const SCENE_COUNT = 5;

/** The stone's state at each scene boundary, p = 0, 0.2, 0.4, 0.6, 0.8, 1. */
export const GEM_KEYS: GemSettings[] = [
  // 01 The Stone — dormant, close, the column standing on it at full strength.
  { dispersion: 0.008, beam: 1.0, exposure: 1.3, bloom: 0.6, spin: 0.012, camDist: 9.0, camHeight: 0.95, zoom: 2.35, light: 0.7 },
  // 02 The Rough — the stone wakes: it turns, and it starts to split the light.
  { dispersion: 0.03, beam: 0.95, exposure: 1.5, bloom: 0.8, spin: 0.045, camDist: 8.6, camHeight: 0.9, zoom: 2.5, light: 1.15 },
  // 03 The Cut — fastest turn, widest spectrum, one facet doing the work.
  { dispersion: 0.055, beam: 0.85, exposure: 1.6, bloom: 0.95, spin: 0.07, camDist: 8.9, camHeight: 1.15, zoom: 2.7, light: 1.35 },
  // 04 The Cabinet — settles. The interest has moved off the stone and onto
  // what is travelling away from it, so the stone stops competing.
  { dispersion: 0.03, beam: 0.6, exposure: 1.5, bloom: 0.8, spin: 0.03, camDist: 9.8, camHeight: 0.8, zoom: 2.4, light: 1.1 },
  // 05 Infinite Facets — the pull back; the beam recedes with the camera.
  { dispersion: 0.05, beam: 0.45, exposure: 1.75, bloom: 1.25, spin: 0.08, camDist: 12.6, camHeight: 1.5, zoom: 2.0, light: 1.4 },
  // …and the convergence at the very end: the column returns to full and
  // everything the story drew comes back into the stone.
  { dispersion: 0.03, beam: 1.0, exposure: 2.0, bloom: 1.45, spin: 0.04, camDist: 11.0, camHeight: 1.1, zoom: 2.2, light: 1.6 },
];

// Spelled out rather than derived from GEM_DEFAULTS: this file is checked by
// `node`, which erases `import type` but would have to resolve a value import
// through the `@/` alias to get it.
const KEYS: (keyof GemSettings)[] = [
  "dispersion",
  "beam",
  "exposure",
  "bloom",
  "spin",
  "camDist",
  "camHeight",
  "zoom",
  "light",
];

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Scene-local progress: 0 where scene `i` starts, 1 where it ends. */
export function sceneProgress(p: number, i: number): number {
  return clamp01((p - i / SCENE_COUNT) * SCENE_COUNT);
}

/** The stone's settings at overall scroll progress `p` (0..1). */
export function gemAt(p: number): GemSettings {
  const span = clamp01(p) * (GEM_KEYS.length - 1);
  const i = Math.min(GEM_KEYS.length - 2, Math.floor(span));
  const t = span - i;
  const a = GEM_KEYS[i];
  const b = GEM_KEYS[i + 1];
  const out = {} as GemSettings;
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Mutate an existing settings object in place — the render loop reads this
 *  object every frame, so writing into it is how the scene changes without a
 *  React render per scroll event. */
export function gemInto(target: GemSettings, p: number): void {
  const next = gemAt(p);
  for (const k of KEYS) target[k] = next[k];
}

/** The constellation of scene 05: every ray the story has drawn, plus the ones
 *  it implies, on a golden-angle spiral so no two land on the same spoke.
 *  Coordinates are the same 0..100 space the beams and cards share. */
export function constellation(n: number): { x: number; y: number; hue: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = i * 2.399963229728653;
    const r = 12 + (i % 9) * 2.6 + (i / n) * 10;
    return { x: 50 + Math.cos(a) * r * 1.55, y: 50 + Math.sin(a) * r, hue: i % 6 };
  });
}
