import type { Metadata } from "next";
import ProfilePage from "./PageClient";

/* The screen itself is a client component — it holds state, effects and event
   handlers — and a client component cannot export `metadata`. So the route is
   this three-line server file: it names the tab and renders the client. Every
   page read "Facet" in the tab strip before this. */
export const metadata: Metadata = { title: "Your account" };

export default function Page() {
  return <ProfilePage />;
}
