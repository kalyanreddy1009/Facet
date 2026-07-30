import type { Metadata } from "next";
import SetPasswordPage from "./PageClient";

/* The screen itself is a client component — it holds state, effects and event
   handlers — and a client component cannot export `metadata`. So the route is
   this three-line server file: it names the tab and renders the client. Every
   page read "Facet" in the tab strip before this. */
export const metadata: Metadata = { title: "Set your password" };

export default function Page() {
  return <SetPasswordPage />;
}
