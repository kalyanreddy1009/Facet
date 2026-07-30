"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Toast {
  id: number;
  text: string;
  hint?: string;
  tone: "error" | "info" | "success";
  /** Optional inline action — this is what makes Dismiss undoable. */
  action?: { label: string; run: () => void };
}

const AUTO_DISMISS_MS = { info: 3500, success: 3500, error: 7000 };

/** One toast queue per page. Errors linger; confirmations get out of the way. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, options: Omit<Partial<Toast>, "id" | "text"> = {}) => {
      const id = nextId.current++;
      const tone = options.tone ?? "error";
      setToasts((prev) => [...prev.slice(-3), { ...options, id, text, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS[tone])
      );
      return id;
    },
    [dismiss]
  );

  /** Hold the queue while a pointer is over it or focus is inside it.
   *
   *  An Undo toast that lasts 3.5s is a promise the app cannot keep: reading
   *  "Dismissed 'Senior Backend Engineer'", deciding that was a mistake and
   *  reaching for the mouse takes longer than that, and the undo was gone
   *  before the cursor arrived. Timers stop while the toast is under the
   *  pointer and resume, from the full duration, when it leaves. */
  const hold = useCallback(() => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
  }, []);

  const resume = useCallback(() => {
    setToasts((current) => {
      current.forEach((toast) => {
        if (timers.current.has(toast.id)) return;
        timers.current.set(
          toast.id,
          setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS[toast.tone])
        );
      });
      return current;
    });
  }, [dismiss]);

  // Leaving a page mid-toast fired `dismiss` into an unmounted component.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return { toasts, push, dismiss, hold, resume };
}
