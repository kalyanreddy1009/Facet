"use client";

/**
 * Manage the people who use this Facet.
 *
 * Only rendered for administrators — but that is courtesy, not security.
 * Every endpoint behind these buttons checks the same flag server-side and
 * answers 404 to anyone else, which `backend/scripts/test_admin.py` proves
 * by calling each one as an ordinary signed-in user.
 *
 * So this page redirects a non-admin rather than hiding controls: showing
 * someone a screen where every action fails is worse than not showing it.
 *
 * Layout note — the account list is a row grid on a wide screen and a stack of
 * cards below `md`. It used to be a real table at every width with four action
 * buttons in the last cell, which is what produced the overlapping,
 * horizontally-scrolling mess on a laptop: four buttons plus an email address
 * do not fit in 40em, and `overflow-x-auto` only hides that by scrolling the
 * actions out of sight.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, MailQuestion, Plus, Shield, UserPlus } from "lucide-react";

import Toaster from "@/components/ui/Toaster";
import { Skeleton } from "@/components/ui/Skeleton";
import { copyText } from "@/lib/clipboard";
import { useSession } from "@/lib/useSession";
import { useToasts } from "@/lib/useToasts";

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
  /** The newest live sign-in link, if one is outstanding. Never the token. */
  invite: { created_at: number; expires_at: number } | null;
}

interface LinkRequest {
  email: string;
  at: number;
  times: number;
}

/** "invited 2 days ago, 5 days left" is a different situation from "invited
 *  last month, link is dead" — and the old list showed both as the same
 *  "no password set yet". */
function inviteLabel(user: AdminUser): { text: string; tone: string } {
  if (user.has_password) return { text: "", tone: "" };
  if (!user.invite) return { text: "no link outstanding", tone: "badge-warn" };
  const days = Math.floor((user.invite.expires_at - Date.now() / 1000) / 86400);
  if (days < 1) return { text: "link expires today", tone: "badge-warn" };
  return { text: `link valid ${days}d`, tone: "badge" };
}

/** The column template, written once. Header and rows drifting apart is the
 *  classic way a "table" made of grids ends up misaligned. */
