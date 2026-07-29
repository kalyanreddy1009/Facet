"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { api } from "@/lib/api";

/** agy missing / unauthenticated / out of quota surfaces here, once, instead
 *  of as a confusing failure later when someone tries to cut a facet. */
export default function AgyHealthBanner() {
  const [detail, setDetail] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // The backend being down is the AgyHealthBanner's business to stay quiet
    // about — pages surface that themselves when their own calls fail.
    api.agyHealth().then((res) => !res.available && setDetail(res.detail)).catch(() => {});
  }, []);

  if (!detail || dismissed) return null;

  return (
    <div className="bg-warn-soft border-b border-warn-border text-warn">
      <div className="max-w-shell mx-auto px-5 sm:px-8 py-2 flex items-center gap-2.5 text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
        <p className="flex-1">
          Facet&apos;s AI engine isn&apos;t reachable ({detail}). Job search and the Cabinet work
          normally; cutting a facet won&apos;t until it&apos;s fixed.
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 hover:text-text focus-visible:text-text transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
