import type { Metadata } from "next";
import StatusPage from "./PageClient";

/* The screen itself is a client component — it holds state, effects and event
   handlers — and a client component cannot export `metadata`. So the route is
   this three-line server file: it names the tab and renders the client. Every
   page read "Facet" in the tab strip before this. */
export const metadata: Metadata = { title: "Service status" };

export default function Page() {
  return <StatusPage />;
}
