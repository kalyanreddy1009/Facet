"""Stand in for Cloudflare Access, on your own machine.

    backend/.venv/bin/python scripts/dev_access.py --as you@example.com

Multi-user Facet identifies people from the
`Cf-Access-Authenticated-User-Email` header that Cloudflare Access sets. That
is fine in production and useless on a laptop, where there is no Access in
front and every request is therefore correctly refused with a 401.

This forwards to the backend and adds that header, so you can open the real
UI as a chosen user and click around. Point the frontend at it:

    BACKEND_ORIGIN=http://127.0.0.1:8088 npm run dev

**A development tool, deliberately kept out of the app.** The obvious
alternative — a `FACET_DEV_IDENTITY` environment variable read by the
backend — is an authentication bypass living inside the production code
path, one stray env var away from making everybody the same person. A
separate process you have to start on purpose cannot be switched on by
accident.

It binds loopback only and refuses to do anything else, because a proxy that
mints identities must not be reachable from off the machine.
"""

import argparse
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

IDENTITY_HEADER = "Cf-Access-Authenticated-User-Email"

# Hop-by-hop headers must not be forwarded; passing Connection or
# Transfer-Encoding through a proxy produces responses the browser rejects
# in ways that look like application bugs.
HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length",
}


class Handler(BaseHTTPRequestHandler):
    upstream = "http://127.0.0.1:8000"
    identity = ""

    def log_message(self, fmt, *args):
        sys.stderr.write(f"  {self.identity} {fmt % args}\n")

    def _proxy(self):
        body = None
        length = self.headers.get("Content-Length")
        if length:
            body = self.rfile.read(int(length))

        request = urllib.request.Request(
            f"{self.upstream}{self.path}", data=body, method=self.command,
        )
        for key, value in self.headers.items():
            if key.lower() not in HOP_BY_HOP and key.lower() != IDENTITY_HEADER.lower():
                request.add_header(key, value)
        # Added last so a client cannot smuggle its own identity past us.
        request.add_header(IDENTITY_HEADER, self.identity)

        try:
            with urllib.request.urlopen(request) as response:
                self._relay(response.status, response.headers.items(), response.read())
        except urllib.error.HTTPError as exc:
            # An error response is still a response — Facet answers 401/403
            # with JSON the UI knows how to show.
            self._relay(exc.code, exc.headers.items(), exc.read())
        except urllib.error.URLError as exc:
            message = f"dev_access: cannot reach {self.upstream} — {exc.reason}"
            self._relay(502, [("Content-Type", "text/plain")], message.encode())

    def _relay(self, status, headers, payload):
        self.send_response(status)
        for key, value in headers:
            if key.lower() not in HOP_BY_HOP:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = _proxy


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--as", dest="identity", required=True,
                        help="the email address to authenticate every request as")
    parser.add_argument("--port", type=int, default=8088)
    parser.add_argument("--upstream", default="http://127.0.0.1:8000")
    args = parser.parse_args()

    Handler.identity = args.identity
    Handler.upstream = args.upstream.rstrip("/")

    print(f"dev_access: :{args.port} -> {Handler.upstream}, everyone is {args.identity}")
    print("Point the frontend at it:")
    print(f"  BACKEND_ORIGIN=http://127.0.0.1:{args.port} npm run dev")
    # Loopback only. This process hands out an identity to anything that can
    # reach it, so "anything" has to mean "this machine".
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
