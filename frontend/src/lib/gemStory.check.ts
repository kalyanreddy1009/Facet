/** Run: node src/lib/gemStory.check.ts */
import assert from "node:assert/strict";
import { GEM_KEYS, clamp01, constellation, gemAt, gemInto, sceneProgress } from "./gemStory.ts";

// The boundaries land exactly on their keyframes, which is the whole contract:
// a scene's start looks like what the keyframe says it looks like.
for (let i = 0; i < GEM_KEYS.length; i++) {
  const got = gemAt(i / (GEM_KEYS.length - 1));
  assert.ok(Math.abs(got.camDist - GEM_KEYS[i].camDist) < 1e-9, `keyframe ${i} camDist`);
  assert.ok(Math.abs(got.beam - GEM_KEYS[i].beam) < 1e-9, `keyframe ${i} beam`);
}

// Continuity: no jump between adjacent samples. A discontinuity here is a
// visible snap in the camera, and it is invisible in the source.
let prev = gemAt(0);
for (let s = 1; s <= 200; s++) {
  const cur = gemAt(s / 200);
  assert.ok(Math.abs(cur.camDist - prev.camDist) < 0.2, `camDist jump at ${s / 200}`);
  assert.ok(Math.abs(cur.spin - prev.spin) < 0.02, `spin jump at ${s / 200}`);
  prev = cur;
}

// Out of range is clamped, not extrapolated: an overscroll must not fly the
// camera through the stone.
assert.deepEqual(gemAt(-1), gemAt(0));
assert.deepEqual(gemAt(4), gemAt(1));

// The camera does pull back over the arc, which is the one thing scene 05 is.
assert.ok(gemAt(0.8).camDist > gemAt(0.2).camDist + 2);

assert.equal(clamp01(-3), 0);
assert.equal(clamp01(0.4), 0.4);
assert.equal(clamp01(9), 1);

// Scene-local progress covers 0..1 inside its own fifth and saturates outside.
assert.equal(sceneProgress(0.2, 1), 0);
assert.equal(sceneProgress(0.4, 1), 1);
assert.equal(sceneProgress(0.05, 1), 0);
assert.equal(sceneProgress(0.9, 1), 1);
assert.ok(Math.abs(sceneProgress(0.3, 1) - 0.5) < 1e-9);

// gemInto writes into the caller's object rather than replacing it — the
// render loop holds that identity for the life of the page.
const live = gemAt(0);
const same = live;
gemInto(live, 1);
assert.equal(live, same);
assert.ok(Math.abs(live.camDist - GEM_KEYS[GEM_KEYS.length - 1].camDist) < 1e-9);

// The constellation stays on screen and spreads: all points inside a generous
// frame, and no two on the same spoke.
const pts = constellation(48);
assert.equal(pts.length, 48);
for (const p of pts) {
  assert.ok(p.x > -35 && p.x < 135, `x out of frame: ${p.x}`);
  assert.ok(p.y > -10 && p.y < 110, `y out of frame: ${p.y}`);
  assert.ok(p.hue >= 0 && p.hue < 6);
}
const angles = new Set(pts.map((p) => Math.round(Math.atan2(p.y - 50, p.x - 50) * 100)));
assert.ok(angles.size > 40, `spokes collapsed: ${angles.size}`);

console.log("gemStory: ok");
