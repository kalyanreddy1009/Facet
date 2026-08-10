import type { Metadata } from "next";
import ProfilePage from "./PageClient";

export const metadata: Metadata = { title: "Your account" };

export default function Page() {
  return <ProfilePage />;
}
