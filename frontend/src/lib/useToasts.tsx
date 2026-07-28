"use client";

import { useCallback, useRef, useState } from "react";

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

  return { toasts, push, dismiss };
}
