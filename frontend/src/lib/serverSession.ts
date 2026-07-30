/**
 * Who is signed in, answered on the server, before the first byte of HTML.
 *
 * The client hook (`useSession`) can only answer after a round trip, which
 * meant the first paint of every page was rendered as "nobody": no nav links,
 * no account menu, and a "Sign in" button on the landing page — all of which
 * then swapped a moment later. That flip is what a user reads as the app
 * being glitchy, and it got worse when `/` became the page you land on after
 * signing in, because then everyone saw it on the way in.
 *
 * So the layout asks here instead, and seeds the client cache with the answer.
 * The cost is that pages using it are dynamic rather than prerendered — which
 * they effectively were anyway, since none of them were correct until the
 * client had fetched.
 */

import { cookies, headers } from "next/headers";

import type { Session } from "./useSession";

const SIGNED_OUT: Session = { authenticated: false, single_user: false, user: null };

const backendOrigin = process.env.BACKEND_ORIGIN || "http://localhost:8000";

export async function getServerSession(): Promise<Session> {
  const cookie = (await cookies()).toString();

  try {
    const response = await fetch(`${backendOrigin}/api/auth/me`, {
      headers: {
        cookie,
        // Multi-user identity is resolved from the session cookie, but the
        // backend logs and rate-limits by host — forwarding it keeps the
        // server-side request indistinguishable from the browser's own.
        host: (await headers()).get("host") || "",
      },
      cache: "no-store",
    });
    if (!response.ok) return SIGNED_OUT;
    return (await response.json()) as Session;
  } catch {
    // Backend restarting, or not up yet. "Signed out" is the safe answer: it
    // hides controls rather than showing someone else's.
    return SIGNED_OUT;
  }
}
