import type { Metadata } from "next";
import SetPasswordPage from "./PageClient";

export const metadata: Metadata = { title: "Set your password" };

export default function Page() {
  return <SetPasswordPage />;
}
