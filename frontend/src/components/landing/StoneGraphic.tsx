"use client";

/**
 * The stone, cut. Plain inline SVG — the old version of this was a full
 * three.js WebGL scene for a decorative shape on one page, which cost ~600KB
 * of JS and a permanent rAF loop. Same metaphor, no renderer.
 *
 * Monochrome and static: it's an illustration, not a status indicator, so it
 * gets no accent colour and no animation to draw the eye away from the copy.
 */
export default function StoneGraphic({ size = 260 }: { size?: number }) {
  const faces = [
    "M110,20 170,60 110,95",
    "M170,60 190,130 110,95",
    "M190,130 140,195 110,95",
    "M140,195 80,195 110,95",
    "M80,195 30,130 110,95",
    "M30,130 50,60 110,95",
    "M50,60 110,20 110,95",
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 220 220"
      fill="none"
      aria-hidden
      className="text-text-ghost"
    >
      {faces.map((d, i) => (
        <path key={d} d={`${d}Z`} fill="currentColor" opacity={0.06 + (i % 3) * 0.03} />
      ))}
      <polygon
        points="110,20 170,60 190,130 140,195 80,195 30,130 50,60"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <g stroke="currentColor" strokeWidth="0.6" opacity="0.5">
        <path d="M110,20 110,95M170,60 110,95M190,130 110,95M140,195 110,95M80,195 110,95M30,130 110,95M50,60 110,95" />
      </g>
    </svg>
  );
}
