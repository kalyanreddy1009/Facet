"use client";

/**
 * "I never got a link" / "mine stopped working".
 *
 * The escape hatch that was missing. Before this, somebody whose link failed
 * had exactly one instruction — "ask whoever administers this Facet" — with
 * no way to do that from inside the product, and the administrator had no way
 * to know they were waiting. Two people gave up there.
 *
 * It is shown to everyone, unconditionally, on both the sign-in page and
 * every failure state of the invite page. That matters for more than
 * convenience: a control that appears only for addresses with an account
 * would be a free tool for discovering who is registered here. It is always
 * present, and the server answers identically whether or not the address
 * exists — so it reveals nothing.
 *
 * There is no SMTP on this deployment, so this does not send anything. It
 * puts the request in a queue the administrator sees on their own page, and
 * says so plainly rather than implying a mail is in flight.
 */

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
      // Deliberately swallowed. The server's answer carries no information
      // either way, so a network failure and a success look the same to the
      // person — and telling them "that didn't work" would invite a retry
      // loop against a backend that is simply down.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <p role="status" className="text-sm text-text-dim text-pretty">
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
        className="text-sm text-accent-text hover:underline focus-visible:underline underline-offset-2"
      >
        No link, or yours has stopped working?
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2.5">
      <label htmlFor="request-email" className="block text-sm font-medium">
        Ask for a new sign-in link
      </label>
      <p className="text-xs text-text-faint text-pretty">
        Your administrator sees this and sends you one. No mail goes out on its own.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id="request-email"
          type="email"
          className="field flex-1 min-w-[12rem]"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={busy}
        />
        <button type="submit" className="btn btn-default" disabled={busy}>
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
