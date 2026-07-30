import { FACETS, GIRDLE, TABLE, VIEW_BOX } from "@/lib/gem";

/**
 * The mark — the hero stone at 17px.
 *
 * Same geometry, from `lib/gem`, so the two cannot drift. What changes is how
 * it is drawn: the hero shades each facet in real colour, and the mark can't,
 * because it has to sit in a nav and inherit whatever colour the text around it
 * is. So it shades in *opacity* instead. Each facet is `currentColor` at an
 * alpha derived from its own light value — a lit side and a dark side — which
 * is what still reads as a faceted solid when the whole thing is 17 pixels
 * across and the individual facets are a pixel and a half.
 *
 * Three earlier attempts are worth recording, because they all look reasonable
 * as descriptions and none of them survived being rendered at 17px:
 *
 *   - outlined facets: a wheel, or a steering wheel
 *   - kite facets only: a flower, or a snowflake
 *   - solid silhouette with light facet lines cut into it: a gear, or a sun
 *
 * Shading was the thing that worked. An icon this small has room for one idea,
 * and "light hits it from the upper left" is a better one than any amount of
 * line detail.
 */
export default function FacetMark({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={VIEW_BOX}
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      {FACETS.map((facet) => (
        <path
          key={facet.d}
          d={facet.d}
          fill="currentColor"
          // Inverted against `lit`: on a light interface more ink means less
          // light, so the facets facing away from the source are the dark
          // ones. Raised to 1.15 to push the two sides apart — at this size a
          // linear ramp turns into one flat grey disc.
          opacity={(0.05 + 0.66 * Math.pow(1 - facet.lit, 1.15)).toFixed(3)}
        />
      ))}
      {/* The table stays near-empty. It is the brightest plane on a real stone,
          and leaving it open is what gives the mark a centre. */}
      <path d={TABLE} fill="currentColor" opacity="0.07" />
      <path
        d={GIRDLE}
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinejoin="round"
      />
    </svg>
  );
}
