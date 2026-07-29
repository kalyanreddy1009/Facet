"use client";

/**
 * Where you are in the agy queue.
 *
 * agy is one authenticated CLI for the whole host, so a colleague's tailoring
 * run genuinely delays yours. Without this the app just feels slow, and "is
 * it broken?" is the natural conclusion — a position in a queue turns that
 * into a wait with an end.
 *
 * It shows counts and your own position, never anyone else's job. Whose run
 * is in front of you is not your business; that one *is* very much is.
 */

import { useEffect, useState } from "react";
import { Clock, Loader2 } from "lucide-react";

interface AgyQueueData {
  mine: {
    queued: { id: number; kind: string; queued_at: number; position: number; ahead: number }[];
    running: { id: number; kind: string; started_at: number }[];
  };
  system: { queued: number; running: number; busy_with_someone_else: boolean };
}

const KIND_LABEL: Record<string, string> = {
  tailor: "Cutting a facet",
  extract_profile: "Reading your resume",
};

function elapsed(since: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - since));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function AgyQueue({ refreshMs = 5000 }: { refreshMs?: number }) {
  const [data, setData] = useState<AgyQueueData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const response = await fetch("/api/queue/agy", { credentials: "include" });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json();
        if (alive) {
          setData(body);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    }

    poll();
    const timer = window.setInterval(poll, refreshMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshMs]);

  if (failed && !data) return null;

  if (!data) {
    return (
      <div className="panel px-4 py-3 text-sm text-text-faint flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
        Checking the queue…
      </div>
    );
  }

  const { mine, system } = data;
  const idle =
    mine.running.length === 0 && mine.queued.length === 0 && system.running === 0;

  return (
    <section className="panel">
      <header className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4" aria-hidden />
          AI queue
        </h2>
        <span className="text-xs text-text-faint tnum">
          {system.running} running · {system.queued} waiting
        </span>
      </header>

      <div className="px-4 py-3 space-y-2">
        {mine.running.map((job) => (
          <p key={job.id} className="text-sm flex items-center gap-2">
            <span className="dot dot-ok dot-pulse" aria-hidden />
            <span className="text-text">
              {KIND_LABEL[job.kind] || job.kind} — running for {elapsed(job.started_at)}
            </span>
          </p>
        ))}

        {mine.queued.map((job) => (
          <p key={job.id} className="text-sm text-text-dim">
            {KIND_LABEL[job.kind] || job.kind} —{" "}
            {job.ahead === 0
              ? "next up"
              : `${job.ahead} job${job.ahead === 1 ? "" : "s"} ahead of yours`}
          </p>
        ))}

        {mine.running.length === 0 && mine.queued.length === 0 && (
          <p className="text-sm text-text-dim">
            {system.busy_with_someone_else
              ? // The honest version of "Facet feels slow right now".
                "Nothing of yours is queued. Someone else is using the AI, so a cut started now would wait."
              : idle
                ? "Nothing queued. The AI is free."
                : "Nothing of yours is queued."}
          </p>
        )}

        {failed && (
          <p className="text-xs text-text-faint">
            Last refresh failed — showing the previous reading.
          </p>
        )}
      </div>
    </section>
  );
}
