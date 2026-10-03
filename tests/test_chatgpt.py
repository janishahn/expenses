from __future__ import annotations

import asyncio
import json
import time

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from openai import AsyncOpenAI
from pydantic_ai import Agent

from expenses.ai import chatgpt, credentials, preferences
from expenses.ai.chatgpt_model import ChatGPTResponsesModel
from expenses.ai.preferences import ResolvedAI
from expenses.core.config import get_settings


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def enabled(api_client, monkeypatch):
    monkeypatch.setenv("EXPENSES_LLM_ENABLED", "true")
    monkeypatch.delenv("EXPENSES_LLM_BASE_URL", raising=False)
    get_settings.cache_clear()
    return api_client


def grant(**extra):
    return {
        "client_id": "client_1",
        "access_token": "access-secret",
        "refresh_token": "refresh-secret",
        "id_token": "id-secret",
        "scope": chatgpt.SCOPES,
        "expires_in": 3600,
        "expires_at": time.time() + 3600,
        "status": "connected",
        "subject": "subject-1",
        **extra,
    }


def csrf(client):
    return {"X-CSRF-Token": client.get("/api/csrf").json()["token"]}


async def catalog(_user_id, _provider):
    return [
        {"id": "gpt-6-luna", "name": "Luna", "reasoning_efforts": ["low", "medium"]},
        {
            "id": "gpt-6.1-sol",
            "name": "Sol",
            "reasoning_efforts": ["low", "medium", "high"],
        },
    ]


def test_settings_are_per_user_and_validate_models_atomically(enabled, monkeypatch):
    monkeypatch.setattr(preferences, "list_models", catalog)
    payload = {
        "features": {
            "transaction_triage": {
                "provider": "chatgpt",
                "model": "gpt-6-luna",
                "reasoning_effort": "low",
            },
            "spending_chat": {
                "provider": "chatgpt",
                "model": "gpt-6.1-sol",
                "reasoning_effort": "high",
            },
        }
    }
    assert enabled.put("/api/ai/settings", json=payload).status_code == 400
    response = enabled.put("/api/ai/settings", headers=csrf(enabled), json=payload)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    rows = {row["id"]: row for row in response.json()["features"]}
    assert rows["transaction_triage"]["model"] == "gpt-6-luna"
    assert rows["spending_chat"]["reasoning_effort"] == "high"
    assert rows["rule_mining"]["provider"] == "configured"
    payload["features"]["transaction_triage"]["model"] = "not-available"
    payload["features"]["spending_chat"]["reasoning_effort"] = "low"
    assert (
        enabled.put("/api/ai/settings", headers=csrf(enabled), json=payload).status_code
        == 409
    )
    assert enabled.get("/api/ai/settings").json()["features"] == list(rows.values())
    enabled.post("/api/auth/logout", headers=csrf(enabled))
    assert enabled.get("/api/ai/settings").status_code == 401
    assert (
        enabled.post(
            "/api/auth/signup", json={"username": "second", "password": "secure-pass"}
        ).status_code
        == 200
    )
    assert (
        enabled.post(
            "/api/auth/login", json={"username": "second", "password": "secure-pass"}
        ).status_code
        == 200
    )
    other = enabled.get("/api/ai/settings").json()
    assert all(row["model"] == "" for row in other["features"])
    assert other["connection"]["status"] == "disconnected"


def test_credentials_encrypted_and_connection_does_not_expose_tokens(enabled):
    credentials.save(1, grant())
    paths = list((get_settings().data_dir / "secrets" / "chatgpt").glob("*.enc"))
    assert len(paths) == 1
    assert paths[0].stat().st_mode & 0o777 == 0o600
    assert "access-secret" not in paths[0].read_text()
    assert "refresh-secret" not in paths[0].read_text()
    assert credentials.load(1)["access_token"] == "access-secret"
    response = enabled.get("/api/ai/settings")
    assert response.json()["connection"]["status"] == "connected"
    assert "secret" not in response.text
    assert credentials.load(2) is None


