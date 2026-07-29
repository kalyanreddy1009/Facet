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

globalThis.fetch = (async (url: string) => {
  calls.push(String(url));
  return {
    ok: true,
    status: 200,
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

  // Any console.assert above prints but does not exit, so fail loudly here.
  if (process.exitCode) throw new Error("api cache: a check failed");
  console.log("api cache: reuse, invalidation, poll bypass, and dedupe all hold");
}

const original = console.assert;
console.assert = (condition: boolean, ...rest: unknown[]) => {
  if (!condition) process.exitCode = 1;
  original(condition, ...rest);
};

await demo();
