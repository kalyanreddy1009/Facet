/**
 * Self-check:  node extension/check.mjs
 *
 * Everything about the extension that can be verified without a browser.
 * Loading it into Chrome is still the real test — this catches the mistakes
 * that would otherwise cost you that round trip, and the ones a successful
 * load would hide.
 *
 * The last group is the important one. It asserts the product boundary: this
 * extension fills fields and never submits. That is a promise made to people
 * whose job applications are involved, and a promise worth a test rather
 * than a comment.
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), "utf8");

// Running the pure-logic checks first; they throw on failure.
await import("./lib/config.check.mjs");

// ------------------------------------------------------------- the manifest

const manifest = JSON.parse(read("manifest.json"));

assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.name && manifest.version, "name and version are required");

// Every file the manifest points at must exist. A typo here shows up in
// Chrome as a generic load failure with no filename in it.
const referenced = [
  manifest.background?.service_worker,
  manifest.options_ui?.page,
  ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
].filter(Boolean);

for (const file of referenced) {
  assert.ok(existsSync(join(HERE, file)), `manifest references a missing file: ${file}`);
}

// The service worker uses `import`, which Chrome only allows when the
// manifest says so. Without this it fails at registration time with a
// message that does not mention modules.
assert.equal(manifest.background.type, "module",
  "background.js uses ES imports and needs \"type\": \"module\"");

// Follow the imports one level and confirm those exist too.
for (const entry of ["background.js", "options.js"]) {
  const source = read(entry);
  for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const target = join(HERE, dirname(entry), match[1]);
    assert.ok(existsSync(target), `${entry} imports a missing module: ${match[1]}`);
  }
}

// ----------------------------------------------------------- the permissions

// The hardcoded backend origin is gone. Its presence was both a portability
// problem and a lie: it named an address that is wrong for every hosted
// install.
const hostPermissions = manifest.host_permissions || [];
for (const pattern of hostPermissions) {
  assert.ok(!/localhost|127\.0\.0\.1/.test(pattern),
    `a fixed backend origin is baked into host_permissions: ${pattern}`);
}

// The Facet address is granted at runtime instead, from the options page.
assert.ok((manifest.optional_host_permissions || []).length > 0,
  "the Facet address must be an optional permission, granted per install");

assert.ok(manifest.options_ui?.page, "there must be somewhere to set the address");

// Content scripts and host permissions should agree: a content script that
// runs where the extension has no host permission cannot be injected.
const contentMatches = new Set(
  (manifest.content_scripts || []).flatMap((cs) => cs.matches || [])
);
for (const pattern of contentMatches) {
  assert.ok(hostPermissions.includes(pattern),
    `content script matches ${pattern} but it is not in host_permissions`);
}

// ------------------------------------------------------- the selector maps

const platforms = ["greenhouse", "lever", "workday", "linkedin"];
for (const platform of platforms) {
  const map = JSON.parse(read(`selectors/${platform}.json`));
  assert.equal(map.platform, platform, `${platform}.json disagrees about its own name`);
  assert.equal(typeof map.supported, "boolean");

  for (const [field, config] of Object.entries(map.fields || {})) {
    assert.ok(config.source, `${platform}.${field} has no source`);
    assert.ok(
      (config.selectors || []).length > 0 || (config.labelFallback || []).length > 0,
      `${platform}.${field} has no way to find its element`
    );
  }

  // THE GATE. No selector map may describe how to submit a form. This is
  // asserted on the data as well as the code, because a schema that has
  // nowhere to put a submit selector is what makes the absence structural
  // rather than a matter of nobody having added one yet.
  const serialized = JSON.stringify(map).toLowerCase();
  assert.ok(!serialized.includes("submit"),
    `${platform}.json mentions submit - the extension must never submit`);
}

// The README's support table has to agree with the selector maps. It drifted
// once already - claiming Workday autofilled when its map was empty, which is
// the kind of wrong that only shows up mid-application.
const readme = read("README.md");
for (const platform of platforms) {
  const supported = JSON.parse(read(`selectors/${platform}.json`)).supported;
  const row = readme.match(new RegExp(`^\\| ${platform} \\| (.+?) \\|$`, "im"));
  assert.ok(row, `README has no support-table row for ${platform}`);
  assert.equal(/autofills/i.test(row[1]), supported,
    `README says "${row[1].trim()}" for ${platform} but supported=${supported}`);
}

// ------------------------------------------------------------ the code gate

// Strip comments before searching, so the paragraphs explaining the
// constraint do not read as violations of it.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

for (const file of ["content_script.js", "background.js"]) {
  const code = stripComments(read(file));
  for (const forbidden of [/\.submit\s*\(/, /requestSubmit/, /\bsubmit_selector\b/]) {
    assert.ok(!forbidden.test(code),
      `${file} contains a submit path (${forbidden}) - this is a [GATE] item`);
  }
}

// The content script must not talk to the network itself: since Chrome 85 its
// fetches follow the *page's* CORS rules, so a call to Facet from a job board
// is a cross-origin request the server correctly refuses. Only local schemes
// are allowed here.
const contentCode = stripComments(read("content_script.js"));
for (const match of contentCode.matchAll(/fetch\(([^)]*)\)/g)) {
  const argument = match[1].trim();
  assert.ok(
    /dataUrl|mapUrl/.test(argument),
    `content_script.js fetches something that is not local: ${argument}`
  );
}

console.log("extension: all checks passed (manifest, permissions, selectors, no-submit gate)");
