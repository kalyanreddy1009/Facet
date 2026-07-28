/**
 * Deliberately does almost nothing. Per Section 11: no alarms API, no
 * scheduled runs, no persistent background behavior — the extension only
 * ever acts inside a tab a person opened themselves by clicking "Set This
 * Facet", via content_script.js reacting to that page loading. This file
 * exists only so Manifest V3's required service_worker entry has something
 * to point at.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("Facet Apply Assist installed — fills known fields, never submits.");
});
