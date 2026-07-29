/**
 * Facet Apply Assist — service worker.
 *
 * Every call to the Facet server happens here, and that is the whole point.
 *
 * Since Chrome 85 a content script's `fetch` is subject to the *page's* CORS
 * rules, not the extension's. A content script on greenhouse.io calling your
 * Facet server is therefore a cross-origin request the server would have to
 * allow — and Facet's allowlist is its own frontend, correctly. So the old
 * arrangement could not work, and the fix is not to widen the allowlist: it
 * is to move the calls somewhere page CORS does not apply. A service worker
 * with host permission is that place.
 *
 * It also buys the thing that makes a hosted deployment possible at all:
 * `credentials: "include"` sends the Cloudflare Access session cookie, so a
 * signed-in browser reaches its own instance. A content script on a job
 * board could never send that cookie.
 *
 * HARD CONSTRAINT, unchanged: nothing here or downstream submits anything.
 * There is no submit path, and its absence is deliberate.
 */

import { normalizeBaseUrl, originPattern } from "./lib/config.js";
import { toBase64, filenameFromDisposition } from "./lib/encode.js";

// A resume that will not fit through the messaging boundary. Real ones are
// tens to hundreds of KB; anything past this is a misconfiguration, and a
// clear error beats a silently truncated attachment.
const MAX_RESUME_BYTES = 8 * 1024 * 1024;

const REQUEST_TIMEOUT_MS = 15000;

chrome.runtime.onInstalled.addListener(() => {
  console.log("Facet Apply Assist installed — fills known fields, never submits.");
});

// No popup: clicking the icon opens the one screen there is.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// ------------------------------------------------------------------ config

async function getBaseUrl() {
  const { baseUrl } = await chrome.storage.sync.get({ baseUrl: "" });
  // Normalized on read as well as on write: a value that arrived from
  // storage.sync was written by another machine's copy of this extension,
  // possibly an older one.
  return normalizeBaseUrl(baseUrl);
}

// ------------------------------------------------------------------ fetching

/**
 * One request to the Facet server, with every failure turned into a value.
 *
 * Errors are *returned*, never thrown. A rejected promise inside
 * `onMessage` reaches the content script as "message port closed before a
 * response was received", which tells the person nothing about what went
 * wrong. Every branch below ends in an `error` string the banner can explain.
 */
async function facetFetch(path, { accept } = {}) {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) return { ok: false, error: "not_configured" };

  const granted = await chrome.permissions.contains({
    origins: [originPattern(baseUrl)],
  });
  if (!granted) return { ok: false, error: "no_permission", baseUrl };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      // The Access cookie. Without this a hosted instance answers with a
      // login page instead of data.
      credentials: "include",
      redirect: "follow",
      headers: accept ? { Accept: accept } : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") return { ok: false, error: "timeout", baseUrl };
    return { ok: false, error: "unreachable", baseUrl, detail: String(err) };
  }
  clearTimeout(timer);

  // Cloudflare Access does not answer an unauthenticated request with 401.
  // It answers 200 and a login page, so status alone cannot be trusted:
  // parsing that as JSON gives "Unexpected token '<'", which reads like a
  // bug in Facet rather than "you are signed out".
  const contentType = response.headers.get("Content-Type") || "";
  // `response.url` is normally the final URL after redirects, but it is
  // empty for some synthetic responses — and `new URL("")` throws, which
  // would turn a signed-out state into an unhandled rejection inside the
  // one function written to avoid exactly that.
  let redirectedOffHost = false;
  try {
    if (response.url) redirectedOffHost = new URL(response.url).origin !== baseUrl;
  } catch {
    redirectedOffHost = false;
  }

  if (redirectedOffHost || contentType.includes("text/html")) {
    return { ok: false, error: "not_signed_in", baseUrl };
  }

  if (response.status === 404) return { ok: false, error: "not_found", baseUrl };
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: "not_signed_in", baseUrl };
  }
  if (!response.ok) {
    return { ok: false, error: "http_error", status: response.status, baseUrl };
  }

  return { ok: true, response, baseUrl };
}

// ------------------------------------------------------------------ handlers

async function handleConfig() {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) return { ok: true, configured: false, baseUrl: "" };
  const granted = await chrome.permissions.contains({
    origins: [originPattern(baseUrl)],
  });
  return { ok: true, configured: true, granted, baseUrl };
}

async function handleProfile() {
  const result = await facetFetch("/api/profile", { accept: "application/json" });
  if (!result.ok) return result;

  try {
    const profile = await result.response.json();
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: "bad_json", detail: String(err) };
  }
}

/**
 * A Blob cannot cross the extension messaging boundary — it is structured-
 * cloned into an empty object, which fails later and far from the cause. So
 * the bytes travel as a data URL and the content script rebuilds the File.
 */
async function handleResume(applicationId) {
  if (!applicationId) return { ok: false, error: "no_application" };

  const result = await facetFetch(
    `/api/applications/${encodeURIComponent(applicationId)}/resume-file`
  );
  if (!result.ok) return result;

  const { response } = result;
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) return { ok: false, error: "empty_resume" };
  if (buffer.byteLength > MAX_RESUME_BYTES) {
    return { ok: false, error: "resume_too_large", bytes: buffer.byteLength };
  }

  const filename = filenameFromDisposition(response.headers.get("Content-Disposition"));
  const mimeType = response.headers.get("Content-Type") || "application/pdf";

  return {
    ok: true,
    filename,
    mimeType,
    dataUrl: `data:${mimeType};base64,${toBase64(buffer)}`,
  };
}

// ------------------------------------------------------------------ routing

const HANDLERS = {
  "facet:config": () => handleConfig(),
  "facet:profile": () => handleProfile(),
  "facet:resume": (message) => handleResume(message.applicationId),
  "facet:open-options": async () => {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) {
    sendResponse({ ok: false, error: "unknown_message" });
    return false;
  }

  // A last-resort catch: an unhandled rejection here would close the port
  // and strand the caller with an opaque message.
  handler(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: "internal", detail: String(err) }));

  return true; // the response is asynchronous
});
