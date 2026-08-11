"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Numbers on the status page arrive at, and settle on, their value.
 *
 * The point is not decoration. Four figures re-render together every poll, and
 * a silent swap gives no clue which of them actually moved — the eye has to
 * diff two frames it never saw side by side. A number that travels is a number
 * you noticed changing, which is the whole job of a status page.
 *
 * Ease-out, not linear: the value has to be *readable* as it lands, and a
 * linear ramp spends the same time on every digit including the ones nobody
 * reads. This one covers most of the distance early and settles.
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * The value at `elapsed` ms into a `duration`-ms travel from `from` to `to`.
 * Exact at both ends — the last frame must be the true figure, never an
 * eased approximation of it, or the page displays a number the backend
 * never reported.
 */
export function countUpFrame(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to;
  if (elapsed <= 0) return from;
  return from + (to - from) * easeOutCubic(elapsed / duration);
}

/**
 * Animates toward `value` whenever it changes.
 *
 * Honours `prefers-reduced-motion` by snapping, and skips the very first
 * value: counting up from zero on load is a splash screen, not information.
 */
export function useCountUp(value: number, duration = 650): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      from.current = value;
      setShown(value);
      return;
    }
    const reduced =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (now: number) => {
      const elapsed = now - start;
      setShown(countUpFrame(origin, value, elapsed, duration));
      if (elapsed < duration) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, duration]);

  return shown;
}
