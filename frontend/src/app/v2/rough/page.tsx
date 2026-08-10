import type { Metadata } from "next";
import RoughPage from "./PageClient";

export const metadata: Metadata = { title: "The Rough" };

export default function Page() {
  return <RoughPage />;
}