/* The column headings and every account row are separate grids that happen to
   share this template, so every track in it has to resolve to the same width
   in all of them. `auto` cannot: it sizes to its own cell's content, which in
   the heading row is the word "Actions" and in an account row is a cluster of
   three buttons. The last track therefore came out ~150px narrower in the
   heading, `1fr` absorbed the difference, and "Status" and "Sessions" sat a
   long way right of the values they label — the column headings pointed at
   nothing. A fixed track resolves identically everywhere; in `rem` so it grows
   with the buttons when the reader's font size does. 15rem because the widest
   cluster — three buttons and their gaps — measures 14.5rem; at 14 it fitted
   the heading and wrapped every row onto two lines, which is the same bug
   wearing the opposite face. */
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_10rem_5rem_15rem]";

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
  const { toasts, push, dismiss, hold, resume } = useToasts();

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ email: string; url: string } | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  /** Which row is mid-request. Without it, Suspend on a slow connection looks
   *  like nothing happened, which invites a second click. */
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
      router.replace("/");
      return;
    }
    refresh();
  }, [loading, session, router, refresh]);

  if (loading || !session?.user?.is_admin) {
    return (
      <main className="max-w-shell mx-auto px-5 sm:px-8 py-8 sm:py-10">
        <p className="flex items-center gap-2 text-sm text-text-faint">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Checking…
        </p>
      </main>
    );
  }

  /** `done` is the confirmation. Suspend, Resume and Sign out all change
   *  something a row away from the button, and without a word from the app the
   *  only evidence they worked is a badge you were not looking at. */
  async function act(id: number, path: string, body?: object, done?: string) {
    setError(null);
    setPending(id);
    try {
      const result = await call(path, { method: "POST", body: JSON.stringify(body || {}) });
      await refresh();
      if (done) push(done, { tone: "success" });
      return result;
    } catch (err) {
      // The fallback only runs when something non-Error was thrown, so there is
      // no message to pass on. Naming the request that failed still beats
      // "Something went wrong" — these actions approve, suspend and delete real
      // accounts, and an admin who cannot tell which one failed has to go and
      // check the table to find out what they just did.
      setError(
        err instanceof Error ? err.message : `The request to ${path} failed, and returned no reason.`
      );
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
    <main className="max-w-shell mx-auto px-5 sm:px-8 py-8 sm:py-10 space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-text">
            <Shield className="w-5 h-5 text-accent-text" aria-hidden />
            People
          </h1>
          <p className="mt-2 text-sm text-text-dim max-w-prose text-pretty">
            Everyone here shares one Facet, and each has their own stone, cabinet and exports.
            Nobody can see anyone else&rsquo;s - including you.
          </p>
        </div>
        {users && (
          <p className="text-sm text-text-faint tnum">
            {users.length} account{users.length === 1 ? "" : "s"}
          </p>
        )}
      </header>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded border border-danger-border bg-danger-soft px-3.5 py-2.5 text-sm"
        >
          {error}
        </div>
      )}

      {requests.length > 0 && (
        <section className="card p-6 sm:p-7 border-warn-border">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <MailQuestion className="w-4 h-4 text-warn" aria-hidden />
            Waiting on a sign-in link
          </h2>
          <p className="mt-1 text-xs text-text-faint text-pretty">
            Asked from the sign-in page. Facet sends no mail, so these reach you and
            nobody else - issuing a link clears the entry.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {requests.map((request) => {
              const match = users?.find((u) => u.email === request.email);
              return (
                <li
                  key={request.email}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface-2 px-3 py-2"
                >
                  <span className="text-sm">
                    {request.email}
                    {!match && (
                      <span className="ml-2 text-xs text-text-faint">no account here</span>
                    )}
                    {request.times > 1 && (
                      <span className="ml-2 text-xs text-text-faint tnum">
                        asked {request.times}×
                      </span>
                    )}
                  </span>
                  {match && (
                    <button
                      type="button"
                      className="btn btn-default btn-sm"
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
      <section className="card p-6 sm:p-7">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <UserPlus className="w-4 h-4 text-text-faint" aria-hidden />
          Add someone
        </h2>
        {/* Grid, not flex-wrap: at a middle width flex-wrap dropped the button
            onto its own full-width line, which read as a second and more
            important action than the one it completes. */}
        <form onSubmit={addUser} className="mt-4 grid gap-2.5 sm:grid-cols-[1.4fr_1fr_auto]">
          <div>
            <label htmlFor="new-email" className="sr-only">
              Email address
            </label>
            <input
              id="new-email"
              type="email"
              className="field field-lg"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              /* Not "email": this field is somebody else's address, and the
                 browser offering the administrator their own is a way to
                 create an account for the wrong person. */
              autoComplete="off"
              required
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="new-name" className="sr-only">
              Display name (optional)
            </label>
            <input
              id="new-name"
              type="text"
              className="field field-lg"
              placeholder="Display name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>
          <button
            type="submit"
            className="btn btn-lg btn-primary"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                Adding…
              </>
            ) : (
              <>
                Add user
                <span className="btn-cap" aria-hidden>
                  <Plus className="w-3 h-3" />
                </span>
              </>
            )}
          </button>
        </form>

        {invite && <InviteLink email={invite.email} url={invite.url} />}
      </section>

      {/* --------------------------------------------------- the account list */}
      {users === null ? (
        /* Rows shaped like the real ones rather than a spinner: the list is
           the page, and every other list in Facet loads this way. */
        <div className="space-y-2.5" aria-busy>
          <span className="sr-only">Loading accounts…</span>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="panel p-5 md:py-3.5 flex items-center gap-4">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 w-20 ml-auto" />
            </div>
          ))}
        </div>
      ) : (
        <section aria-label="Accounts" className="space-y-2.5">
          {/* Headings for the wide form only. The stacked form repeats its own
              labels inline, so a second set here would be announced twice. */}
          <div className={`hidden md:grid ${COLUMNS} gap-4 px-5 pb-1 label`}>
            <span>Person</span>
            <span>Status</span>
            <span>Sessions</span>
            <span className="text-right">Actions</span>
          </div>

          {users.map((user) => (
            <article
              key={user.id}
              className={`panel panel-lit row-hover p-5 md:py-3.5 grid gap-3 md:items-center md:gap-4 ${COLUMNS}`}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <span className="truncate">{user.display_name || user.slug}</span>
                  {user.is_admin && <span className="badge badge-accent shrink-0">admin</span>}
                </p>
                <p className="text-xs text-text-faint truncate">{user.email}</p>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`dot ${user.status === "suspended" ? "dot-warn" : "dot-ok"}`}
                  aria-hidden
                />
                <span className="text-sm text-text-dim capitalize">{user.status}</span>
                {!user.has_password && (
                  /* The state that looks like a bug to whoever sent the
                     invite: the account exists but nobody has claimed it.
                     Says whether a usable link is still out there, because
                     "waiting for them" and "their link is dead" need
                     opposite actions from you. */
                  <span
                    className={`${inviteLabel(user).tone} shrink-0`}
                    title="No password set yet"
                  >
                    {inviteLabel(user).text}
                  </span>
                )}
              </div>

              <p className="text-sm text-text-dim tnum">
                <span className="md:hidden text-text-faint">Sessions: </span>
                {user.sessions}
              </p>

              <div className="flex flex-wrap md:justify-end gap-1.5">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
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
                  className="btn btn-ghost btn-sm"
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
                    className="btn btn-default btn-sm"
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
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      act(
                        user.id,
                        `/api/admin/users/${user.id}/suspend`,
                        undefined,
                        `${user.display_name || user.email} is suspended - their data is untouched`
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

      <Toaster toasts={toasts} onDismiss={dismiss} onHold={hold} onResume={resume} />

      <p className="text-xs text-text-faint max-w-prose text-pretty">
        Deleting an account and restoring a backup are deliberately not here - they live in the
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
    <div className="mt-5 rounded-lg border border-accent-border bg-accent-soft p-4">
      <p className="text-sm font-medium">Sign-in link for {email}</p>
      <p className="mt-1 text-xs text-text-dim text-pretty">
        Copy it now - only its digest is stored, so it cannot be shown again. Works once, expires in
        a week. Facet sends no email; pass it on yourself.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          readOnly
          value={url}
          aria-label={`Sign-in link for ${email}`}
          onFocus={(e) => e.currentTarget.select()}
          className="field flex-1 min-w-[14rem] mono text-xs"
        />
        <button
          type="button"
          className="btn btn-default"
          onClick={async () => {
            // The link is shown once and cannot be recovered, so a copy that
            // silently failed must not look like one that worked.
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
        <p role="alert" className="mt-2 text-xs text-danger-text">
          Couldn&rsquo;t reach the clipboard. Select the link above and copy it by hand.
        </p>
      )}
    </div>
  );
}
