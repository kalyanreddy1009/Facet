/** Runnable self-check for the hero's scroll mapping:  npm run check
 *  Node 22.6+ strips the types itself — no test framework, no build step.
 *
 *  The property that actually broke in the browser was monotonicity: the
 *  library's version rose and then fell over a single downward scroll, so the
 *  masthead un-arrived halfway through phase two. That is the first thing
 *  asserted here, over the whole travel, because it is the one failure that
 *  looks like a rendering glitch rather than like a bug.
 */

import { heroProgress } from "./heroProgress.ts";

let failed = 0;
function ok(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

const VIEWPORT = 900;
const HEIGHT = 220 * (VIEWPORT / 100); // the stage is 220svh
const RANGE = HEIGHT - VIEWPORT;

// The ends.
ok(heroProgress(0, HEIGHT, VIEWPORT) === 0, "unscrolled hero reports 0");
ok(heroProgress(-RANGE, HEIGHT, VIEWPORT) === 1, "fully scrolled hero reports 1");
ok(Math.abs(heroProgress(-RANGE / 2, HEIGHT, VIEWPORT) - 0.5) < 1e-9, "half way reports 0.5");

// Monotonic across the whole travel, which is the regression this file exists
// for: a phase that arrives must never partly leave again on the way down.
let previous = -1;
for (let scrolled = 0; scrolled <= RANGE; scrolled += 17) {
  const value = heroProgress(-scrolled, HEIGHT, VIEWPORT);
  ok(value >= previous, `progress fell at ${scrolled}px: ${value} < ${previous}`);
  previous = value;
}

// Clamped outside the section, in both directions. Above it the page is not in
// the hero yet; below it the hero is over and must stay settled rather than
// running past the end of every range mapped onto it.
ok(heroProgress(400, HEIGHT, VIEWPORT) === 0, "above the section clamps to 0");
ok(heroProgress(-RANGE - 5000, HEIGHT, VIEWPORT) === 1, "past the section clamps to 1");

// A viewport taller than the stage has no travel: report the settled state, not
// the opening frame of an animation that can never advance.
ok(heroProgress(0, 600, 900) === 1, "no travel reports the finished state");
ok(heroProgress(0, 900, 900) === 1, "exactly one viewport reports the finished state");

if (failed) {
  console.error(`hero progress: ${failed} failed`);
  process.exit(1);
}
console.log("hero progress: ends, midpoint, monotonic travel, clamping, degenerate viewport");
