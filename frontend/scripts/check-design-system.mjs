/**
 * Assert that every design-system name the app *uses* actually *exists*.
 *
 * This sprint began with four screens rendering as unstyled boxes because
 * they were written against `.card`, `--text-muted` and `--danger-text` —
 * none of which had ever been defined. Nothing caught it: a CSS class that
 * doesn't exist is not an error, it's just no styling, and `var(--nope)` on a
 * colour silently inherits. TypeScript can't see either one, the linter has no
 * opinion, and the build is perfectly happy. The only detector was a human
 * looking at the page, which is how it survived to production.
 *
 * So: two assertions, run in CI and by `npm run check`.
 *
 *   1. Every custom class used in a component is defined in globals.css.
 *      Only OUR classes — Tailwind's thousands of utilities are generated, so
 *      the check is scoped by prefix to names this design system owns.
 *   2. Every `--custom-property` referenced anywhere resolves to one declared
 *      in `:root`.
 *
 * Deliberately a plain script with no test framework: the repo doesn't have
 * one, and adding jest to assert two things about strings would be a worse
 * trade than the bug it prevents.
 *
 *   node scripts/check-design-system.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CSS = join(ROOT, "src/app/globals.css");

/** Class-name prefixes this design system owns. A class starting with one of
 *  these must be defined in globals.css; anything else is assumed to be a
 *  Tailwind utility and left alone. Keep in step with the `@layer components`
 *  block — a new component class family needs its stem added here, or the
 *  check silently stops covering it. */
const OWNED = [
  "ambient",
  "badge",
  "btn",
  "card",
  "chrome",
  "clamp-",
  "divider",
  "dot",
  "field",
  "label",
  "list-row",
  "mono",
  "panel",
  "rise",
  "row-hover",
  "skeleton",
  "tnum",
];

/** Custom properties supplied by the caller at the call site rather than
 *  declared globally — `--i` is the stagger index each `.rise` child sets
 *  inline. They are correctly absent from `:root`. */
const CALLER_SET = new Set(["--i"]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(tsx|ts)$/.test(path)) out.push(path);
  }
  return out;
}

const css = readFileSync(CSS, "utf8");

// Defined classes: every `.name` that appears as a selector. The regex is
// greedy on purpose — a name defined anywhere in the file counts as defined.
const definedClasses = new Set(
  [...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((match) => match[1])
);

// Declared custom properties: only those on `:root`, because that is the only
// place this system declares them and a property set on one component is not
// available to another.
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("html {"));
const declaredVars = new Set(
  [...rootBlock.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1])
);

const failures = [];

for (const file of walk(join(ROOT, "src"))) {
  const source = readFileSync(file, "utf8");
  const where = relative(ROOT, file);

  // Class names, from className="..." and className={`...`} alike. Splitting
  // on whitespace over the whole attribute value catches both, plus the
  // ternaries inside a template literal.
  for (const attr of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const name of (attr[1] ?? attr[2]).split(/[\s`${}?:()]+/)) {
      // A dot means it is a JS expression the split cut in half
      // (`${mono.variable}`), not a class name.
      if (!name || name.includes(".")) continue;
      // Strip a responsive/state prefix: `md:panel` is still `panel`.
      const bare = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
      if (!OWNED.some((stem) => bare === stem || bare.startsWith(stem))) continue;
      if (!definedClasses.has(bare)) {
        failures.push(`${where}: class "${bare}" is used but never defined in globals.css`);
      }
    }
  }

  // var(--x) references.
  for (const use of source.matchAll(/var\((--[a-z0-9-]+)/g)) {
    if (!declaredVars.has(use[1]) && !CALLER_SET.has(use[1])) {
      failures.push(`${where}: ${use[1]} is referenced but never declared in :root`);
    }
  }
}

// The CSS file has to hold together on its own terms too — a component class
// that reaches for a property nobody declared fails the same way.
for (const use of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
  if (
    !declaredVars.has(use[1]) &&
    !CALLER_SET.has(use[1]) &&
    !use[1].startsWith("--tw-") &&
    !use[1].startsWith("--font-")
  ) {
    failures.push(`globals.css: ${use[1]} is referenced but never declared in :root`);
  }
}

const unique = [...new Set(failures)];
if (unique.length) {
  console.error(`✗ ${unique.length} design-system reference(s) point at nothing:\n`);
  for (const failure of unique) console.error(`  ${failure}`);
  console.error("\nDefine it in globals.css, or fix the name at the call site.");
  process.exit(1);
}

console.log(
  `✓ design system intact — ${definedClasses.size} classes and ${declaredVars.size} custom properties, every reference resolves`
);
