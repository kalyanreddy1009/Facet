"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { formatElapsed } from "@/lib/format";
import { ENTER, REDUCED } from "@/lib/motion";

const PHRASES = ["Reading the stone…", "Finding the angle…", "Cutting your facet…"];

/** agy's own ceiling. Past this the request is dead and the toast takes over. */
const TIMEOUT_S = 300;

/** Shown while the cutting pipeline is in flight — a real model call that can
 *  take minutes, so this also says *which* stage it's on rather than spinning
 *  anonymously. Under reduced-motion it settles on the last phrase.
 *
 *  The elapsed counter is not decoration: after the phrases run out there are
 *  up to five minutes left, and a still panel reads as a frozen page. A
 *  ticking number is the honest signal that the call is still alive — we
 *  genuinely don't know the progress, so we don't draw a progress bar. */
export default function LoadingOverlay({ queuePosition }: { queuePosition?: number | null }) {
  const reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Waiting in line is a different state from being worked on, and saying so
  // is the difference between "queued behind 2" and an app that looks hung.
  // Position 1 means next up but not started — still waiting, not cutting.
  const waiting = typeof queuePosition === "number" && queuePosition > 0;
  const index = Math.min(Math.floor(elapsed / 4), PHRASES.length - 1);
  const phrase = waiting
    ? queuePosition === 1
      ? "Next in line…"
      : `Waiting — ${queuePosition} in the queue…`
    : reduced
      ? PHRASES[PHRASES.length - 1]
      : PHRASES[index];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 grid place-items-center bg-bg/80 px-6"
    >
      <div className="rounded-lg chrome px-6 py-5 flex flex-col items-center gap-3 shadow-popover">
        <Loader2 className="w-4 h-4 text-text-faint animate-spin" aria-hidden />
        <AnimatePresence mode="wait">
          <motion.p
            key={phrase}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? undefined : { opacity: 0 }}
            transition={reduced ? REDUCED : ENTER}
            className="text-sm text-text"
          >
            {phrase}
          </motion.p>
        </AnimatePresence>
        <p className="text-xs text-text-faint text-center text-pretty">
          {waiting
            ? "Facet runs one cut at a time. This one is queued and will start on its own."
            : "This runs a local model — it can take a minute."}
          <br />
          <span className="tnum">
            {formatElapsed(elapsed)} elapsed
            {waiting ? "" : `, gives up at ${formatElapsed(TIMEOUT_S)}`}
          </span>
        </p>
      </div>
    </div>
  );
}
