/**
 * The stone, as coordinates.
 *
 * One round brilliant seen from above, shared by the 17px mark in the nav and
 * the hero on the landing page — so they are one design at two sizes rather
 * than two drawings of a similar idea. Anything that redraws the stone imports
 * from here; nothing re-types a path.
 *
 * The construction, so it can be rederived rather than guessed at:
 *
 *   table    octagon, radius 44 at 0°, 45°, 90° …
 *   apexes   radius 74, offset 22.5° — star tips and kite shoulders
 *   girdle   regular 16-gon, radius 100, alternating 0° and 22.5° points
 *
 * That yields the real facet count of a brilliant crown: one table, 8 star
 * facets on the table edges, 8 kites out to the girdle, and 16 upper-girdle
 * facets around the rim. Generated, not hand-written — the vertices have to
 * agree to a tenth of a unit or the edges show hairline gaps when scaled up.
 *
 * `lit` is the facet's own brightness: the cosine between its outward normal
 * and a light at 214°, weighted by how steep that ring of facets sits, then
 * nudged ± per neighbour. That last part is scintillation — on a real stone
 * adjacent facets almost never return the same light, and without it the three
 * rings read as one smooth gradient rather than as cut stone.
 */

export interface Facet {
  /** Ring: star, kite, or upper-girdle. Kept because the mark draws a subset. */
  k: "star" | "kite" | "ug";
  d: string;
  /** 0 faces fully away from the light, 1 faces straight into it. */
  lit: number;
}

export const FACETS: Facet[] = [
  { k: "star", d: "M164.0 120.0 L188.4 148.3 L151.1 151.1 Z", lit: 0.062 },
  { k: "kite", d: "M164.0 120.0 L188.4 148.3 L220.0 120.0 L188.4 91.7 Z", lit: 0.17 },
  { k: "ug", d: "M220.0 120.0 L212.4 158.3 L188.4 148.3 Z", lit: 0 },
  { k: "ug", d: "M188.4 148.3 L212.4 158.3 L190.7 190.7 Z", lit: 0 },
  { k: "star", d: "M151.1 151.1 L148.3 188.4 L120.0 164.0 Z", lit: 0.285 },
  { k: "kite", d: "M151.1 151.1 L148.3 188.4 L190.7 190.7 L188.4 148.3 Z", lit: 0 },
  { k: "ug", d: "M190.7 190.7 L158.3 212.4 L148.3 188.4 Z", lit: 0 },
  { k: "ug", d: "M148.3 188.4 L158.3 212.4 L120.0 220.0 Z", lit: 0.065 },
  { k: "star", d: "M120.0 164.0 L91.7 188.4 L88.9 151.1 Z", lit: 0.343 },
  { k: "kite", d: "M120.0 164.0 L91.7 188.4 L120.0 220.0 L148.3 188.4 Z", lit: 0.305 },
  { k: "ug", d: "M120.0 220.0 L81.7 212.4 L91.7 188.4 Z", lit: 0.332 },
  { k: "ug", d: "M91.7 188.4 L81.7 212.4 L49.3 190.7 Z", lit: 0.411 },
  { k: "star", d: "M88.9 151.1 L51.6 148.3 L76.0 120.0 Z", lit: 0.784 },
  { k: "kite", d: "M88.9 151.1 L51.6 148.3 L49.3 190.7 L91.7 188.4 Z", lit: 0.51 },
  { k: "ug", d: "M49.3 190.7 L27.6 158.3 L51.6 148.3 Z", lit: 0.727 },
  { k: "ug", d: "M51.6 148.3 L27.6 158.3 L20.0 120.0 Z", lit: 0.983 },
  { k: "star", d: "M76.0 120.0 L51.6 91.7 L88.9 88.9 Z", lit: 0.768 },
  { k: "kite", d: "M76.0 120.0 L51.6 91.7 L20.0 120.0 L51.6 148.3 Z", lit: 1.0 },
  { k: "ug", d: "M20.0 120.0 L27.6 81.7 L51.6 91.7 Z", lit: 1 },
  { k: "ug", d: "M51.6 91.7 L27.6 81.7 L49.3 49.3 Z", lit: 1 },
  { k: "star", d: "M88.9 88.9 L91.7 51.6 L120.0 76.0 Z", lit: 0.885 },
  { k: "kite", d: "M88.9 88.9 L91.7 51.6 L49.3 49.3 L51.6 91.7 Z", lit: 0.906 },
  { k: "ug", d: "M49.3 49.3 L81.7 27.6 L91.7 51.6 Z", lit: 1 },
  { k: "ug", d: "M91.7 51.6 L81.7 27.6 L120.0 20.0 Z", lit: 1 },
  { k: "star", d: "M120.0 76.0 L148.3 51.6 L151.1 88.9 Z", lit: 0.487 },
  { k: "kite", d: "M120.0 76.0 L148.3 51.6 L120.0 20.0 L91.7 51.6 Z", lit: 0.865 },
  { k: "ug", d: "M120.0 20.0 L158.3 27.6 L148.3 51.6 Z", lit: 0.77 },
  { k: "ug", d: "M148.3 51.6 L158.3 27.6 L190.7 49.3 Z", lit: 0.487 },
  { k: "star", d: "M151.1 88.9 L188.4 91.7 L164.0 120.0 Z", lit: 0.386 },
  { k: "kite", d: "M151.1 88.9 L188.4 91.7 L190.7 49.3 L148.3 51.6 Z", lit: 0.32 },
  { k: "ug", d: "M190.7 49.3 L212.4 81.7 L188.4 91.7 Z", lit: 0.171 },
  { k: "ug", d: "M188.4 91.7 L212.4 81.7 L220.0 120.0 Z", lit: 0.119 },
];

/** The flat top face — a window straight down into the stone. */
export const TABLE = "M164.0 120.0 L151.1 151.1 L120.0 164.0 L88.9 151.1 L76.0 120.0 L88.9 88.9 L120.0 76.0 L151.1 88.9 Z";

/** The rim. A 16-gon, which is what keeps the silhouette from reading as a
 *  geometric octagon rather than a round cut. */
export const GIRDLE = "M220.0 120.0 L212.4 158.3 L190.7 190.7 L158.3 212.4 L120.0 220.0 L81.7 212.4 L49.3 190.7 L27.6 158.3 L20.0 120.0 L27.6 81.7 L49.3 49.3 L81.7 27.6 L120.0 20.0 L158.3 27.6 L190.7 49.3 L212.4 81.7 Z";

/** What you see *through* the table: the pavilion below, reflected back. On a
 *  real stone this is the dark ring in the middle, and it is the strongest
 *  single cue that the centre is a window and not a flat cap. */
export const REFLECTION = "M145.2 130.4 L130.4 145.2 L109.6 145.2 L94.8 130.4 L94.8 109.6 L109.6 94.8 L130.4 94.8 L145.2 109.6 Z";

/** The viewBox every consumer must use. Exported so a caller cannot pick a
 *  different one and silently crop the girdle. */
export const VIEW_BOX = "0 0 240 240";
