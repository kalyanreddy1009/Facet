"use client";

/**
 * Set a first password from an invitation link, or a new one after a reset.
 *
 * The token arrives in the query string, which is the only credential the
 * person has at this point. It is single-use on the server: accepting it
 * writes the password hash and burns every outstanding link for the account
 * in the same call, so a link that leaks later opens nothing.
 *
 * This screen exists in the worst possible position — it is the first thing a
 * new person sees, they have no account to fall back on, and if it fails they
 * have no way to tell whether the fault is theirs. Two real users were locked
 * out here on 2026-07-29 because every failure said the same thing ("that link
 * is not valid any more"), which was false in most cases and actionable in
 * none.
 *
 * So it now does three things it did not:
 *   - Asks the server whether the link is usable *on load*, before anyone
 *     chooses a password. Being told the link was dead after typing a
 *     passphrase twice is the difference between an annoyance and giving up.
 *   - Renders a different, specific screen per failure, each with the one
 *     action that actually resolves it.
 *   - Offers a way to ask for a new link without needing an account first.
 *
 * The confirm field is still checked here rather than server-side: mistyping
 * a password twice identically is not a security question, and a round trip
 * to be told so is just slower.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

import RequestLink from "@/components/auth/RequestLink";
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

  // Asked once, on load. The server does the same checks the submission will,
  // so what this reports and what a submission does cannot disagree.
  const check = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(
        `/api/auth/invite-status?token=${encodeURIComponent(token)}`,
        { credentials: "include" }
      );
      setStatus(await response.json());
    } catch {
      // The backend being unreachable is not the link's fault, and saying
      // "your link is invalid" here would send someone to ask for a
      // replacement that would fail in exactly the same way.
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
        setError({
          error: data.error || "Could not set your password.",
          hint: data.hint,
          reason: data.reason,
        });
        // Re-read the link's state, so a failure that changed it (used,
        // expired between load and submit) redraws the right screen instead
        // of leaving a stale form under an error.
        check();
        return;
      }
      await refreshSession().catch(() => {});
      router.replace("/");
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
      <div className="card p-8 sm:p-10">
        <p className="flex items-center gap-2 text-sm text-text-faint">
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
        // "Already used" is the one failure with a different answer: the
        // password exists, so the way in is the sign-in page, not a new link.
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
    <div className="card p-8 sm:p-10">
      <h1 className="text-2xl font-semibold tracking-tight">Choose a password</h1>
      <p className="mt-2 text-sm text-text-muted text-pretty">
        {/* Naming the account is the cheapest possible confirmation that the
            link is the right one — it catches a link forwarded to the wrong
            person before a password is set on somebody else's account. */}
        For <span className="text-text">{status.email}</span>. At least {MIN_LENGTH} characters
        — a short phrase you can remember beats a short password you cannot.
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4">
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
            className={`mt-1.5 text-xs ${tooShort ? "text-danger-text" : "text-text-muted"}`}
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
            <p id="match-hint" className="mt-1.5 text-xs text-danger-text">
              These do not match.
            </p>
          )}
        </div>

        {error && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded border border-danger-border bg-danger-soft px-3 py-2.5 text-sm"
          >
            <p className="font-medium">{error.error}</p>
            {error.hint && <p className="mt-1 text-text-muted">{error.hint}</p>}
          </div>
        )}

        {/* Label in the button, icon in the cap — see the note in login. */}
        <button
          type="submit"
          className="btn btn-primary btn-lg w-full"
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
              <span className="btn-cap" aria-hidden>
                <ArrowRight className="w-3 h-3" />
              </span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}

/** Every dead end this screen can reach, with the action that resolves it.
 *  A failure with no next step is the thing that made this unrecoverable. */
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
    <div className="card p-8 sm:p-10">
      <h1 className="flex items-start gap-2.5 text-2xl font-semibold tracking-tight text-balance">
        <span className="mt-1 shrink-0 text-warn" aria-hidden>
          {signIn ? (
            <CheckCircle2 className="w-5 h-5 text-ok" />
          ) : (
            <TriangleAlert className="w-5 h-5" />
          )}
        </span>
        {title}
      </h1>
      {body && <p className="mt-3 text-sm text-text-dim text-pretty">{body}</p>}

      <div className="mt-6 flex flex-wrap gap-2">
        {signIn && (
          <Link href="/login" className="btn btn-primary">
            Go to sign in
            <span className="btn-cap" aria-hidden>
              <ArrowRight className="w-3 h-3" />
            </span>
          </Link>
        )}
        {retry && (
          <button type="button" className="btn btn-default" onClick={retry}>
            Check again
          </button>
        )}
      </div>

      {!signIn && (
        <div className="mt-7 border-t border-border pt-6">
          <RequestLink />
        </div>
      )}
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 py-16">
      {/* useSearchParams needs a Suspense boundary, or the build fails at
          prerender with an error that does not name this file. */}
      <Suspense
        fallback={
          <div className="card p-8 sm:p-10">
            <p className="flex items-center gap-2 text-sm text-text-faint">
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
