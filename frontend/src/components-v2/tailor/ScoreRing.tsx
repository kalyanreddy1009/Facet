"use client";

/** v2's clarity-score ring. Static SVG arc, no spring animation — v2 is flat
 *  and editorial rather than motion-driven, so this keeps the same numbers
 *  and semantics as v1's `ScoreRing` without the framer-motion dependency. */
export default function ScoreRing({ score, size = 104 }: { score: number; size?: number }) {
  const stroke = 6;
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = score >= 75 ? "var(--v2-ok)" : score >= 50 ? "var(--v2-warn)" : "var(--v2-danger)";
  const offset = circumference * (1 - score / 100);

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Clarity score ${score} out of 100`}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--v2-border)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <span className="v2-mono text-2xl leading-none" style={{ color: "var(--v2-text)" }}>
          {Math.round(score)}
        </span>
        <span className="v2-label" style={{ marginBottom: 0 }}>
          Clarity
        </span>
      </div>
    </div>
  );
}
