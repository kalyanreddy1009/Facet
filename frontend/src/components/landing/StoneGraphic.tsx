import { FACETS, GIRDLE, REFLECTION, TABLE, VIEW_BOX } from "@/lib/gem";

/**
 * The stone — the hero illustration, and the source of the app's identity.
 *
 * It is a round brilliant seen from above, and the geometry is generated
 * rather than drawn: one table, 8 star facets, 8 kites and 16 upper-girdle
 * facets, which is the real crown of a brilliant cut. It lives in `lib/gem`
 * and `components/ui/FacetMark` draws the same coordinates at 17px, so the
 * mark and the hero are one design at two sizes rather than two drawings of a
 * similar idea — they cannot drift, because there is only one set of numbers.
 *
 * The light is physical rather than decorative:
 *
 *   1. Each facet has a fixed `lit` value, computed from the angle between its
 *      outward normal and a light source at the upper left. That is what makes
 *      a flat vector read as a solid object — the facets nearest the light are
 *      near-white, the ones facing away are deep slate, and every one between
 *      them is interpolated rather than picked.
 *   2. A sweep rotates over the top of that, clipped to the stone and blended
 *      with `screen`, so it *adds* light the way a real highlight does instead
 *      of painting grey over the shading.
 *   3. Dispersion. White light entering a gem is refracted by wavelength, which
 *      is why a diamond throws colour. A second, counter-rotating pass carries
 *      a low-opacity spectrum — counter-rotating because the two effects must
 *      never lock into one obvious spinning wheel.
 *   4. Three specular flares at facet junctions, on long staggered cycles, so
 *      the stone catches the eye at intervals rather than pulsing.
 *
 * All of it is CSS and SVG: no canvas, no requestAnimationFrame, no WebGL, no
 * image request. An earlier version of this file *was* a three.js scene, at
 * ~600KB of JavaScript and a permanent animation frame, for a decorative shape
 * on one page. Everything that moves here is `transform` or `opacity` on a
 * composited layer, and every animation is inside `motion-safe:`, because SMIL
 * and CSS keyframes both ignore `prefers-reduced-motion` unless something
 * makes them respect it.
 */

/** Facet fill, interpolated between a deep slate and near-white.
 *
 *  Two greys with a blue bias rather than neutral: a colourless stone still
 *  takes the colour of the light around it, and a perfectly neutral gradient
 *  reads as plastic. Kept as raw values, not tokens — this is a rendering of a
 *  material, not a surface of the interface, and it must not shift when the
 *  palette does. */
function shade(lit: number): string {
  const dark = [86, 100, 128];
  const light = [250, 252, 255];
  // Squared, so the falloff is steeper near the terminator — light does not
  // fall off linearly across a curved arrangement of flats.
  const t = lit * lit * 0.78 + lit * 0.22;
  const mix = dark.map((c, i) => Math.round(c + (light[i] - c) * t));
  return `rgb(${mix.join(" ")})`;
}

/** Where the flares sit, and how their cycles are offset. Junctions of three
 *  facets, on the lit side — a highlight on the dark side would read as a
 *  mistake. */
const FLARES = [
  { x: 75.9, y: 75.9, size: 38, delay: "0s" },
  { x: 46, y: 120, size: 26, delay: "3.1s" },
  { x: 120, y: 20, size: 22, delay: "5.7s" },
];

/** Fluid rather than a fixed pixel size: on a wide screen the stone is the
 *  counterweight to the hero type, and a 320px graphic beside 6rem headline
 *  text reads as an afterthought. Capped so it stays a companion to the copy
 *  and never the subject of the page. */
