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
  // The 16 upper-girdle facets are dropped. They are the smallest ring, they
  // ring the rim, and at 18px they collapse into a grey band that eats the
  // silhouette — the mark reads as a pearl. Kites and stars are the large
  // shapes that still carry structure at this size, and the girdle stroke
  // already draws the edge those rim facets were describing.
  const shapes = FACETS.filter((facet) => facet.k !== "ug");

  return (
    <svg
      width={size}
      height={size}
      viewBox={VIEW_BOX}
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      {shapes.map((facet) => (
        <path
          key={facet.d}
          d={facet.d}
          fill="currentColor"
          // Inverted against `lit`: on a light interface more ink means less
          // light, so the facets facing away from the source are the dark
          // ones. The exponent is high and the range nearly full, because the
          // failure mode at 18px is not "too subtle" — it is a uniform grey
          // disc that reads as a pearl. What survives at this size is one
          // hard terminator between a light half and a dark half.
          opacity={(0.04 + 0.8 * Math.pow(1 - facet.lit, 1.2)).toFixed(3)}
        />
      ))}
      {/* Left almost open. The table is the brightest plane on a real stone,
          and at 18px an empty centre is the difference between a cut gem and a
          filled blob. */}
      <path d={TABLE} fill="currentColor" opacity="0.04" />
      <path
        d={GIRDLE}
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinejoin="round"
      />
    </svg>
  );
}
