"use client";

import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { copyText } from "@/lib/clipboard";

/**
 * Copy, and say what happened — including when it doesn't work.
 *
 * `copyText` already refuses to claim success it didn't have, but both call
 * sites simply returned on failure, so a browser that denies clipboard access
 * (Safari without a user gesture in the right frame, a page served over plain
 * http, a locked-down corporate profile) produced a button that did nothing at
 * all when clicked. Nothing is the one response a control may never give: the
 * person tries again, harder, and concludes the app is broken.
 *
 * The failed state names the way out — the keyboard shortcut — and clears
 * itself, so it never becomes permanent furniture.
 */
export default function CopyButton({
  text,
  label = "Copy",
  className = "btn btn-ghost btn-sm",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const Icon = state === "copied" ? Check : state === "failed" ? X : Copy;
  const caption =
    state === "copied" ? "Copied" : state === "failed" ? "Press Ctrl+C" : label;

  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "copied" : "failed");
        setTimeout(() => setState("idle"), ok ? 1800 : 3500);
      }}
      // Announced, because the only evidence a copy worked is this label.
      aria-live="polite"
      className={className}
    >
      <Icon
        className={`w-3.5 h-3.5 ${state === "failed" ? "text-danger-text" : ""}`}
        aria-hidden
      />
      {caption}
    </button>
  );
}
