"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/useSession";

/** agy missing / unauthenticated / out of quota surfaces here, once, instead
 *  of as a confusing failure later when someone tries to cut a facet. */
export default function AgyHealthBanner() {
  const pathname = usePathname();
  const { session } = useSession();
  const [detail, setDetail] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Signed in, or a local single-user checkout. This lives in the root
  // layout, so it mounts on the landing and sign-in pages too — where
  // /api/agy/health is a 401, and a 401 used to navigate the browser to
  // "your session has ended". Someone halfway through setting a first
  // password was thrown off the page, with the token that got them there
  // gone from the URL. It is also just a pointless request: nobody who
  // cannot sign in yet needs to be told the AI engine is unreachable.
  const signedIn = session?.authenticated === true || session?.single_user === true;

  useEffect(() => {
    if (!signedIn) return;
    // The backend being down is the AgyHealthBanner's business to stay quiet
    // about — pages surface that themselves when their own calls fail.
    api.agyHealth().then((res) => !res.available && setDetail(res.detail)).catch(() => {});
  }, [signedIn]);

  // v2 pages surface agy health their own way rather than sharing v1's banner.
  if (pathname.startsWith("/v2")) return null;

  if (!detail || dismissed) return null;

  return (
    <div className="bg-warn-soft border-b border-warn-border text-warn-text">
      <div className="max-w-shell mx-auto px-5 sm:px-8 py-2 flex items-center gap-2.5 text-sm">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
        <p className="flex-1">
          Facet&apos;s AI engine isn&apos;t reachable ({detail}). Job search and the Cabinet work
          normally; cutting a facet won&apos;t until it&apos;s fixed.
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 hover:text-text focus-visible:text-text transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
