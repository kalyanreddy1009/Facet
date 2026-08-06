/**
 * Why a cut stone is bright — as a calculation rather than an illustration.
 *
 * The landing page's study section draws a beam entering the stone and either
 * coming back out of the top or leaking through the bottom, and prints the
 * angles beside it. Those two things must be the same computation or the page
 * is lying in exactly the way the product promises it never does. So there is
 * one function, `traceStone`, and both the polyline and the readout are read
 * off its result.
 *
 * THE MODEL, stated plainly so the numbers can be checked:
 *
 *   - Diamond's refractive index is 2.417. Air is 1.
 *   - Snell: sin(incident) = n · sin(refracted). Light entering the table
 *     therefore bends *toward* the vertical, and can never travel more than
 *     asin(1/n) ≈ 24.4° off it however steeply it arrives.
 *   - At every internal surface, if the ray meets the facet at more than the
 *     critical angle asin(1/n) from that facet's normal, none of it escapes —
 *     total internal reflection. Below that angle it refracts out and is gone.
 *   - The critical angle and the pavilion angle together are the whole trick:
 *     the pavilion facets of a round brilliant sit at ~40.7° from the girdle
 *     plane, which is far enough past 24.4° that a beam arriving anywhere near
 *     the axis is turned around rather than lost. That is a cut decision, not
 *     a property of the material — the same rough cut badly leaks.
 *
 * The geometry is not re-typed here: the segments come from `gemProfile`, the
 * same coordinates the SVG draws, so "to scale" is structural rather than a
 * claim. Change the stone and the physics follows it.
 *
 * Not modelled, deliberately: dispersion (one wavelength, one index — the
 * colour in the artwork is artistic and the study is monochrome to stay
 * honest), Fresnel partial reflection at each surface, and the girdle. None of
 * them change whether the beam comes back, which is the only question asked.
 */

import { CULET, STRIKE } from "./gemProfile.ts";

/** Diamond, sodium D line. */
export const INDEX = 2.417;

const DEG = 180 / Math.PI;

/** Beyond this angle from a facet's normal, nothing escapes. ≈24.4°. */
export const CRITICAL_ANGLE = Math.asin(1 / INDEX) * DEG;

export type Point = [number, number];

/** A face of the stone, in the same coordinate space `gemProfile` draws.
 *  `outward` is the unit normal pointing out of the stone. */
interface Face {
  name: string;
  a: Point;
  b: Point;
  outward: Point;
}

/** Roughly inside the stone — used only to orient each face's normal, so a
 *  face never has to state which way is out and then be wrong about it. */
const INSIDE: Point = [120, 100];

function face(name: string, a: Point, b: Point): Face {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(dx, dy);
  // Either perpendicular; pick the one pointing away from the interior.
  let n: Point = [dy / len, -dx / len];
  const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (n[0] * (mid[0] - INSIDE[0]) + n[1] * (mid[1] - INSIDE[1]) < 0) n = [-n[0], -n[1]];
  return { name, a, b, outward: n };
}

/** The five faces a ray can reach, from the profile in `gemProfile`. */
const FACES: Face[] = [
  face("table", [54, 58.8], [186, 58.8]),
  face("crown", [186, 58.8], [240, 96]),
  face("crown", [54, 58.8], [0, 96]),
  face("pavilion", [240, 96], [CULET.x, CULET.y]),
  face("pavilion", [0, 96], [CULET.x, CULET.y]),
];

export interface Trace {
  /** The beam's path, starting above the table and ending wherever it stops. */
  path: Point[];
  /** Angle from the table's normal at which the beam arrives, in degrees. */
  incident: number;
  /** Angle from the vertical it travels at once inside, in degrees. */
  refracted: number;
  /** Angle from the normal at the first facet it meets inside, in degrees.
   *  This is the number compared against the critical angle. */
  pavilion: number;
  /** True when the beam leaves through the crown or table — the stone is
   *  bright. False when it refracts out of the pavilion and is lost. */
  returned: boolean;
  /** Which face it finally left by. */
  exit: string;
}

function dot(u: Point, v: Point) {
  return u[0] * v[0] + u[1] * v[1];
}

