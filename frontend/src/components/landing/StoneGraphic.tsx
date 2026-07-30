import {
  CROWN,
  CULET,
  EXITS,
  GIRDLE_LINE,
  PAVILION,
  PROFILE,
  PROFILE_VIEW_BOX,
  STRIKE,
  TABLE_LINE,
} from "@/lib/gemProfile";

/**
 * The stone, struck.
 *
 * A round brilliant in profile, at real proportions, with one hard source
 * above it. The whole figure is a single event on a loop:
 *
 *   0.0s  a bolt falls from off-canvas and hits the table
 *   0.5s  the stone flashes — the crown lights, the pavilion lights a beat
 *         later, because that is the order light actually travels
 *   0.9s  five refracted beams leave through the girdle and cross the page
 *   6.0s  everything is dark again, and the loop waits before repeating
 *
 * Profile rather than the plan view it replaces, because the app needed a
 * light *source*. Seen from above a stone can only glint at you. Seen from
 * the side you can watch the beam arrive, sink into the pavilion, turn around
 * on the back facets and leave through the crown — which is the actual reason
 * a cut stone is bright, and now the organising idea of the whole page. The
 * beams that leave here are the same ones `BeamField` continues across the
 * sections below, on the same clock.
 *
 * Cost: no canvas, no rAF, no WebGL, no image. Everything that animates is
 * `opacity` or `transform` on a small element, and the whole sequence is one
 * CSS timeline with delays — so the browser can schedule it once rather than
 * being driven frame by frame from JavaScript. The previous version animated
 * two viewport-scale gradient rects with `mix-blend-mode` on a continuous
 * rotation, which is a large blended surface recomposited every frame,
 * forever. This one animates nothing while it is dark.
 */

/** Facet fill, from a deep slate to near-white.
 *
 *  The dark end is genuinely dark. The span between a stone's lightest and
 *  darkest face is what the eye reads as gloss, and a gem whose shadow side
 *  only reaches mid-grey looks like frosted plastic. */
function shade(lit: number, floor = 0, depth = 0): string {
  const dark = [34, 45, 72];
  const light = [248, 251, 255];
  const t = Math.max(floor, lit * lit * 0.7 + lit * 0.3) * (1 - depth);
  return `rgb(${dark.map((c, i) => Math.round(c + (light[i] - c) * t)).join(" ")})`;
}

