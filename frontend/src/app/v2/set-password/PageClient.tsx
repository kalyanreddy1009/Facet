"use client";

/** v2 skin of `app/set-password/PageClient.tsx`. Same invite-status check on
 *  load, same per-failure screens, same client-side confirm check. See the
 *  v1 file for the reasoning; only markup/classes and the /v2 destinations
 *  differ. */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

import RequestLink from "@/components-v2/auth/RequestLink";
import { refreshSession } from "@/lib/useSession";

const MIN_LENGTH = 12;

interface InviteStatus {
  usable: boolean;
  email?: string;
  display_name?: string;
  account_ready?: boolean;
  status?: string;
  expires_at?: number;
  reason?: string;
  error?: string;
  hint?: string;
}

function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [status, setStatus] = useState<InviteStatus | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ error: string; hint?: string; reason?: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= MIN_LENGTH && password === confirm && !busy;

  const check = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(
        `/api/auth/invite-status?token=${encodeURIComponent(token)}`,
        { credentials: "include" }
      );
      setStatus(await response.json());
    } catch {
      setStatus({
        usable: false,
        reason: "offline",
        error: "Could not reach Facet.",
        hint: "It may be restarting. Your link is probably fine — reload in a moment.",
      });
    }
  }, [token]);

  useEffect(() => {
    check();
  }, [check]);

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
        setError({ error: data.error || "Could not set your password.", hint: data.hint, reason: data.reason });
        check();
        return;
      }
      await refreshSession().catch(() => {});
      router.replace("/v2");
    } catch {
      setError({
        error: "Could not reach Facet.",
        hint: "It may be restarting. Try again in a moment — your link is still good.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Problem
        title="This link is incomplete"
        body="Open the whole link you were sent — it ends in a long code after `token=`. Chat apps and mail clients sometimes cut it short, so copying it rather than tapping it can help."
      />
    );
  }

  if (status === null) {
    return (
      <div className="v2-panel w-full max-w-md p-8 sm:p-10">
        <p className="flex items-center gap-2 text-sm text-[color:var(--v2-text-faint)] v2-sans">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Checking your link…
        </p>
      </div>
    );
  }

  if (!status.usable) {
    return (
      <Problem
        title={status.error || "That link cannot be used"}
        body={status.hint || ""}
        signIn={status.reason === "used"}
        retry={status.reason === "offline" ? check : undefined}
      />
    );
  }

  if (status.account_ready === false) {
    return (
      <Problem
        title="This account isn't active yet"
        body={`Your link is good and will keep working — the account is ${status.status}. Ask whoever administers this Facet to activate it, then open the link again.`}
        retry={check}
      />
    );
  }

  return (
    <div className="v2-panel w-full max-w-md p-8 sm:p-10">
      <p className="v2-eyebrow">Facet v2</p>
      <h1 className="v2-h1 mt-1">Choose a password</h1>
      <p className="v2-lede mt-2">
        For <span className="text-[color:var(--v2-text)]">{status.email}</span>. At least{" "}
        {MIN_LENGTH} characters — a short phrase you can remember beats a short password you
        cannot.
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4">
        <div>
          <label htmlFor="password" className="v2-label">
            New password
          </label>
          <input
            id="password"
            type="password"
            className="v2-field"
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
            className={`mt-1.5 text-xs v2-sans ${
              tooShort ? "text-[color:var(--v2-danger)]" : "text-[color:var(--v2-text-faint)]"
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
          <label htmlFor="confirm" className="v2-label">
            Type it again
          </label>
          <input
            id="confirm"
            type="password"
            className="v2-field"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-describedby="match-hint"
            required
            disabled={busy}
          />
          {mismatch && (
            <p id="match-hint" className="mt-1.5 text-xs text-[color:var(--v2-danger)] v2-sans">
              These do not match.
            </p>
          )}
        </div>

        {error && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded border border-[color:var(--v2-danger)] bg-[color:var(--v2-danger-soft)] px-3 py-2.5 text-sm v2-sans"
          >
            <p className="font-medium text-[color:var(--v2-text)]">{error.error}</p>
            {error.hint && <p className="mt-1 text-[color:var(--v2-text-dim)]">{error.hint}</p>}
          </div>
        )}

        <button
          type="submit"
          className="v2-btn v2-btn-primary w-full justify-center"
          disabled={!ready}
          aria-busy={busy || undefined}
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            <>
              Set password and sign in
              <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </>
          )}
        </button>
      </form>
    </div>
  );
}

function Problem({
  title,
  body,
  signIn,
  retry,
}: {
  title: string;
  body: string;
  signIn?: boolean;
  retry?: () => void;
}) {
  return (
    <div className="v2-panel w-full max-w-md p-8 sm:p-10">
      <h1 className="v2-h1 flex items-start gap-2.5">
        <span className="mt-1 shrink-0" aria-hidden>
          {signIn ? (
            <CheckCircle2 className="w-5 h-5 text-[color:var(--v2-ok)]" />
          ) : (
            <TriangleAlert className="w-5 h-5 text-[color:var(--v2-warn)]" />
          )}
        </span>
        {title}
      </h1>
      {body && <p className="v2-lede mt-3">{body}</p>}

      <div className="mt-6 flex flex-wrap gap-2">
        {signIn && (
          <Link href="/v2/login" className="v2-btn v2-btn-primary">
            Go to sign in
            <ArrowRight className="w-3.5 h-3.5" aria-hidden />
          </Link>
        )}
        {retry && (
          <button type="button" className="v2-btn" onClick={retry}>
            Check again
          </button>
        )}
      </div>

      {!signIn && (
        <div className="mt-7 border-t border-[color:var(--v2-border-soft)] pt-6">
          <RequestLink />
        </div>
      )}
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <main className="v2-bare-main">
      <Suspense
        fallback={
          <div className="v2-panel w-full max-w-md p-8 sm:p-10">
            <p className="flex items-center gap-2 text-sm text-[color:var(--v2-text-faint)] v2-sans">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              Loading…
            </p>
          </div>
        }
      >
        <SetPasswordForm />
      </Suspense>
    </main>
  );
}
