"use client";

/**
 * Cut a Facet — the page.
 *
 * The workflow is untouched: fill the posting in, choose how truthful the
 * argument may be, cut, get a resume, a cover letter and a recruiter pitch.
 * What the revamp changed is that the page now has a shape. It was a title, a
 * paragraph and a wall of inputs; it is now a header that says what a cut
 * produces, three numbered steps, and an action bar that stays reachable.
 *
 * The one behavioural addition here is cancellation. A cut can sit in a queue
 * behind someone else's and then take five minutes of its own, and until now
 * the only way out was to close the tab — which left the job running and the
 * agy lock held. `DELETE /api/queue/{id}` already existed and already killed
 * the process tree; nothing on this page had ever offered it.
 */

import { useCallback, useRef, useState } from "react";
import { FileDown, Mail, MessageSquare } from "lucide-react";
import { api, ApiError, type TailorRequestBody, type TailorResponse } from "@/lib/api";
import LoadingOverlay from "@/components/ui/LoadingOverlay";
import Toaster from "@/components/ui/Toaster";
import TailorForm from "@/components/tailor/TailorForm";
import TailorResult from "@/components/tailor/TailorResult";
import { useToasts } from "@/lib/useToasts";

/** What a cut produces. Stated at the top because it is the answer to the
 *  question someone arriving at this page is actually asking, and it used to
 *  be buried in the middle of a paragraph. */
const OUTPUTS = [
  { icon: FileDown, label: "Tailored resume", detail: "PDF and Word" },
  { icon: Mail, label: "Cover letter", detail: "PDF" },
  { icon: MessageSquare, label: "Recruiter pitch", detail: "Ready to paste" },
];

export default function TailorPage() {
  const { toasts, push, dismiss, hold, resume } = useToasts();
  const [loading, setLoading] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [result, setResult] = useState<TailorResponse | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  // Held so the overlay can cancel the right job. Refs rather than state: they
  // are read by callbacks and never rendered, and a re-render per queue poll
  // would be work for nothing.
  const jobRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handlePrefilled = useCallback(
    (company: string) =>
      push(`Filled in from ${company || "the posting"}`, {
        tone: "info",
        hint: "Paste the full description if the summary is thin - it makes a better facet.",
      }),
    [push]
  );

  const handleCancel = useCallback(async () => {
    const jobId = jobRef.current;
    abortRef.current?.abort();
    setLoading(false);
    setQueuePosition(null);
    if (jobId !== null) {
      // Cancelling server-side matters even though the browser has stopped
      // waiting: a running cut holds the agy lock, and the next person in the
      // queue is stuck behind a job nobody wants any more.
      try {
        await api.cancelJob(jobId);
      } catch {
        // It may have finished between the click and the call. There is
        // nothing useful to say about that.
      }
    }
    push("Cut cancelled", { tone: "info" });
  }, [push]);

  const handleSubmit = async (body: TailorRequestBody) => {
    setLoading(true);
    setQueuePosition(null);
    setResult(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // The cut is queued server-side; this reports where it is while waiting
      // so a line behind someone else reads as a queue, not a hang.
      const response = await api.tailor(
        body,
        (job) => {
          jobRef.current = job.id;
          setQueuePosition(job.position);
        },
        controller.signal
      );
      setResult(response);
      // Scroll to the result rather than leaving it below the fold.
      requestAnimationFrame(() =>
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } catch (err) {
      // A cancel aborts the wait, which surfaces here as an error. It is not
      // one — the user asked for it and has already been told.
      if (controller.signal.aborted) return;
      if (err instanceof ApiError) push(err.message, { hint: err.hint });
      else push(err instanceof Error ? err.message : "Cutting this facet failed");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      jobRef.current = null;
      abortRef.current = null;
    }
  };

  return (
    <main className="max-w-shell mx-auto px-5 sm:px-8 py-8 sm:py-10">
      {/* The page frame is the shared shell, so this page's edges line up with
          the nav and every other screen. The work itself stays in a column:
          a job description in a textarea 1100px wide is unreadable, and a
          form field that long has no visible relationship to its label. */}
      <div className="max-w-4xl">
        <header className="mb-6 flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-text tracking-[-0.01em]">Cut a facet</h1>
            <p className="text-sm text-text-dim mt-1.5 max-w-prose text-pretty">
              Your Stone doesn&apos;t change. This cuts one face of it - aimed at one posting, and
              claiming nothing your record doesn&apos;t already support.
            </p>
          </div>

          {/* Three outputs, named. The old page mentioned them mid-paragraph,
              so a first-time visitor had to read to find out what pressing the
              button would actually give them. */}
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {OUTPUTS.map((output) => (
              <li key={output.label} className="panel-inset px-3 py-2.5 flex items-center gap-2.5">
                <output.icon className="w-4 h-4 text-accent-text shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm text-text truncate">{output.label}</span>
                  <span className="block text-2xs text-text-faint truncate">{output.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </header>

        <TailorForm onSubmit={handleSubmit} disabled={loading} onPrefilled={handlePrefilled} />

        {result && (
          <div ref={resultRef} className="mt-8 scroll-mt-24">
            <TailorResult result={result} />
          </div>
        )}
      </div>

      {loading && <LoadingOverlay queuePosition={queuePosition} onCancel={handleCancel} />}
      <Toaster toasts={toasts} onDismiss={dismiss} onHold={hold} onResume={resume} />
    </main>
  );
}
