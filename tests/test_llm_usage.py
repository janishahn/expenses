from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.usage import RunUsage
from sqlalchemy import event
from sqlalchemy.orm import Session

from expenses.ai import usage_report
from expenses.ai.usage import usage_metadata
from expenses.core.config import AIBackend, get_settings
from expenses.db.models import AssistantChat, LLMJob, User

LOCAL = AIBackend(
    name="local", kind="openai-compatible", base_url="http://llm.local/v1", api_key=""
)


def test_usage_metadata_reads_run_usage_and_last_response() -> None:
    usage = RunUsage(
        input_tokens=12,
        output_tokens=5,
        cache_read_tokens=3,
        cache_write_tokens=2,
        details={"reasoning_tokens": 4},
        requests=1,
        tool_calls=2,
        cost=Decimal("0.0000215"),
    )
    messages = [
        ModelRequest(parts=[UserPromptPart("hi")]),
        ModelResponse(
            parts=[TextPart("hello")],
            model_name="qwen-local",
            provider_name="LocalProvider",
            provider_response_id="resp-123",
        ),
    ]

    metadata = usage_metadata(
        usage=usage,
        messages=messages,
        backend="local",
        llm_provider="openai-compatible",
        model="configured-model",
    )

    assert metadata.input_tokens == 12
    assert metadata.output_tokens == 5
    assert metadata.total_tokens == 17
    assert metadata.cached_input_tokens == 3
    assert metadata.cache_write_tokens == 2
    assert metadata.reasoning_tokens == 4
    assert metadata.request_count == 1
    assert metadata.tool_call_count == 2
    assert metadata.cost_decimal == "0.0000215"
    assert metadata.cost_unit == "usd"
    assert metadata.backend == "local"
    assert metadata.llm_provider == "openai-compatible"
    assert metadata.provider_name == "LocalProvider"
    assert metadata.provider_model == "qwen-local"
    assert metadata.provider_response_id == "resp-123"


def test_usage_metadata_without_a_price_leaves_cost_empty() -> None:
    metadata = usage_metadata(
        usage=RunUsage(input_tokens=1),
        messages=[],
        backend="local",
        llm_provider="openai-compatible",
        model="m",
    )

    assert metadata.cost_decimal is None
    assert metadata.cost_unit is None
    assert metadata.provider_model == "m"


def _elevate_admin(client: TestClient) -> None:
    token = client.get("/api/csrf").json()["token"]
    response = client.post(
        "/api/auth/admin-elevation",
        headers={"X-CSRF-Token": token},
        json={"password": "pw-12345"},
    )
    assert response.status_code == 200


def _run(**fields) -> LLMJob:
    return LLMJob(
        **{
            "user_id": 1,
            "feature": "spending_chat",
            "status": "completed",
            "prompt_version": "assistant",
            "backend": "anthropic",
            "model": "claude",
            "input_hash": "unused",
            **fields,
        }
    )


