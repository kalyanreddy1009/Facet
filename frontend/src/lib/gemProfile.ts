/**
 * The stone, in profile.
 *
 * A round brilliant seen from the side, at its real proportions: the table is
 * 55% of the girdle diameter, the crown 15.5% of it, the pavilion 43%. Those
 * numbers are not arbitrary — they are close to the Tolkowsky proportions that
 * make a diamond return light through its top instead of leaking it out of the
 * bottom, and they are the reason this silhouette is recognisable as a gem
 * rather than as a hexagon.
 *
 * Profile rather than plan view because the app needed a light *source*. Seen
 * from above, a stone can only glint. Seen from the side you can watch a beam
 * arrive at the table, travel down into the pavilion, bounce off the back
 * facets and leave through the crown — which is the actual physics of why a
 * cut stone is bright, and the thing the landing page is now built around.
 *
 * `lit` is per-facet, from a single hard source above and slightly left.
 */

export interface Facet {
  d: string;
  /** 0 faces away from the source, 1 faces into it. */
  lit: number;
}

/** The silhouette: table, crown slopes, girdle corners, culet. */
export const PROFILE = "M54.0 58.8 L186.0 58.8 L240.0 96.0 L120.0 199.2 L0.0 96.0 Z";

/** Crown facets — the visible top slope, table corner to girdle. */
export const CROWN: Facet[] = [
  { d: "M54.0 58.8 L83.7 58.8 L54.0 96.0 L0.0 96.0 Z", lit: 0.826 },
  { d: "M83.7 58.8 L108.1 58.8 L98.4 96.0 L54.0 96.0 Z", lit: 0.653 },
  { d: "M108.1 58.8 L131.9 58.8 L141.6 96.0 L98.4 96.0 Z", lit: 0.5 },
  { d: "M131.9 58.8 L156.3 58.8 L186.0 96.0 L141.6 96.0 Z", lit: 0.347 },
  { d: "M156.3 58.8 L186.0 58.8 L240.0 96.0 L186.0 96.0 Z", lit: 0.174 },
];

/** Pavilion facets — girdle down to the culet, where light turns around. */
export const PAVILION: Facet[] = [
  { d: "M0.0 96.0 L45.6 96.0 L120.0 199.2 Z", lit: 0.583 },
  { d: "M45.6 96.0 L86.4 96.0 L120.0 199.2 Z", lit: 0.475 },
  { d: "M86.4 96.0 L120.0 96.0 L120.0 199.2 Z", lit: 0.382 },
  { d: "M120.0 96.0 L153.6 96.0 L120.0 199.2 Z", lit: 0.298 },
  { d: "M153.6 96.0 L194.4 96.0 L120.0 199.2 Z", lit: 0.205 },
  { d: "M194.4 96.0 L240.0 96.0 L120.0 199.2 Z", lit: 0.097 },
];

/** The girdle line: the widest point, and the boundary between the two. */
export const GIRDLE_LINE = "M0.0 96.0 L240.0 96.0";
export const TABLE_LINE = "M54.0 58.8 L186.0 58.8";

/** Where the beam lands on the table. */
export const STRIKE = { x: 96.9, y: 58.8 };

/** The culet — the point at the bottom, and the optical centre of the
 *  pavilion's reflections. */
export const CULET = { x: 120.0, y: 199.2 };

/** Where refracted beams leave the stone, spread along the girdle. Five,
 *  because an odd count never reads as symmetrical decoration. */
export const EXITS = [
  { x: 26.4, y: 96.0 },
  { x: 72.0, y: 96.0 },
  { x: 126.0, y: 96.0 },
  { x: 174.0, y: 96.0 },
  { x: 218.4, y: 96.0 },
];

export const PROFILE_VIEW_BOX = "0 0 240 240";

/** The same figure, cropped to the stone itself.
 *
 *  The hero needs the square box because the bolt falls in from above it. The
 *  mark does not: a stone is far wider than it is tall, so in a square box it
 *  only ever fills the middle band — an 18px mark was drawing an 11px gem.
 *  This crop is worth roughly 60% more mark at the same nominal size. */
export const MARK_VIEW_BOX = "-5 52 250 154";
