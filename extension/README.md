# Facet Apply Assist

A Chrome extension that fills known application-form fields from your Facet
profile, in a tab you opened yourself.

**It never submits.** There is no submit path in the code, no
`submit_selector` in the selector-map schema, and `extension/check.mjs`
asserts both. You read what it filled and click Submit — that decision stays
yours.

## Install

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this `extension/` directory
3. Click the Facet icon in the toolbar (or **Details → Extension options**)
4. Enter your Facet address and press **Connect**

Chrome will ask permission for that one origin. Grant it.

| Your setup | Address to enter |
|---|---|
| Running locally | `http://localhost:8000` |
| Hosted, behind Cloudflare | `https://alice.facet.example` |

Press **Test connection** to confirm. "Connected — reading Alex's profile"
means everything works.

## How it works, and why

Every call to the Facet server happens in the **service worker**, not the
content script. That is not a style preference.

Since Chrome 85 a content script's `fetch` follows the **page's** CORS rules
rather than the extension's. A content script on `greenhouse.io` calling your
Facet server is therefore a cross-origin request your server would have to
permit — and Facet's allowlist is its own frontend, correctly. The old
version of this extension fetched from the content script, so its
resume-attach path could not have worked against a correctly-configured
server.

The fix is not to widen the server's allowlist. It is to move the calls
somewhere page CORS does not apply. A service worker holding host permission
is that place, and it brings the thing that makes a hosted deployment
possible at all: `credentials: "include"` sends the Cloudflare Access session
cookie, so a signed-in browser reaches its own instance. A content script on
a job board could never send that cookie.

```
content_script.js  ──chrome.runtime.sendMessage──►  background.js  ──fetch──►  Facet
   (no network)                                     (host permission,
                                                     Access cookie)
```

Resume bytes come back as a **data URL**. A `Blob` cannot cross the messaging
boundary — structured clone turns it into an empty object, and the failure
surfaces later as a File with no contents attached to a form.

## Address configuration

The Facet address is an **optional** host permission requested at runtime,
not a fixed entry in the manifest. The old manifest hardcoded
`http://localhost:8000/*`, which is wrong for every hosted install and
demands an alarming permission at install time for everyone else.

Chrome only grants optional permissions from a user gesture, which is why
"Connect" is a button rather than something that happens on page load.

**Disconnect** hands the permission back as well as forgetting the address.
Host access to a server the extension has been told to forget is not
something to leave lying around.

## What it supports

| Platform | Status |
|---|---|
| Greenhouse | Autofills |
| Lever | Autofills |
| Workday | Autofills |
| LinkedIn | Shows a notice, fills nothing |

LinkedIn's EasyApply is a multi-step, obfuscated-class React modal. Guessing
at its fields would put wrong data in a real application, so it says so
instead. Add support by setting `supported: true` in
`selectors/linkedin.json` once the selectors are verified against a live
modal.

Selector maps are plain JSON — `selectors/*.json`. Each field lists CSS
selectors tried in order, plus an optional `labelFallback` matched against
label text for forms with no stable IDs.

## When something goes wrong

The banner in the corner of the page says which, and offers **Open settings**
when that is the fix.

| Banner | Meaning |
|---|---|
| "doesn't know where your Facet is yet" | Nothing configured. Open settings. |
| "Permission … was withdrawn" | Granted, then revoked in `chrome://extensions`. Reconnect. |
| "You're signed out of Facet" | Cloudflare Access session expired. Open Facet, sign in, reload. |
| "couldn't reach …" | Server down, or the address is wrong. |
| "has no profile yet" | Connected fine — import a resume in The Stone first. |

"You're signed out" is detected by content type, not status code: Access
answers an unauthenticated request with **200 and a login page**, so trusting
the status alone produces `Unexpected token '<'`, which reads like a bug in
Facet rather than "you are signed out".

## Tests

```bash
node extension/check.mjs
```

Manifest structure and file references, permission shape, selector-map
schema, address normalization, the base64 transport, and the no-submit gate.
The gate is verified to fail when a submit path is introduced — a test that
cannot fail is not a test.

Loading it into Chrome remains the real check; this catches what would
otherwise cost you that round trip.
