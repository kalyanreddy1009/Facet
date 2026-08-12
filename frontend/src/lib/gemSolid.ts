/**
 * A round brilliant as a convex solid: the list of half-spaces whose
 * intersection *is* the stone.
 *
 * The 3D hero traces real light through a diamond, and the one decision that
 * makes that affordable is this representation. A triangle mesh needs a BVH
 * and a per-triangle intersection loop; a signed distance field needs forty
 * sphere-tracing steps per bounce and rounds off exactly the sharp facet edges
 * that make a gem look like a gem. A convex polyhedron needs neither: a ray
 * against N planes by the slab method gives the *exact* entry point, the exact
 * exit point and both exact normals in one linear pass, with no tolerance and
 * no epsilon creep. That is what lets the shader afford five internal bounces
 * on three wavelengths.
 *
 * Proportions are the Tolkowsky-ish ones the 2D mark already uses, restated in
 * girdle-radius units (radius = 1, so a "% of diameter" figure doubles):
 *
 *   table       55% of diameter   -> radius 0.55
 *   crown       15.5%             -> height 0.31, from a 34.5 deg bezel
 *   pavilion    43%               -> depth 0.862, from a 40.75 deg main
 *   girdle       3%               -> half-thickness 0.03
 *
 * The facet groups are the real ones. Bezels and pavilion mains sit on the
 * eight cardinal azimuths; stars and lower-girdle halves sit on the eight
 * between them, shallower and steeper respectively, so they cut the corners
 * off their neighbours exactly as they do on a cut stone. Take any group away
 * and the light stops behaving: the eight-pointed star that appears under the
 * table is made by the lower halves, not by the mains.
 */

/** One half-space: the solid is every point p with dot(p, n) <= d. */
export interface Plane {
  n: [number, number, number];
  d: number;
}

const RAD = Math.PI / 180;

/** Girdle half-thickness, in radius units. */
const GIRDLE = 0.03;
/** Table radius, in radius units. */
export const TABLE_R = 0.55;
/** Table height above the girdle plane. */
export const TABLE_Y = Math.tan(34.5 * RAD) * (1 - TABLE_R) + GIRDLE;

/** A ring of `count` identical facets around the axis.
 *
 *  `tilt` is the facet's inclination from the girdle plane, so its normal is
 *  that same angle from vertical. `up` picks crown (+1) or pavilion (-1).
 *  `through` is a point in the r/y half-plane the facet must contain, which is
 *  what pins the plane's offset: bezels pass through the girdle edge, stars
 *  through the table rim. */
function ring(
  count: number,
  tiltDeg: number,
  up: 1 | -1,
  through: [number, number],
  phase = 0
): Plane[] {
  const tilt = tiltDeg * RAD;
  const [r, y] = through;
  const d = Math.sin(tilt) * r + Math.cos(tilt) * y * up;
  return Array.from({ length: count }, (_, i) => {
    const a = phase + (i * 2 * Math.PI) / count;
    return {
      n: [Math.sin(tilt) * Math.cos(a), up * Math.cos(tilt), Math.sin(tilt) * Math.sin(a)] as [
        number,
        number,
        number,
      ],
      d,
    };
  });
}

const OFF = Math.PI / 8; // 22.5 deg: the azimuths between the mains.

export const GEM_PLANES: Plane[] = [
  { n: [0, 1, 0], d: TABLE_Y }, // table
  ...ring(8, 34.5, 1, [1, GIRDLE]), // crown bezels
  ...ring(8, 22, 1, [TABLE_R, TABLE_Y], OFF), // stars
  ...ring(8, 90, 1, [1, 0]), // girdle
  ...ring(8, 40.75, -1, [1, -GIRDLE]), // pavilion mains
  ...ring(8, 42.5, -1, [1, -GIRDLE], OFF), // lower girdle halves
];

/** Flat vec4 array for the shader uniform: (nx, ny, nz, d). */
export const GEM_PLANE_DATA = new Float32Array(
  GEM_PLANES.flatMap((p) => [p.n[0], p.n[1], p.n[2], p.d])
);

/** Signed distance-ish: <= 0 is inside every half-space. */
export function outside(p: [number, number, number]): number {
  return Math.max(...GEM_PLANES.map((q) => q.n[0] * p[0] + q.n[1] * p[1] + q.n[2] * p[2] - q.d));
}

/** The solid's extent along the axis, found by walking the half-spaces. */
export function axisExtent(): { top: number; bottom: number } {
  // At r = 0 only the table and the pavilion facets bound the axis.
  const top = TABLE_Y;
  const bottom = -Math.min(
    ...GEM_PLANES.filter((p) => p.n[1] < -0.01).map((p) => p.d / -p.n[1])
  );
  return { top, bottom };
}

/** The bounding sphere the shader tests before paying for a full trace. */
export const GEM_BOUND = 1.1;

/** Which plane bounds the solid in direction `dir` from the centre, and how
 *  far away it is. This is the slab method the shader runs, in one dimension
 *  fewer: it is how the check finds out whether a facet is ever visible. */
export function boundaryIn(dir: [number, number, number]): { plane: number; t: number } {
  let best = Infinity;
  let plane = -1;
  for (const [i, p] of GEM_PLANES.entries()) {
    const dn = p.n[0] * dir[0] + p.n[1] * dir[1] + p.n[2] * dir[2];
    if (dn <= 1e-9) continue;
    const t = p.d / dn;
    if (t < best) {
      best = t;
      plane = i;
    }
  }
  return { plane, t: best };
}
