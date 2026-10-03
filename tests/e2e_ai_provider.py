"""External identity/inference fixtures for opt-in browser tests only.

Loaded in the Playwright child process, never in production. Expenses settings,
OAuth pairing state, encrypted persistence and API authorization remain real.
"""

import json

import httpx


def response_events(text="Hello", terminal="response.completed", tool=False):
    response = {
        "id": "resp_1",
        "created_at": 1,
        "object": "response",
        "status": "completed",
        "model": "gpt-6-luna",
        "output": [],
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    }
    events = [
        {"type": "response.created", "response": {**response, "status": "in_progress"}}
    ]
    if tool:
        item = {
            "type": "function_call",
            "id": "fc_1",
            "call_id": "call_1",
            "name": "balance",
            "namespace": "expenses",
            "arguments": "",
        }
        events += [
            {"type": "response.output_item.added", "output_index": 0, "item": item},
            {
                "type": "response.function_call_arguments.delta",
                "item_id": "fc_1",
                "output_index": 0,
                "delta": "{}",
            },
        ]
    else:
        events += [
            {
                "type": "response.output_item.added",
                "output_index": 0,
                "item": {
                    "type": "message",
                    "id": "msg_1",
                    "role": "assistant",
                    "content": [],
                    "status": "in_progress",
                },
            },
            {
                "type": "response.content_part.added",
                "item_id": "msg_1",
                "output_index": 0,
                "content_index": 0,
                "part": {"type": "output_text", "text": "", "annotations": []},
            },
            {
                "type": "response.output_text.delta",
                "item_id": "msg_1",
                "output_index": 0,
                "content_index": 0,
                "delta": text,
            },
        ]
    if terminal:
        if terminal == "response.failed":
            response["error"] = {
                "code": "subscription_sharing_usage_limit_exceeded",
                "message": "limit",
            }
            response["status"] = "failed"
        events.append({"type": terminal, "response": response})
    return "".join(
        "data: " + json.dumps(event | {"sequence_number": i}) + "\n\n"
        for i, event in enumerate(events)
    )


def install(mock_openai=False):
    from expenses.ai import chatgpt

    real_client = httpx.AsyncClient
    catalog = [
        {
            "slug": "gpt-6-luna",
            "display_name": "GPT-6 Luna",
            "visibility": "list",
            "supported_reasoning_levels": [{"effort": "low"}, {"effort": "medium"}],
        },
        {
            "slug": "gpt-6.1-sol",
            "display_name": "GPT-6.1 Sol",
            "visibility": "list",
            "supported_reasoning_levels": [
                {"effort": "low"},
                {"effort": "medium"},
                {"effort": "high"},
            ],
        },
    ]

    def handle(request):
        if request.url.path.endswith("openid-configuration"):
            return httpx.Response(
                200,
                json={
                    "issuer": chatgpt.AUTH_ORIGIN,
                    **{
                        field: f"{chatgpt.AUTH_ORIGIN}/{field}"
                        for field in (
                            "authorization_endpoint",
                            "token_endpoint",
                            "revocation_endpoint",
                            "jwks_uri",
                        )
                    },
                },
            )
        if request.url.path.endswith("/models"):
            return httpx.Response(
                200,
                json={
                    "models": catalog,
                    "data": [{"id": row["slug"]} for row in catalog],
                },
            )
        if request.url.path.endswith("/responses"):
            if json.loads(request.content)["model"] == "custom-model":
                return httpx.Response(
                    200,
                    headers={"content-type": "text/event-stream"},
                    text=response_events("OK"),
                )
            return httpx.Response(404, json={"error": {"code": "model_not_found"}})
        if request.url.path.endswith("revocation_endpoint"):
            return httpx.Response(200)
        return httpx.Response(
            503,
            json={"error": "External inference is not part of this browser fixture."},
        )

    async def identity(_client, token, client_id, nonce=None):
        if token != "e2e-id-token" or client_id != "e2e-client":
            raise chatgpt.ChatGPTError("Invalid test identity")
        return {"sub": "e2e-account", "email": "test@example.com", "nonce": nonce}

    if mock_openai:
        chatgpt.verify_identity = identity

    class ExternalTransport(httpx.AsyncBaseTransport):
        def __init__(self):
            self.upstream = httpx.AsyncHTTPTransport()

        async def handle_async_request(self, request):
            if (
                request.url.host == "127.0.0.1"
                and request.url.port == 1
                and request.url.path == "/v1/models"
            ):
                return handle(request)
            if mock_openai and request.url.host in {
                "api.openai.com",
                "auth.openai.com",
            }:
                return handle(request)
            return await self.upstream.handle_async_request(request)

        async def aclose(self):
            await self.upstream.aclose()

    class ExternalClient(real_client):
        def __init__(self, **kwargs):
            super().__init__(**({"transport": ExternalTransport()} | kwargs))

    httpx.AsyncClient = ExternalClient
