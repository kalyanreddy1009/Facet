/** @type {import('next').NextConfig} */

// Next proxies /api/* to the backend, always. The browser only ever talks to
// the frontend's own origin, which means:
//   - no API host/port baked into the JS bundle at build time, so one image
//     runs anywhere,
//   - no CORS, because nothing is cross-origin,
//   - the backend needn't be reachable from the browser at all — only from
//     the frontend container.
//
// This used to apply only when BACKEND_ORIGIN was set, leaving local runs on
// a second, cross-origin code path that production never exercised. Behind a
// domain with per-user hostnames that difference stops being cosmetic, so the
// proxy is now unconditional and local defaults to the port run.py uses.
const backendOrigin = process.env.BACKEND_ORIGIN || "http://localhost:8000";

const nextConfig = {
  // Emits a self-contained server bundle so the runtime image needs neither
  // node_modules nor the source tree.
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,

  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backendOrigin}/api/:path*` }];
  },
};

export default nextConfig;
