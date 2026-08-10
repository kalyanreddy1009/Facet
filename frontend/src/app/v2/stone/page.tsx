import type { Metadata } from "next";
import StonePage from "./PageClient";

export const metadata: Metadata = { title: "Your Stone" };

export default function Page() {
  return <StonePage />;
}
