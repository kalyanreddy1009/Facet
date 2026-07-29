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
import { LogOut, Shield, User as UserIcon } from "lucide-react";

import { refreshSession, useSession } from "@/lib/useSession";

export default function AccountMenu() {
  const router = useRouter();
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
    await refreshSession();
    router.replace("/login");
  }

  return (
    <div className="relative" ref={wrapper}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${user.display_name}`}
        className="flex items-center gap-2 px-1.5 h-7 rounded text-xs text-text-faint hover:text-text-dim transition-colors duration-fast"
      >
        <span
          aria-hidden
          className="grid place-items-center w-6 h-6 rounded-full bg-surface-3 text-text text-[11px] font-medium"
        >
          {initial}
        </span>
        <span className="hidden sm:inline max-w-[10rem] truncate">
          {user.display_name}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1.5 w-60 rounded-md border border-border bg-surface-2 shadow-lg py-1 z-50"
        >
          <div className="px-3 py-2 border-b border-border">
            <p className="text-sm font-medium truncate">{user.display_name}</p>
            {/* The address, because on a shared deployment "which account am
                I in" is a real question and the display name may not answer it. */}
            <p className="text-xs text-text-faint truncate">{user.email}</p>
          </div>

          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-text-dim hover:text-text hover:bg-surface-3"
          >
            <UserIcon className="w-4 h-4" aria-hidden />
            Your profile
          </Link>

          {user.is_admin && (
            <Link
              href="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-text-dim hover:text-text hover:bg-surface-3"
            >
              <Shield className="w-4 h-4" aria-hidden />
              Manage users
            </Link>
          )}

          <button
            role="menuitem"
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-dim hover:text-text hover:bg-surface-3 border-t border-border mt-1"
          >
            <LogOut className="w-4 h-4" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
