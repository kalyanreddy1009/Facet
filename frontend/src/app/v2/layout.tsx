import type { Metadata } from "next";
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./v2.css";
import Sidebar from "@/components-v2/Sidebar";

const serif = Newsreader({ subsets: ["latin"], variable: "--v2-font-serif", display: "swap" });
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--v2-font-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--v2-font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Facet — v2", template: "%s · Facet v2" },
};

/**
 * v2's own root, nested inside the real root layout (`app/layout.tsx`), which
 * still supplies `<html>`/`<body>`, the skip link, and session seeding — all
 * of that is plumbing, not visual design, so it is reused rather than forked.
 * What v1's layout adds on top of that plumbing (`NavBar`, `AmbientField`,
 * `AgyHealthBanner`) is v1's *visual* chrome, so those three components each
 * early-return null on a `/v2` pathname and this layout supplies its own.
 */
export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`v2-root ${serif.variable} ${sans.variable} ${mono.variable}`}>
      <div className="v2-shell">
        <Sidebar />
        {children}
      </div>
    </div>
  );
}
