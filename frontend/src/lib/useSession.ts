"use client";

/**
 * Who is signed in, asked once and shared.
 *
 * Every component that needs the answer would otherwise call /api/auth/me
 * itself, which means the nav, the profile page and the admin page each fire
 * their own request on every navigation — and can briefly disagree about
 * whether you are an administrator.
 *
 * A module-level cache rather than a Context provider: the answer changes
 * about twice per session, and wrapping the whole tree in a provider to
 * distribute a value that stable is more machinery than the problem needs.
 */

import { createContext, useContext, useEffect, useState } from "react";

export interface SessionUser {
  email: string;
  display_name: string;
  status: string;
  must_set_password: boolean;
  /** Whether to *render* admin controls. The server checks this again on
   *  every admin request — hiding a link protects nothing on its own. */
  is_admin: boolean;
}

export interface Session {
  authenticated: boolean;
  single_user: boolean;
  user: SessionUser | null;
}

let cached: Session | null = null;
let inflight: Promise<Session> | null = null;
const listeners = new Set<(session: Session) => void>();

async function load(): Promise<Session> {
  const response = await fetch("/api/auth/me", { credentials: "include" });
  const session = (await response.json()) as Session;
  cached = session;
  listeners.forEach((notify) => notify(session));
  return session;
}

/** The answer the server already worked out for *this* request.
 *
 *  A context and not the module cache above: on the server that cache is
 *  shared by every request the process handles, so seeding it would let one
 *  visitor's session decide what another visitor's HTML says. A context value
 *  belongs to one render tree and cannot cross that line.
 *
 *  Its job is only the first frame. Once mounted, the module cache and its
 *  listeners take over, so a sign-out still updates every consumer at once. */
export const SessionSeedContext = createContext<Session | null>(null);

/** Force a re-read — after signing in, out, or changing a password. */
export function refreshSession(): Promise<Session> {
  inflight = load();
  return inflight;
}

export function useSession(): { session: Session | null; loading: boolean } {
  const seed = useContext(SessionSeedContext);
  const initial = cached ?? seed;
  const [session, setSession] = useState<Session | null>(initial);
  const [loading, setLoading] = useState(initial === null);

  useEffect(() => {
    listeners.add(setSession);

    // The seed is a real answer, so adopt it rather than asking again — the
    // request that produced it happened moments ago, server-side.
    if (cached === null && seed !== null) cached = seed;

    if (cached === null) {
      // Share one request between however many components mount together,
      // instead of one each.
      (inflight ??= load())
        .then(setSession)
        .catch(() => {
          // Offline, or the backend is restarting. "Not signed in" is the
          // safe assumption: it hides admin controls rather than showing
          // them to someone whose status we could not confirm.
          setSession({ authenticated: false, single_user: false, user: null });
        })
        .finally(() => {
          inflight = null;
          setLoading(false);
        });
    }

    return () => {
      listeners.delete(setSession);
    };
  }, []);

  return { session, loading };
}