def test_pairing_is_expiring_one_time_and_not_a_login_session(enabled, monkeypatch):
    async def flow(user, port):
        return {"nonce": "nonce", "client_id": "dynamic_agent_client", "port": port}

    accepted = []

    async def accept(user, token, pending_flow):
        accepted.append((user, pending_flow["nonce"]))

    monkeypatch.setattr(chatgpt, "authorization_flow", flow)
    monkeypatch.setattr(chatgpt, "accept_grant", accept)
    response = enabled.post("/api/ai/chatgpt/pairing", headers=csrf(enabled))
    assert response.status_code == 200
    code = response.json()["pairing_code"]
    headers = {"X-ChatGPT-Pairing": code}
    assert (
        enabled.post(
            "/api/ai/chatgpt/pairing/start",
            headers={"X-ChatGPT-Pairing": "wrong"},
            json={"port": 1455},
        ).status_code
        == 401
    )
    assert (
        enabled.post(
            "/api/ai/chatgpt/pairing/start", headers=headers, json={"port": 1455}
        ).status_code
        == 200
    )
    assert (
        enabled.post(
            "/api/ai/chatgpt/pairing/start", headers=headers, json={"port": 1455}
        ).status_code
        == 409
    )
    assert (
        enabled.post(
            "/api/ai/chatgpt/pairing/complete", headers=headers, json=grant()
        ).status_code
        == 200
    )
    assert accepted == [(1, "nonce")]
    assert (
        enabled.post(
            "/api/ai/chatgpt/pairing/complete", headers=headers, json=grant()
        ).status_code
        == 401
    )
    assert (
        enabled.get("/api/ai/settings", headers=headers).status_code == 200
    )  # cookie is still needed
    enabled.cookies.clear()
    assert enabled.get("/api/ai/settings", headers=headers).status_code == 401


@pytest.mark.anyio
async def test_identity_checks_signature_audience_and_nonce(enabled):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key())) | {
        "kid": "test"
    }
    metadata = {
        "issuer": chatgpt.AUTH_ORIGIN,
        **{
            name: f"{chatgpt.AUTH_ORIGIN}/{name}"
            for name in (
                "authorization_endpoint",
                "token_endpoint",
                "jwks_uri",
                "revocation_endpoint",
            )
        },
    }

    def handler(request):
        return httpx.Response(
            200, json={"keys": [key]} if request.url.path == "/jwks_uri" else metadata
        )

    claims = {
        "iss": chatgpt.AUTH_ORIGIN,
        "aud": "client_1",
        "sub": "account",
        "exp": int(time.time()) + 600,
        "nonce": "expected",
    }
    token = jwt.encode(claims, private, algorithm="RS256", headers={"kid": "test"})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert (await chatgpt.verify_identity(client, token, "client_1", "expected"))[
            "sub"
        ] == "account"
        with pytest.raises(chatgpt.ChatGPTError):
            await chatgpt.verify_identity(client, token, "client_1", "wrong")
        with pytest.raises(chatgpt.ChatGPTError):
            await chatgpt.verify_identity(client, token, "other-client", "expected")


@pytest.mark.anyio
async def test_refresh_is_serialized_and_reuses_registration(enabled, monkeypatch):
    credentials.save(1, grant(expires_at=0))
    requests = []

    async def handler(request):
        requests.append(request)
        await asyncio.sleep(0.01)
        assert b"client_id=client_1" in request.content
        assert b"refresh_token=refresh-secret" in request.content
        return httpx.Response(
            200,
            json={
                "access_token": "renewed",
                "refresh_token": "rotated",
                "expires_in": 3600,
            },
        )

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        chatgpt.httpx,
        "AsyncClient",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )

    async def metadata(_client):
        return {"token_endpoint": "https://auth.openai.com/token"}

    monkeypatch.setattr(chatgpt, "discovery", metadata)
    assert await asyncio.gather(chatgpt.access_token(1), chatgpt.access_token(1)) == [
        "renewed",
        "renewed",
    ]
    assert len(requests) == 1
    assert credentials.load(1)["refresh_token"] == "rotated"
    with pytest.raises(chatgpt.ChatGPTError):
        await chatgpt.access_token(2)


