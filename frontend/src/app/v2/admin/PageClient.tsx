"use client";

/**
 * v2's People page — full parity with v1's admin (frontend/src/app/admin/PageClient.tsx):
 * add a user, issue/resend sign-in links, suspend/resume, sign out everywhere,
 * and the "waiting on a sign-in link" queue. Gated by `session.user.is_admin`
 * exactly like v1 — every mutating endpoint re-checks that flag server-side
 * and 404s otherwise, so this page redirects a non-admin rather than hiding
 * controls, same reasoning as v1.
 *
 * Simplified vs v1: the wide-screen account list is a single-column stack of
 * v2-panel rows instead of v1's 4-column CSS grid with a hand-tuned `15rem`
 * actions column. v2 has no equivalent grid-table pattern yet and the row
 * count here is small, so a stacked row (label/value pairs, actions wrapping
 * beneath) reads fine at every width without inventing a second grid
 * convention for one page. Every action and piece of information from v1 is
 * present.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, MailQuestion, Shield, UserPlus } from "lucide-react";

import { copyText } from "@/lib/clipboard";
import { useSession } from "@/lib/useSession";
import { useToasts } from "@/lib/useToasts";
import V2Toaster from "@/components-v2/Toast";

interface AdminUser {
  id: number;
  email: string;
  display_name: string | null;
  slug: string;
  status: string;
  is_admin: boolean;
  created_at: number;
  last_seen_at: number | null;
  has_password: boolean;
  sessions: number;
  invite: { created_at: number; expires_at: number } | null;
}

interface LinkRequest {
  email: string;
  at: number;
  times: number;
}

function inviteLabel(user: AdminUser): { text: string; tone: string } {
  if (user.has_password) return { text: "", tone: "" };
  if (!user.invite) return { text: "no link outstanding", tone: "v2-badge-warn" };
  const days = Math.floor((user.invite.expires_at - Date.now() / 1000) / 86400);
  if (days < 1) return { text: "link expires today", tone: "v2-badge-warn" };
  return { text: `link valid ${days}d`, tone: "v2-badge" };
}

async function call(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || body.error || `Failed (${response.status})`);
  }
  return body;
}

export default function AdminPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const { toasts, push, dismiss } = useToasts();

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ email: string; url: string } | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const body = await call("/api/admin/users");
      setUsers(body.users);
      setRequests(body.link_requests || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load users");
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session?.user?.is_admin) {
      router.replace("/v2");
      return;
    }
    refresh();
  }, [loading, session, router, refresh]);

  if (loading || !session?.user?.is_admin) {
    return (
      <main className="v2-main w-full">
        <p className="v2-sans flex items-center gap-2 text-sm text-[var(--v2-text-faint)]">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Checking…
        </p>
      </main>
    );
  }

  async function act(id: number, path: string, body?: object, done?: string) {
    setError(null);
    setPending(id);
    try {
      const result = await call(path, { method: "POST", body: JSON.stringify(body || {}) });
      await refresh();
      if (done) push(done, { tone: "success" });
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : `The request to ${path} failed, and returned no reason.`);
      return null;
    } finally {
      setPending(null);
    }
  }

  async function addUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await call("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, display_name: name || null }),
      });
      setInvite({ email: created.email, url: created.invite_url });
      setEmail("");
      setName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that user");
    } finally {
      setBusy(false);
    }
  }

  const currentEmail = session.user.email;

  return (
    <main className="v2-main w-full flex flex-col gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="v2-eyebrow mb-1">Multi-user</p>
          <h1 className="v2-h1 flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-[var(--v2-accent)]" aria-hidden />
            People
          </h1>
          <p className="v2-lede mt-2 max-w-prose text-pretty">
            Everyone here shares one Facet, and each has their own stone, cabinet and exports.
            Nobody can see anyone else&rsquo;s — including you.
          </p>
        </div>
        {users && (
          <p className="v2-mono text-sm text-[var(--v2-text-faint)]">
            {users.length} account{users.length === 1 ? "" : "s"}
          </p>
        )}
      </header>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="v2-panel v2-panel-tight border-[var(--v2-danger)] bg-[var(--v2-danger-soft)] v2-sans text-sm text-[var(--v2-text)]"
        >
          {error}
        </div>
      )}

      {requests.length > 0 && (
        <section className="v2-panel border-[var(--v2-warn)]">
          <h2 className="v2-sans flex items-center gap-2 text-sm font-medium text-[var(--v2-text)]">
            <MailQuestion className="w-4 h-4 text-[var(--v2-warn)]" aria-hidden />
            Waiting on a sign-in link
          </h2>
          <p className="mt-1 v2-sans text-xs text-[var(--v2-text-faint)] text-pretty">
            Asked from the sign-in page. Facet sends no mail, so these reach you and nobody else —
            issuing a link clears the entry.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {requests.map((request) => {
              const match = users?.find((u) => u.email === request.email);
              return (
                <li
                  key={request.email}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--v2-radius)] border border-[var(--v2-border)] bg-[var(--v2-bg)] px-3 py-2"
                >
                  <span className="v2-sans text-sm text-[var(--v2-text)]">
                    {request.email}
                    {!match && <span className="ml-2 text-xs text-[var(--v2-text-faint)]">no account here</span>}
                    {request.times > 1 && (
                      <span className="ml-2 v2-mono text-xs text-[var(--v2-text-faint)]">
                        asked {request.times}×
                      </span>
                    )}
                  </span>
                  {match && (
                    <button
                      type="button"
                      className="v2-btn"
                      disabled={pending === match.id}
                      onClick={async () => {
                        const result = await act(match.id, `/api/admin/users/${match.id}/invite`);
                        if (result) setInvite({ email: match.email, url: result.invite_url });
                      }}
                    >
                      Send a link
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------- add someone */}
      <section className="v2-panel">
        <h2 className="v2-sans flex items-center gap-2 text-sm font-medium text-[var(--v2-text)]">
          <UserPlus className="w-4 h-4 text-[var(--v2-text-faint)]" aria-hidden />
          Add someone
        </h2>
        <form onSubmit={addUser} className="mt-4 grid gap-2.5 sm:grid-cols-[1.4fr_1fr_auto]">
          <div>
            <label htmlFor="v2-new-email" className="v2-sr-only">
              Email address
            </label>
            <input
              id="v2-new-email"
              type="email"
              className="v2-field"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              required
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="v2-new-name" className="v2-sr-only">
              Display name (optional)
            </label>
            <input
              id="v2-new-name"
              type="text"
              className="v2-field"
              placeholder="Display name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>
          <button type="submit" className="v2-btn v2-btn-primary" disabled={busy} aria-busy={busy || undefined}>
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                Adding…
              </>
            ) : (
              "Add user"
            )}
          </button>
        </form>

        {invite && <InviteLink email={invite.email} url={invite.url} />}
      </section>

      {/* --------------------------------------------------- the account list */}
      {users === null ? (
        <div className="flex flex-col gap-2.5" aria-busy>
          <span className="v2-sr-only">Loading accounts…</span>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="v2-panel v2-panel-tight animate-pulse h-14" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="v2-panel flex flex-col items-center text-center gap-2 py-14">
          <UserPlus className="w-5 h-5 text-[var(--v2-text-faint)]" aria-hidden />
          <p className="v2-sans text-sm font-medium text-[var(--v2-text)]">No accounts yet</p>
          <p className="v2-sans text-xs text-[var(--v2-text-faint)] max-w-md text-pretty">
            Add the first person above — they&apos;ll get a one-time sign-in link to set their own
            password.
          </p>
        </div>
      ) : (
        <section aria-label="Accounts" className="flex flex-col gap-2.5">
          {users.map((user) => (
            <article key={user.id} className="v2-panel flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="v2-sans flex items-center gap-2 font-medium text-[var(--v2-text)]">
                    <span className="truncate">{user.display_name || user.slug}</span>
                    {user.is_admin && <span className="v2-badge v2-badge-ok shrink-0">admin</span>}
                  </p>
                  <p className="v2-mono text-xs text-[var(--v2-text-faint)] truncate">{user.email}</p>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${user.status === "suspended" ? "bg-[var(--v2-warn)]" : "bg-[var(--v2-ok)]"}`}
                    aria-hidden
                  />
                  <span className="v2-sans text-sm text-[var(--v2-text-dim)] capitalize">{user.status}</span>
                  {!user.has_password && (
                    <span className={`v2-badge ${inviteLabel(user).tone} shrink-0`} title="No password set yet">
                      {inviteLabel(user).text}
                    </span>
                  )}
                </div>
              </div>

              <p className="v2-mono text-xs text-[var(--v2-text-faint)]">
                {user.sessions} session{user.sessions === 1 ? "" : "s"}
              </p>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="v2-btn"
                  disabled={pending === user.id}
                  onClick={async () => {
                    const result = await act(user.id, `/api/admin/users/${user.id}/invite`);
                    if (result) setInvite({ email: user.email, url: result.invite_url });
                  }}
                  title="A fresh one-time link. Any link already sent keeps working, so re-issuing is safe."
                >
                  Sign-in link
                </button>

                <button
                  type="button"
                  className="v2-btn"
                  onClick={() =>
                    act(
                      user.id,
                      `/api/admin/users/${user.id}/revoke-sessions`,
                      undefined,
                      `Signed ${user.display_name || user.email} out everywhere`
                    )
                  }
                  disabled={user.sessions === 0 || pending === user.id}
                  title="Sign them out of every browser. For a lost laptop."
                >
                  Sign out
                </button>

                {user.status === "suspended" ? (
                  <button
                    type="button"
                    className="v2-btn v2-btn-primary"
                    disabled={pending === user.id}
                    onClick={() =>
                      act(
                        user.id,
                        `/api/admin/users/${user.id}/resume`,
                        undefined,
                        `${user.display_name || user.email} can sign in again`
                      )
                    }
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    className="v2-btn"
                    onClick={() =>
                      act(
                        user.id,
                        `/api/admin/users/${user.id}/suspend`,
                        undefined,
                        `${user.display_name || user.email} is suspended — their data is untouched`
                      )
                    }
                    disabled={user.email === currentEmail || pending === user.id}
                    title={
                      user.email === currentEmail
                        ? "You cannot suspend your own account"
                        : "Stops their access. Their data is untouched."
                    }
                  >
                    Suspend
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      <V2Toaster toasts={toasts} onDismiss={dismiss} />

      <p className="v2-sans text-xs text-[var(--v2-text-faint)] max-w-prose text-pretty">
        Deleting an account and restoring a backup are deliberately not here — they live in the
        control plane on port 9000, reachable over SSH. A button that destroys somebody&rsquo;s
        career record should take more than one click from a browser tab left open.
      </p>
    </main>
  );
}

function InviteLink({ email, url }: { email: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="mt-5 rounded-[var(--v2-radius)] border border-[var(--v2-accent)] bg-[var(--v2-bg)] p-4">
      <p className="v2-sans text-sm font-medium text-[var(--v2-text)]">Sign-in link for {email}</p>
      <p className="mt-1 v2-sans text-xs text-[var(--v2-text-dim)] text-pretty">
        Copy it now — only its digest is stored, so it cannot be shown again. Works once, expires in
        a week. Facet sends no email; pass it on yourself.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          readOnly
          value={url}
          aria-label={`Sign-in link for ${email}`}
          onFocus={(e) => e.currentTarget.select()}
          className="v2-field flex-1 min-w-[14rem] v2-mono text-xs"
        />
        <button
          type="button"
          className="v2-btn"
          onClick={async () => {
            if (!(await copyText(url))) {
              setFailed(true);
              return;
            }
            setFailed(false);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" aria-hidden />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" aria-hidden />
              Copy
            </>
          )}
        </button>
      </div>
      {failed && (
        <p role="alert" className="mt-2 v2-sans text-xs text-[var(--v2-danger)]">
          Couldn&rsquo;t reach the clipboard. Select the link above and copy it by hand.
        </p>
      )}
    </div>
  );
}
