/**
 * Facet Apply Assist — content script.
 *
 * HARD CONSTRAINT (Section 11/13, a [GATE] item): this file fills form
 * fields and STOPS. There is no `submit_selector` concept anywhere in the
 * selector-map schema (see selectors/*.json), and nothing below queries for,
 * clicks, or dispatches a submit event on any control. That is not an
 * oversight to "complete" later — the missing submit path is intentional.
 * Do not add one.
 *
 * This file makes no network requests. Every call to the Facet server goes
 * through the service worker (see background.js), because a content script's
 * fetch follows the *page's* CORS rules and a job board will not permit a
 * call to your Facet instance. The worker is also the only context that can
 * send the Cloudflare Access session cookie.
 */

function detectPlatform() {
  const host = location.hostname;
  if (host.endsWith("greenhouse.io")) return "greenhouse";
  if (host.endsWith("lever.co")) return "lever";
  if (host.endsWith("myworkdayjobs.com")) return "workday";
  if (host.endsWith("linkedin.com")) return "linkedin";
  return null;
}

/**
 * Ask the service worker for something.
 *
 * A worker that failed to start, or an extension that was just reloaded,
 * rejects with "Could not establish connection". That is not a reason to
 * throw at the caller — every path here ends in a banner, so it becomes an
 * error value like any other.
 */
async function ask(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response || { ok: false, error: "no_response" };
  } catch (err) {
    return { ok: false, error: "worker_unreachable", detail: String(err) };
  }
}

function splitName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/);
  return {
    first_name: parts[0] || "",
    last_name: parts.slice(1).join(" ") || "",
  };
}

function buildCandidateFields(profile) {
  const { first_name, last_name } = splitName(profile.name);
  const contact = profile.contact || {};
  return {
    name: profile.name || "",
    first_name,
    last_name,
    email: contact.email || "",
    phone: contact.phone || "",
    location: contact.location || "",
    linkedin: contact.linkedin || "",
  };
}

function setInputValue(el, value) {
  if (!value) return false;
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function findByLabelText(labelWords) {
  const labels = Array.from(document.querySelectorAll("label"));
  for (const label of labels) {
    const text = label.textContent.trim().toLowerCase();
    if (!labelWords.some((word) => text.includes(word))) continue;

    if (label.htmlFor) {
      const target = document.getElementById(label.htmlFor);
      if (target) return target;
    }
    const nestedInput = label.querySelector("input, textarea");
    if (nestedInput) return nestedInput;
  }
  return null;
}

function findField(fieldConfig) {
  for (const selector of fieldConfig.selectors || []) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  if (fieldConfig.labelFallback) {
    const el = findByLabelText(fieldConfig.labelFallback);
    if (el) return el;
  }
  return null;
}

/**
 * @param {object} [action] optional { label, message } — renders a button
 *   that sends `message` to the worker. Used to offer "Open settings" when
 *   the extension has nowhere to connect to, since a banner that names a
 *   problem the person cannot act on is only half a message.
 */
function showBanner(message, tone = "info", action = null) {
  const colors = {
    info: "#0a84ff",
    warn: "#ff9f0a",
    error: "#ff453a",
  };

  const banner = document.createElement("div");
  Object.assign(banner.style, {
    position: "fixed",
    top: "16px",
    right: "16px",
    zIndex: 2147483647,
    background: "#1c1c1e",
    color: "#ffffff",
    border: `1px solid ${colors[tone] || colors.info}`,
    borderRadius: "12px",
    padding: "12px 16px",
    fontFamily: "-apple-system, sans-serif",
    fontSize: "13px",
    lineHeight: "1.5",
    maxWidth: "320px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  });

  const text = document.createElement("div");
  text.textContent = message;
  banner.appendChild(text);

  if (action) {
    const button = document.createElement("button");
    button.textContent = action.label;
    Object.assign(button.style, {
      marginTop: "10px",
      padding: "6px 12px",
      background: colors[tone] || colors.info,
      color: "#fff",
      border: "none",
      borderRadius: "7px",
      font: "inherit",
      fontWeight: "600",
      cursor: "pointer",
    });
    button.addEventListener("click", () => {
      ask(action.message);
      banner.remove();
    });
    banner.appendChild(button);
  }

  document.body.appendChild(banner);
  // Something with a button in it should not vanish while being read.
  setTimeout(() => banner.remove(), action ? 20000 : 8000);
  return banner;
}

const OPEN_SETTINGS = {
  label: "Open settings",
  message: { type: "facet:open-options" },
};

/** Turn a worker error into something the person can act on. */
function reportError(result, what) {
  switch (result.error) {
    case "not_configured":
      showBanner(
        "Facet Apply Assist doesn't know where your Facet is yet. Set the address once and this page will fill itself next time.",
        "warn",
        OPEN_SETTINGS
      );
      return;
    case "no_permission":
      showBanner(
        `Permission to reach ${result.baseUrl} was withdrawn. Grant it again to autofill.`,
        "warn",
        OPEN_SETTINGS
      );
      return;
    case "not_signed_in":
      showBanner(
        "You're signed out of Facet. Open it in another tab, sign in, then reload this page.",
        "warn"
      );
      return;
    case "unreachable":
    case "worker_unreachable":
      showBanner(
        `Facet couldn't reach ${result.baseUrl || "your Facet"} to read ${what}.`,
        "error"
      );
      return;
    case "timeout":
      showBanner("Facet didn't answer in time. Reload to try again.", "error");
      return;
    case "not_found":
      showBanner(
        "Facet has no profile yet — import a resume in The Stone first.",
        "warn"
      );
      return;
    default:
      showBanner(`Facet couldn't read ${what}.`, "error");
  }
}

/**
 * Rebuild the resume as a File and hand it to the form's file input.
 *
 * The bytes arrive as a data URL because a Blob cannot survive the extension
 * messaging boundary — it structured-clones into an empty object, which
 * fails later and nowhere near the cause.
 */
async function attachResumeFile(applicationId) {
  const fileInput = document.querySelector("input[type=file]");
  if (!fileInput || !applicationId) return false;

  const result = await ask({ type: "facet:resume", applicationId });
  if (!result.ok) return false;

  try {
    const blob = await (await fetch(result.dataUrl)).blob();
    const file = new File([blob], result.filename, { type: result.mimeType });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const platform = detectPlatform();
  if (!platform) return;

  let selectorMap;
  try {
    const mapUrl = chrome.runtime.getURL(`selectors/${platform}.json`);
    selectorMap = await (await fetch(mapUrl)).json();
  } catch {
    return;
  }

  if (!selectorMap.supported) {
    showBanner(
      `Facet doesn't autofill ${platform} forms yet — fill this one in by hand.`,
      "warn"
    );
    return;
  }

  const profileResult = await ask({ type: "facet:profile" });
  if (!profileResult.ok) {
    reportError(profileResult, "your profile");
    return;
  }

  const candidate = buildCandidateFields(profileResult.profile);
  let filled = 0;
  const total = Object.keys(selectorMap.fields).length;

  for (const [, config] of Object.entries(selectorMap.fields)) {
    const el = findField(config);
    if (!el) continue;
    const value = candidate[config.source];
    if (setInputValue(el, value)) filled += 1;
  }

  const params = new URLSearchParams(location.search);
  const applicationId = params.get("facet_application_id");
  const attachedResume = await attachResumeFile(applicationId);

  showBanner(
    `Facet filled ${filled} of ${total} fields${attachedResume ? " and attached your resume" : ""}. Review everything, then click Submit yourself.`
  );
}

run();
