import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/ui/NavBar";
import AgyHealthBanner from "@/components/ui/AgyHealthBanner";
import AmbientField from "@/components/ui/AmbientField";

// One UI typeface, one for numbers and code. A display serif reads as
// "designed" rather than "built" — real tools don't use one.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Facet",
  description:
    "Search jobs across every major board and tailor a resume, cover letter and recruiter pitch from one honest record. Runs entirely on your machine.",
};

export const viewport: Viewport = {
  themeColor: "#080a10",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn btn-primary"
        >
          Skip to content
        </a>
        {/* Behind everything, and the reason every surface is translucent. */}
        <AmbientField />
        <NavBar />
        <AgyHealthBanner />
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
