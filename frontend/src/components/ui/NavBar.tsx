"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Activity } from "lucide-react";
import { ENTER, REDUCED } from "@/lib/motion";
import AccountMenu from "@/components/ui/AccountMenu";
import FacetMark from "@/components/ui/FacetMark";
import TabBar from "@/components/ui/TabBar";
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

export default function NavBar() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const { session } = useSession();

  // Single-user mode has no login at all, so the app is always reachable there.
  const inApp = session?.authenticated === true || session?.single_user === true;

  // The auth screens are their own world: brand only. Offering "Find jobs" to
  // someone being asked to sign in is a link that can only bounce them back.
  const bare = pathname === "/login" || pathname === "/set-password";
  const showApp = inApp && !bare;

  // On the landing page the wordmark is doing a different job — it is the
  // product's name to someone who has never seen it, not a home button to
  // someone who lives here. So it is set larger there, and stays quiet
  // everywhere else. The glint, though, runs on every page: the brand should
  // not behave like a different brand once you are signed in.
  const landing = pathname === "/";

  return (
    <>
    <header className="sticky top-0 z-40 nav-shell">
      {/* Three columns rather than space-between: the outer two are equal
          fractions, so the track lands on the optical centre of the island no
          matter how wide the brand or the account control happen to be. With
          space-between it drifts, and a nav that is almost centred reads as a
          mistake rather than as a choice. */}
      <div className="nav-island px-2.5 sm:px-3 grid grid-cols-[auto_1fr_auto] md:grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Link
          href="/"
          className={`group nav-pill shrink-0 justify-self-start text-text ${
            landing ? "gap-2.5 !min-h-[44px] !px-3.5" : "gap-2"
          }`}
        >
          {/* The mark leans into the light on hover — a stone catching it,
              which is the one gesture this brand gets to make. */}
          <span className="nav-mark inline-flex">
            <FacetMark size={landing ? 26 : 18} />
          </span>
          <span
            className={
              landing
                ? "wordmark text-[1.4rem] sm:text-[1.6rem] font-semibold tracking-[-0.035em] leading-none"
                : "wordmark text-[0.95rem] font-semibold tracking-[-0.02em]"
            }
          >
            Facet
          </span>
        </Link>

        {showApp && (
          <nav className="hidden md:flex nav-track justify-self-center" aria-label="Main">
            {LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`nav-pill relative text-sm font-medium ${
                    active ? "nav-pill-on" : "text-text-dim hover:text-text"
                  }`}
                >
                  {/* Every item is already a pane; this is the accent moving
                      across them. It travels as one object rather than four
                      backgrounds taking turns, which is what makes the change
                      of page read as movement instead of a redraw. */}
                  {active && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-[11px] nav-pill-active"
                      transition={reduced ? REDUCED : ENTER}
                    />
                  )}
                  <span className="relative z-10">{link.label}</span>
                </Link>
              );
            })}
          </nav>
        )}

        <div className="flex items-center justify-self-end gap-1.5">
          {showApp && (
            <Link
              href={STATUS_LINK.href}
              aria-current={pathname === STATUS_LINK.href ? "page" : undefined}
              /* Shown at every width now. It used to hide below `md` because
                 the hamburger owned that corner; with the tab bar carrying the
                 four destinations, this is the only thing left up here and it
                 fits. Status is a diagnostic — agy and WeasyPrint — so it
                 belongs in the chrome rather than taking a tab slot. */
              className={`nav-pill nav-pill-sm relative flex items-center gap-1.5 text-xs ${
                pathname === STATUS_LINK.href
                  ? "nav-pill-active nav-pill-on"
                  : "text-text-dim hover:text-text"
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

        </div>
      </div>
    </header>

    {/* Outside the header on purpose. `.nav-shell` is `pointer-events: none`
        so the page stays clickable around the floating island, and a tab bar
        living inside it would have to opt back in for no reason — it is a
        fixed element at the other end of the screen and shares nothing with
        the header but a condition. */}
    <TabBar show={showApp} />
    </>
  );
}
