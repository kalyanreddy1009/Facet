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
 * The stone, lit.
 *
 * A round brilliant in profile under one continuous source. Light falls on the
 * table, travels down into the pavilion, turns on the back facets and leaves
 * through the girdle as a fan of colour that keeps moving across the page.
 * Nothing here blinks and nothing waits: every part of it is visible at every
 * moment, and every part of it is in slow motion.
 *
 * Two things this had to get right, both learned by finally watching it in a
 * real browser rather than reasoning about the keyframes:
 *
 *   1. LIGHT ON PAPER IS COLOUR, NOT BRIGHTNESS. The first version drew white
 *      beams over a near-white page, which is invisible by construction — you
 *      cannot add brightness to something already at the top of the range.
 *      Every beam here is saturated indigo, violet or cyan at real alpha. That
 *      is how a shaft of light reads on paper: as a tinted volume, the way a
 *      sunbeam reads in a dusty room.
 *
 *   2. AN EVENT IS NOT AN ANIMATION. The version before this was a strike on a
 *      9s loop, and five captured frames out of eight were simply dark.
 *      Something that spends most of its cycle invisible reads as "no
 *      animation" however good the 0.4s where it fires. So the beam is
 *      continuous, and everything moves on long overlapping periods — 11s,
 *      13s, 17s, 19s, 23s — chosen coprime so the scene never returns to a
 *      pose you have already watched.
 *
 * Cost: no canvas, no rAF, no WebGL, no image request. Every animation is
 * `opacity` or `transform` on a small element. A long duration is not more
 * expensive than a short one — the compositor simply interpolates more slowly
 * — and this is far cheaper than the rotating blended viewport-scale rects it
 * replaces.
 */

/** Facet fill, from a deep slate to near-white.
 *
 *  The dark end is genuinely dark. The span between a stone's lightest and
 *  darkest face is what the eye reads as gloss — a gem whose shadow side only
 *  reaches mid-grey looks like frosted plastic. */
function shade(lit: number, depth = 0): string {
  const dark = [30, 41, 68];
  const light = [252, 253, 255];
  const t = (lit * lit * 0.66 + lit * 0.34) * (1 - depth);
  return `rgb(${dark.map((c, i) => Math.round(c + (light[i] - c) * t)).join(" ")})`;
}

/** The fan leaving the girdle: hue, vertical drop and period per ray. The
 *  periods are coprime so the fan never returns to the same arrangement. */
const FAN = [
  { hue: "#6d8cff", drop: -54, period: "13s", delay: "0s", alpha: 0.5 },
  { hue: "#8f7bff", drop: -22, period: "17s", delay: "-3s", alpha: 0.42 },
  { hue: "#4fb6e8", drop: 12, period: "11s", delay: "-6s", alpha: 0.46 },
  { hue: "#6d8cff", drop: 44, period: "19s", delay: "-2s", alpha: 0.38 },
  { hue: "#a874f0", drop: 74, period: "23s", delay: "-8s", alpha: 0.32 },
];

