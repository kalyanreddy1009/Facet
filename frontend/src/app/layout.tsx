import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/ui/NavBar";
import AgyHealthBanner from "@/components/ui/AgyHealthBanner";
import AmbientField from "@/components/ui/AmbientField";
import SessionSeed from "@/components/ui/SessionSeed";
import { getServerSession } from "@/lib/serverSession";

// One UI typeface, one for numbers and code. A display serif reads as
// "designed" rather than "built" — real tools don't use one.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  // A template, so a route only has to name itself: "The Rough · Facet".
  title: { default: "Facet", template: "%s · Facet" },
  description:
    "Search jobs across every major board and tailor a resume, cover letter and recruiter pitch from one honest record - without inventing a single thing.",
};

export const viewport: Viewport = {
  themeColor: "#eef1f7",
  colorScheme: "light",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Resolved here, once per request, rather than by every client component
  // that needs it — and early enough that the first paint is already right.
  const session = await getServerSession();

  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn btn-primary"
        >
          Skip to content
        </a>
        <SessionSeed session={session}>
          {/* Behind everything, and the reason every surface is translucent. */}
          <AmbientField />
          <NavBar />
          <AgyHealthBanner />
          {/* `tabIndex={-1}` is what makes the skip link actually work. An
              anchor to a plain <div> scrolls in every browser but moves focus
              in none of them, so the next Tab landed back in the nav — the
              link looked right and did nothing for the one person who needs
              it. Not `<main>`: every page renders its own, and two main
              landmarks is worse than none. */}
          <div id="main" tabIndex={-1} className="outline-none">
            {children}
          </div>
        </SessionSeed>
      </body>
    </html>
  );
}
