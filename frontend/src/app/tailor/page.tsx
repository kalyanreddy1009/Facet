"use client";

import { useCallback, useRef, useState } from "react";
import { api, ApiError, type TailorRequestBody, type TailorResponse } from "@/lib/api";
import LoadingOverlay from "@/components/ui/LoadingOverlay";
import Toaster from "@/components/ui/Toaster";
import TailorForm from "@/components/tailor/TailorForm";
import TailorResult from "@/components/tailor/TailorResult";
import { useToasts } from "@/lib/useToasts";

export default function TailorPage() {
  const { toasts, push, dismiss } = useToasts();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TailorResponse | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const handlePrefilled = useCallback(
    (company: string) =>
      push(`Filled in from ${company || "the posting"}`, {
        tone: "info",
        hint: "Paste the full description if the summary is thin — it makes a better facet.",
      }),
    [push]
  );

  const handleSubmit = async (body: TailorRequestBody) => {
    setLoading(true);
    setResult(null);
    try {
      const response = await api.tailor(body);
      setResult(response);
      // Scroll to the result rather than leaving it below the fold.
      requestAnimationFrame(() =>
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } catch (err) {
      if (err instanceof ApiError) push(err.message, { hint: err.hint });
      else push(err instanceof Error ? err.message : "Cutting this facet failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 py-8 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text">Cut a facet</h1>
        <p className="text-sm text-text-dim mt-1 max-w-prose text-pretty">
          Your Stone doesn&apos;t change. This cuts one face of it — a resume, a cover letter and a
          recruiter pitch aimed at this specific posting.
        </p>
      </header>

      <TailorForm onSubmit={handleSubmit} disabled={loading} onPrefilled={handlePrefilled} />

      {result && (
        <div ref={resultRef} className="mt-8 scroll-mt-24">
          <TailorResult result={result} />
        </div>
      )}

      {loading && <LoadingOverlay />}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </main>
  );
}
