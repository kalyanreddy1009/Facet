/**
 * The stone, cut — the hero illustration.
 *
 * Plain inline SVG. An earlier version was a full three.js WebGL scene for a
 * decorative shape on one page, which cost ~600KB of JS and a permanent rAF
 * loop; the metaphor survived the renderer being deleted, so it stays deleted.
 *
 * What it has now is one slow light sweep across the facets, because a
 * gemstone that never catches light is just a grey polygon. The sweep is three
 * animated gradient stops — the browser animates one paint, with no element
 * moving and no script running.
 *
 * Still monochrome apart from the halo: it's an illustration, not a status
 * indicator, so it carries no semantic colour.
 */

/** Pavilion facets, table down to culet. Order matters — the alternating
 *  opacity is what makes them read as separate planes rather than one shape. */
const FACES = [
  "M110,20 170,60 110,95",
  "M170,60 190,130 110,95",
  "M190,130 140,195 110,95",
  "M140,195 80,195 110,95",
  "M80,195 30,130 110,95",
  "M30,130 50,60 110,95",
  "M50,60 110,20 110,95",
];

const OUTLINE = "110,20 170,60 190,130 140,195 80,195 30,130 50,60";

/** The three stops of the sweep, as [start, end] offsets. Staggered so the
 *  band has a soft leading and trailing edge instead of a hard bar. */
const SWEEP = [
  { opacity: 0, from: "-0.5", to: "1" },
  { opacity: 0.5, from: "-0.35", to: "1.15" },
  { opacity: 0, from: "-0.2", to: "1.3" },
];

export default function StoneGraphic({ size = 320 }: { size?: number }) {
  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* The halo. Behind the stone, and the only place the decorative second
          hue appears at any real strength. */}
      <div
        className="absolute inset-[12%] rounded-full blur-3xl opacity-70"
        style={{
          background:
            "radial-gradient(circle at 38% 30%, rgba(74,118,240,0.4), rgba(41,199,221,0.16) 46%, transparent 70%)",
        }}
      />

      <svg
        width={size}
        height={size}
        viewBox="0 0 220 220"
        fill="none"
        className="relative text-text-dim"
      >
        <defs>
          <linearGradient id="facet-sweep" x1="0" y1="0" x2="1" y2="0.35">
            {SWEEP.map((stop) => (
              <stop key={stop.from} offset="0%" stopColor="white" stopOpacity={stop.opacity}>
                <animate
                  attributeName="offset"
                  values={`${stop.from};${stop.to}`}
                  dur="7s"
                  repeatCount="indefinite"
                />
              </stop>
            ))}
          </linearGradient>

          <clipPath id="facet-body">
            <polygon points={OUTLINE} />
          </clipPath>
        </defs>

        {/* The faces. */}
        {FACES.map((d, i) => (
          <path key={d} d={`${d}Z`} fill="currentColor" opacity={0.07 + (i % 3) * 0.045} />
        ))}

        {/* The sweep, clipped so light never spills past the girdle.
            SMIL ignores `prefers-reduced-motion` — the global CSS rule that
            neutralises every other animation in the app cannot reach an
            `<animate>` element — so the whole group is removed instead. */}
        <g clipPath="url(#facet-body)" className="hidden motion-safe:block">
          <rect x="0" y="0" width="220" height="220" fill="url(#facet-sweep)" />
        </g>

        {/* Girdle — the one full-strength line, because it is the silhouette. */}
        <polygon
          points={OUTLINE}
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinejoin="round"
          opacity="0.85"
        />

        {/* Facet edges converging on the culet. */}
        <g stroke="currentColor" strokeWidth="0.7" opacity="0.45">
          <path d="M110,20 110,95M170,60 110,95M190,130 110,95M140,195 110,95M80,195 110,95M30,130 110,95M50,60 110,95" />
        </g>

        {/* The table: the flat top face, and the brightest plane on a real
            cut stone. */}
        <polygon
          points="110,20 170,60 50,60"
          fill="currentColor"
          opacity="0.1"
          stroke="currentColor"
          strokeWidth="0.7"
          strokeOpacity="0.5"
        />
      </svg>
    </div>
  );
}
