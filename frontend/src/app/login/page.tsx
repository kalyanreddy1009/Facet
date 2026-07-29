"use client";

/**
 * Sign in.
 *
 * The first screen anyone sees, and the one most likely to be seen while
 * something has gone wrong — an expired session, a mistyped password, an
 * account an administrator has suspended. So every failure it can produce
 * says what happened and what to do, rather than "invalid credentials".
 *
 * It deliberately does not tell you whether an address has an account here.
 * The server answers a wrong password and an unknown address identically,
 * and this screen must not undo that by being helpful.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ error: string; hint?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // "Your session ended" is a different message from "you signed out", and
  // both arrive here. Saying which is the difference between a page that
  // feels broken and one that feels expected.
  const reason = params.get("reason");

  useEffect(() => {
    // Already signed in? Don't make someone log in twice because they
    // bookmarked this page.
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) router.replace(params.get("next") || "/tailor");
      })
      .catch(() => {
        /* Offline or the server is down; the form still works to try. */
      });
  }, [router, params]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError({
          error: data.error || "Could not sign in.",
          hint: data.hint,
        });
        setPassword("");
        return;
      }

      if (data.user?.must_set_password) {
        router.replace("/set-password");
        return;
      }
      // replace, not push: the back button should not return to a login
      // form that will now just bounce forward again.
      router.replace(params.get("next") || "/tailor");
    } catch {
      setError({
        error: "Could not reach Facet.",
        hint: "It may be restarting. Try again in a moment.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Facet</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Your applications, your resume, your record.
        </p>

        {reason === "expired" && !error && (
          <p
            role="status"
            className="mt-6 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
          >
            Your session ended. Sign in to pick up where you were.
          </p>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="field w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              disabled={busy}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="field w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </div>

          {error && (
            /* aria-live, so a screen reader hears the failure. Without it the
               form silently clears the password and appears to do nothing. */
            <div
              role="alert"
              aria-live="polite"
              className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm"
            >
              <p className="font-medium">{error.error}</p>
              {error.hint && (
                <p className="mt-1 text-[var(--text-muted)]">{error.hint}</p>
              )}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={busy}>
            <span className="btn-cap">{busy ? "Signing in…" : "Sign in"}</span>
          </button>
        </form>

        <p className="mt-6 text-sm text-[var(--text-muted)]">
          No account, or forgotten your password? Whoever administers this Facet
          can send you a new sign-in link.
        </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 py-16">
      {/* useSearchParams needs a Suspense boundary, or the production build
          fails at prerender with an error that does not name this file. */}
      <Suspense fallback={<div className="card p-8">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
