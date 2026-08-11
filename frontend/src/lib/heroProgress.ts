/**
 * How far through the pinned hero the page has scrolled, as 0 → 1.
 *
 * This is four lines of arithmetic and it lives in its own file because it was
 * not four lines of arithmetic before. Framer's `useScroll({ target, offset:
 * ["start start", "end end"] })` on this layout returned a progress that rose
 * and then *fell* again — 0 → 0.39 → 0.25 → 0.14 across a monotonic downward
 * scroll — which put the masthead at 43% opacity at the exact position it was
 * supposed to be fully settled, and left the scroll hint on screen underneath
 * the finished copy. A sticky child inside the measured target is the usual
 * suspect, but the point is that the failure was silent and cost a full
 * build-and-screenshot round to even see.
 *
 * So the number is computed here, from the section's own rect, and asserted in
 * `heroProgress.check.ts`. Anything that depends on it is now debuggable by
 * reading one function.
 */

/**
 * @param top     the section's `getBoundingClientRect().top`, so negative once
 *                its top edge has passed the top of the viewport
 * @param height  the section's height
 * @param viewport the viewport height — the pinned stage's height, which is
 *                the part of the section that is never scrolled *past*
 */
export function heroProgress(top: number, height: number, viewport: number): number {
  // A section no taller than the viewport has no travel to report. Returning 1
  // rather than 0 matters: it means "the hero is finished", so a short window
  // shows the settled state instead of freezing on the first frame of an
  // animation that can never advance.
  const range = height - viewport;
  if (range <= 0) return 1;
  const raw = -top / range;
  return raw < 0 ? 0 : raw > 1 ? 1 : raw;
}
