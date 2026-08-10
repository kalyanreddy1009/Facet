import type { Metadata } from "next";
import CabinetPage from "./PageClient";

export const metadata: Metadata = { title: "The Cabinet" };

export default function Page() {
  return <CabinetPage />;
}
