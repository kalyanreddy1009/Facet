"use client";

/**
 * Your account: who you are here, what you have, and how to secure it.
 *
 * On a shared deployment this answers the question the rest of the app
 * cannot — "is this my data?" A name and address at the top, then the Stone,
 * the Cabinet and the disk they occupy, all scoped to this session by the
 * server rather than by a query parameter this page could get wrong.
 *
 * One request fills it. Five endpoints would mean five loading states on a
 * screen whose whole job is a summary.
 */

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, MonitorSmartphone, Shield } from "lucide-react";

import { refreshSession } from "@/lib/useSession";

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
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/profile", { credentials: "include" });
      if (response.status === 401) {
        window.location.href = "/login?next=/profile";
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json());
    } catch {
      setError("Could not load your profile. Facet may be restarting.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="card p-6" role="alert">
          {error}
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="flex items-center gap-2 text-sm text-text-faint">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Loading your profile…
        </p>
      </main>
    );
  }

  const totalStorage =
    data.storage.data + data.storage.workspace + data.storage.exports;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {data.user.display_name}
        </h1>
        <p className="mt-1 text-sm text-text-faint">
          {data.user.email}
          {data.user.is_admin && (
            <span className="ml-2 inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs">
              <Shield className="w-3 h-3" aria-hidden />
              Administrator
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-text-faint">
          Using Facet since {when(data.member_since)}
        </p>
      </header>

      <section className="card p-6">
        <h2 className="text-sm font-medium">Your stone</h2>
        <p className="mt-2 text-sm text-text-dim">
          {data.stone.error ? (
            <span className="text-[var(--danger-text)]">{data.stone.error}</span>
          ) : data.stone.imported ? (
            <>
              Imported{data.stone.name ? ` — ${data.stone.name}` : ""}. Every
              tailored resume is cut from it.
            </>
          ) : (
            <>
              No resume imported yet. The Stone is the single record everything
              else is cut from — start there.
            </>
          )}
        </p>
      </section>

      <section className="card p-6">
        <h2 className="text-sm font-medium">Your cabinet</h2>
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            ["Applications", data.cabinet.applications],
            ["Contacts", data.cabinet.contacts],
            ["Interviews", data.cabinet.interviews],
            ["Postings seen", data.cabinet.postings_seen],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-xs text-text-faint">{label}</dt>
              <dd className="mt-0.5 text-xl font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-text-faint">
          {bytes(totalStorage)} on disk — {bytes(data.storage.data)} data,{" "}
          {bytes(data.storage.workspace)} workspace, {bytes(data.storage.exports)}{" "}
          exports. Yours alone: every account has its own database and its own
          directory.
        </p>
      </section>

      <ChangePassword passwordSetAt={data.password_set_at} onChanged={load} />

      <section className="card p-6">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <MonitorSmartphone className="w-4 h-4" aria-hidden />
          Where you are signed in
        </h2>
        <ul className="mt-3 space-y-2">
          {data.sessions.map((session, index) => (
            <li
              key={index}
              className="flex items-baseline justify-between gap-4 text-sm"
            >
              <span className="truncate text-text-dim">
                {session.user_agent || "Unknown browser"}
                {session.current && (
                  <span className="ml-2 text-xs text-[var(--accent-text)]">
                    this one
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-text-faint tabular-nums">
                {when(session.last_seen_at)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-text-faint">
          Changing your password signs out every other browser.
        </p>
      </section>
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
    <section className="card p-6">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="w-4 h-4" aria-hidden />
        Password
      </h2>
      <p className="mt-1 text-xs text-text-faint">
        {passwordSetAt ? `Last changed ${when(passwordSetAt)}.` : "Never set."}
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3 max-w-sm">
        <div>
          <label htmlFor="current" className="mb-1.5 block text-sm">
            Current password
          </label>
          <input
            id="current"
            type="password"
            className="field w-full"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
          />
        </div>
        <div>
          <label htmlFor="next" className="mb-1.5 block text-sm">
            New password
          </label>
          <input
            id="next"
            type="password"
            className="field w-full"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            disabled={busy}
          />
          <p className="mt-1.5 text-xs text-text-faint">
            {MIN_PASSWORD} characters minimum.
          </p>
        </div>
        <div>
          <label htmlFor="confirm" className="mb-1.5 block text-sm">
            Type it again
          </label>
          <input
            id="confirm"
            type="password"
            className="field w-full"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            disabled={busy}
          />
          {mismatch && (
            <p className="mt-1.5 text-xs text-[var(--danger-text)]">
              These do not match.
            </p>
          )}
        </div>

        {message && (
          <p
            role="status"
            className={`text-sm ${
              message.ok ? "text-text-dim" : "text-[var(--danger-text)]"
            }`}
          >
            {message.text}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={!ready}>
          <span className="btn-cap">{busy ? "Changing…" : "Change password"}</span>
        </button>
      </form>
    </section>
  );
}