export default function StoneGraphic({
  size = "clamp(18rem, 28vw, 30rem)",
}: {
  size?: number | string;
}) {
  return (
    <div
      className="relative grid place-items-center w-full"
      style={{ width: size, height: size, maxWidth: "100%" }}
      aria-hidden
    >
      <svg
        width="100%"
        height="100%"
        viewBox={PROFILE_VIEW_BOX}
        fill="none"
        className="relative overflow-visible"
        style={{ isolation: "isolate" }}
      >
        <defs>
          {/* The incoming shaft: faintest and widest above, tightening and
              saturating as it nears the table. */}
          <linearGradient id="shaft" x1="0" y1="0" x2="0.15" y2="1">
            <stop offset="0%" stopColor="#8ea8ff" stopOpacity="0.04" />
            <stop offset="55%" stopColor="#7b9bff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#5f83ff" stopOpacity="0.46" />
          </linearGradient>

          {/* One gradient per ray, so each fades along its own length. */}
          {FAN.map((ray, i) => (
            <linearGradient key={`${ray.hue}${i}`} id={`ray-${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={ray.alpha * 0.9} />
              <stop offset="12%" stopColor={ray.hue} stopOpacity={ray.alpha} />
              <stop offset="100%" stopColor={ray.hue} stopOpacity="0" />
            </linearGradient>
          ))}

          {/* Colour separating as it crosses the inside of the stone. */}
          <linearGradient id="inner-fire" x1="0" y1="0" x2="1" y2="0.6">
            <stop offset="0%" stopColor="#5f83ff" stopOpacity="0" />
            <stop offset="26%" stopColor="#7d68ff" stopOpacity="0.55" />
            <stop offset="48%" stopColor="#39c5e8" stopOpacity="0.5" />
            <stop offset="70%" stopColor="#b06cf0" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#5f83ff" stopOpacity="0" />
          </linearGradient>

          <radialGradient id="table-hot">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#cfe0ff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#cfe0ff" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="pool">
            <stop offset="0%" stopColor="#7b9bff" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#7b9bff" stopOpacity="0" />
          </radialGradient>

          <clipPath id="stone-body">
            <path d={PROFILE} />
          </clipPath>
        </defs>

        {/* ---- the shaft, always on ----------------------------------- */}
        {/* Drawn before the stone so the stone occludes it. Light arriving
            from in front of the object it lands on is the cheapest possible
            tell that a scene is fake. It sways two degrees about the point
            where it meets the table — enough to feel alive, small enough never
            to look like it is swinging. */}
        <g className="beam-sway" style={{ transformOrigin: `${STRIKE.x}px ${STRIKE.y}px` }}>
          <path
            d={`M${STRIKE.x - 62} -120 L${STRIKE.x + 26} -120 L${STRIKE.x + 11} ${STRIKE.y} L${
              STRIKE.x - 13
            } ${STRIKE.y} Z`}
            fill="url(#shaft)"
          />
          {/* A brighter core inside the shaft, breathing on its own period, so
              the beam has internal life rather than being a flat wedge. */}
          <path
            className="beam-core"
            d={`M${STRIKE.x - 30} -120 L${STRIKE.x - 4} -120 L${STRIKE.x + 3} ${STRIKE.y} L${
              STRIKE.x - 7
            } ${STRIKE.y} Z`}
            fill="url(#shaft)"
          />
        </g>

        {/* ---- the stone ---------------------------------------------- */}
        <g>
          {PAVILION.map((facet) => (
            <path key={facet.d} d={facet.d} fill={shade(facet.lit, 0.44)} />
          ))}
          {CROWN.map((facet) => (
            <path key={facet.d} d={facet.d} fill={shade(facet.lit)} />
          ))}
        </g>

        {/* Colour moving inside the stone: two passes at different speeds and
            opposite directions, because refraction is not one band sliding
            across a window. */}
        <g clipPath="url(#stone-body)">
          <rect className="fire-a" x="-240" y="0" width="480" height="240" fill="url(#inner-fire)" />
          <rect className="fire-b" x="-240" y="0" width="480" height="240" fill="url(#inner-fire)" />
        </g>

        {/* ---- structure ---------------------------------------------- */}
        <path d={PROFILE} fill="none" stroke="#26365c" strokeOpacity="0.6" strokeWidth="1.2" />
        <g stroke="#ffffff" strokeOpacity="0.26" strokeWidth="0.6" fill="none">
          {CROWN.map((facet) => (
            <path key={`e${facet.d}`} d={facet.d} />
          ))}
          {PAVILION.map((facet) => (
            <path key={`e${facet.d}`} d={facet.d} />
          ))}
        </g>
        <path d={GIRDLE_LINE} stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1" />
        <path d={TABLE_LINE} stroke="#ffffff" strokeOpacity="0.9" strokeWidth="1.6" />

        {/* Where the shaft meets the table: a hot spot that breathes. */}
        <ellipse
          className="table-hot"
          cx={STRIKE.x}
          cy={STRIKE.y}
          rx="34"
          ry="13"
          fill="url(#table-hot)"
        />

        {/* ---- the fan ------------------------------------------------ */}
        {/* Continuous. Each ray breathes on its own period and the fan as a
            whole rocks slowly, so light is always leaving the stone and never
            leaving it the same way twice. */}
        <g className="fan-rock" style={{ transformOrigin: "120px 96px" }}>
          {FAN.map((ray, i) => {
            const exit = EXITS[i];
            const toLeft = exit.x < 120;
            const end = toLeft ? -150 : 390;
            return (
              <path
                key={`${ray.hue}-${i}`}
                className="fan-ray"
                style={{
                  transformOrigin: `${exit.x}px ${exit.y}px`,
                  animationDuration: ray.period,
                  animationDelay: ray.delay,
                }}
                d={`M${exit.x} ${exit.y - 3} L${end} ${exit.y + ray.drop - 30} L${end} ${
                  exit.y + ray.drop + 34
                } L${exit.x} ${exit.y + 3} Z`}
                fill={`url(#ray-${i})`}
              />
            );
          })}
        </g>

        {/* The culet, and the pool of light the stone throws below it. */}
        <ellipse className="pool" cx={CULET.x} cy={CULET.y + 16} rx="66" ry="16" fill="url(#pool)" />
        <circle className="culet-glow" cx={CULET.x} cy={CULET.y} r="9" fill="url(#table-hot)" />
      </svg>
    </div>
  );
}
