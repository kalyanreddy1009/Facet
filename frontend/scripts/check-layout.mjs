/**
 * Measure the layout at six widths, in a real browser.
 *
 * The two problems this was written for are invisible to every other check in
 * this repo, because both are about *geometry* rather than markup or colour:
 *
 *   1. Horizontal overflow. One control that refuses to wrap pushes the
 *      document wider than the viewport, and every page then scrolls sideways
 *      on a phone. It cannot be seen at desktop width and it does not fail a
 *      type check.
 *
 *   2. Edge alignment. The nav island and the page content were capped by two
 *      different rules, and when those rules disagree by 32px the interface
 *      reads as "broken on a large monitor" without anyone being able to say
 *      which element is wrong. Here it is one number against another.
 *
 * Point it at a running instance:
 *
 *   node scripts/check-layout.mjs [http://localhost:3100]
 *
 * Exits non-zero on an overflow, a misalignment or an uncaught page error. The
 * landing page is exempt from the alignment rule — its hero is full-bleed on
 * purpose.
 */

import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:3100";
const sizes = [
  [2560, 1440],
  [1920, 1080],
  [1440, 900],
  [1024, 768],
  [834, 1112],
  [390, 844],
];
const paths = [
  "/",
  "/rough",
  "/tailor",
  "/cabinet",
  "/cabinet#interviews",
  "/stone",
  "/status",
  "/profile",
];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
let bad = 0;

for (const [width, height] of sizes) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  for (const path of paths) {
    await page.goto(`${base}${path}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(500);

    const m = await page.evaluate(() => {
      const nav = document.querySelector(".nav-island")?.getBoundingClientRect();
      // The first real content box inside main, not main itself: main is a
      // full-bleed element with padding, so its own left edge says nothing
      // about where the content actually starts.
      const inner = document.querySelector("main h1, main section, main header");
      const main = inner?.getBoundingClientRect();
      return {
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        url: location.pathname + location.hash,
        navL: nav && Math.round(nav.left),
        navR: nav && Math.round(nav.right),
        mainL: main && Math.round(main.left),
        mainR: main && Math.round(main.right),
        title: document.title,
      };
    });

    const over = m.scroll > m.client + 1;
    // The landing hero is full-bleed and the auth screens are a centred card;
    // neither is meant to sit on the content column's left edge. (An
    // unauthenticated run of this script lands on /login for every app route,
    // which is why the exemption matters rather than being pedantry.)
    const centred = m.url === "/" || m.url === "/login" || m.url === "/set-password";
    const misaligned =
      !centred && width >= 1024 && m.mainL != null && Math.abs(m.mainL - m.navL) > 2;
    if (over || misaligned) bad++;

    console.log(
      `${String(width).padStart(4)}px ${path.padEnd(20)} ${m.url.padEnd(20)} ` +
        `scroll=${m.scroll}/${m.client} nav=[${m.navL},${m.navR}] ` +
        `main=[${m.mainL},${m.mainR}] "${m.title}"` +
        `${over ? " OVERFLOW" : ""}${misaligned ? " MISALIGNED" : ""}`
    );
  }

  if (errors.length) {
    console.log(`   page errors @${width}px: ${errors.slice(0, 2).join(" | ")}`);
    bad++;
  }
  await page.close();
}

await browser.close();
console.log(bad ? `\n✗ ${bad} problem(s)` : "\n✓ no overflow, no misalignment, no page errors");
process.exit(bad ? 1 : 0);
