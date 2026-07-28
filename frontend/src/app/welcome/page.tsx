import LandingContent from "@/components/landing/LandingContent";

/**
 * The landing page's content, always shown, no fresh-install redirect check.
 * "/" auto-redirects an existing install straight to /tailor (Section 12.8
 * says that's not the thing you sit through every morning) — this route is
 * how the marketing/explainer page "stays reachable any time via a nav
 * link" without that link immediately bouncing you back to /tailor.
 */
export default function WelcomePage() {
  return <LandingContent />;
}
