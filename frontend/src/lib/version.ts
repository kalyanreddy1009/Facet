/** The v1/v2 site-wide toggle.
 *
 * A single cookie (`fv`, "facet version") is the entire mechanism. It is read
 * by `middleware.ts` on every top-level route so a bare URL — typed, bookmarked,
 * or from an old link — lands on whichever version was last chosen, and it is
 * written by `VersionToggle` when someone flips the switch. No React context,
 * no server round trip: a cookie is exactly enough state for one flag that one
 * local user sets a few times a session.
 */

export const VERSION_COOKIE = "fv";

/** Every top-level route that exists in both trees. `/` maps to `/v2` (not
 *  `/v2/`), everything else to `/v2${path}`. Keep in step with `app/v2/*`. */
export const MIRRORED_PATHS = [
  "/",
  "/login",
  "/set-password",
  "/stone",
  "/rough",
  "/tailor",
  "/cabinet",
  "/profile",
  "/status",
  "/admin",
];

export function toV2Path(pathname: string): string {
  if (pathname === "/") return "/v2";
  return `/v2${pathname}`;
}

export function toV1Path(pathname: string): string {
  if (pathname === "/v2" || pathname === "/v2/") return "/";
  return pathname.replace(/^\/v2/, "") || "/";
}

/** Write the preference so the *next* bare navigation (typed URL, bookmark,
 *  a link from outside the toggle) stays on this version. `path=/` so it
 *  applies to both trees; a year is "remember until I say otherwise". */
export function setVersionCookie(version: "v1" | "v2") {
  if (typeof document === "undefined") return;
  document.cookie = `${VERSION_COOKIE}=${version}; path=/; max-age=31536000; samesite=lax`;
}
