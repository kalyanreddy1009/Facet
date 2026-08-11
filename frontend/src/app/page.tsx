import type { Metadata } from "next";
import LandingContent from "@/components/landing/LandingContent";

/** Every route names its own tab; this one names it in full. */
export const metadata: Metadata = {
  // Absolute: the landing page is the product's name, not "Home · Facet".
  title: { absolute: "Facet - one stone, a facet for every job" },
};

/**
 * The domain root is the product page, for everyone, always.
 *
 * It used to ask the backend whether a profile existed and bounce you to
 * /rough — which, once Facet grew a login, meant the first request a stranger
 * made was a 401 and the first thing they saw was a password box for a product
 * nobody had told them anything about. A landing page that only appears when
 * you are already signed in is not a landing page.
 *
 * So: no redirect, no session check, no API call before paint. A static server
 * component. Where the buttons *point* is the only thing that depends on who
 * you are, and `LandingContent` resolves that per visitor without gating the
 * page on the answer.
 */
export default function RootPage() {
  return <LandingContent />;
}
