/**
 * Facet Apply Assist — content script.
 *
 * HARD CONSTRAINT (Section 11/13, a [GATE] item): this file fills form
 * fields and STOPS. There is no `submit_selector` concept anywhere in the
 * selector-map schema (see selectors/*.json), and nothing below queries for,
 * clicks, or dispatches a submit event on any control. That is not an
 * oversight to "complete" later — the missing submit path is intentional.
 * Do not add one.
 */

const BACKEND = "http://localhost:8000";

function detectPlatform() {
  const host = location.hostname;
  if (host.endsWith("greenhouse.io")) return "greenhouse";
  if (host.endsWith("lever.co")) return "lever";
  if (host.endsWith("myworkdayjobs.com")) return "workday";
  if (host.endsWith("linkedin.com")) return "linkedin";
  return null;
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

function showBanner(message, tone = "info") {
  const colors = {
    info: "#0a84ff",
    warn: "#ff9f0a",
  };
  const banner = document.createElement("div");
  banner.textContent = message;
  Object.assign(banner.style, {
    position: "fixed",
    top: "16px",
    right: "16px",
    zIndex: 2147483647,
    background: "#1c1c1e",
    color: "#ffffff",
    border: `1px solid ${colors[tone]}`,
    borderRadius: "12px",
    padding: "12px 16px",
    fontFamily: "-apple-system, sans-serif",
    fontSize: "13px",
    maxWidth: "320px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  });
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 8000);
}

async function attachResumeFile(applicationId) {
  const fileInput = document.querySelector("input[type=file]");
  if (!fileInput || !applicationId) return false;

  try {
    const res = await fetch(`${BACKEND}/api/applications/${applicationId}/resume-file`);
    if (!res.ok) return false;
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const nameMatch = disposition.match(/filename="?([^"]+)"?/);
    const filename = nameMatch ? nameMatch[1] : "resume.pdf";

    const file = new File([blob], filename, { type: blob.type });
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

  let profile;
  try {
    const res = await fetch(`${BACKEND}/api/profile`);
    if (!res.ok) throw new Error("no profile");
    profile = await res.json();
  } catch {
    showBanner("Facet couldn't reach the local app to read your profile.", "warn");
    return;
  }

  const candidate = buildCandidateFields(profile);
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
