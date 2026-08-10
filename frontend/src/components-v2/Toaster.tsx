"use client";

import type { Toast } from "@/lib/useToasts";

/** v2's toast stack — same queue/hold/resume contract as v1's Toaster
 *  (`lib/useToasts`), flat-bordered instead of glassy. Fixed bottom-right,
 *  clear of the sticky `.v2-actionbar` other pages may render. */
export default function Toaster({
  toasts,
  onDismiss,
  onHold,
  onResume,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  onHold: () => void;
  onResume: () => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))]"
      onPointerEnter={onHold}
      onPointerLeave={onResume}
      onFocus={onHold}
      onBlur={onResume}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="v2-panel-tight v2-panel v2-sans flex items-start gap-2.5"
          style={{
            borderColor:
              toast.tone === "error"
                ? "var(--v2-danger)"
                : toast.tone === "success"
                  ? "var(--v2-ok)"
                  : "var(--v2-border)",
          }}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm" style={{ color: "var(--v2-text)" }}>
              {toast.text}
            </p>
            {toast.hint && (
              <p className="text-xs mt-0.5" style={{ color: "var(--v2-text-faint)" }}>
                {toast.hint}
              </p>
            )}
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  onDismiss(toast.id);
                }}
                className="text-xs mt-1 v2-mono"
                style={{ color: "var(--v2-accent)" }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
            className="text-xs shrink-0"
            style={{ color: "var(--v2-text-faint)" }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
