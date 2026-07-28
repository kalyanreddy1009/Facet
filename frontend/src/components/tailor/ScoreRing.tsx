"use client";

import { useEffect, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

interface ScoreRingProps {
  score: number; // 0-100
  size?: number;
}

/** The arc reports a measured state, so it is the one place a semantic colour
 *  belongs on this screen. */
function ringColor(score: number): string {
  if (score >= 75) return "var(--ok)";
  if (score >= 50) return "var(--warn)";
  return "var(--danger)";
}

/** Clarity Score. The number counts up with the arc so the two never disagree
 *  mid-animation; reduced-motion draws the final state directly. */
export default function ScoreRing({ score, size = 104 }: ScoreRingProps) {
  const reduced = useReducedMotion();
  const stroke = 6;
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = ringColor(score);

  const progress = useMotionValue(reduced ? score : 0);
  const spring = useSpring(progress, { stiffness: 80, damping: 20 });
  const dashOffset = useTransform(spring, (v) => circumference * (1 - v / 100));
  const [display, setDisplay] = useState(reduced ? score : 0);

  useEffect(() => {
    progress.set(score);
  }, [score, progress]);

  useEffect(() => {
    if (reduced) {
      setDisplay(score);
      return;
    }
    return spring.on("change", (v) => setDisplay(Math.round(v)));
  }, [spring, reduced, score]);

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Clarity score ${score} out of 100`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--surface-3)"
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: reduced ? circumference * (1 - score / 100) : dashOffset }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <span className="mono text-2xl leading-none text-text tnum">{display}</span>
        <span className="label">Clarity</span>
      </div>
    </div>
  );
}
