import type { Metadata } from "next";
import TailorPage from "./PageClient";

export const metadata: Metadata = { title: "Cut a facet" };

export default function Page() {
  return <TailorPage />;
}
