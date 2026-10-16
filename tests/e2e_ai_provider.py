"""Stub OpenAI-compatible AI backend for browser tests only.

Loaded in the Playwright child process, never in production. It serves the
model list for the "local" backend and streams scripted chat completions, so
Assistant turns run through the real agent, tools, and storage.

The last user message picks the script:
- "slow": a long answer streamed slowly, for stopping mid-answer.
- "long": eighty short paragraphs, for scrolling.
- "fail once": an authentication error the first time, then the default script.
- "add lunch": proposes a new transaction, then links it or accepts the dismissal.
- anything else: reasoning, a note, a ledger read, then a short answer.
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = ["e2e-large", "e2e-small"]
ANSWER = (
    "You spent **1 234,56 €** in May.\n\n"
    "- Groceries: 800,00 €\n"
    "- Rent: 434,56 €\n\n"
    "That is less than in April."
)
SLOW_ANSWER = " ".join(f"Word{index}" for index in range(400))
LONG_ANSWER = [f"Spending detail {index}.\n\n" for index in range(1, 81)]
_failed_once: set[str] = set()
_lock = threading.Lock()


def _chunk(delta: dict | None, finish: str | None = None) -> dict:
    return {
        "id": "chatcmpl-e2e",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "e2e-large",
        "choices": []
        if delta is None
        else [{"index": 0, "delta": delta, "finish_reason": finish}],
        "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20}
        if delta is None
        else None,
    }


def _words(text: str) -> list[str]:
    parts = text.split(" ")
    return [
        part + (" " if index < len(parts) - 1 else "")
        for index, part in enumerate(parts)
    ]


def _text(text: str) -> list[dict]:
    return [*(_chunk({"content": word}) for word in _words(text)), _chunk({}, "stop")]


def _script(messages: list[dict]) -> tuple[list[dict], float]:
    """The chunks to stream and the pause between them."""
    last = messages[-1]
    user = next(m for m in reversed(messages) if m["role"] == "user")
    question = user["content"] if isinstance(user["content"], str) else ""
    if "slow" in question.lower():
        return _text(SLOW_ANSWER), 0.08
    if "long" in question.lower():
        return [
            *(_chunk({"content": part}) for part in LONG_ANSWER),
            _chunk({}, "stop"),
        ], 0.05
    if "add lunch" in question.lower():
        if last["role"] == "tool":
            result = json.loads(last["content"])
            if result["status"] != "applied":
                return _text("Okay, nothing changed."), 0.01
            created = result["created"][0]["id"]
            return _text(f"Added [Lunch](transaction:{created})."), 0.01
        return [
            _chunk(
                {
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": f"call_{len(messages)}",
                            "type": "function",
                            "function": {
                                "name": "create_transactions",
                                "arguments": json.dumps(
                                    {
                                        "transactions": [
                                            {
                                                "date": "2020-02-20",
                                                "kind": "expense",
                                                "amount_cents": 1250,
                                                "title": "Lunch",
                                            }
                                        ]
                                    }
                                ),
                            },
                        }
                    ],
                }
            ),
            _chunk({}, "tool_calls"),
        ], 0.01
    if last["role"] == "tool":
        return _text(ANSWER), 0.01
    return [
        _chunk({"role": "assistant", "reasoning_content": "Checking May by category."}),
        *(_chunk({"content": word}) for word in _words("I'll check May's spending.")),
        _chunk(
            {
                "tool_calls": [
                    {
                        "index": 0,
                        "id": f"call_{len(messages)}",
                        "type": "function",
                        "function": {
                            "name": "query_transactions",
                            "arguments": json.dumps(
                                {
                                    "start": "2026-05-01",
                                    "end": "2026-05-31",
                                    "group_by": "category",
                                }
                            ),
                        },
                    }
                ]
            }
        ),
        _chunk({}, "tool_calls"),
    ], 0.01


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/v1/models":
            self.send_error(404)
            return
        self._json(
            200,
            {"object": "list", "data": [{"id": m, "object": "model"} for m in MODELS]},
        )

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        messages = body["messages"]
        question = next(m for m in reversed(messages) if m["role"] == "user")["content"]
        if isinstance(question, str) and "fail once" in question.lower():
            with _lock:
                first = question not in _failed_once
                _failed_once.add(question)
            if first:
                self._json(
                    401,
                    {
                        "error": {
                            "message": "Invalid API key",
                            "type": "invalid_request_error",
                        }
                    },
                )
                return
        chunks, pause = _script(messages)
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        try:
            for chunk in [*chunks, _chunk(None)]:
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                self.wfile.flush()
                time.sleep(pause)
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # The Assistant stopped the run.
            return

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
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
