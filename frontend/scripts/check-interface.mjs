/**
 * The interface checks a compiler cannot make.
 *
 * `tsc` proves the props type-check and `check-design-system` proves the class
 * names exist. Neither has an opinion about whether a control can be reached
 * with a keyboard, whether the text on a surface is legible, or whether a
 * button inside a form is about to submit it because nobody wrote `type`.
 * Those are the defects that survive review — they look right in the diff.
 *
 * Five assertions, all static, all cheap enough to run on every build:
 *
 *   1. Contrast. Every foreground token is checked against every surface it
 *      is plausibly drawn on, at the WCAG AA ratio for its size. The palette
 *      was lightened this sprint; this is what keeps the next adjustment from
 *      quietly making body text unreadable. Status inks are additionally
 *      checked against their own soft tint, which is where a badge actually
 *      sits and is the lightest background in the system.
 *   2. Labels. Every input, select and textarea has a <label htmlFor> that
 *      matches its id, or an aria-label.
 *   3. Button type. A <button> inside a <form> with no `type` is a submit
 *      button — the reason a "show password" toggle sends the form.
 *   4. Icon-only controls have an accessible name.
 *   5. `target="_blank"` carries `rel="noreferrer"`, or the opened page can
 *      reach back through window.opener.
 *
 *   node scripts/check-interface.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CSS = join(ROOT, "src/app/globals.css");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx$/.test(path)) out.push(path);
  }
  return out;
}

const failures = [];
const notes = [];

/** The attribute text of a JSX tag opened at `start`.
 *
 *  Not a regex, because `[^>]*` stops at the first `>` — and every second
 *  handler in this codebase is `onChange={(e) => ...}`. An earlier version of
 *  this file did use the regex and reported six inputs as unlabelled that
 *  were labelled two attributes further along. A checker that cries wolf gets
 *  switched off, so it is worth the twenty lines to read the tag properly.
 */
function attributesOf(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return source.slice(start, i);
  }
  return "";
}

/** Is this tag wrapped in something that labels it? Either a literal <label>
 *  or the local `<Field label="...">` helper, which renders one.
 *
 *  Counted over the whole file rather than a window: a window that starts
 *  mid-element sees the closing tag without its opener and concludes the
 *  control is bare. Tag counting is not a parse, but it is right for every
 *  shape this codebase actually writes, and a JSX parser would be a
 *  dependency for one assertion. */
function wrappedInALabel(source, index) {
  const before = source.slice(0, index);
  const opened = (before.match(/<(?:label|Field)\b[^>]*>/g) || []).length;
  const closed = (before.match(/<\/(?:label|Field)>/g) || []).length;
  return opened > closed;
}

/* ------------------------------------------------------------- contrast */

const css = readFileSync(CSS, "utf8");
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("html {"));
const tokens = Object.fromEntries(
  [...rootBlock.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()])
);

function toRgb(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = value.match(/^rgba?\(([^)]+)\)/);
  if (rgba) {
    const parts = rgba[1].split(",").map((p) => parseFloat(p));
    return parts.slice(0, 3);
  }
  return null;
}

/** Composite a possibly-translucent colour over what is behind it. The glass
 *  surfaces are the whole visual direction here, so checking them as if they
 *  were opaque would be checking a colour that never appears on screen. */
function over(value, backdrop) {
  const rgb = toRgb(value);
  if (!rgb) return null;
  const alphaMatch = value.match(/^rgba\([^)]*,\s*([0-9.]+)\s*\)/);
  const alpha = alphaMatch ? parseFloat(alphaMatch[1]) : 1;
  return rgb.map((c, i) => c * alpha + backdrop[i] * (1 - alpha));
}

