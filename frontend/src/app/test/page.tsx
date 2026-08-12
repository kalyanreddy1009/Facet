import type { Metadata } from "next";
import StoryHero from "@/components/landing/StoryHero";

export const metadata: Metadata = {
  title: { absolute: "Hero test - Facet" },
  // Not a page anyone should reach from a search result: it is a proving
  // ground for one component, and it says nothing true about the product.
  robots: { index: false, follow: false },
};

/** The landing narrative — five scenes over one continuous WebGL scene — in
 *  isolation. Nothing on this route is imported by the live landing page, so
 *  it can be changed, broken or deleted without touching what visitors see.
 *  `TestHero` is still there beside it: that is the stone with its tuning
 *  knobs exposed, which is the right page when the question is about the
 *  render rather than about the story. */
export default function TestPage() {
  return <StoryHero />;
}
