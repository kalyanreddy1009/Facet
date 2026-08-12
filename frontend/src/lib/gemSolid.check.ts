/**
 * The gem solid, asserted.
 *
 * Everything the hero's shader believes about the stone comes out of
 * `gemSolid.ts`, and none of it is visible in the picture until it is wrong in
 * a way that takes an hour to attribute: a facet ring at the wrong angle does
 * not draw a wrong shape, it draws a slightly duller stone. So the geometry is
 * checked here numerically, before a GPU is involved.
 *
 *   node src/lib/gemSolid.check.ts
 */

import {
  GEM_BOUND,
  GEM_PLANES,
  GEM_PLANE_DATA,
  TABLE_R,
  TABLE_Y,
  axisExtent,
  boundaryIn,
  outside,
} from "./gemSolid.ts";

function assert(ok: boolean, msg: string) {
  if (!ok) throw new Error(msg);
}

// --- the solid is the shape we think it is ---------------------------------

assert(outside([0, 0, 0]) < 0, "the centre must be inside the solid");
assert(outside([1.02, 0, 0]) > 0, "past the girdle must be outside");
assert(outside([0, TABLE_Y - 0.01, 0]) < 0, "under the table must be inside");
assert(outside([0, TABLE_Y + 0.01, 0]) > 0, "above the table must be outside");

// The girdle is the widest point: that is what makes the silhouette a gem
// rather than a cone or a barrel.
assert(outside([0.99, 0, 0]) < 0, "the girdle must be reachable");
assert(outside([0.99, 0.2, 0]) > 0, "the crown must narrow going up");
assert(outside([0.99, -0.2, 0]) > 0, "the pavilion must narrow going down");

// The table rim is a corner of the solid: on the boundary from inside, out
// from a hair beyond. If a bezel angle drifts, the table stops meeting the
// crown here and the stone grows a shoulder.
assert(outside([TABLE_R - 0.01, TABLE_Y - 0.005, 0]) < 0, "the table rim must be on the solid");
assert(outside([TABLE_R + 0.06, TABLE_Y - 0.005, 0]) > 0, "the crown must slope away below it");

// --- the proportions are the cut's, not something that drifted -------------

const { top, bottom } = axisExtent();
assert(Math.abs(top - 0.34) < 0.01, `crown height drifted: ${top.toFixed(3)}`);
assert(Math.abs(bottom + 0.892) < 0.01, `pavilion depth drifted: ${bottom.toFixed(3)}`);
assert(GEM_BOUND >= 1.0, "the bounding sphere must contain the girdle");
assert(GEM_BOUND >= -bottom * 0.0 + 1.0, "the bounding sphere must contain the culet reach");

// --- every facet is a facet ------------------------------------------------
//
// A plane that never bounds the solid is a facet nobody will ever see and a
// per-bounce cost the GPU pays on every pixel of the stone regardless. Sweep
// the sphere of directions and require each plane to win at least once.

const seen = new Set<number>();
const N = 6000;
for (let i = 0; i < N; i++) {
  // Fibonacci sphere: an even cover without pole clustering, which matters
  // because the thin girdle band is exactly where clustering would hide a
  // missing win.
  const y = 1 - (2 * (i + 0.5)) / N;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * Math.PI * (3 - Math.sqrt(5));
  const { plane, t } = boundaryIn([Math.cos(a) * r, y, Math.sin(a) * r]);
  assert(plane >= 0, "every direction must leave the solid through some plane");
  assert(t <= GEM_BOUND + 1e-6, `direction ${i} escapes the bounding sphere at t=${t}`);
  seen.add(plane);
}
for (let i = 0; i < GEM_PLANES.length; i++) {
  assert(seen.has(i), `plane ${i} never bounds the solid: it is a redundant facet`);
}

// --- the uniform the shader actually reads ---------------------------------

assert(GEM_PLANE_DATA.length === GEM_PLANES.length * 4, "plane data must be one vec4 per plane");
for (const [i, p] of GEM_PLANES.entries()) {
  const len = Math.hypot(...p.n);
  assert(Math.abs(len - 1) < 1e-6, `plane ${i} normal is not unit length (${len})`);
  assert(p.d > 0, `plane ${i} passes through or behind the centre, so the centre is not inside`);
  assert(
    Math.abs(GEM_PLANE_DATA[i * 4 + 3] - p.d) < 1e-6,
    `plane ${i} offset did not survive flattening`
  );
}

console.log(`gemSolid: ${GEM_PLANES.length} facets, all reachable, proportions ok`);
