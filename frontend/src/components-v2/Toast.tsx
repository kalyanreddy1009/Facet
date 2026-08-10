"use client";

/** v2's own toast renderer. Reuses v1's `useToasts` hook for the queue logic
 *  (push/dismiss/auto-timeout) but not v1's `Toaster` component, which is
 *  built from v1's glass classes — a flat-panel v2 gets its own markup on
 *  the same `Toast[]` shape. */

import type { Toast } from "@/lib/useToasts";

const TONE_BADGE: Record<Toast["tone"], string> = {
  error: "v2-badge-danger",
  success: "v2-badge-ok",
  info: "v2-badge",
};

export default function V2Toaster({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="v2-panel v2-panel-tight flex items-start gap-2.5 shadow-lg">
          <span className={`v2-badge ${TONE_BADGE[toast.tone]} shrink-0 mt-0.5`}>
            {toast.tone}
          </span>
          <div className="min-w-0 flex-1">
            <p className="v2-sans text-sm text-[var(--v2-text)]">{toast.text}</p>
            {toast.hint && <p className="v2-sans text-xs text-[var(--v2-text-faint)] mt-0.5">{toast.hint}</p>}
            {toast.action && (
              <button
                type="button"
                className="v2-sans text-xs text-[var(--v2-accent)] mt-1 underline"
                onClick={toast.action.run}
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            className="v2-sans text-xs text-[var(--v2-text-faint)] hover:text-[var(--v2-text)]"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
