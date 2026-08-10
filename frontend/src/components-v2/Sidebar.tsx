"use client";

/** V2's structural answer to v1's floating top nav: a fixed left rail, always
 *  present once signed in. Where v1 centres a pill island and lets the page
 *  scroll under it, v2 pins navigation to the edge and gives the page its own
 *  full-height column — the "different structural arrangement" the brief asks
 *  for, not a recolour of the same header. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Gem, Search, Scissors, Archive, User, Activity, Shield } from "lucide-react";
import { useSession } from "@/lib/useSession";
import VersionToggle from "@/components-v2/VersionToggle";

const LINKS = [
  { href: "/v2/rough", label: "Rough", icon: Search },
  { href: "/v2/tailor", label: "Cut a Facet", icon: Scissors },
  { href: "/v2/cabinet", label: "Cabinet", icon: Archive },
  { href: "/v2/stone", label: "Stone", icon: Gem },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { session } = useSession();
  const inApp = session?.authenticated === true || session?.single_user === true;
  const bare = pathname === "/v2/login" || pathname === "/v2/set-password";

  if (bare) {
    return (
      <div className="v2-bare-topbar">
        <Link href="/v2" className="v2-wordmark">
          <LayoutGrid className="w-5 h-5" aria-hidden />
          Facet <span className="v2-wordmark-tag">v2</span>
        </Link>
        <VersionToggle pathname={pathname} />
      </div>
    );
  }

  if (!inApp) return null;

  return (
    <aside className="v2-sidebar">
      <Link href="/v2" className="v2-wordmark">
        <LayoutGrid className="w-5 h-5" aria-hidden />
        Facet <span className="v2-wordmark-tag">v2</span>
      </Link>

      <nav className="v2-sidebar-nav" aria-label="Main">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`v2-sidebar-link ${active ? "v2-sidebar-link-on" : ""}`}>
              <Icon className="w-4 h-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="v2-sidebar-foot">
        <Link href="/v2/status" className={`v2-sidebar-link v2-sidebar-link-sm ${pathname === "/v2/status" ? "v2-sidebar-link-on" : ""}`}>
          <Activity className="w-4 h-4" aria-hidden />
          Status
        </Link>
        <Link href="/v2/profile" className={`v2-sidebar-link v2-sidebar-link-sm ${pathname === "/v2/profile" ? "v2-sidebar-link-on" : ""}`}>
          <User className="w-4 h-4" aria-hidden />
          Profile
        </Link>
        {session?.user?.is_admin && (
          <Link href="/v2/admin" className={`v2-sidebar-link v2-sidebar-link-sm ${pathname === "/v2/admin" ? "v2-sidebar-link-on" : ""}`}>
            <Shield className="w-4 h-4" aria-hidden />
            Admin
          </Link>
        )}
        <VersionToggle pathname={pathname} />
      </div>
    </aside>
  );
}
