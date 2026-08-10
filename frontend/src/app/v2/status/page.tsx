import type { Metadata } from "next";
import StatusPage from "./PageClient";

export const metadata: Metadata = { title: "Service status" };

export default function Page() {
  return <StatusPage />;
}
