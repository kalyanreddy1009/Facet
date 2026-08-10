import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MIRRORED_PATHS, VERSION_COOKIE, toV2Path } from "@/lib/version";

/** Keeps a bare URL — typed, bookmarked, or a link that doesn't know about the
 *  toggle — on whichever version the `fv` cookie last recorded. Only redirects
 *  a v1 top-level route to its v2 counterpart when the cookie says v2; the
 *  reverse direction needs no redirect because v2 pages simply exist at their
 *  own `/v2/...` URLs and are never the default. */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const fv = request.cookies.get(VERSION_COOKIE)?.value;

  if (fv === "v2" && MIRRORED_PATHS.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = toV2Path(pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/set-password", "/stone", "/rough", "/tailor", "/cabinet", "/profile", "/status", "/admin"],
};
