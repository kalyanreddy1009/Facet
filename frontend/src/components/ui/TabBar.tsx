"use client";

/**
 * The four destinations, on a phone.
 *
 * This replaces a hamburger menu, and the reason is not fashion. Apple's HIG
 * is blunt about it — a tab bar is the idiom for a small, flat set of peer
 * destinations, and a menu is what you reach for when they do not fit. Facet
 * has exactly four, they are peers, and they never change. Putting them behind
 * a button meant two taps to reach any of them and no indication of where you
 * were until you opened it.
 *
 * WHY FOUR AND NOT FIVE. Status is a diagnostic, not a place — it reports on
 * agy and WeasyPrint. It stays in the header, where it now shows at every
 * width rather than hiding below `md`, because removing the hamburger freed
 * exactly the room it needed. A tab bar earns its keep by being the same four
 * things every time; a fifth slot for something you visit twice a year is how
 * that stops being true.
 *
 * THE ICONS ARE THE APP'S OWN. Stone, Rough, Facet, Cabinet are drawn from the
 * gem geometry in FacetIcons rather than taken from a general icon set, so the
 * tab bar names the product's four nouns in the product's own hand.
 *
 * SAFE AREA. `padding-bottom: env(safe-area-inset-bottom)` keeps the row clear
 * of the home indicator. The bar's own height is added to the document's
 * bottom padding in globals.css, so the last row of a list is reachable
 * instead of sitting permanently underneath this.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CabinetIcon, FacetIcon, RoughIcon, StoneIcon } from "@/components/ui/FacetIcons";

const TABS = [
  { href: "/rough", label: "Rough", icon: RoughIcon },
  { href: "/tailor", label: "Cut", icon: FacetIcon },
  { href: "/cabinet", label: "Cabinet", icon: CabinetIcon },
  { href: "/stone", label: "Stone", icon: StoneIcon },
];

export default function TabBar({ show }: { show: boolean }) {
  const pathname = usePathname();
  if (!show) return null;

  return (
    /* No `md:hidden` here. `.tab-bar` is unlayered CSS and Tailwind's
       utilities live in `@layer utilities`, so an unlayered `display: grid`
       beats a layered `display: none` no matter the specificity — the bar
       stayed visible at 1440px. The breakpoint is in globals.css instead. */
    <nav className="tab-bar" aria-label="Main">
      {TABS.map(({ href, label, icon: Icon }) => {
        // Prefix matching, not equality: /tailor and a future /tailor/[id]
        // are the same destination as far as "where am I" is concerned, and a
        // tab bar that goes blank on a detail screen is a tab bar that has
        // stopped answering its only question.
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`tab-item ${active ? "tab-item-on" : ""}`}
          >
            <Icon className="tab-icon" />
            <span className="tab-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