def test_ai_usage_splits_features_models_days_and_chats(
    api_client: TestClient, db_session: Session
) -> None:
    _elevate_admin(api_client)
    now = datetime.utcnow()
    db_session.add(User(id=2, username="mara", password_hash="unused"))
    db_session.flush()
    db_session.add_all(
        AssistantChat(
            id=chat_id, user_id=user_id, title=title, created_at=now, updated_at=now
        )
        for chat_id, user_id, title in [
            ("a" * 32, 1, "Groceries this month"),
            ("b" * 32, 2, "Mara's question"),
        ]
    )
    db_session.add_all(
        [
            _run(
                chat_id="a" * 32,
                usage_input_tokens=1000,
                usage_output_tokens=200,
                usage_cached_input_tokens=800,
                usage_reasoning_tokens=50,
                usage_cost_decimal="0.0123",
                usage_cost_unit="usd",
                input_json="x" * 10_000,
                duration_ms=1200,
                created_at=now - timedelta(days=2),
            ),
            _run(
                chat_id="a" * 32,
                status="stopped",
                usage_input_tokens=300,
                usage_output_tokens=20,
                usage_cost_decimal="0.0000215",
                usage_cost_unit="usd",
                duration_ms=900,
                created_at=now - timedelta(hours=1),
            ),
            _run(
                user_id=2,
                chat_id="b" * 32,
                backend="local",
                model="qwen",
                usage_input_tokens=5000,
                usage_output_tokens=500,
                duration_ms=4000,
                created_at=now - timedelta(days=1),
            ),
            _run(
                chat_id="c" * 32,
                status="failed",
                usage_input_tokens=10,
                duration_ms=100,
                created_at=now - timedelta(days=3),
            ),
            _run(
                feature="transaction_triage",
                prompt_version="triage",
                backend="openrouter",
                model="gpt",
                usage_input_tokens=400,
                usage_output_tokens=40,
                usage_cost_decimal="0.05",
                usage_cost_unit="usd",
                created_at=now - timedelta(days=2),
            ),
            _run(
                chat_id="a" * 32,
                usage_input_tokens=7,
                usage_cost_decimal="1",
                usage_cost_unit="usd",
                created_at=now - timedelta(days=40),
            ),
        ]
    )
    db_session.commit()
    select_statements: list[str] = []

    def capture_select(conn, cursor, statement, *args) -> None:
        if statement.lstrip().lower().startswith("select"):
            select_statements.append(statement)

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", capture_select)
    try:
        week = api_client.get("/api/admin/ai/usage", params={"period": "week"}).json()
    finally:
        event.remove(engine, "before_cursor_execute", capture_select)

    assert "input_json" not in "\n".join(select_statements).lower()
    zone = ZoneInfo(get_settings().timezone)
    today = datetime.now(zone).date()
    assert week["bucket"] == "day"
    assert week["buckets"] == [
        (today - timedelta(days=6 - index)).isoformat() for index in range(7)
    ]
    assert week["totals"] == {
        "runs": 5,
        "failed_runs": 1,
        "stopped_runs": 1,
        "priced_runs": 3,
        "input_tokens": 6710,
        "output_tokens": 760,
        "cached_input_tokens": 800,
        "reasoning_tokens": 50,
        "total_tokens": 7470,
        "cost_usd": "0.0623215",
        "chats": 3,
        "turns": 4,
        "p95_duration_ms": 4000,
    }
    assert [
        (s["feature"], s["backend"], s["model"], s["runs"], s["cost_usd"])
        for s in week["slices"]
    ] == [
        ("transaction_triage", "openrouter", "gpt", 1, "0.05"),
        ("spending_chat", "anthropic", "claude", 3, "0.0123215"),
        ("spending_chat", "local", "qwen", 1, "0"),
    ]

    def day_index(created_at: datetime) -> int:
        local = created_at.replace(tzinfo=timezone.utc).astimezone(zone).date()
        return week["buckets"].index(local.isoformat())

    claude = week["slices"][1]
    expected_tokens = [0] * 7
    expected_tokens[day_index(now - timedelta(days=2))] += 1200
    expected_tokens[day_index(now - timedelta(days=3))] += 10
    expected_tokens[day_index(now - timedelta(hours=1))] += 320
    assert claude["bucket_tokens"] == expected_tokens
    assert claude["bucket_cost_usd"][day_index(now - timedelta(days=2))] == "0.0123"
    assert [
        (
            chat["access"],
            chat["title"],
            chat["username"],
            chat["turns"],
            chat["cost_usd"],
        )
        for chat in week["chats"]
    ] == [
        ("own", "Groceries this month", "bootstrap", 2, "0.0123215"),
        ("private", None, "mara", 1, "0"),
        ("deleted", None, "bootstrap", 1, "0"),
    ]

    scoped = api_client.get(
        "/api/admin/ai/usage",
        params={
            "period": "all",
            "feature": "spending_chat",
            "backend": "anthropic",
            "model": "claude",
            "chats": 1,
        },
    ).json()
    assert scoped["bucket"] == "week"
    assert [s["model"] for s in scoped["slices"]] == ["claude"]
    assert scoped["totals"]["cost_usd"] == "1.0123215"
    assert scoped["chat_count"] == 2
    assert [chat["title"] for chat in scoped["chats"]] == ["Groceries this month"]


def test_ai_usage_chat_detail_lists_each_turn(
    api_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _elevate_admin(api_client)
    now = datetime.utcnow()
    db_session.add_all(
        [
            _run(
                chat_id="d" * 32,
                usage_input_tokens=100,
                usage_output_tokens=10,
                usage_tool_call_count=3,
                usage_cost_decimal="0.002",
                usage_cost_unit="usd",
                duration_ms=800,
                created_at=now - timedelta(minutes=5),
            ),
            _run(
                chat_id="d" * 32,
                status="failed",
                backend="local",
                model="qwen",
                created_at=now - timedelta(minutes=1),
            ),
        ]
    )
    db_session.commit()

    detail = api_client.get(f"/api/admin/ai/usage/chats/{'d' * 32}").json()

    assert (detail["access"], detail["turns"], detail["cost_usd"]) == (
        "deleted",
        2,
        "0.002",
    )
    assert [
        (
            run["status"],
            run["model"],
            run["total_tokens"],
            run["tool_calls"],
            run["cost_usd"],
        )
        for run in detail["runs"]
    ] == [("completed", "claude", 110, 3, "0.002"), ("failed", "qwen", 0, 0, None)]
    assert detail["tool_calls"] == 3
    assert detail["models"] == [
        {"backend": "anthropic", "model": "claude"},
        {"backend": "local", "model": "qwen"},
    ]
    assert api_client.get(f"/api/admin/ai/usage/chats/{'e' * 32}").status_code == 404

    monkeypatch.setattr(usage_report, "CHAT_RUNS", 1)
    latest = api_client.get(f"/api/admin/ai/usage/chats/{'d' * 32}").json()
    assert (latest["turns"], latest["tool_calls"]) == (2, 3)
    assert [run["model"] for run in latest["runs"]] == ["qwen"]


def test_ai_usage_model_without_a_backend_leaves_out_other_backends(
    api_client: TestClient, db_session: Session
) -> None:
    _elevate_admin(api_client)
    now = datetime.utcnow()
    db_session.add_all(
        [
            _run(
                feature="transaction_triage",
                backend=None,
                status="failed",
                model="gpt",
                created_at=now,
            ),
            _run(
                feature="transaction_triage",
                backend="openrouter",
                model="gpt",
                usage_input_tokens=400,
                created_at=now,
            ),
        ]
    )
    db_session.commit()

    scoped = api_client.get(
        "/api/admin/ai/usage",
        params={"period": "week", "feature": "transaction_triage", "model": "gpt"},
    ).json()

    assert [(s["backend"], s["runs"]) for s in scoped["slices"]] == [(None, 1)]
    assert scoped["totals"]["failed_runs"] == 1
