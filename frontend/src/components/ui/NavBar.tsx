"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, Menu, X } from "lucide-react";
import { ENTER, REDUCED } from "@/lib/motion";

const LINKS = [
  { href: "/rough", label: "Find jobs" },
  { href: "/tailor", label: "Cut a facet" },
  { href: "/cabinet", label: "Cabinet" },
  { href: "/stone", label: "Your stone" },
  { href: "/welcome", label: "About" },
];

// Utility destination, not a primary one — sits apart from the main nav and
// only appears in the mobile menu at the end. Deliberately does NOT poll
// /api/status from every page: that report does real work on each call.
const STATUS_LINK = { href: "/status", label: "Status" };

/** Monochrome — it inherits text colour like every other icon in the app. */
function FacetMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2 22 9l-3.8 12H5.8L2 9l10-7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M2 9h20" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 chrome border-x-0 border-t-0">
      <div className="max-w-shell mx-auto h-nav px-5 sm:px-8 flex items-center justify-between gap-6">
        <Link
          href="/rough"
          className="flex items-center gap-2 shrink-0 text-text"
          onClick={() => setOpen(false)}
        >
          <FacetMark />
          <span className="text-sm font-semibold tracking-tight">Facet</span>
        </Link>

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

        <div className="flex items-center gap-1">
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

          <button
            onClick={() => setOpen((o) => !o)}
            className="btn btn-ghost md:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="md:hidden border-t border-border px-5 py-2 flex flex-col" aria-label="Main">
          {[...LINKS, STATUS_LINK].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              aria-current={pathname === link.href ? "page" : undefined}
              className={`py-2 text-sm ${
                pathname === link.href ? "text-text font-medium" : "text-text-dim"
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
