"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, Menu, X } from "lucide-react";
import { ENTER, REDUCED } from "@/lib/motion";
import AccountMenu from "@/components/ui/AccountMenu";
import { useSession } from "@/lib/useSession";

const LINKS = [
  { href: "/rough", label: "Find jobs" },
  { href: "/tailor", label: "Cut a facet" },
  { href: "/cabinet", label: "Cabinet" },
  { href: "/stone", label: "Your stone" },
];

// Utility destination, not a primary one — sits apart from the main nav and
// only appears in the mobile menu at the end. Deliberately does NOT poll
// /api/status from every page: that report does real work on each call.
const STATUS_LINK = { href: "/status", label: "Status" };

/** Monochrome — it inherits text colour like every other icon in the app.
 *  Sized by the caller: 17px inside the app, larger on the landing page,
 *  where the name is the page's first line rather than a way back. */
function FacetMark({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2 22 9l-3.8 12H5.8L2 9l10-7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M2 9h20" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {/* The centre facet. Enough to read as a cut stone at 17px rather than
          a generic pentagon. */}
      <path
        d="m12 2-3.4 7L12 21l3.4-12L12 2Z"
        stroke="currentColor"
        strokeWidth="0.75"
        opacity="0.4"
      />
    </svg>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const { session } = useSession();
  const [open, setOpen] = useState(false);

  // Single-user mode has no login at all, so the app is always reachable there.
  const inApp = session?.authenticated === true || session?.single_user === true;

  // The auth screens are their own world: brand only. Offering "Find jobs" to
  // someone being asked to sign in is a link that can only bounce them back.
  const bare = pathname === "/login" || pathname === "/set-password";
  const showApp = inApp && !bare;

  // On the landing page the wordmark is doing a different job — it is the
  // product's name to someone who has never seen it, not a home button to
  // someone who lives here. So it is set larger and lit there, and stays
  // quiet everywhere else.
  const landing = pathname === "/";

  return (
    <header className="sticky top-0 z-40 chrome border-x-0 border-t-0">
      <div className="max-w-shell mx-auto h-nav px-5 sm:px-8 flex items-center justify-between gap-6">
        <Link
          href={inApp ? "/rough" : "/"}
          className={`flex items-center shrink-0 text-text transition-opacity duration-fast hover:opacity-80 ${
            landing ? "gap-2.5" : "gap-2"
          }`}
        >
          <FacetMark size={landing ? 26 : 17} />
          <span
            className={
              landing
                ? "wordmark text-2xl sm:text-[1.75rem] font-semibold tracking-[-0.03em] leading-none"
                : "text-sm font-semibold tracking-tight"
            }
          >
            Facet
          </span>
        </Link>

        {showApp && (
          <nav className="hidden md:flex items-center gap-0.5" aria-label="Main">
            {LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className="relative px-3 py-2 text-sm font-medium transition-colors duration-fast"
                >
                  {active && (
                    <motion.span
                      layoutId="nav-underline"
                      className="absolute inset-x-2 -bottom-px h-px bg-accent"
                      transition={reduced ? REDUCED : ENTER}
                    />
                  )}
                  <span className={active ? "text-text" : "text-text-dim hover:text-text"}>
                    {link.label}
                  </span>
                </Link>
              );
            })}
          </nav>
        )}

        <div className="flex items-center gap-1.5">
          {showApp && (
            <Link
              href={STATUS_LINK.href}
              aria-current={pathname === STATUS_LINK.href ? "page" : undefined}
              className={`hidden md:flex items-center gap-1.5 px-2.5 h-7 rounded text-xs transition-colors duration-fast ${
                pathname === STATUS_LINK.href
                  ? "text-text bg-surface-2"
                  : "text-text-faint hover:text-text-dim"
              }`}
            >
              <Activity className="w-3.5 h-3.5" aria-hidden />
              {STATUS_LINK.label}
            </Link>
          )}

          <AccountMenu />

          {/* Signed out, on the landing page: the nav's job is to offer the one
              action there is. Waits for `session` rather than assuming — a
              "Sign in" button that appears and then vanishes for someone who
              was already signed in reads as a glitch. Suppressed on /login,
              where it would point at the page you are looking at. */}
          {session && !inApp && !bare && (
            <Link href="/login" className="btn btn-primary btn-sm">
              Sign in
            </Link>
          )}

          {showApp && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="btn btn-ghost md:hidden"
              aria-expanded={open}
              aria-label={open ? "Close menu" : "Open menu"}
            >
              {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {open && showApp && (
        <nav className="md:hidden border-t border-border px-5 py-2 flex flex-col" aria-label="Main">
          {[...LINKS, STATUS_LINK].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              // Closed here rather than in an effect on `pathname`: tapping
              // the link you are already on does not change the route, and a
              // menu that stays open in that one case reads as a stuck menu.
              onClick={() => setOpen(false)}
              aria-current={pathname === link.href ? "page" : undefined}
              className={`py-2.5 text-sm transition-colors duration-fast ${
                pathname === link.href ? "text-text font-medium" : "text-text-dim hover:text-text"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
