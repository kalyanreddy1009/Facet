"use client";

import { useEffect, type RefObject } from "react";

/** Everything focusable, in DOM order, minus anything currently disabled or
 *  explicitly removed from the tab order. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === root
  );
}

/** The five things a hand-rolled modal forgets: Escape closes it, focus moves
 *  in, Tab can't escape it, the page behind stops scrolling, and focus goes
 *  back where it came from on close.
 *
 *  Lives here rather than in `Sheet` because `/rough`'s mobile filter layer
 *  needs the same contract with a completely different shape. */
export function useModal(
  open: boolean,
  onClose: () => void,
  // React 19: `useRef<T>(null)` is typed `RefObject<T | null>`, so the null has
  // to be in the signature. The body already treats a missing panel as normal.
  panelRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;

      const items = focusable(panel);
      if (items.length === 0) {
        // Nothing to land on — keep focus on the panel rather than letting it
        // fall through to the page behind.
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panel?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, panelRef]);
}
