/** Runnable self-check for the in-memory response cache:  npm run check
 *  Node 22.6+ strips the types itself — no test framework, no build step.
 *
 *  The cache is the one piece of `api.ts` that can be wrong without anything
 *  throwing: too eager and somebody sees a stale Cabinet after their own
 *  edit, too shy and it does nothing at all. Both look identical from the
 *  outside, so the four properties it rests on are asserted here against a
 *  counted `fetch`.
 */

import { api, clearApiCache } from "./api.ts";

let calls: string[] = [];
let unauthorized = false;

globalThis.fetch = (async (url: string) => {
  calls.push(String(url));
  return {
    ok: !unauthorized,
    status: unauthorized ? 401 : 200,
    headers: new Map(),
    json: async () => [],
  };
}) as unknown as typeof fetch;

function reset() {
  calls = [];
  clearApiCache();
}

async function demo() {
  // 1. A repeated read inside the window costs one request.
  reset();
  await api.listApplications();
  await api.listApplications();
  console.assert(calls.length === 1, `repeated read made ${calls.length} requests`);

  // 2. A write invalidates it — the failure mode that matters, because it is
  //    the user's own change not appearing.
  await api.updateApplication(1, { notes: "x" });
  await api.listApplications();
  console.assert(
    calls.filter((c) => c === "/api/applications").length === 2,
    "a write did not invalidate the cached read"
  );

  // 3. Polled endpoints are never cached, or the poll reports one answer
  //    forever and the spinner never resolves.
  reset();
  await api.job(1);
  await api.job(1);
  console.assert(calls.length === 2, `a polled read was cached (${calls.length} requests)`);

  // 4. Simultaneous identical reads share one request. The Cabinet issues
  //    four on mount; a re-render mid-flight must not double them.
  reset();
  await Promise.all([api.listApplications(), api.listApplications(), api.listApplications()]);
  console.assert(calls.length === 1, `three parallel reads made ${calls.length} requests`);

  // 5. A 401 on a page that is *meant* to be anonymous must not navigate.
  //
  //    This is the bug that broke setting a password: the health banner in
  //    the root layout calls an authenticated endpoint on every page, and the
  //    401 sent the browser to "your session has ended" — taking the invite
  //    token in the URL with it, so there was nothing left to click.
  for (const page of ["/set-password", "/login", "/"]) {
    reset();
    unauthorized = true;
    const location = { pathname: page, search: "?token=abc", href: page };
    (globalThis as { window?: unknown }).window = { location };
    try {
      await api.listApplications();
    } catch {
      // A 401 still throws — callers must be able to handle it. What must not
      // happen is the navigation.
    }
    console.assert(location.href === page, `a 401 on ${page} navigated to ${location.href}`);
    delete (globalThis as { window?: unknown }).window;
    unauthorized = false;
  }

  // ...and on a real app page it must still bounce, or an expired session
  // leaves someone staring at errors with no way to sign in again.
  reset();
  unauthorized = true;
  const cabinet = { pathname: "/cabinet", search: "", href: "/cabinet" };
  (globalThis as { window?: unknown }).window = { location: cabinet };
  try {
    await api.listApplications();
  } catch {
    /* expected */
  }
  console.assert(
    cabinet.href.startsWith("/login?reason=expired"),
    `an expired session on /cabinet did not reach the sign-in page (${cabinet.href})`
  );
  delete (globalThis as { window?: unknown }).window;
  unauthorized = false;

  // Any console.assert above prints but does not exit, so fail loudly here.
  if (process.exitCode) throw new Error("api cache: a check failed");
  console.log(
    "api cache: reuse, invalidation, poll bypass, dedupe - and a 401 only " +
      "redirects from pages that need a session"
  );
}

const original = console.assert;
console.assert = (condition: boolean, ...rest: unknown[]) => {
  if (!condition) process.exitCode = 1;
  original(condition, ...rest);
};

await demo();
