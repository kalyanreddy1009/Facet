import type { Metadata } from "next";
import AdminPage from "./PageClient";

export const metadata: Metadata = { title: "People" };

export default function Page() {
  return <AdminPage />;
}
