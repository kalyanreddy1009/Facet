/**
 * The one property that matters: the animation never shows a number the
 * backend did not report. Endpoints exact, no overshoot, monotonic travel.
 *
 *   node src/lib/countUp.check.ts
 */

import assert from "node:assert/strict";
import { countUpFrame, easeOutCubic } from "./countUp.ts";

// Endpoints are exact in both directions — the last frame is the true figure.
assert.equal(countUpFrame(0, 100, 0, 600), 0);
assert.equal(countUpFrame(0, 100, 600, 600), 100);
assert.equal(countUpFrame(0, 100, 9_999, 600), 100, "past the end holds at the target");
assert.equal(countUpFrame(100, 4, 600, 600), 4, "counts down as well as up");

// A zero-length travel is the reduced-motion / instant case, not a divide by
// zero: it must land rather than produce NaN.
assert.equal(countUpFrame(3, 9, 0, 0), 9);

// Monotonic and never outside the interval — an overshoot on a status page
// reads as a real spike that never happened.
let previous = -Infinity;
for (let t = 0; t <= 600; t += 25) {
  const v = countUpFrame(20, 80, t, 600);
  assert.ok(v >= previous, `travel went backwards at ${t}ms`);
  assert.ok(v >= 20 && v <= 80, `overshot the interval at ${t}ms: ${v}`);
  previous = v;
}

// Ease-out: more than half the distance is covered in the first half.
assert.ok(easeOutCubic(0.5) > 0.5);
assert.equal(easeOutCubic(0), 0);
assert.equal(easeOutCubic(1), 1);

console.log("countUp: endpoints exact, monotonic, no overshoot, ease-out front-loaded");
