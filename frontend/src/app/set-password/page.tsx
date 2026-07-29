"use client";

/**
 * Set a first password from an invitation link, or a new one after a reset.
 *
 * The token arrives in the query string, which is the only credential the
 * person has at this point. It is single-use on the server: accepting it
 * writes the password hash and clears the invite in the same statement, so a
 * link that leaks later opens nothing.
 *
 * The confirm field is checked here rather than server-side on purpose —
 * mistyping a password twice identically is not a security question, and a
 * round trip to be told so is just slower.
 */

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const MIN_LENGTH = 12;

function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ error: string; hint?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= MIN_LENGTH && password === confirm && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError({ error: data.error || "Could not set your password.", hint: data.hint });
        return;
      }
      router.replace("/tailor");
    } catch {
      setError({
        error: "Could not reach Facet.",
        hint: "It may be restarting. Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="card p-8">
        <h1 className="text-2xl font-semibold tracking-tight">This link is incomplete</h1>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Open the full link you were sent — it ends in a long code. If it has
          expired, ask for a new one.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a password</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        At least {MIN_LENGTH} characters. A short phrase you can remember beats
        a short password you cannot.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            New password
          </label>
          <input
            id="password"
            type="password"
            className="field w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            aria-describedby="length-hint"
            autoFocus
            required
            disabled={busy}
          />
          <p
            id="length-hint"
            className={`mt-1.5 text-xs ${
              tooShort ? "text-[var(--danger-text)]" : "text-[var(--text-muted)]"
            }`}
          >
            {tooShort
              ? `${MIN_LENGTH - password.length} more character${
                  MIN_LENGTH - password.length === 1 ? "" : "s"
                } needed`
              : `${MIN_LENGTH} characters minimum`}
          </p>
        </div>

        <div>
          <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium">
            Type it again
          </label>
          <input
            id="confirm"
            type="password"
            className="field w-full"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-describedby="match-hint"
            required
            disabled={busy}
          />
          {mismatch && (
            <p id="match-hint" className="mt-1.5 text-xs text-[var(--danger-text)]">
              These do not match.
            </p>
          )}
        </div>

        {error && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm"
          >
            <p className="font-medium">{error.error}</p>
            {error.hint && <p className="mt-1 text-[var(--text-muted)]">{error.hint}</p>}
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-lg w-full" disabled={!ready}>
          <span className="btn-cap">{busy ? "Saving…" : "Set password and sign in"}</span>
        </button>
      </form>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 py-16">
      {/* useSearchParams needs a Suspense boundary, or the build fails at
          prerender with an error that does not name this file. */}
      <Suspense fallback={<div className="card p-8">Loading…</div>}>
        <SetPasswordForm />
      </Suspense>
    </main>
  );
}
