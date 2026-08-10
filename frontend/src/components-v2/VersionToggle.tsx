"use client";

import { useRouter } from "next/navigation";
import { setVersionCookie, toV1Path } from "@/lib/version";

/** The site-wide switch back to v1, from anywhere in the v2 tree. The forward
 *  direction (v1 -> v2) lives in v1's NavBar as `V2ToggleLink`; this is its
 *  mirror. Both write the cookie *before* navigating so the destination page
 *  (and middleware, on the next bare visit) agree with where the click sent
 *  them — writing it after would leave a one-request window where a reload
 *  bounces back to the version you just left. */
export default function VersionToggle({ pathname }: { pathname: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="v2-toggle"
      onClick={() => {
        setVersionCookie("v1");
        router.push(toV1Path(pathname));
      }}
    >
      <span className="v2-toggle-dot" aria-hidden />
      Switch to V1
    </button>
  );
}
