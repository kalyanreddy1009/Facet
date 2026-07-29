"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type { Toast } from "@/lib/useToasts";
import { ENTER, EXIT, REDUCED } from "@/lib/motion";

const ICON = { error: AlertTriangle, success: CheckCircle2, info: Info };
// Colour reports the outcome — a real state, so it earns its colour. "info"
// stays neutral: nothing has gone right or wrong.
const COLOR = { error: "text-danger", success: "text-ok", info: "text-text-faint" };

interface ToasterProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

/** Backend errors land here as readable sentences — never a blank screen or a
 *  raw stack trace. `role="status"` so screen readers announce them. */
export default function Toaster({ toasts, onDismiss }: ToasterProps) {
  const reduced = useReducedMotion();

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[min(23rem,calc(100vw-2rem))] pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const Icon = ICON[toast.tone];
          return (
            <motion.div
              key={toast.id}
              layout={!reduced}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : 4, transition: reduced ? REDUCED : EXIT }}
              transition={reduced ? REDUCED : ENTER}
              className="rounded-lg chrome p-3 flex items-start gap-2.5 shadow-popover pointer-events-auto"
            >
              <Icon className={`w-4 h-4 mt-px shrink-0 ${COLOR[toast.tone]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text">{toast.text}</p>
                {toast.hint && <p className="text-xs text-text-faint mt-1">{toast.hint}</p>}
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action!.run();
                      onDismiss(toast.id);
                    }}
                    className="text-xs font-medium text-accent-text mt-1.5 hover:underline focus-visible:underline underline-offset-2"
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss notification"
                className="text-text-faint hover:text-text focus-visible:text-text transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
