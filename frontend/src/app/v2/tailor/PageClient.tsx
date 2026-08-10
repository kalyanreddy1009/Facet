"use client";

/** v2's Cut a Facet — same handoff, same queueing/cancellation contract as
 *  `app/tailor/PageClient.tsx`. Header states the three outputs, form is
 *  three numbered `.v2-panel` steps ending in a sticky `.v2-actionbar`. */

import { useCallback, useRef, useState } from "react";
import { FileDown, Mail, MessageSquare } from "lucide-react";
import { api, ApiError, type TailorRequestBody, type TailorResponse } from "@/lib/api";
import LoadingOverlay from "@/components-v2/tailor/LoadingOverlay";
import Toaster from "@/components-v2/Toaster";
import TailorForm from "@/components-v2/tailor/TailorForm";
import TailorResult from "@/components-v2/tailor/TailorResult";
import { useToasts } from "@/lib/useToasts";

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
  const jobRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handlePrefilled = useCallback(
    (company: string) =>
      push(`Filled in from ${company || "the posting"}`, {
        tone: "info",
        hint: "Paste the full description if the summary is thin — it makes a better facet.",
      }),
    [push]
  );

  const handleCancel = useCallback(async () => {
    const jobId = jobRef.current;
    abortRef.current?.abort();
    setLoading(false);
    setQueuePosition(null);
    if (jobId !== null) {
      try {
        await api.cancelJob(jobId);
      } catch {
        // It may have finished between the click and the call.
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
      const response = await api.tailor(
        body,
        (job) => {
          jobRef.current = job.id;
          setQueuePosition(job.position);
        },
        controller.signal
      );
      setResult(response);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
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
    <main className="v2-main">
      <header className="mb-6 flex flex-col gap-4">
        <div>
          <p className="v2-eyebrow mb-1">One facet, one posting</p>
          <h1 className="v2-h1">Cut a facet</h1>
          <p className="v2-lede mt-1.5 max-w-prose text-pretty">
            Your Stone doesn&apos;t change. This cuts one face of it — aimed at one posting, and
            claiming nothing your record doesn&apos;t already support.
          </p>
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {OUTPUTS.map((output) => (
            <li key={output.label} className="v2-panel-tight v2-panel v2-sans flex items-center gap-2.5">
              <output.icon className="w-4 h-4 shrink-0" style={{ color: "var(--v2-accent)" }} aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm truncate" style={{ color: "var(--v2-text)" }}>
                  {output.label}
                </span>
                <span className="block text-xs truncate" style={{ color: "var(--v2-text-faint)" }}>
                  {output.detail}
                </span>
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

      {loading && <LoadingOverlay queuePosition={queuePosition} onCancel={handleCancel} />}
      <Toaster toasts={toasts} onDismiss={dismiss} onHold={hold} onResume={resume} />
    </main>
  );
}
