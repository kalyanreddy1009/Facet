/**
 * Shared between the service worker and the options page.
 *
 * Both need to agree on exactly what a valid Facet address is: the options
 * page validates what you typed and requests permission for it, and the
 * worker builds requests and permission checks from what was stored. If those
 * two disagreed even slightly — a trailing slash, a path, a port — the
 * options page would report success and every later request would be denied
 * for an origin nobody granted.
 */

/**
 * The origin, or "" if this is not a usable Facet address.
 *
 * Reduced to an origin on purpose. A permission grant is per-origin, so
 * keeping a path would let the stored value and the granted pattern drift
 * apart. `https://alice.facet.example/some/path/` and
 * `https://alice.facet.example` are the same grant and must be the same
 * string.
 */
export function normalizeBaseUrl(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";

  // A bare host is what people type, so a missing scheme is filled in as
  // https — never http, since silently downgrading the transport for
  // something carrying a resume and a session cookie is not a helpful
  // default.
  //
  // But only when there is genuinely no scheme. Prepending unconditionally
  // turns `file:///etc/passwd` into `https://file:///etc/passwd`, which
  // parses cleanly as the origin `https://file` — a made-up address accepted
  // from input that should have been rejected outright.
  let withScheme;
  if (/^https?:\/\//i.test(trimmed)) {
    withScheme = trimmed;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return "";  // some other scheme — javascript:, file:, data:. Not ours.
  } else {
    withScheme = `https://${trimmed}`;
  }

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    return url.origin;
  } catch {
    return "";
  }
}

/** The match pattern Chrome wants for an origin. */
export function originPattern(baseUrl) {
  return `${baseUrl}/*`;
}

/**
 * Plaintext HTTP to somewhere that is not this machine.
 *
 * Worth a warning rather than a refusal: `http://localhost:8000` is the
 * normal single-user setup and is fine, but plain http to a remote host
 * sends a session cookie and a resume across the network in the clear. A
 * hosted Facet is behind Cloudflare and therefore https, so seeing this
 * usually means a typo rather than a decision.
 */
export function isInsecureRemote(baseUrl) {
  try {
    const { protocol, hostname } = new URL(baseUrl);
    if (protocol !== "http:") return false;
    return !(hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]");
  } catch {
    return false;
  }
}
