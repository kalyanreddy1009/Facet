"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatElapsed } from "@/lib/format";

const PHRASES = ["Reading the stone…", "Finding the angle…", "Cutting your facet…"];
const TIMEOUT_S = 300;

/** v2's equivalent of `components/ui/LoadingOverlay.tsx` — same queue-position
 *  vs. running distinction, same cancel affordance wired to `DELETE
 *  /api/queue/{id}` via the page's `onCancel`. */
export default function LoadingOverlay({
  queuePosition,
  onCancel,
}: {
  queuePosition?: number | null;
  onCancel?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const waiting = typeof queuePosition === "number" && queuePosition > 0;
  const index = Math.min(Math.floor(elapsed / 4), PHRASES.length - 1);
  const phrase = waiting
    ? queuePosition === 1
      ? "Next in line…"
      : `Waiting — ${queuePosition} in the queue…`
    : PHRASES[index];

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 grid place-items-center px-6 v2-sans"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div className="v2-panel flex flex-col items-center gap-3 text-center" style={{ maxWidth: "22rem" }}>
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--v2-text-faint)" }} aria-hidden />
        <p className="text-sm" style={{ color: "var(--v2-text)" }}>
          {phrase}
        </p>
        <p className="text-xs text-pretty" style={{ color: "var(--v2-text-faint)" }}>
          {waiting
            ? "Facet runs one cut at a time. This one is queued and will start on its own."
            : "This runs a local model — it can take a minute."}
          <br />
          <span className="v2-mono">
            {formatElapsed(elapsed)} elapsed
            {waiting ? "" : `, gives up at ${formatElapsed(TIMEOUT_S)}`}
          </span>
        </p>
        {onCancel && (
          <button type="button" onClick={onCancel} className="v2-btn mt-1">
            Cancel this cut
          </button>
        )}
      </div>
    </div>
  );
}