function luminance([r, g, b]) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg, bg) {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

const page = toRgb(tokens["--bg"]);

// Each surface, composited over the page behind it.
const SURFACES = ["--bg", "--surface-1", "--surface-2", "--surface-3", "--glass-1", "--glass-2"];

// 4.5 is AA for body text. The dim/faint tokens are used for supporting text
// at normal size too, so they get the same bar — "it's only a caption" is how
// a caption becomes unreadable. 3.0 is AA for large text and for the non-text
// tokens that only ever draw a 1px rule or an icon.
const FOREGROUNDS = [
  ["--text", 4.5],
  ["--text-dim", 4.5],
  ["--text-muted", 4.5],
  ["--text-faint", 3.0],
  ["--accent-text", 4.5],
  ["--ok-text", 4.5],
  ["--warn-text", 4.5],
  ["--danger-text", 4.5],
];

for (const [name, minimum] of FOREGROUNDS) {
  if (!tokens[name]) {
    failures.push(`globals.css: contrast check references ${name}, which is not declared`);
    continue;
  }
  const fg = over(tokens[name], page);
  let worst = { surface: null, value: Infinity };
  for (const surface of SURFACES) {
    const bg = over(tokens[surface], page);
    if (!bg || !fg) continue;
    const value = ratio(fg, bg);
    if (value < worst.value) worst = { surface, value };
  }
  if (worst.value < minimum) {
    failures.push(
      `contrast: ${name} on ${worst.surface} is ${worst.value.toFixed(2)}:1, ` +
        `below the ${minimum}:1 it needs`
    );
  } else {
    notes.push(`${name} ≥ ${worst.value.toFixed(2)}:1`);
  }
}

// The tinted surfaces. A badge is not text on a neutral panel — it is text on
// a wash of its own status colour, and that wash is the lightest background in
// the system. The loop above never looked at these pairs, which is how the
// light palette shipped badges at 2.2:1: every token in it passed on grey.
const TINTED_PAIRS = [
  ["--accent-text", "--accent-soft", 4.5],
  ["--ok-text", "--ok-soft", 4.5],
  ["--warn-text", "--warn-soft", 4.5],
  ["--danger-text", "--danger-soft", 4.5],
  // The placeholder. Real text, so it takes the real bar.
  ["--text-ghost", "--glass-1", 4.5],
];

for (const [fgName, bgName, minimum] of TINTED_PAIRS) {
  if (!tokens[fgName] || !tokens[bgName]) {
    failures.push(`globals.css: contrast check references ${fgName}/${bgName}, not declared`);
    continue;
  }
  // The soft tints are themselves translucent, so they composite over the
  // lightest surface they are ever drawn on — the worst case for the ink.
  const behind = over(tokens["--glass-1"], page);
  const bg = over(tokens[bgName], behind);
  const fg = over(tokens[fgName], page);
  const value = ratio(fg, bg);
  if (value < minimum) {
    failures.push(
      `contrast: ${fgName} on ${bgName} is ${value.toFixed(2)}:1, below the ${minimum}:1 it needs`
    );
  } else {
    notes.push(`${fgName}/${bgName} ≥ ${value.toFixed(2)}:1`);
  }
}

/* ---------------------------------------------------------- the markup */

for (const file of walk(join(ROOT, "src"))) {
  // Comments are stripped first. This codebase documents itself heavily, and
  // a doc comment explaining what `<input type="radio">` would have given us
  // is not a control that needs a label.
  const source = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const where = relative(ROOT, file);

  // 2. Labels. An id that a <label htmlFor> names, or an aria-label, or a
  //    wrapping <label> — checked by proximity, which is enough because this
  //    codebase writes them next to each other.
  const labelled = new Set(
    [...source.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1])
  );
  for (const tag of source.matchAll(/<(input|select|textarea)\b/gs)) {
    const attrs = attributesOf(source, tag.index + tag[0].length);
    if (/type="(hidden|submit|button)"/.test(attrs)) continue;
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    const named =
      (id && labelled.has(id)) ||
      /aria-label(?:ledby)?=/.test(attrs) ||
      wrappedInALabel(source, tag.index);
    if (!named) {
      failures.push(`${where}: <${tag[1]}> has no label and no aria-label`);
    }
  }

  // 3. Buttons inside a form default to submit.
  if (/<form\b/.test(source)) {
    for (const tag of source.matchAll(/<button\b([^>]*)>/gs)) {
      if (!/\btype=/.test(tag[1])) {
        failures.push(
          `${where}: <button> in a file with a <form> has no type — it defaults to submit`
        );
      }
    }
  }

  // 4. A control whose only child is an icon needs a name. Matched on the
  //    common shape: <button ...>{...<SomeIcon .../>}</button> with no text.
  for (const tag of source.matchAll(/<button\b([^>]*)>\s*<([A-Z]\w*)[^>]*\/>\s*<\/button>/gs)) {
    if (!/aria-label=/.test(tag[1])) {
      failures.push(`${where}: icon-only <button> (${tag[2]}) has no aria-label`);
    }
  }

  // 5. window.opener.
  for (const tag of source.matchAll(/<(?:a|Link)\b([^>]*target="_blank"[^>]*)>/gs)) {
    if (!/rel="[^"]*noreferrer/.test(tag[1])) {
      failures.push(`${where}: target="_blank" without rel="noreferrer"`);
    }
  }
}

const unique = [...new Set(failures)];
if (unique.length) {
  console.error(`✗ ${unique.length} interface problem(s):\n`);
  for (const failure of unique) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  `✓ interface intact — contrast (${notes.length} tokens, worst ` +
    `${Math.min(...notes.map((n) => parseFloat(n.split("≥ ")[1]))).toFixed(2)}:1), ` +
    `labels, button types, icon names, link rel`
);