@pytest.mark.anyio
async def test_no_plan_permission_means_no_inference(enabled):
    credentials.save(1, grant(scope="openid profile email"))
    with pytest.raises(chatgpt.ChatGPTError, match="allow Expenses"):
        await chatgpt.access_token(1)


def test_model_catalog_filters_hidden_models():
    assert chatgpt.parse_models(
        {
            "models": [
                {"slug": "hidden", "visibility": "hide"},
                {
                    "slug": "gpt-6-luna",
                    "display_name": "Luna",
                    "visibility": "list",
                    "supported_reasoning_levels": [{"effort": "low"}],
                },
            ]
        },
        chatgpt=True,
    ) == [{"id": "gpt-6-luna", "name": "Luna", "reasoning_efforts": ["low"]}]


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


@pytest.mark.anyio
async def test_responses_wire_contract_and_tool_history(enabled):
    credentials.save(1, grant())
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        assert str(request.url) == "https://api.openai.com/v1/responses"
        assert request.headers["authorization"] == "Bearer access-secret"
        assert body["store"] is False and body["stream"] is True
        assert isinstance(body["input"], list)
        assert body["reasoning"] == {"effort": "low"}
        assert not set(body) & {
            "temperature",
            "max_output_tokens",
            "previous_response_id",
            "conversation",
            "background",
            "user",
        }
        assert all(item.get("role") != "system" for item in body["input"])
        assert body["tools"][0]["type"] == "namespace"
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=response_events("Balance is €12.", tool=len(calls) == 1),
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        sdk = AsyncOpenAI(api_key="unused", http_client=http, max_retries=0)
        model = ChatGPTResponsesModel(
            ResolvedAI(1, "chatgpt", "gpt-6-luna", "low"), sdk
        )
        agent = Agent(
            model,
            system_prompt="Use balance to answer.",
            model_settings={"openai_store": False, "openai_reasoning_effort": "low"},
        )

        @agent.tool_plain
        def balance() -> str:
            return "€12"

        result = await agent.run("What is my balance?")
        assert result.output == "Balance is €12."
        assert len(calls) == 2
        assert any(
            item.get("type") == "function_call_output" for item in calls[1]["input"]
        )
        assert result.usage.input_tokens == 20


@pytest.mark.anyio
@pytest.mark.parametrize("terminal", ["response.failed", "response.incomplete", None])
async def test_partial_stream_is_never_success(enabled, terminal):
    credentials.save(1, grant())
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text=response_events(terminal=terminal),
            )
        )
    ) as http:
        sdk = AsyncOpenAI(api_key="unused", http_client=http, max_retries=0)
        model = ChatGPTResponsesModel(
            ResolvedAI(1, "chatgpt", "gpt-6-luna", "auto"), sdk
        )
        with pytest.raises(chatgpt.ChatGPTError):
            await Agent(model, model_settings={"openai_store": False}).run("Hello")


@pytest.mark.anyio
async def test_disconnect_clears_tokens_even_if_remote_revocation_fails(
    enabled, monkeypatch
):
    credentials.save(1, grant())

    async def broken(_client):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(chatgpt, "discovery", broken)
    assert await chatgpt.disconnect(1) is False
    saved = credentials.load(1)
    assert saved["status"] == "disconnected"
    assert saved["client_id"] == "client_1"
    assert not set(saved) & {"access_token", "refresh_token", "id_token"}
    with pytest.raises(chatgpt.ChatGPTError):
        await chatgpt.access_token(1)


