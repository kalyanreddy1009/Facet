"use client";

/** v2 skin of `app/profile/PageClient.tsx`. Same one-request summary
 *  (`/api/auth/profile`), same single-user 401 redirect guard, same password
 *  change form. See the v1 file for the reasoning; only the layout and
 *  classes differ — two v2-panel rows instead of two-column cards. */

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, KeyRound, Loader2, MonitorSmartphone, Shield } from "lucide-react";

import { refreshSession, useSession } from "@/lib/useSession";

interface ProfileData {
  user: {
    email: string;
    display_name: string;
    status: string;
    is_admin: boolean;
  };
  member_since: number;
  password_set_at: number | null;
  stone: { imported: boolean; name?: string; error?: string };
  cabinet: {
    applications: number;
    contacts: number;
    interviews: number;
    postings_seen: number;
  };
  storage: { data: number; workspace: number; exports: number };
  queue: { queued: number; running: number; done: number; failed: number };
  sessions: {
    created_at: number;
    last_seen_at: number | null;
    user_agent: string;
    current: boolean;
  }[];
}

const MIN_PASSWORD = 12;

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function when(seconds: number | null): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ProfilePage() {
  const { session } = useSession();
  const singleUser = session?.single_user === true;
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/profile", { credentials: "include" });
      if (response.status === 401) {
        window.location.href = singleUser ? "/v2" : "/v2/login?next=/v2/profile";
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json());
    } catch {
      setError("Could not load your profile. Facet may be restarting.");
    }
  }, [singleUser]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <main className="v2-main">
        <div className="v2-panel" role="alert">
          <p className="v2-sans text-sm text-[color:var(--v2-danger)]">{error}</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="v2-main">
        <p className="v2-sans flex items-center gap-2 text-sm text-[color:var(--v2-text-faint)]">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Loading your profile…
        </p>
      </main>
    );
  }

  const totalStorage = data.storage.data + data.storage.workspace + data.storage.exports;

  return (
    <main className="v2-main">
      <header className="mb-6">
        <p className="v2-eyebrow">Account</p>
        <h1 className="v2-h1 mt-1">{data.user.display_name}</h1>
        <p className="v2-sans mt-1 text-sm text-[color:var(--v2-text-faint)]">
          {data.user.email}
          {data.user.is_admin && (
            <span className="v2-badge ml-2">
              <Shield className="w-3 h-3" aria-hidden />
              Administrator
            </span>
          )}
        </p>
        <p className="v2-sans mt-1 text-xs text-[color:var(--v2-text-faint)]">
          Using Facet since {when(data.member_since)}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <section className="v2-panel">
          <h2 className="v2-h2 text-base">Your stone</h2>
          <p className="v2-sans mt-2 text-sm text-[color:var(--v2-text-dim)]">
            {data.stone.error ? (
              <span className="text-[color:var(--v2-danger)]">{data.stone.error}</span>
            ) : data.stone.imported ? (
              <>
                Imported{data.stone.name ? ` — ${data.stone.name}` : ""}. Every tailored resume
                is cut from it.
              </>
            ) : (
              <>
                No resume imported yet. The Stone is the single record everything else is cut
                from — start there.
              </>
            )}
          </p>
        </section>

        <section className="v2-panel">
          <h2 className="v2-h2 text-base">Your cabinet</h2>
          <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              ["Applications", data.cabinet.applications],
              ["Contacts", data.cabinet.contacts],
              ["Interviews", data.cabinet.interviews],
              ["Postings seen", data.cabinet.postings_seen],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="v2-label mb-0">{label}</dt>
                <dd className="v2-mono mt-0.5 text-xl font-medium tabular-nums text-[color:var(--v2-text)]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="v2-sans mt-4 text-xs text-[color:var(--v2-text-faint)]">
            {bytes(totalStorage)} on disk — {bytes(data.storage.data)} data,{" "}
            {bytes(data.storage.workspace)} workspace, {bytes(data.storage.exports)} exports.
            Yours alone: every account has its own database and its own directory.
          </p>
        </section>

        <ChangePassword passwordSetAt={data.password_set_at} onChanged={load} />

        <section className="v2-panel">
          <h2 className="v2-h2 flex items-center gap-2 text-base">
            <MonitorSmartphone className="w-4 h-4" aria-hidden />
            Where you are signed in
          </h2>
          <ul className="mt-3 space-y-2">
            {data.sessions.map((session, index) => (
              <li key={index} className="flex items-baseline justify-between gap-4 text-sm v2-sans">
                <span className="truncate text-[color:var(--v2-text-dim)]">
                  {session.user_agent || "Unknown browser"}
                  {session.current && (
                    <span className="ml-2 text-xs text-[color:var(--v2-accent)]">this one</span>
                  )}
                </span>
                <span className="shrink-0 v2-mono text-xs text-[color:var(--v2-text-faint)] tabular-nums">
                  {when(session.last_seen_at)}
                </span>
              </li>
            ))}
          </ul>
          <p className="v2-sans mt-4 text-xs text-[color:var(--v2-text-faint)]">
            Changing your password signs out every other browser.
          </p>
        </section>
      </div>
    </main>
  );
}

function ChangePassword({
  passwordSetAt,
  onChanged,
}: {
  passwordSetAt: number | null;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current && next.length >= MIN_PASSWORD && next === confirm && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ ok: false, text: body.error || "Could not change it." });
        return;
      }
      setMessage({ ok: true, text: "Changed. Other browsers have been signed out." });
      setCurrent("");
      setNext("");
      setConfirm("");
      await refreshSession();
      onChanged();
    } catch {
      setMessage({ ok: false, text: "Could not reach Facet." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="v2-panel">
      <h2 className="v2-h2 flex items-center gap-2 text-base">
        <KeyRound className="w-4 h-4" aria-hidden />
        Password
      </h2>
      <p className="v2-sans mt-1 text-xs text-[color:var(--v2-text-faint)]">
        {passwordSetAt ? `Last changed ${when(passwordSetAt)}.` : "Never set."}
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3 max-w-sm">
        <div>
          <label htmlFor="current" className="v2-label">
            Current password
          </label>
          <input
            id="current"
            type="password"
            className="v2-field"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="next" className="v2-label">
            New password
          </label>
          <input
            id="next"
            type="password"
            className="v2-field"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            disabled={busy}
          />
          <p className="v2-sans mt-1.5 text-xs text-[color:var(--v2-text-faint)]">
            {MIN_PASSWORD} characters minimum.
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
            disabled={busy}
          />
          {mismatch && (
            <p className="v2-sans mt-1.5 text-xs text-[color:var(--v2-danger)]">
              These do not match.
            </p>
          )}
        </div>

        {message && (
          <p
            role="status"
            className={`v2-sans text-sm ${
              message.ok ? "text-[color:var(--v2-text-dim)]" : "text-[color:var(--v2-danger)]"
            }`}
          >
            {message.text}
          </p>
        )}

        <button
          type="submit"
          className="v2-btn v2-btn-primary"
          disabled={!ready}
          aria-busy={busy || undefined}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          ) : (
            <>
              Change password
              <ArrowRight className="w-3 h-3" aria-hidden />
            </>
          )}
        </button>
      </form>
    </section>
  );
}