export default function StoneGraphic({
  size = "clamp(18rem, 30vw, 30rem)",
}: {
  size?: number | string;
}) {
  return (
    <div
      className="relative grid place-items-center w-full"
      style={{ width: size, height: size, maxWidth: "100%" }}
      aria-hidden
    >
      {/* The light the stone is sitting in, thrown back onto the page. Behind
          the figure, and the only place the second hue appears at strength. */}
      <div
        className="absolute inset-[6%] rounded-full blur-3xl opacity-80 gem-halo"
        style={{
          background:
            "radial-gradient(circle at 40% 32%, rgba(74,118,240,0.36), rgba(23,164,187,0.18) 45%, rgba(168,85,247,0.10) 62%, transparent 72%)",
        }}
      />

      <svg
        width="100%"
        height="100%"
        viewBox={VIEW_BOX}
        fill="none"
        className="relative"
        /* Without an isolated stacking context, `screen` on the light passes
           blends against everything painted beneath the SVG — the halo, the
           ambient field, the page — instead of against the stone. It happens
           to look close to right on this background, which is the kind of bug
           that survives review and then breaks the day someone changes the
           page colour. */
        style={{ isolation: "isolate" }}
      >
        <defs>
          {/* The moving highlight. A soft band rather than a hard edge, so it
              reads as light crossing the stone and not as a wiper. */}
          <linearGradient id="gem-sweep" x1="0" y1="0" x2="1" y2="0.4">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="38%" stopColor="#fff" stopOpacity="0.10" />
            <stop offset="50%" stopColor="#fff" stopOpacity="0.92" />
            <stop offset="62%" stopColor="#fff" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>

          {/* Dispersion: the visible spectrum in order, at an opacity where it
              is a suggestion of colour rather than a rainbow decal. */}
          <linearGradient id="gem-fire" x1="0" y1="0.2" x2="1" y2="0.8">
            <stop offset="0%" stopColor="#ff4d6d" stopOpacity="0" />
            <stop offset="18%" stopColor="#ff4d6d" stopOpacity="0.5" />
            <stop offset="34%" stopColor="#ffb020" stopOpacity="0.42" />
            <stop offset="50%" stopColor="#42d99a" stopOpacity="0.38" />
            <stop offset="66%" stopColor="#3aa8ff" stopOpacity="0.45" />
            <stop offset="82%" stopColor="#a855f7" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
          </linearGradient>

          {/* The table is a flat window straight down into the stone, so it is
              the one face that shows depth rather than a shade. */}
          <linearGradient id="gem-table" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="38%" stopColor="#dfe8fa" />
            <stop offset="100%" stopColor="#9dabcb" />
          </linearGradient>

          {/* What the table shows is the pavilion below it, not the sky. Dark
              at the top where the far side of the stone is in shadow, bright
              at the bottom where it throws light back. */}
          <linearGradient id="gem-reflection" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#7e8dae" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#aebbd8" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.5" />
          </linearGradient>

          <radialGradient id="gem-flare">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="35%" stopColor="#dbe6ff" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#dbe6ff" stopOpacity="0" />
          </radialGradient>

          <clipPath id="gem-body">
            <path d={GIRDLE} />
          </clipPath>
        </defs>

        {/* 1. The solid. Fixed shading — this is the object, and it does not
               move; everything after this is light falling on it. */}
        <g>
          {FACETS.map((facet) => (
            <path key={facet.d} d={facet.d} fill={shade(facet.lit)} />
          ))}
          <path d={TABLE} fill="url(#gem-table)" />
          {/* The pavilion, seen through the table. */}
          <path d={REFLECTION} fill="url(#gem-reflection)" />
        </g>

        {/* 2. + 3. The two passes of moving light, both clipped to the stone.
               `screen` adds light instead of covering the shading with grey —
               a normal-blended white band would flatten the facets it crossed,
               which is exactly what a real highlight does not do. */}
        <g clipPath="url(#gem-body)" className="hidden motion-safe:block">
          <g className="gem-sweep-spin" style={{ mixBlendMode: "screen" }}>
            <rect x="-120" y="-120" width="480" height="480" fill="url(#gem-sweep)" />
          </g>
          <g className="gem-fire-spin" style={{ mixBlendMode: "screen" }}>
            <rect x="-120" y="-120" width="480" height="480" fill="url(#gem-fire)" />
          </g>
        </g>

        {/* Facet edges, over the light. Every real cut stone reads as edges
            first — without them the shading alone looks like a gradient mesh. */}
        {/* Facet edges, over the light. Brightness follows the facet rather
            than being one flat white: a uniform outline is exactly what makes
            a vector gem read as a diagram of a gem. */}
        <g strokeWidth="0.7" fill="none">
          {FACETS.map((facet) => (
            <path
              key={`e${facet.d}`}
              d={facet.d}
              stroke="#ffffff"
              strokeOpacity={(0.2 + 0.55 * facet.lit).toFixed(2)}
            />
          ))}
        </g>
        <path d={TABLE} fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="1" />
        <path d={REFLECTION} fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="0.6" />
        <path
          d={GIRDLE}
          fill="none"
          stroke="#5d6b88"
          strokeOpacity="0.5"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />

        {/* 4. Specular flares. Long cycles and prime-ish offsets, so they never
               settle into a rhythm you can predict. */}
        <g className="hidden motion-safe:block">
          {FLARES.map((flare) => (
            <circle
              key={`${flare.x}-${flare.y}`}
              cx={flare.x}
              cy={flare.y}
              r={flare.size}
              fill="url(#gem-flare)"
              className="gem-flare"
              style={{ animationDelay: flare.delay }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