export default function StoneGraphic({
  size = "clamp(17rem, 26vw, 27rem)",
}: {
  size?: number | string;
}) {
  return (
    <div
      className="relative grid place-items-center w-full stone-scene"
      style={{ width: size, height: size, maxWidth: "100%" }}
      aria-hidden
    >
      <svg
        width="100%"
        height="100%"
        viewBox={PROFILE_VIEW_BOX}
        fill="none"
        className="relative overflow-visible"
        /* `screen` on the flash layers has to blend against the stone, not
           against whatever the page happens to be painted with. */
        style={{ isolation: "isolate" }}
      >
        <defs>
          {/* The bolt. White at the core, accent at the edges — the way a hot
              discharge looks, rather than a blue line. */}
          <linearGradient id="bolt-core" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0%" stopColor="#dce8ff" stopOpacity="0" />
            <stop offset="35%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="1" />
          </linearGradient>

          {/* Each refracted beam: bright where it leaves the stone, gone by
              the time it reaches the edge of the figure. */}
          <linearGradient id="beam-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="22%" stopColor="#a8c4ff" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#a8c4ff" stopOpacity="0" />
          </linearGradient>

          <radialGradient id="impact-glow">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="40%" stopColor="#cfe0ff" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#cfe0ff" stopOpacity="0" />
          </radialGradient>

          <clipPath id="stone-body">
            <path d={PROFILE} />
          </clipPath>
        </defs>

        {/* ---- the stone at rest -------------------------------------- */}
        <g>
          {/* The pavilion is under the girdle and away from the source, so it
              is uniformly darker than the crown. Without that step the two
              halves read as one flat polygon with lines drawn on it. */}
          {PAVILION.map((facet) => (
            <path key={facet.d} d={facet.d} fill={shade(facet.lit, 0, 0.42)} />
          ))}
          {CROWN.map((facet) => (
            <path key={facet.d} d={facet.d} fill={shade(facet.lit)} />
          ))}
        </g>

        {/* ---- the flash ---------------------------------------------- */}
        {/* Two groups, not one: the crown lights first and the pavilion a
            beat later, which is the order the light gets there. Doing both at
            once is what makes an effect read as a filter rather than as an
            event. */}
        <g clipPath="url(#stone-body)" className="hidden motion-safe:block">
          <g className="stone-flash-crown" style={{ mixBlendMode: "screen" }}>
            {CROWN.map((facet) => (
              <path key={`fc${facet.d}`} d={facet.d} fill={shade(facet.lit, 0.55)} />
            ))}
          </g>
          <g className="stone-flash-pavilion" style={{ mixBlendMode: "screen" }}>
            {PAVILION.map((facet) => (
              <path key={`fp${facet.d}`} d={facet.d} fill={shade(facet.lit, 0.42)} />
            ))}
          </g>
        </g>

        {/* ---- structure ---------------------------------------------- */}
        <path d={PROFILE} fill="none" stroke="#2b3a5c" strokeOpacity="0.55" strokeWidth="1.2" />
        <path d={GIRDLE_LINE} stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1" />
        <path d={TABLE_LINE} stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1.4" />
        {/* Facet edges, drawn over the fills so the cut reads at any size. */}
        <g stroke="#ffffff" strokeOpacity="0.22" strokeWidth="0.6" fill="none">
          {CROWN.map((facet) => (
            <path key={`e${facet.d}`} d={facet.d} />
          ))}
          {PAVILION.map((facet) => (
            <path key={`e${facet.d}`} d={facet.d} />
          ))}
        </g>

        {/* ---- the strike --------------------------------------------- */}
        <g className="hidden motion-safe:block">
          {/* The bolt itself: a jagged fall from off-canvas to the table.
              Drawn as a stroke so it can be dashed in, which costs one
              property rather than one element per segment. */}
          <path
            className="stone-bolt"
            d={`M${STRIKE.x - 26} -60 L${STRIKE.x - 6} -18 L${STRIKE.x - 20} 2 L${
              STRIKE.x - 2
            } 26 L${STRIKE.x - 12} 40 L${STRIKE.x} ${STRIKE.y}`}
            stroke="url(#bolt-core)"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Its halo, so the bolt has air around it rather than being a
              sticker on the page. */}
          <path
            className="stone-bolt stone-bolt-halo"
            d={`M${STRIKE.x - 26} -60 L${STRIKE.x - 6} -18 L${STRIKE.x - 20} 2 L${
              STRIKE.x - 2
            } 26 L${STRIKE.x - 12} 40 L${STRIKE.x} ${STRIKE.y}`}
            stroke="#8fb4ff"
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity="0.35"
          />
          <circle
            className="stone-impact"
            cx={STRIKE.x}
            cy={STRIKE.y}
            r="46"
            fill="url(#impact-glow)"
          />
        </g>

        {/* ---- what leaves the stone ---------------------------------- */}
        {/* Five beams out of the girdle, each on its own delay so they open
            like a fan rather than switching on together. They are scaled from
            their origin, so the animation is a transform and the browser never
            re-rasterises them. */}
        <g className="hidden motion-safe:block">
          {EXITS.map((exit, i) => {
            const toLeft = exit.x < 120;
            return (
              <g
                key={`${exit.x}-${exit.y}`}
                className="stone-beam"
                style={{
                  transformOrigin: `${exit.x}px ${exit.y}px`,
                  animationDelay: `${0.9 + i * 0.06}s`,
                }}
              >
                {/* Clamped to just outside the stone's own box. An earlier
                    version ran them to ±380, which put a wedge of light
                    straight across the headline in the next column — light
                    over body copy is a legibility bug however pretty it is.
                    Crossing the *page* is the job of the section sweeps
                    below, which pass behind content rather than over it. */}
                <path
                  d={`M${exit.x} ${exit.y} L${toLeft ? -34 : 274} ${
                    exit.y - 46 - i * 18
                  } L${toLeft ? -34 : 274} ${exit.y + 8 - i * 18} Z`}
                  fill="url(#beam-fade)"
                  opacity={0.46 - i * 0.05}
                />
              </g>
            );
          })}
        </g>

        {/* The culet catches the last of it — the point every pavilion facet
            aims at, and the one place a profile stone can sparkle. */}
        <circle
          className="hidden motion-safe:block stone-culet"
          cx={CULET.x}
          cy={CULET.y}
          r="7"
          fill="url(#impact-glow)"
        />
      </svg>
    </div>
  );
}
