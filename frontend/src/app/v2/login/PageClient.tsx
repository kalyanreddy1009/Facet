"use client";

/** v2 skin of `app/login/PageClient.tsx` — identical behaviour (session
 *  check, submit, error states, "reason" messaging, must_set_password
 *  redirect), rebuilt in v2's panel/row language. See the v1 file for the
 *  reasoning behind each of these; nothing here changes it. */

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";

import RequestLink from "@/components-v2/auth/RequestLink";
import { refreshSession } from "@/lib/useSession";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ error: string; hint?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const reason = params.get("reason");

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) router.replace(params.get("next") || "/v2");
      })
      .catch(() => {});
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
        setError({ error: data.error || "Could not sign in.", hint: data.hint });
        setPassword("");
        passwordRef.current?.focus();
        return;
      }

      if (data.user?.must_set_password) {
        router.replace("/v2/set-password");
        return;
      }
      await refreshSession().catch(() => {});
      router.replace(params.get("next") || "/v2");
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
    <div className="v2-panel w-full max-w-md p-8 sm:p-10">
      <p className="v2-eyebrow">Facet v2</p>
      <h1 className="v2-h1 mt-1">Sign in</h1>
      <p className="v2-lede mt-2">Your applications, your resume, your record.</p>

      {reason === "expired" && !error && (
        <p role="status" className="v2-sans mt-6 rounded border border-[color:var(--v2-border)] bg-[color:var(--v2-bg-raised)] px-3 py-2.5 text-sm text-[color:var(--v2-text-dim)]">
          Your session ended. Sign in to pick up where you were.
        </p>
      )}

      <form onSubmit={submit} className="mt-7 space-y-4">
        <div>
          <label htmlFor="email" className="v2-label">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="v2-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "signin-error" : undefined}
          />
        </div>

        <div>
          <label htmlFor="password" className="v2-label">
            Password
          </label>
          <input
            id="password"
            ref={passwordRef}
            type="password"
            className="v2-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "signin-error" : undefined}
          />
        </div>

        {error && (
          <div
            id="signin-error"
            role="alert"
            aria-live="polite"
            className="flex items-start gap-2.5 rounded border border-[color:var(--v2-danger)] bg-[color:var(--v2-danger-soft)] px-3 py-2 text-sm v2-sans"
          >
            <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0 text-[color:var(--v2-danger)]" aria-hidden />
            <span>
              <p className="font-medium text-[color:var(--v2-text)]">{error.error}</p>
              {error.hint && <p className="mt-1 text-[color:var(--v2-text-dim)]">{error.hint}</p>}
            </span>
          </div>
        )}

        <button
          type="submit"
          className="v2-btn v2-btn-primary w-full justify-center"
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              Signing in…
            </>
          ) : (
            <>
              Sign in
              <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </>
          )}
        </button>
      </form>

      <div className="mt-7 border-t border-[color:var(--v2-border-soft)] pt-6">
        <RequestLink defaultEmail={email} />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="v2-bare-main">
      <Suspense fallback={<div className="v2-panel p-8 w-full max-w-md">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
