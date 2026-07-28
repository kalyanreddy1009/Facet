"use client";

import { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { ENTER, EXIT, REDUCED } from "@/lib/motion";
import { useModal } from "@/lib/useModal";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/** Right-hand side sheet for secondary flows (feeds, source settings).
 *  The whole modal keyboard contract — Escape, focus in, Tab trap, scroll
 *  lock, focus restore — comes from `useModal`. */
export default function Sheet({ open, onClose, title, description, children }: SheetProps) {
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  useModal(open, onClose, panelRef);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <motion.div
            className="absolute inset-0 bg-overlay"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: reduced ? REDUCED : EXIT }}
            transition={reduced ? REDUCED : ENTER}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={reduced ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={{
              ...(reduced ? { opacity: 0 } : { x: "100%" }),
              transition: reduced ? REDUCED : EXIT,
            }}
            transition={reduced ? REDUCED : ENTER}
            className="relative w-[min(30rem,100vw)] h-full bg-surface-1 border-l border-border flex flex-col outline-none"
          >
            <div className="px-5 py-4 divider flex items-start justify-between gap-4 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-text">{title}</h2>
                {description && <p className="text-sm text-text-faint mt-0.5">{description}</p>}
              </div>
              <button onClick={onClose} aria-label="Close" className="btn btn-ghost shrink-0 -mr-1.5">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
