import type { Metadata } from "next";
import LoginPage from "./PageClient";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return <LoginPage />;
}
