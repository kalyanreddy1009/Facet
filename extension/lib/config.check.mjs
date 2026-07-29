/**
 * Self-check:  node extension/lib/config.check.mjs
 *
 * The parts of the extension that can be checked without a browser: address
 * normalization, permission patterns, and the byte encoding that carries a
 * resume across the messaging boundary.
 *
 * These are worth checking precisely because they are invisible when wrong.
 * A base URL that normalizes one way in the options page and another in the
 * service worker produces "permission granted" followed by every request
 * being denied, with nothing in between to explain it.
 */

import assert from "node:assert/strict";
import { normalizeBaseUrl, originPattern, isInsecureRemote } from "./config.js";
import { toBase64, filenameFromDisposition } from "./encode.js";

// ------------------------------------------------------- normalizeBaseUrl

// Reduced to an origin, so the stored value and the granted pattern cannot
// drift apart.
assert.equal(normalizeBaseUrl("https://alice.facet.example"), "https://alice.facet.example");
assert.equal(normalizeBaseUrl("https://alice.facet.example/"), "https://alice.facet.example");
assert.equal(normalizeBaseUrl("https://alice.facet.example///"), "https://alice.facet.example");
assert.equal(normalizeBaseUrl("https://alice.facet.example/some/path"), "https://alice.facet.example");
assert.equal(normalizeBaseUrl("  https://alice.facet.example  "), "https://alice.facet.example");

// Ports are part of the origin and must survive — this is the local setup.
assert.equal(normalizeBaseUrl("http://localhost:8000"), "http://localhost:8000");
assert.equal(normalizeBaseUrl("http://127.0.0.1:8000/"), "http://127.0.0.1:8000");

// A bare host is what people type. https is assumed; http never is, because
// silently downgrading the transport for a session cookie is not a helpful
// default.
assert.equal(normalizeBaseUrl("alice.facet.example"), "https://alice.facet.example");

// Junk yields "", never a half-valid pattern that would be requested as a
// permission.
for (const bad of ["", "   ", "not a url", "javascript:alert(1)", "file:///etc/passwd", "ftp://x.com"]) {
  assert.equal(normalizeBaseUrl(bad), "", `expected "" for ${JSON.stringify(bad)}`);
}

// Idempotent: normalizing a stored value again must not change it, since
// that is exactly what the service worker does on every read.
for (const input of ["https://a.example/", "alice.facet.example", "http://localhost:8000"]) {
  const once = normalizeBaseUrl(input);
  assert.equal(normalizeBaseUrl(once), once, `not idempotent for ${input}`);
}

// ---------------------------------------------------------- originPattern

assert.equal(originPattern("https://a.example"), "https://a.example/*");
// The pattern must be built from a normalized value, or Chrome rejects it.
assert.equal(originPattern(normalizeBaseUrl("https://a.example/x")), "https://a.example/*");

// -------------------------------------------------------- isInsecureRemote

assert.equal(isInsecureRemote("http://alice.facet.example"), true, "plain http to a remote host");
assert.equal(isInsecureRemote("https://alice.facet.example"), false);
// The normal local setup must not warn.
assert.equal(isInsecureRemote("http://localhost:8000"), false);
assert.equal(isInsecureRemote("http://127.0.0.1:8000"), false);

// ---------------------------------------------------------------- toBase64

const roundTrip = (bytes) =>
  Buffer.from(toBase64(new Uint8Array(bytes).buffer), "base64");

assert.equal(toBase64(new Uint8Array([]).buffer), "");
assert.deepEqual([...roundTrip([0, 1, 2, 253, 254, 255])], [0, 1, 2, 253, 254, 255]);

// The bug this function exists to avoid: `String.fromCharCode(...bytes)`
// throws RangeError past a few hundred KB. It passes on every small test
// file and fails on real resumes, so the check uses a realistic size and
// deliberately crosses the 0x8000 chunk boundary.
const big = new Uint8Array(300 * 1024);
for (let i = 0; i < big.length; i += 1) big[i] = i % 256;
const decoded = Buffer.from(toBase64(big.buffer), "base64");
assert.equal(decoded.length, big.length, "large buffer round-trip changed length");
assert.ok(decoded.equals(Buffer.from(big)), "large buffer round-trip corrupted bytes");

// Exactly one chunk, and one byte either side of it.
for (const size of [0x7fff, 0x8000, 0x8001]) {
  const buf = new Uint8Array(size).fill(0xab);
  assert.equal(Buffer.from(toBase64(buf.buffer), "base64").length, size,
    `chunk boundary broke at ${size}`);
}

// ------------------------------------------------- filenameFromDisposition

assert.equal(filenameFromDisposition('attachment; filename="stripe-engineer.pdf"'),
  "stripe-engineer.pdf");
assert.equal(filenameFromDisposition("attachment; filename=plain.pdf"), "plain.pdf");
// RFC 5987 — Facet's export names contain spaces often enough to matter.
assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''my%20resume.pdf"),
  "my resume.pdf");
// Falls back rather than failing: a resume under a generic name beats none.
assert.equal(filenameFromDisposition(""), "resume.pdf");
assert.equal(filenameFromDisposition(null), "resume.pdf");
assert.equal(filenameFromDisposition("attachment"), "resume.pdf");
assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%"), "resume.pdf",
  "malformed percent-encoding must fall back, not throw");

console.log("extension: all checks passed (address normalization, permissions, byte transport)");