/** Nearest face the ray from `p` in direction `d` actually reaches. */
function hit(p: Point, d: Point, skip: Face | null): { face: Face; at: Point } | null {
  let best: { face: Face; at: Point; t: number } | null = null;
  for (const f of FACES) {
    if (f === skip) continue;
    const [ex, ey] = [f.b[0] - f.a[0], f.b[1] - f.a[1]];
    const denom = d[0] * -ey - d[1] * -ex;
    if (Math.abs(denom) < 1e-9) continue; // parallel
    const [rx, ry] = [f.a[0] - p[0], f.a[1] - p[1]];
    const t = (rx * -ey - ry * -ex) / denom;
    const u = (d[0] * ry - d[1] * rx) / denom;
    if (t <= 1e-6 || u < -1e-6 || u > 1 + 1e-6) continue;
    if (!best || t < best.t) best = { face: f, at: [p[0] + d[0] * t, p[1] + d[1] * t], t };
  }
  return best && { face: best.face, at: best.at };
}

/**
 * Send a beam into the table at `incidentDeg` from its normal and follow it.
 *
 * @param incidentDeg 0 is straight down the stone's axis; 90 would be grazing.
 * @param bounces Safety stop. Three is enough for the pavilion's two turns
 *   plus the exit; the cap exists so a degenerate angle cannot spin forever.
 */
export function traceStone(incidentDeg: number, bounces = 4): Trace {
  const incident = Math.min(Math.max(incidentDeg, 0), 89);

  // Into the stone. The beam bends toward the vertical — this is why the
  // refracted angle saturates at the critical angle no matter how steep the
  // arrival, and therefore why a well-cut pavilion can always turn it around.
  const refracted = Math.asin(Math.sin(incident / DEG) / INDEX);

  // Approach leg, drawn from above the table so the bend at the surface is
  // visible rather than implied.
  const lead = 62;
  const start: Point = [
    STRIKE.x - Math.sin(incident / DEG) * lead,
    STRIKE.y - Math.cos(incident / DEG) * lead,
  ];

  const path: Point[] = [start, [STRIKE.x, STRIKE.y]];
  let p: Point = [STRIKE.x, STRIKE.y];
  let d: Point = [Math.sin(refracted), Math.cos(refracted)];
  let from: Face | null = FACES[0];

  let pavilion = 0;
  let returned = false;
  let exit = "pavilion";

  for (let i = 0; i < bounces; i++) {
    const next = hit(p, d, from);
    if (!next) break;
    const n = next.face.outward;
    // Angle to the normal. `d` points into the surface, so the dot product is
    // positive and this is the incidence angle directly.
    const phi = Math.acos(Math.min(1, Math.abs(dot(d, n)))) * DEG;
    if (i === 0) pavilion = phi;

    if (phi >= CRITICAL_ANGLE) {
      // Trapped: reflect and keep going.
      const k = 2 * dot(d, n);
      d = [d[0] - k * n[0], d[1] - k * n[1]];
      path.push(next.at);
      p = next.at;
      from = next.face;
      continue;
    }

    // It escapes here. Bend away from the normal on the way out, and draw a
    // short leg so the direction it left in is legible.
    const out = Math.asin(Math.min(1, INDEX * Math.sin(phi / DEG)));
    const along: Point = [d[0] - dot(d, n) * n[0], d[1] - dot(d, n) * n[1]];
    const mag = Math.hypot(along[0], along[1]) || 1;
    const t: Point = [along[0] / mag, along[1] / mag];
    const dir: Point = [
      Math.sin(out) * t[0] + Math.cos(out) * n[0],
      Math.sin(out) * t[1] + Math.cos(out) * n[1],
    ];
    path.push(next.at, [next.at[0] + dir[0] * 74, next.at[1] + dir[1] * 74]);
    exit = next.face.name;
    returned = next.face.name !== "pavilion";
    return { path, incident, refracted: refracted * DEG, pavilion, returned, exit };
  }

  return { path, incident, refracted: refracted * DEG, pavilion, returned, exit };
}

/** The steepest arrival that still comes back, found rather than asserted, so
 *  the copy beside the study cannot drift away from the model. */
export function brightestLimit(): number {
  let lo = 0;
  let hi = 89;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (traceStone(mid).returned) lo = mid;
    else hi = mid;
  }
  return lo;
}
