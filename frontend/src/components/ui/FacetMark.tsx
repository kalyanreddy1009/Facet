import { CROWN, GIRDLE_LINE, MARK_VIEW_BOX, PAVILION, PROFILE } from "@/lib/gemProfile";

/**
 * The mark — the hero stone at 18px.
 *
 * Same profile geometry as `landing/StoneGraphic`, from `lib/gemProfile`, so
 * the two cannot drift: there is one set of coordinates and both draw it.
 *
 * The plan view this replaces was a disc of 32 facets, and at 18px it averaged
 * into a grey circle that read as a pearl no matter how the shading was tuned
 * — four separate attempts are recorded in the file's history. The profile has
 * something the plan view never did at small size: a *silhouette*. A flat top,
 * two shoulders and a point is legible at 12px, recognisable as a cut gem
 * without any interior detail at all, and unmistakable in a favicon.
 *
 * It shades in opacity rather than colour, because it lives in the nav and has
 * to inherit whatever colour the text around it is — which, now that the nav
 * is dark, means it has to work in both directions from one definition.
 */
export default function FacetMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      /* Not square. The box is cropped to the stone, which is 250×154, and
         forcing that into a square would squash the cut. */
      height={Math.round((size * 154) / 250)}
      viewBox={MARK_VIEW_BOX}
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      {/* Pavilion first, then crown: the lower half is the darker mass, and
          drawing it underneath means the girdle needs no seam. */}
      {PAVILION.map((facet) => (
        <path
          key={facet.d}
          d={facet.d}
          fill="currentColor"
          opacity={(0.26 + 0.4 * (1 - facet.lit)).toFixed(3)}
        />
      ))}
      {CROWN.map((facet) => (
        <path
          key={facet.d}
          d={facet.d}
          fill="currentColor"
          opacity={(0.08 + 0.34 * (1 - facet.lit)).toFixed(3)}
        />
      ))}
      {/* The girdle is the one interior line that survives at 18px — it is
          what separates the two halves and makes the shape read as cut rather
          than as a kite. */}
      <path d={GIRDLE_LINE} stroke="currentColor" strokeWidth="4" opacity="0.5" />
      <path
        d={PROFILE}
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinejoin="round"
      />
    </svg>
  );
}
