"use client";

/** v2 skin of `components/auth/RequestLink.tsx` — same request, same
 *  unconditional-visibility reasoning (see the v1 file for why), only the
 *  markup and classes differ. Kept in components-v2 since v2 pages must not
 *  import from components/. */

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

export default function RequestLink({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Deliberately swallowed — see v1 RequestLink for why.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <p role="status" className="v2-sans text-sm text-[color:var(--v2-text-dim)]">
        Asked. Whoever administers this Facet will see the request and can send you a fresh
        link. Nothing is emailed automatically — this deployment has no mail server, so it
        reaches them as a note on their own screen.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="v2-sans text-sm text-[color:var(--v2-accent)] hover:underline underline-offset-2 inline-block py-3 -my-3"
      >
        No link, or yours has stopped working?
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <label htmlFor="request-email" className="v2-label">
        Ask for a new sign-in link
      </label>
      <p className="v2-sans text-xs text-[color:var(--v2-text-faint)]">
        Your administrator sees this and sends you one. No mail goes out on its own.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id="request-email"
          type="email"
          className="v2-field flex-1 min-w-[12rem]"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          autoFocus
          required
          disabled={busy}
        />
        <button type="submit" className="v2-btn" disabled={busy}>
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          ) : (
            <Send className="w-3.5 h-3.5" aria-hidden />
          )}
          Ask
        </button>
      </div>
    </form>
  );
}
