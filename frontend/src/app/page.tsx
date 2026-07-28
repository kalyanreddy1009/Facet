"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import LandingContent from "@/components/landing/LandingContent";

/**
 * Fresh install (no profile.json) → the landing page.
 * Existing install → straight to job search; the landing page stays reachable
 * at /welcome, since it isn't the thing you want to sit through every morning.
 */
export default function RootPage() {
  const router = useRouter();
  const [showLanding, setShowLanding] = useState(false);

  useEffect(() => {
    api.profileExists().then((exists) => {
      if (exists) router.replace("/rough");
      else setShowLanding(true);
    });
  }, [router]);

  // Blank while deciding — a landing page that flashes and vanishes is worse
  // than a beat of nothing.
  if (!showLanding) return <main className="min-h-screen" />;

  return <LandingContent />;
}
