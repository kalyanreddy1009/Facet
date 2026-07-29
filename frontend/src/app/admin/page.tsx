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
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Shield } from "lucide-react";

import { useSession } from "@/lib/useSession";

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

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ email: string; url: string } | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setUsers((await call("/api/admin/users")).users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load users");
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session?.user?.is_admin) {
      router.replace("/tailor");
      return;
    }
    refresh();
  }, [loading, session, router, refresh]);

  if (loading || !session?.user?.is_admin) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="flex items-center gap-2 text-sm text-text-faint">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Checking…
        </p>
      </main>
    );
  }

  async function act(path: string, body?: object) {
    setError(null);
    try {
      const result = await call(path, {
        method: "POST",
        body: JSON.stringify(body || {}),
      });
      await refresh();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return null;
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

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Shield className="w-5 h-5" aria-hidden />
          Manage users
        </h1>
        <p className="mt-1 text-sm text-text-faint">
          Everyone here shares one Facet, and each has their own stone, cabinet
          and exports. Nobody can see anyone else&rsquo;s.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-soft)] px-3 py-2 text-sm"
        >
          {error}
        </div>
      )}

      <section className="card p-6">
        <h2 className="text-sm font-medium">Add someone</h2>
        <form onSubmit={addUser} className="mt-3 flex flex-wrap gap-2">
          <input
            type="email"
            className="field flex-1 min-w-[16rem]"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
          <input
            type="text"
            className="field flex-1 min-w-[12rem]"
            placeholder="Display name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <span className="btn-cap">{busy ? "Adding…" : "Add user"}</span>
          </button>
        </form>

        {invite && <InviteLink email={invite.email} url={invite.url} />}
      </section>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-faint">
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Sessions</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(users || []).map((user) => (
                <tr key={user.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {user.display_name || user.slug}
                      {user.is_admin && (
                        <span className="ml-2 text-xs text-text-faint">admin</span>
                      )}
                    </div>
                    <div className="text-xs text-text-faint">{user.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-text-dim">{user.status}</span>
                    {!user.has_password && (
                      /* The state that looks like a bug to whoever sent the
                         invite: the account exists but nobody has claimed it. */
                      <div className="text-xs text-text-faint">
                        no password set yet
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-text-dim">
                    {user.sessions}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          const result = await act(`/api/admin/users/${user.id}/invite`);
                          if (result) {
                            setInvite({ email: user.email, url: result.invite_url });
                          }
                        }}
                        title="A fresh one-time link. This is the password reset."
                      >
                        <span className="btn-cap">Sign-in link</span>
                      </button>

                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          act(`/api/admin/users/${user.id}/revoke-sessions`)
                        }
                        disabled={user.sessions === 0}
                        title="Sign them out of every browser. For a lost laptop."
                      >
                        <span className="btn-cap">Sign out</span>
                      </button>

                      {user.status === "suspended" ? (
                        <button
                          className="btn btn-default btn-sm"
                          onClick={() => act(`/api/admin/users/${user.id}/resume`)}
                        >
                          <span className="btn-cap">Resume</span>
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => act(`/api/admin/users/${user.id}/suspend`)}
                          disabled={user.email === session.user?.email}
                          title={
                            user.email === session.user?.email
                              ? "You cannot suspend your own account"
                              : "Stops their access. Their data is untouched."
                          }
                        >
                          <span className="btn-cap">Suspend</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-text-faint">
        Deleting an account and restoring a backup are deliberately not here —
        they live in the control plane on port 9000, reachable over SSH. A
        button that destroys somebody&rsquo;s career record should take more
        than one click from a browser tab left open.
      </p>
    </main>
  );
}

function InviteLink({ email, url }: { email: string; url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-4 rounded-md border border-[var(--accent-border)] bg-[var(--accent-soft)] p-3">
      <p className="text-sm font-medium">Sign-in link for {email}</p>
      <p className="mt-0.5 text-xs text-text-faint">
        Copy it now — only its digest is stored, so it cannot be shown again.
        Works once, expires in a week. Facet sends no email; pass it on
        yourself.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="field flex-1 font-mono text-xs"
        />
        <button
          className="btn btn-default"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          <span className="btn-cap flex items-center gap-1.5">
            <Copy className="w-3.5 h-3.5" aria-hidden />
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
      </div>
    </div>
  );
}
