"""Static file server for local preview.

Sends `Cache-Control: no-store` so an edited ES module is always re-fetched:
the browser otherwise keeps a stale module in its graph and reports exports
that were added seconds ago as missing.
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4321
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
