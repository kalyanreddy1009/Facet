/**
 * Watch the interface, instead of reasoning about it.
 *
 * Every animation in this app shipped on inference until now: the tooling on
 * this host could rasterise a static page, so a keyframe list could be checked
 * for plausibility but never *seen*. That is how a hero animation reached the
 * user reading as "one strike, no rays" when the CSS said otherwise.
 *
 * This drives a real Chromium, freezes the page at a series of offsets into an
 * animation cycle, and writes a contact sheet of those frames. A cycle you can
 * lay out side by side is a cycle you can judge: whether light is continuous or
 * blinks, whether motion breathes or twitches, whether anything is visible at
 * all at second three.
 *
 *   node scripts/capture.mjs <url> <out.png> [--frames 8] [--cycle 9]
 *                            [--width 1440] [--height 900] [--clip x,y,w,h]
 *                            [--full] [--wait ms]
 *
 * Frames are taken by pausing the document's looping animations at an explicit
 * time rather than by sleeping between screenshots — sleeping samples
 * wall-clock jitter, and two runs would never line up.
 *
 * Only infinite animations are touched. `getAnimations()` also hands back every
 * CSS transition, and rewinding those un-reveals the landing page's scroll
 * sections — which produced a blank frame that looked exactly like a rendering
 * bug in the page rather than a flaw in this file.
 */

import { chromium } from "playwright";

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const frames = Number(flag("frames", 8));
const cycle = Number(flag("cycle", 9));
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));
const wait = Number(flag("wait", 900));
const clip = flag("clip", null);

if (!url || !out) {
  console.error("usage: node scripts/capture.mjs <url> <out.png> [options]");
  process.exit(1);
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(wait);

const shots = [];
for (let i = 0; i < frames; i++) {
  const t = (cycle / frames) * i;
  await page.evaluate((time) => {
    for (const animation of document.getAnimations()) {
      // Only the looping decorative animations. `getAnimations()` also returns
      // every CSS *transition*, including the landing page's scroll reveals —
      // seeking those back to zero un-reveals the sections and produces a
      // blank frame that looks exactly like a rendering bug. Ask for the
      // iteration count and leave anything finite alone.
      const timing = animation.effect?.getTiming?.();
      if (timing?.iterations !== Infinity) continue;
      animation.pause();
      animation.currentTime = time * 1000;
    }
  }, t);
  await page.waitForTimeout(60);

  const options = { type: "png" };
  if (clip) {
    const [x, y, w, h] = clip.split(",").map(Number);
    options.clip = { x, y, width: w, height: h };
  } else if (has("full")) {
    options.fullPage = true;
  }
  shots.push({ t, buffer: await page.screenshot(options) });
}

await browser.close();

// Stitch the frames into one sheet, so a cycle can be read left to right in a
// single look rather than by opening eight files.
const sharpModule = await import("sharp").catch(() => null);
if (!sharpModule) {
  // No image library available: write the frames individually and say so.
  const { writeFileSync } = await import("node:fs");
  shots.forEach((shot, i) => {
    const name = out.replace(/\.png$/, `-${String(i).padStart(2, "0")}.png`);
    writeFileSync(name, shot.buffer);
  });
  console.log(`wrote ${shots.length} frames (no sharp; not stitched)`);
} else {
  const sharp = sharpModule.default;
  const first = await sharp(shots[0].buffer).metadata();
  const cols = Math.min(4, shots.length);
  const rows = Math.ceil(shots.length / cols);
  const composites = shots.map((shot, i) => ({
    input: shot.buffer,
    left: (i % cols) * first.width,
    top: Math.floor(i / cols) * first.height,
  }));
  await sharp({
    create: {
      width: first.width * cols,
      height: first.height * rows,
      channels: 3,
      background: { r: 20, g: 22, b: 30 },
    },
  })
    .composite(composites)
    .png()
    .toFile(out);
  console.log(
    `${shots.length} frames over ${cycle}s → ${out} ` +
      `(${first.width}×${first.height} each, ${cols}×${rows})`
  );
}
