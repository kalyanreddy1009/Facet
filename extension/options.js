/**
 * Facet Apply Assist — settings.
 *
 * One job: learn where your Facet lives, and get permission to talk to it.
 *
 * The permission request has to happen here rather than in the service
 * worker, because Chrome only grants an optional host permission from a user
 * gesture. That is why "Connect" is a button you press and not something
 * that happens when the page loads.
 */

import { normalizeBaseUrl, originPattern, isInsecureRemote } from "./lib/config.js";

const els = {
  input: document.getElementById("base-url"),
  save: document.getElementById("save"),
  status: document.getElementById("status"),
  connected: document.getElementById("connected"),
  currentUrl: document.getElementById("current-url"),
  currentPermission: document.getElementById("current-permission"),
  test: document.getElementById("test"),
  forget: document.getElementById("forget"),
};

function setStatus(message, tone = "") {
  els.status.textContent = message;
  els.status.className = `status ${tone}`.trim();
}

/** Human text for the error codes the service worker returns. */
function explain(result) {
  switch (result.error) {
    case "not_configured":
      return "No address saved yet.";
    case "no_permission":
      return "Permission for that address was not granted. Press Connect again.";
    case "not_signed_in":
      return "Reached it, but you are not signed in. Open Facet in a tab, sign in, then test again.";
    case "unreachable":
      return "Could not reach that address. Check it is running and the URL is right.";
    case "timeout":
      return "That address did not answer in time.";
    case "not_found":
      return "Connected, but no profile yet - import a resume in Facet first.";
    case "bad_json":
      return "That address answered, but not with Facet data. Check the URL.";
    case "http_error":
      return `Facet answered with an error (HTTP ${result.status}).`;
    default:
      // No branch matched, so the reason is whatever the background script sent.
      // With nothing to pass on, name the outcome rather than the feeling: the
      // person is looking at a Connect button and needs to know whether to press
      // it again.
      return result.detail || `The connection test failed for an unknown reason (${result.status || "no status"}).`;
  }
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

// ------------------------------------------------------------------ render

async function refresh() {
  const config = await send({ type: "facet:config" });

  if (!config.configured) {
    els.connected.hidden = true;
    return;
  }

  els.input.value = config.baseUrl;
  els.currentUrl.textContent = config.baseUrl;
  els.currentPermission.textContent = config.granted ? "granted" : "NOT granted";
  els.connected.hidden = false;

  if (!config.granted) {
    setStatus("Saved, but permission is missing. Press Connect to grant it.", "warn");
  }
}

// ------------------------------------------------------------------ actions

async function connect() {
  const baseUrl = normalizeBaseUrl(els.input.value);
  if (!baseUrl) {
    setStatus("That does not look like a web address.", "error");
    return;
  }

  if (isInsecureRemote(baseUrl)) {
    const proceed = confirm(
      `${baseUrl} is plain http to a remote host.\n\n` +
      "Your session cookie and your resume would cross the network " +
      "unencrypted. A hosted Facet sits behind Cloudflare and should be " +
      "https.\n\nUse it anyway?"
    );
    if (!proceed) return;
  }

  els.save.disabled = true;
  setStatus("Requesting permission…", "busy");

  let granted;
  try {
    // Must be called synchronously enough to still count as a user gesture,
    // which is why nothing is awaited before this point.
    granted = await chrome.permissions.request({ origins: [originPattern(baseUrl)] });
  } catch (err) {
    els.save.disabled = false;
    setStatus(`Chrome refused the permission request: ${err}`, "error");
    return;
  }

  if (!granted) {
    els.save.disabled = false;
    setStatus("Permission denied - the extension cannot reach Facet without it.", "error");
    return;
  }

  await chrome.storage.sync.set({ baseUrl });
  els.save.disabled = false;
  await refresh();
  await test();
}

async function test() {
  setStatus("Testing…", "busy");
  const result = await send({ type: "facet:profile" });

  if (result.ok) {
    const name = result.profile?.name;
    setStatus(name ? `Connected - reading ${name}'s profile.` : "Connected.", "ok");
    return;
  }

  // "No profile yet" means the connection itself is fine, which is worth
  // saying differently from a failure.
  setStatus(explain(result), result.error === "not_found" ? "warn" : "error");
}

async function forget() {
  const baseUrl = normalizeBaseUrl(els.input.value);
  await chrome.storage.sync.remove("baseUrl");

  // Hand the permission back too. Keeping host access to a server the
  // extension has been told to forget is not something to leave lying around.
  if (baseUrl) {
    try {
      await chrome.permissions.remove({ origins: [originPattern(baseUrl)] });
    } catch {
      // Not fatal: the stored address is gone either way.
    }
  }

  els.input.value = "";
  els.connected.hidden = true;
  setStatus("Disconnected.", "");
}

els.save.addEventListener("click", connect);
els.test.addEventListener("click", test);
els.forget.addEventListener("click", forget);
els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") connect();
});

refresh();
