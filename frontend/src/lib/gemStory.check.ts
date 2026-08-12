/** Run: node src/lib/gemStory.check.ts */
import assert from "node:assert/strict";
import { GEM_KEYS, clamp01, gemAt, gemInto, sceneProgress } from "./gemStory.ts";

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

// The Bifröst is the ending and only the ending: no bridge anywhere in the
// first four scenes, opening through the fifth, at strength at the very end.
// A stray arc earlier would be a rainbow over the matching scene.
for (let s = 0; s <= 0.8001; s += 0.02) {
  assert.ok(gemAt(s).arc < 1e-9, `arc leaked at ${s}`);
}
let prevArc = 0;
for (let s = 0.8; s <= 1.0001; s += 0.01) {
  const arc = gemAt(Math.min(1, s)).arc;
  assert.ok(arc >= prevArc - 1e-9, `arc dips at ${s}`);
  prevArc = arc;
}
assert.ok(gemAt(1).arc > 1, "the bridge never reaches strength");

// And the camera is far enough back to have a bridge in frame at all: the
// sheet runs twenty units out, and from nine units away only its mouth is on
// screen. This is the one coupling between the two files worth asserting.
assert.ok(gemAt(1).camDist > 13, "too close for the bridge to read");

console.log("gemStory: ok");
