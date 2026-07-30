"use client";

/**
 * The account menu in the top-right corner.
 *
 * Standard shape, deliberately: name, then Profile / Admin / Sign out. People
 * already know where this lives and what is in it, and a job-search tool is
 * not the place to be inventive about where the sign-out button is.
 *
 * The Admin entry renders only for administrators. That is presentation —
 * every /api/admin route checks the same flag server-side and answers 404
 * otherwise, which `scripts/test_admin.py` proves by calling them as an
 * ordinary user.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { LogOut, Shield, User as UserIcon } from "lucide-react";

import { clearApiCache } from "@/lib/api";
import { ENTER, EXIT, REDUCED } from "@/lib/motion";
import { refreshSession, useSession } from "@/lib/useSession";

export default function AccountMenu() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. Without both, a menu opened by
  // keyboard can only be closed by opening something else.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Single-user mode has no account to manage, and nobody to sign out as.
  if (!session || session.single_user || !session.authenticated || !session.user) {
    return null;
  }

  const user = session.user;
  const initial = (user.display_name || user.email).trim().charAt(0).toUpperCase();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    // Reads this tab has cached in memory belong to the session that just
    // ended. Nothing sensitive survives a reload, but the next person to sign
    // in on this tab must not see a frame of the last person's Cabinet.
    clearApiCache();
    await refreshSession();
    router.replace("/login");
  }

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${user.display_name}`}
        className="nav-pill nav-pill-sm gap-2 !pl-1 !pr-2.5 text-xs text-text-dim hover:text-text"
      >
        <span
          aria-hidden
          className="grid place-items-center w-[22px] h-[22px] rounded-full bg-accent-soft text-accent-text text-[10.5px] font-semibold ring-1 ring-accent-border"
        >
          {initial}
        </span>
        <span className="hidden sm:inline max-w-[10rem] truncate">
          {user.display_name}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={reduced ? false : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: reduced ? REDUCED : EXIT }}
            transition={reduced ? REDUCED : ENTER}
            // Scales from the button it belongs to, not from its own middle.
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 mt-2 w-60 rounded-2xl glass py-1.5 z-50 overflow-hidden"
          >
            <div className="px-3 py-2.5 border-b border-border">
              <p className="text-sm font-medium truncate">{user.display_name}</p>
              {/* The address, because on a shared deployment "which account am
                  I in" is a real question the display name may not answer. */}
              <p className="text-xs text-text-faint truncate">{user.email}</p>
            </div>

            <Link
              href="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-text-dim hover:text-text hover:bg-surface-3 transition-colors duration-fast"
            >
              <UserIcon className="w-4 h-4" aria-hidden />
              Your profile
            </Link>

            {user.is_admin && (
              <Link
                href="/admin"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-text-dim hover:text-text hover:bg-surface-3 transition-colors duration-fast"
              >
                <Shield className="w-4 h-4" aria-hidden />
                Manage users
              </Link>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-dim hover:text-text hover:bg-surface-3 transition-colors duration-fast border-t border-border mt-1"
            >
              <LogOut className="w-4 h-4" aria-hidden />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
