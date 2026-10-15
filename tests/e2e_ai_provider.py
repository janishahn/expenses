"""Stub OpenAI-compatible AI backend for browser tests only.

Loaded in the Playwright child process, never in production. It serves the
model list for the "local" backend; Expenses settings and API authorization
remain real.
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = ["e2e-large", "e2e-small"]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/v1/models":
            self.send_error(404)
            return
        body = json.dumps(
            {"object": "list", "data": [{"id": m, "object": "model"} for m in MODELS]}
        ).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def install():
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    os.environ["EXPENSES_AI_LOCAL_BASE_URL"] = (
        f"http://127.0.0.1:{server.server_address[1]}/v1"
    )
