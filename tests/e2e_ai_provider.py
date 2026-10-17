"""Stub OpenAI-compatible AI backend for browser tests only.

Loaded in the Playwright child process, never in production. It serves the
model list for the "local" backend and streams scripted chat completions, so
Assistant turns run through the real agent, tools, and storage.

The last user message picks the script:
- "slow": a long answer streamed slowly, for stopping mid-answer.
- "long": eighty short paragraphs, for scrolling.
- "fail once": an authentication error the first time, then the default script.
- "add lunch" or "add ten lunches": proposes new transactions, then links the first
  or accepts the dismissal.
- "tag ...": finds the transactions matching the question's last word and proposes
  tagging them "work".
- "pay ...": finds the reimbursement and the expenses matching the last
  word and proposes allocating half of each expense.
- "budget ...": proposes a 300,00 € budget from this month for the category whose
  name ends with the last word.
- "remove ...": proposes removing that category's budget from this month on.
- "archive ...": proposes archiving that category.
- "trash ...": finds the expenses matching the last word and proposes moving them
  to Trash.
- "end ...": finds the recurring payment matching the last word and proposes ending
  it on 30 June 2021.
- "undo ...": proposes undoing the latest change applied in the chat.
- anything else: reasoning, a note, a ledger read, then a short answer.

Write scenarios read ids only from tool results and the instructions, as a model would.
"""

import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = ["e2e-large", "e2e-small"]
ANSWER = (
    "You spent **1 234,56 €** in May.\n\n"
    "- Groceries: 800,00 €\n"
    "- Rent: 434,56 €\n\n"
    "That is less than in April. See [Budgets](page:budgets).\n\n"
    "![Chart](https://example.invalid/chart.png)"
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


def _call(messages: list[dict], name: str, arguments: dict) -> list[dict]:
    tool_call = {
        "index": 0,
        "id": f"call_{len(messages)}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }
    return [
        _chunk({"role": "assistant", "tool_calls": [tool_call]}),
        _chunk({}, "tool_calls"),
    ]


def _matching(messages: list[dict], token: str, kind: str) -> list[dict]:
    query = token.replace("'", "''")
    return _call(
        messages,
        "sql_query",
        {
            "label": f"Transactions matching {token}",
            "sql": f"select id from transactions where kind = '{kind}' "
            f"and (fuzzy(title, '{query}') or fuzzy(description, '{query}'))",
        },
    )


def _propose(messages: list[dict], change: dict) -> list[dict]:
    return _call(messages, "propose_change", {"change": change})


def _write_script(messages: list[dict], question: str) -> list[dict] | None:
    """A write scenario's next step, or None when the question names none."""
    words = question.lower().split()
    # Tool results needed before the proposal.
    steps = {
        "tag": 1,
        "pay": 2,
        "trash": 1,
        "end": 1,
        "budget": 0,
        "remove": 0,
        "archive": 0,
        "undo": 0,
    }.get(words[0] if words else "")
    if steps is None:
        return None
    token = question.split()[-1]
    since = max(i for i, m in enumerate(messages) if m["role"] == "user")
    results = [
        json.loads(m["content"]) for m in messages[since + 1 :] if m["role"] == "tool"
    ]
    if len(results) > steps:
        if results[-1]["status"] != "applied":
            return _text("Okay, nothing changed.")
        return _text(f"Done: {results[-1]['summary']}.")
    if words[0] == "tag":
        if not results:
            return _matching(messages, token, "expense")
        ids = [row[0] for row in results[0]["rows"]]
        return _propose(
            messages,
            {"kind": "edit_transactions", "transaction_ids": ids, "add_tags": ["work"]},
        )
    if words[0] == "pay":
        if not results:
            return _matching(messages, token, "reimbursement")
        if len(results) == 1:
            return _matching(messages, token, "expense")
        return _propose(
            messages,
            {
                "kind": "allocate_reimbursement",
                "reimbursement_id": results[0]["rows"][0][0],
                "expense_ids": [row[0] for row in results[1]["rows"]],
                "split": "share",
                "share_percent": 50,
            },
        )
    if words[0] == "trash":
        if not results:
            return _matching(messages, token, "expense")
        return _propose(
            messages,
            {
                "kind": "trash_transactions",
                "transaction_ids": [row[0] for row in results[0]["rows"]],
            },
        )
    if words[0] == "end":
        if not results:
            query = token.replace("'", "''")
            return _call(
                messages,
                "sql_query",
                {
                    "label": f"Recurring matching {token}",
                    "sql": f"select id from recurring where fuzzy(name, '{query}')",
                },
            )
        return _propose(
            messages,
            {
                "kind": "end_recurring",
                "recurring_ids": [row[0] for row in results[0]["rows"]],
                "end_date": "2021-06-30",
            },
        )
    instructions = "\n".join(
        m["content"] for m in messages if m["role"] in ("system", "developer")
    )
    today = re.search(r"Today is \w+, (\d{4}-\d{2})", instructions)[1]
    category = re.search(
        rf"^- (\d+): .* {re.escape(token)}, expense$", instructions, re.MULTILINE
    )
    if words[0] == "remove":
        return _propose(
            messages,
            {
                "kind": "remove_budgets",
                "budgets": [{"category_id": int(category[1]), "month": today}],
            },
        )
    if words[0] == "archive":
        return _propose(
            messages,
            {"kind": "archive", "category_ids": [int(category[1])], "tag_ids": []},
        )
    if words[0] == "budget":
        return _propose(
            messages,
            {
                "kind": "set_budgets",
                "budgets": [
                    {
                        "category_id": int(category[1]),
                        "month": today,
                        "amount_cents": 30_000,
                        "applies": "onward",
                    }
                ],
            },
        )
    applied = [
        result
        for m in messages
        if m["role"] == "tool"
        and (result := json.loads(m["content"])).get("status") == "applied"
    ]
    return _propose(messages, {"kind": "undo", "action_id": applied[-1]["action_id"]})


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
    if question.lower().startswith("add") and "lunch" in question.lower():
        if last["role"] == "tool":
            result = json.loads(last["content"])
            if result["status"] != "applied":
                return _text("Okay, nothing changed."), 0.01
            created = result["created"][0]["id"]
            return _text(f"Added [Lunch](transaction:{created})."), 0.01
        lunch = {
            "date": "2020-02-20",
            "kind": "expense",
            "amount_cents": 1250,
            "title": "Lunch",
        }
        count = 10 if "ten" in question.lower() else 1
        return _propose(
            messages, {"kind": "create_transactions", "transactions": [lunch] * count}
        ), 0.01
    if (chunks := _write_script(messages, question)) is not None:
        return chunks, 0.01
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
                            "name": "sql_query",
                            "arguments": json.dumps(
                                {
                                    "label": "Spending by category, May 2026",
                                    "sql": "select category, sum(net_cents) "
                                    "from transactions where kind = 'expense' "
                                    "and date between '2026-05-01' and '2026-05-31' "
                                    "group by category",
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
