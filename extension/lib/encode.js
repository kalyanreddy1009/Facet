/**
 * Moving bytes across the extension messaging boundary.
 *
 * A Blob cannot make the trip — structured clone turns it into an empty
 * object, and the failure surfaces far from the cause, as a File with no
 * contents attached to a form. So resume bytes travel as a data URL.
 *
 * Kept in its own module with no `chrome` dependency so it can be run
 * outside a browser; see config.check.mjs.
 */

/**
 * ArrayBuffer to base64.
 *
 * The obvious one-liner — `btoa(String.fromCharCode(...bytes))` — throws
 * RangeError once the resume is more than a few hundred KB, because spreading
 * a typed array into arguments overflows the call stack. It works on every
 * small test file and fails on real ones, so this walks the buffer in chunks
 * instead.
 */
export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * The filename a Content-Disposition header is asking for.
 *
 * Handles both `filename="x.pdf"` and RFC 5987's `filename*=UTF-8''x%20y.pdf`,
 * because Facet's own export names contain spaces and non-ASCII often enough
 * to matter. Falls back rather than failing: a resume attached under a
 * generic name is better than no resume.
 */
export function filenameFromDisposition(disposition, fallback = "resume.pdf") {
  if (!disposition) return fallback;

  const extended = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      return fallback;
    }
  }

  const plain = disposition.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
  if (plain) {
    const value = (plain[1] || plain[2] || "").trim();
    if (value) return value;
  }

  return fallback;
}
