/** Runnable self-check for the stone's optics:  npm run check
 *  Node 22.6+ strips the types itself — no test framework, no build step.
 *
 *  The landing page prints these numbers next to a drawing generated from the
 *  same call, so the failure this guards against is not a crash: it is the
 *  study quietly showing a beam bouncing while the readout says it leaked, on
 *  a page whose entire argument is that it never claims anything it can't
 *  support. Each assertion below is a fact about diamond, not about the code.
 */

import { CRITICAL_ANGLE, INDEX, brightestLimit, traceStone } from "./optics.ts";

let failed = 0;
function ok(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) < tol;

function demo() {
  // 1. The critical angle is a property of the material, and it is the number
  //    the whole study turns on. asin(1/2.417) = 24.44°.
  ok(near(CRITICAL_ANGLE, 24.44, 0.01), `critical angle should be 24.44°, got ${CRITICAL_ANGLE}`);
  ok(INDEX === 2.417, "index should be diamond's");

  // 2. Snell, at a hand-checkable angle. sin(30°)/2.417 = 0.2069 → 11.94°.
  const thirty = traceStone(30);
  ok(near(thirty.refracted, 11.94, 0.01), `30° should refract to 11.94°, got ${thirty.refracted}`);

  // 3. Light entering the table can never travel more than the critical angle
  //    off the vertical, however steeply it arrives. This is why a stone can
  //    be cut to return everything rather than most things.
  for (const steep of [45, 60, 75, 89]) {
    ok(
      traceStone(steep).refracted <= CRITICAL_ANGLE + 1e-9,
      `${steep}° must refract to at most the critical angle`
    );
  }

  // 4. A beam near the axis is turned around by the pavilion and leaves
  //    through the top. This is the bright case, and the one the page shows
  //    first.
  const axial = traceStone(6);
  ok(axial.returned, "a near-axial beam must come back out of the top");
  ok(axial.exit !== "pavilion", `it should not leave by the pavilion, got ${axial.exit}`);
  ok(
    axial.pavilion > CRITICAL_ANGLE,
    `its pavilion incidence ${axial.pavilion} must clear the critical angle`
  );

  // 5. A shallow enough arrival tilts the ray until the pavilion no longer
  //    clears the critical angle, and the light is lost out of the bottom.
  const grazing = traceStone(80);
  ok(!grazing.returned, "a grazing beam must leak");
  ok(grazing.exit === "pavilion", `it should leave by the pavilion, got ${grazing.exit}`);
  ok(
    grazing.pavilion < CRITICAL_ANGLE,
    `its pavilion incidence ${grazing.pavilion} must fall short of critical`
  );

  // 6. There is exactly one crossover, and it sits where the geometry says:
  //    the pavilion is ~40.7° off the girdle, so the ray can tilt 40.7 − 24.4
  //    = 16.3° inside before the facet stops holding it, which is an arrival
  //    of asin(2.417 · sin 16.3°) ≈ 42.7°.
  const limit = brightestLimit();
  ok(near(limit, 42.7, 0.4), `the crossover should be near 42.7°, got ${limit}`);
  ok(traceStone(limit - 0.5).returned, "just inside the limit must still return");
  ok(!traceStone(limit + 0.5).returned, "just outside the limit must leak");

  // 7. The drawing and the verdict come from one call, so a returned beam's
  //    path must actually end above the girdle and a lost one below it.
  for (const angle of [0, 12, 25, 38, 50, 65, 88]) {
    const t = traceStone(angle);
    const end = t.path[t.path.length - 1];
    ok(
      t.returned === end[1] < 96,
      `at ${angle}° the verdict (${t.returned}) disagrees with where the path ends (y=${end[1].toFixed(1)})`
    );
    ok(t.path.length >= 3, `at ${angle}° the path should have a bend in it`);
  }

  if (failed) {
    console.error(`optics: ${failed} assertion(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(
      `optics: Snell, the ${CRITICAL_ANGLE.toFixed(2)}° critical angle, and the ${limit.toFixed(1)}° crossover all hold — drawing and readout agree`
    );
  }
}

demo();