@pytest.mark.anyio
async def test_suggestions_use_selected_chatgpt_model_and_schema(enabled, monkeypatch):
    from expenses.ai.client import PydanticAILLMRunner
    from expenses.ai.schemas import TransactionTriageOutput
    from expenses.ai import chatgpt_model

    credentials.save(1, grant())
    payload = {
        "category_id": 7,
        "tags": [],
        "clean_title": "Bakery",
        "confidence": 0.95,
        "reason": "Groceries",
    }
    bodies = []

    def handler(request):
        body = json.loads(request.content)
        bodies.append(body)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            text=response_events(json.dumps(payload)),
        )

    async def build(configuration):
        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        sdk = AsyncOpenAI(api_key="unused", http_client=http, max_retries=0)
        return (
            ChatGPTResponsesModel(configuration, sdk),
            http,
            {
                "openai_store": False,
                "openai_reasoning_effort": configuration.reasoning_effort,
            },
        )

    monkeypatch.setattr(chatgpt_model, "build_model", build)
    runner = PydanticAILLMRunner(
        configuration=ResolvedAI(1, "chatgpt", "gpt-6-luna", "low"),
        max_tokens=2048,
        temperature=0.7,
        reasoning_effort="medium",
    )
    result = await runner.run(
        feature="transaction_triage",
        prompt_version="test",
        payload={"categories": [{"id": 7}], "transaction": {"title": "Bakery"}},
        output_type=TransactionTriageOutput,
    )
    assert result.output.category_id == 7
    assert result.usage_metadata.llm_provider == "chatgpt"
    assert result.usage_metadata.cost_decimal is None
    assert bodies[0]["model"] == "gpt-6-luna"
    assert bodies[0]["reasoning"]["effort"] == "low"
    assert "max_output_tokens" not in bodies[0]


@pytest.mark.anyio
async def test_streamed_agent_does_not_report_success_after_usage_limit(enabled):
    credentials.save(1, grant())
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                text=response_events(terminal="response.failed"),
            )
        )
    ) as http:
        model = ChatGPTResponsesModel(
            ResolvedAI(1, "chatgpt", "gpt-6-luna", "low"),
            AsyncOpenAI(api_key="unused", http_client=http, max_retries=0),
        )
        events = []
        with pytest.raises(chatgpt.ChatGPTError, match="usage limit"):
            async for event in Agent(
                model, model_settings={"openai_store": False}
            ).run_stream_events("Hello"):
                events.append(event)
        from pydantic_ai import AgentRunResultEvent

        assert not any(isinstance(event, AgentRunResultEvent) for event in events)


def test_local_helper_completes_loopback_and_transfers_without_persisting(
    monkeypatch, capsys
):
    import threading
    import urllib.request
    from urllib.parse import urlencode
    from expenses.cli import connect_chatgpt

    flow = {}
    transfers = []

    def handler(request):
        if request.url.path.endswith("/pairing/start"):
            port = json.loads(request.content)["port"]
            flow.update(
                {
                    "state": "expected-state",
                    "code_verifier": "verifier",
                    "redirect_uri": f"http://127.0.0.1:{port}/auth/callback",
                    "client_id": "dynamic_agent_client",
                    "authorization_url": "https://auth.openai.com/authorize",
                    "token_endpoint": "https://auth.openai.com/token",
                }
            )
            return httpx.Response(200, json=flow)
        if request.url.path == "/token":
            assert b"code_verifier=verifier" in request.content
            return httpx.Response(200, json=grant())
        if request.url.path.endswith("/pairing/complete"):
            assert request.headers["x-chatgpt-pairing"] == "pairing-secret"
            transfers.append(json.loads(request.content))
            return httpx.Response(200, json={"connected": True})
        raise AssertionError("Unexpected request")

    def open_browser(_url):
        def callback():
            with urllib.request.urlopen(
                flow["redirect_uri"]
                + "?"
                + urlencode(
                    {"state": flow["state"], "code": "code", "client_id": "client_1"}
                )
            ) as response:
                assert response.status == 200

        threading.Thread(target=callback, daemon=True).start()
        return True

    real_client = httpx.Client
    monkeypatch.setattr(
        connect_chatgpt.httpx,
        "Client",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    monkeypatch.setattr(connect_chatgpt.webbrowser, "open", open_browser)
    connect_chatgpt.connect("https://expenses.test", "pairing-secret")
    assert transfers[0]["client_id"] == "client_1"
    output = capsys.readouterr().out
    assert "ChatGPT connected" in output
    assert "access-secret" not in output and "refresh-secret" not in output
    with pytest.raises(ValueError):
        connect_chatgpt.server_url("http://public-server.example")
