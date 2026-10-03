"""Run on the computer with your browser: uv run connect-chatgpt --server URL.

Only a short-lived pairing code is entered here. Tokens are exchanged locally,
transferred over HTTPS to the user's Expenses runtime, and never written locally.
"""

from __future__ import annotations

import argparse
import getpass
from http.server import BaseHTTPRequestHandler, HTTPServer
import secrets
import time
from urllib.parse import parse_qs, urlparse
import webbrowser

import httpx

from expenses.ai.chatgpt import API_ORIGIN


def server_url(value: str) -> str:
    parsed = urlparse(value)
    if (
        (
            parsed.scheme != "https"
            and not (
                parsed.scheme == "http"
                and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
            )
        )
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError("Use an HTTPS Expenses origin, or HTTP on localhost.")
    return value.rstrip("/")


def connect(server: str, pairing_code: str) -> None:
    result: dict[str, list[str]] = {}
    state = ""

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Authorization codes and identity hints must never be logged.

        def do_GET(self):
            parsed = urlparse(self.path)
            values = parse_qs(parsed.query)
            if parsed.path != "/auth/callback" or not secrets.compare_digest(
                values.get("state", [""])[0], state
            ):
                self.send_error(400, "Invalid sign-in callback")
                return
            result.update(values)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(
                b"You can close this tab and return to the Expenses connection helper."
            )

    with (
        HTTPServer(("127.0.0.1", 0), Callback) as listener,
        httpx.Client(timeout=30, follow_redirects=False) as client,
    ):
        headers = {"X-ChatGPT-Pairing": pairing_code}
        response = client.post(
            server + "/api/ai/chatgpt/pairing/start",
            headers=headers,
            json={"port": listener.server_port},
        )
        if not response.is_success:
            raise ValueError(
                "Pairing could not start. Check the server address and create a fresh pairing code."
            )
        flow = response.json()
        state = flow["state"]
        for key in ("authorization_url", "token_endpoint"):
            parsed = urlparse(flow[key])
            if parsed.scheme != "https" or parsed.netloc != "auth.openai.com":
                raise ValueError(
                    "The server supplied an unexpected OpenAI sign-in address."
                )
        if not webbrowser.open(flow["authorization_url"]):
            raise ValueError(
                "Could not open your browser. Run this helper on your desktop computer."
            )
        print("Finish signing in with ChatGPT in your browser.")
        listener.timeout = 1
        deadline = time.monotonic() + 540
        while not result and time.monotonic() < deadline:
            listener.handle_request()
        if not result or "error" in result or "code" not in result:
            raise ValueError(
                "Sign-in was cancelled or timed out. Create a new pairing code to retry."
            )
        client_id = result.get("client_id", [flow["client_id"]])[0]
        if client_id == "dynamic_agent_client" or (
            flow["client_id"] != "dynamic_agent_client"
            and client_id != flow["client_id"]
        ):
            raise ValueError("ChatGPT returned an unexpected registration.")
        response = client.post(
            flow["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "code": result["code"][0],
                "code_verifier": flow["code_verifier"],
                "redirect_uri": flow["redirect_uri"],
                "resource": API_ORIGIN,
            },
        )
        if not response.is_success:
            raise ValueError(
                "ChatGPT sign-in could not be completed. Create a new pairing code to retry."
            )
        grant = response.json()
        # The backend verifies signature, issuer, audience, and its original nonce
        # before persisting credentials. No API response containing tokens is printed.
        transfer = {
            key: grant[key]
            for key in (
                "access_token",
                "refresh_token",
                "id_token",
                "scope",
                "expires_in",
            )
        }
        transfer["client_id"] = client_id
        response = client.post(
            server + "/api/ai/chatgpt/pairing/complete", headers=headers, json=transfer
        )
        if not response.is_success:
            raise ValueError(
                "Expenses could not verify the connection. Create a new pairing code to retry."
            )
    print("ChatGPT connected. Return to AI settings to select models for each feature.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", required=True, help="Your Expenses HTTPS address")
    args = parser.parse_args()
    try:
        server = server_url(args.server)
        code = getpass.getpass("Pairing code from Expenses AI settings: ").strip()
        if not code:
            raise ValueError("A pairing code is required.")
        connect(server, code)
    except (ValueError, KeyError, httpx.HTTPError, OSError) as exc:
        # HTTP exceptions can contain request URLs: keep diagnostics token-free.
        message = (
            str(exc)
            if isinstance(exc, ValueError)
            else "Connection failed. Check network access and try again."
        )
        parser.exit(1, message + "\n")


if __name__ == "__main__":
    main()
