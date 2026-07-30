"use client";

import { SessionSeedContext, type Session } from "@/lib/useSession";

/** Hands the server's answer about who is signed in down to the client
 *  components that need it, so the first frame is already correct.
 *
 *  Wraps the tree rather than writing to the shared module cache: on the
 *  server that cache belongs to the whole process, and one visitor's session
 *  must never decide what another visitor's page says. */
export default function SessionSeed({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  return <SessionSeedContext.Provider value={session}>{children}</SessionSeedContext.Provider>;
}
