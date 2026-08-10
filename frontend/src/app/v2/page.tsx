import type { Metadata } from "next";
import Link from "next/link";
import { Gem, Search, Scissors, Archive } from "lucide-react";

export const metadata: Metadata = {
  title: { absolute: "Facet v2 — one stone, a facet for every job" },
};

const STEPS = [
  { icon: Gem, title: "The Stone", body: "Your real background — one honest record nothing gets invented from.", href: "/v2/stone" },
  { icon: Search, title: "The Rough", body: "The raw pool of postings you're pulling from.", href: "/v2/rough" },
  { icon: Scissors, title: "Cut a Facet", body: "A resume, cover letter and pitch tailored to one job.", href: "/v2/tailor" },
  { icon: Archive, title: "The Cabinet", body: "Every cut facet, tracked.", href: "/v2/cabinet" },
];

/** v2's landing: no hero animation, no ambient field — a masthead line and a
 *  four-item table of contents, set as a list rather than a card grid. Same
 *  non-gating rule as v1's `/`: static, no session check before paint. */
export default function V2Landing() {
  return (
    <main className="v2-main">
      <p className="v2-eyebrow">Facet — local job search</p>
      <h1 className="v2-h1" style={{ marginTop: "0.5rem" }}>
        One stone. A facet for every job.
      </h1>
      <p className="v2-lede" style={{ marginTop: "1rem", maxWidth: "38rem" }}>
        Search postings, keep one truthful record of your background, and cut a tailored resume,
        cover letter and recruiter pitch from it — without inventing anything.
      </p>

      <div style={{ marginTop: "2.5rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <Link href="/v2/login" className="v2-btn v2-btn-primary">
          Sign in
        </Link>
        <Link href="/" className="v2-btn">
          Back to v1
        </Link>
      </div>

      <ol style={{ marginTop: "3rem", display: "flex", flexDirection: "column" }}>
        {STEPS.map(({ icon: Icon, title, body, href }, i) => (
          <li key={href} className="v2-row" style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
            <span className="v2-mono" style={{ color: "var(--v2-text-faint)", minWidth: "1.5rem" }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <Icon className="w-5 h-5 mt-0.5" style={{ color: "var(--v2-accent)" }} aria-hidden />
            <div>
              <Link href={href} className="v2-h2" style={{ fontSize: "1.05rem", display: "block" }}>
                {title}
              </Link>
              <p className="v2-lede" style={{ marginTop: "0.15rem" }}>
                {body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
