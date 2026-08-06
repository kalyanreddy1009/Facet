/**
 * The four nouns, drawn in the app's own geometry.
 *
 * Facet borrows its whole vocabulary from gemcutting — Stone, Rough, Facet,
 * Cabinet — and then drew that vocabulary with borrowed icons: a generic
 * layers glyph for a stone, a magnifying glass for a pool of postings. A
 * product with a metaphor this specific should not be using stock symbols for
 * the four words it invented.
 *
 * All four are cut from `lib/gemProfile`, the same coordinates the hero stone
 * and the nav mark use. That is the point: the icon for "Stone" is literally
 * the silhouette of the stone on the landing page, at 16px. Nothing here is a
 * new drawing to keep in step with an old one.
 *
 * Deliberately not a full icon set. Lucide stays for every ordinary verb —
 * refresh, settings, download — because those are conventions and inventing
 * private glyphs for them would cost recognition and buy nothing. These four
 * exist because these four words are the product's own.
 */

import { CULET, MARK_VIEW_BOX, PROFILE, TABLE_LINE } from "@/lib/gemProfile";

interface IconProps {
  className?: string;
}

/** Shared frame. `currentColor` throughout so they inherit like text, and
 *  non-scaling strokes so a 16px icon and a 24px icon read at the same
 *  weight rather than the small one going spindly. */
function Frame({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox={MARK_VIEW_BOX}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={12}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** THE STONE — the whole silhouette, closed and solid. One thing, entire.
 *  It is the only one of the four that is filled: the Stone is the only one
 *  of the four that is a fact rather than a process. */
export function StoneIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d={PROFILE} fill="currentColor" fillOpacity={0.16} />
      <path d={TABLE_LINE} />
    </Frame>
  );
}

/** THE ROUGH — uncut material. The same silhouette before it has facets: no
 *  table line, and a broken outline, because the Rough is a pool of things
 *  that have not been decided about yet. */
export function RoughIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d={PROFILE} strokeDasharray="34 26" />
    </Frame>
  );
}

/** A FACET — one face of the stone, lit. The crown's left face picked out
 *  against the rest of the outline: one plane of the whole, which is exactly
 *  what a tailored application is. */
export function FacetIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d={PROFILE} strokeOpacity={0.32} />
      {/* Table corner down to the girdle — the face the light leaves by. */}
      <path d="M54 58.8 L0 96 L120 199.2 Z" fill="currentColor" fillOpacity={0.22} strokeOpacity={0} />
      <path d="M54 58.8 L0 96" />
    </Frame>
  );
}

/** THE CABINET — where cut stones are kept. The culet resting on a shelf:
 *  the stone plus the line it sits on, which is the difference between a
 *  facet you cut and a facet you filed. */
export function CabinetIcon({ className }: IconProps) {
  return (
    <Frame className={className}>
      <path d={PROFILE} strokeOpacity={0.55} />
      <path d={`M-4 ${CULET.y + 14} L244 ${CULET.y + 14}`} />
    </Frame>
  );
}
