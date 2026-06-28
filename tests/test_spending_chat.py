import json
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import expenses.app as app_main
from expenses.api import routes
from expenses.ai.spending_chat import (
    PydanticAISpendingRunner,
    SpendingAgentContext,
    SpendingAgentTurnResult,
    SpendingAnalysisService,
    SpendingChatRequest,
)
from expenses.core.config import get_settings
from expenses.db.models import (
    BudgetFrequency,
    LLMJob,
    TransactionType,
)
from expenses.db.session import Base
from expenses.schemas import BudgetTemplateIn, CategoryIn, TransactionIn
from expenses.services import (
    BudgetService,
    CategoryService,
    ReimbursementService,
    TransactionService,
)


@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def _create_txn(
    service: TransactionService,
    *,
    title: str,
    amount_cents: int,
    txn_date: date,
    category_id: int,
    txn_type: TransactionType = TransactionType.expense,
    tags: list[str] | None = None,
    is_reimbursement: bool | None = None,
):
    return service.create(
        TransactionIn(
            date=txn_date,
            occurred_at=datetime.combine(txn_date, datetime.min.time()),
            type=txn_type,
            is_reimbursement=is_reimbursement,
            amount_cents=amount_cents,
            category_id=category_id,
            title=title,
            tags=tags or [],
        )
    )


def _seed_spending_fixture(session: Session) -> dict[str, int]:
    category_service = CategoryService(session, user_id=1)
    groceries = category_service.create(
        CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
    )
    leisure = category_service.create(
        CategoryIn(name="Free time", type=TransactionType.expense, order=1)
    )
    salary = category_service.create(
        CategoryIn(name="Salary", type=TransactionType.income, order=0)
    )
    transaction_service = TransactionService(session, user_id=1)
    _create_txn(
        transaction_service,
        title="Weekly supermarket",
        amount_cents=9_000,
        txn_date=date(2026, 6, 2),
        category_id=groceries.id,
        tags=["Food"],
    )
    _create_txn(
        transaction_service,
        title="Big grocery run",
        amount_cents=22_000,
        txn_date=date(2026, 6, 8),
        category_id=groceries.id,
        tags=["Food"],
    )
    concert = _create_txn(
        transaction_service,
        title="Concert weekend",
        amount_cents=30_000,
        txn_date=date(2026, 6, 15),
        category_id=leisure.id,
        tags=["Fun"],
    )
    reimbursement = _create_txn(
        transaction_service,
        title="Friend paid back ticket",
        amount_cents=12_000,
        txn_date=date(2026, 6, 18),
        category_id=salary.id,
        txn_type=TransactionType.income,
        is_reimbursement=True,
    )
    ReimbursementService(session, user_id=1).upsert_allocation(
        reimbursement.id, concert.id, 12_000
    )
    _create_txn(
        transaction_service,
        title="May groceries",
        amount_cents=24_000,
        txn_date=date(2026, 5, 9),
        category_id=groceries.id,
    )
    BudgetService(session, user_id=1).upsert_template(
        BudgetTemplateIn(
            frequency=BudgetFrequency.monthly,
            category_id=groceries.id,
            amount_cents=35_000,
            starts_on=date(2026, 1, 1),
        )
    )
    BudgetService(session, user_id=1).upsert_template(
        BudgetTemplateIn(
            frequency=BudgetFrequency.monthly,
            category_id=leisure.id,
            amount_cents=12_000,
            starts_on=date(2026, 1, 1),
        )
    )
    return {
        "groceries_id": groceries.id,
        "leisure_id": leisure.id,
        "concert_id": concert.id,
    }


def test_spending_analysis_uses_net_amounts_for_overview_and_search() -> None:
    with make_session() as session:
        ids = _seed_spending_fixture(session)
        service = SpendingAnalysisService(session, user_id=1, today=date(2026, 6, 27))

        overview = service.get_spending_overview(
            start=date(2026, 6, 1), end=date(2026, 6, 30)
        )
        assert overview["ok"] is True
        assert overview["totals"]["expense_cents"] == 49_000
        assert overview["category_breakdown"][0]["name"] == "Groceries"
        assert overview["category_breakdown"][0]["amount_cents"] == 31_000
        assert overview["category_breakdown"][1]["name"] == "Free time"
        assert overview["category_breakdown"][1]["amount_cents"] == 18_000

        results = service.search_transactions(
            start=date(2026, 6, 1),
            end=date(2026, 6, 30),
            sort="amount_desc",
            limit=2,
        )
        assert results["ok"] is True
        assert [row["title"] for row in results["transactions"]] == [
            "Big grocery run",
            "Concert weekend",
        ]
        assert results["transactions"][1]["id"] == ids["concert_id"]
        assert results["transactions"][1]["net_amount_cents"] == 18_000


def test_spending_analysis_compares_periods_and_reports_budget_context() -> None:
    with make_session() as session:
        ids = _seed_spending_fixture(session)
        category_service = CategoryService(session, user_id=1)
        transaction_service = TransactionService(session, user_id=1)
        for index in range(9):
            category = category_service.create(
                CategoryIn(
                    name=f"Baseline small {index + 1}",
                    type=TransactionType.expense,
                    order=index + 2,
                )
            )
            _create_txn(
                transaction_service,
                title=f"Baseline small spend {index + 1}",
                amount_cents=(index + 1) * 100,
                txn_date=date(2026, 5, 10),
                category_id=category.id,
            )
        service = SpendingAnalysisService(session, user_id=1, today=date(2026, 6, 27))

        comparison = service.compare_spending_periods(
            current_start=date(2026, 6, 1),
            current_end=date(2026, 6, 30),
            baseline_start=date(2026, 5, 1),
            baseline_end=date(2026, 5, 31),
        )
        assert comparison["totals"]["current_expense_cents"] == 49_000
        assert comparison["totals"]["baseline_expense_cents"] == 28_500
        assert comparison["category_deltas"][0]["name"] == "Free time"
        assert comparison["category_deltas"][0]["delta_cents"] == 18_000
        baseline_small = next(
            row
            for row in comparison["category_deltas"]
            if row["name"] == "Baseline small 1"
        )
        assert baseline_small["current_amount_cents"] == 0
        assert baseline_small["baseline_amount_cents"] == 100

        budget_context = service.get_budget_context(year=2026, month=6)
        groceries = next(
            row
            for row in budget_context["budgets"]
            if row["scope_category_id"] == ids["groceries_id"]
        )
        leisure = next(
            row
            for row in budget_context["budgets"]
            if row["scope_category_id"] == ids["leisure_id"]
        )
        assert groceries["spent_cents"] == 31_000
        assert groceries["remaining_cents"] == 4_000
        assert leisure["spent_cents"] == 18_000
        assert leisure["remaining_cents"] == -6_000


def test_breakdown_spending_tag_aggregates_beyond_search_page_limit() -> None:
    with make_session() as session:
        snacks = CategoryService(session, user_id=1).create(
            CategoryIn(name="Snacks", type=TransactionType.expense, order=0)
        )
        transaction_service = TransactionService(session, user_id=1)
        for day in range(1, 31):
            _create_txn(
                transaction_service,
                title=f"Snack run {day}",
                amount_cents=100,
                txn_date=date(2026, 6, day),
                category_id=snacks.id,
                tags=["Snacks"],
            )
            _create_txn(
                transaction_service,
                title=f"Second snack run {day}",
                amount_cents=100,
                txn_date=date(2026, 6, day),
                category_id=snacks.id,
                tags=["Snacks"],
            )

        service = SpendingAnalysisService(session, user_id=1, today=date(2026, 6, 27))
        breakdown = service.breakdown_spending(
            start=date(2026, 6, 1),
            end=date(2026, 6, 30),
            group_by="tag",
        )

        assert breakdown["ok"] is True
        assert breakdown["transaction_count"] == 60
        assert breakdown["candidate_truncated"] is False
        assert breakdown["rows"] == [{"id": 1, "name": "Snacks", "amount_cents": 6_000}]


def test_breakdown_spending_category_limit_is_not_dashboard_truncated() -> None:
    with make_session() as session:
        category_service = CategoryService(session, user_id=1)
        transaction_service = TransactionService(session, user_id=1)
        for index in range(10):
            category = category_service.create(
                CategoryIn(
                    name=f"Category {index + 1}",
                    type=TransactionType.expense,
                    order=index,
                )
            )
            _create_txn(
                transaction_service,
                title=f"Spend {index + 1}",
                amount_cents=(index + 1) * 1_000,
                txn_date=date(2026, 6, 1),
                category_id=category.id,
            )

        service = SpendingAnalysisService(session, user_id=1, today=date(2026, 6, 27))
        breakdown = service.breakdown_spending(
            start=date(2026, 6, 1),
            end=date(2026, 6, 30),
            group_by="category",
            limit=10,
        )

        assert breakdown["ok"] is True
        assert len(breakdown["rows"]) == 10
        assert breakdown["rows"][0]["name"] == "Category 10"
        assert breakdown["rows"][-1]["name"] == "Category 1"


def test_spending_chat_disabled_returns_503_before_stream(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EXPENSES_LLM_ENABLED", raising=False)
    monkeypatch.delenv("EXPENSES_LLM_BASE_URL", raising=False)
    get_settings.cache_clear()
    response = api_client.post(
        "/api/ai/spending-chat/stream",
        headers=csrf_headers,
        json={"messages": [{"role": "user", "content": "What changed this month?"}]},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "LLM is not configured"


def test_spending_chat_stream_route_emits_ndjson_events(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EXPENSES_LLM_ENABLED", "true")
    monkeypatch.setenv("EXPENSES_LLM_BASE_URL", "http://llm.local/v1")
    get_settings.cache_clear()

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def session_factory() -> Session:
        return session_local()

    class FakeSpendingChatService:
        def __init__(self, session: Session, *, user_id: int) -> None:
            self.session = session
            self.user_id = user_id

        async def stream_turn(self, *, request):
            yield {"type": "turn_started", "turn_id": "turn-test"}
            yield {
                "type": "tool_call_start",
                "tool_call_id": "call-1",
                "tool_name": "search_transactions",
                "arguments": {"sort": "amount_desc"},
            }
            yield {
                "type": "tool_call_end",
                "tool_call_id": "call-1",
                "tool_name": "search_transactions",
                "result_preview": '{"ok":true}',
                "success": True,
            }
            yield {"type": "text_chunk", "content": "Big grocery run"}
            yield {"type": "text_commit"}
            yield SpendingAgentTurnResult(
                assistant_message="Big grocery run",
                message_history=[{"kind": "fake"}],
            )

    app_main.app.dependency_overrides[routes.get_spending_chat_session_factory] = (
        lambda: session_factory
    )
    app_main.app.dependency_overrides[routes.get_spending_chat_service_class] = (
        lambda: FakeSpendingChatService
    )
    try:
        with api_client.stream(
            "POST",
            "/api/ai/spending-chat/stream",
            headers=csrf_headers,
            json={
                "messages": [{"role": "user", "content": "What did I spend most on?"}]
            },
        ) as response:
            assert response.status_code == 200
            # The stream must not be gzip-compressed: GZipMiddleware buffers
            # deflate output until close, which would withhold every event until
            # the turn ends. The route marks the body as identity-encoded so it
            # streams unbuffered.
            assert response.headers.get("content-encoding") == "identity"
            rows = [json.loads(line) for line in response.iter_lines() if line.strip()]
    finally:
        app_main.app.dependency_overrides.pop(
            routes.get_spending_chat_session_factory, None
        )
        app_main.app.dependency_overrides.pop(
            routes.get_spending_chat_service_class, None
        )
        get_settings.cache_clear()

    assert [row["type"] for row in rows] == [
        "turn_started",
        "tool_call_start",
        "tool_call_end",
        "text_chunk",
        "text_commit",
        "result",
        "done",
    ]
    assert rows[2]["result_preview"] == '{"ok":true}'
    assert rows[5]["assistant_message"] == "Big grocery run"
    assert rows[5]["message_history"] == [{"kind": "fake"}]


def test_spending_chat_rejects_invalid_message_history_before_stream(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EXPENSES_LLM_ENABLED", "true")
    monkeypatch.setenv("EXPENSES_LLM_BASE_URL", "http://llm.local/v1")
    get_settings.cache_clear()

    response = api_client.post(
        "/api/ai/spending-chat/stream",
        headers=csrf_headers,
        json={
            "messages": [{"role": "user", "content": "Summarize June"}],
            "message_history": [{"not": "a pydantic-ai message"}],
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid message_history"


@pytest.mark.anyio
async def test_pydantic_spending_runner_builds_tool_schemas_without_model_request(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_LLM_ENABLED", "true")
    monkeypatch.setenv("EXPENSES_LLM_BASE_URL", "http://llm.local/v1")
    get_settings.cache_clear()
    with make_session() as session:
        analysis = SpendingAnalysisService(session, user_id=1, today=date(2026, 6, 27))
        context = SpendingAgentContext(
            analysis=analysis,
            user_id=1,
            today=date(2026, 6, 27),
            now=datetime(2026, 6, 27, 12, 0),
        )
        stream = PydanticAISpendingRunner().stream_turn(
            request=SpendingChatRequest(
                messages=[{"role": "user", "content": "What changed this month?"}]
            ),
            analysis=analysis,
            context=context,
        )
        try:
            event = await anext(stream)
            assert event["type"] == "turn_started"
            assert isinstance(event["turn_id"], str)
        finally:
            await stream.aclose()
            get_settings.cache_clear()


@pytest.mark.anyio
async def test_spending_chat_stream_logs_one_job_with_fake_runner() -> None:
    with make_session() as session:

        class FakeRunner:
            async def stream_turn(self, *, request, analysis, context):
                yield {"type": "turn_started", "turn_id": "job-test"}
                yield {"type": "text_chunk", "content": "Answer"}
                yield {"type": "text_commit"}
                yield SpendingAgentTurnResult(
                    assistant_message="Answer",
                    message_history=[{"kind": "fake"}],
                    usage_input_tokens=11,
                    usage_output_tokens=7,
                    usage_total_tokens=18,
                    usage_cached_input_tokens=3,
                    usage_cache_write_tokens=2,
                    usage_reasoning_tokens=4,
                    usage_request_count=2,
                    usage_tool_call_count=1,
                    usage_cost_decimal="0.000000125",
                    usage_cost_unit="openrouter_credits",
                    provider_name="openrouter",
                    provider_model="openai/gpt-test",
                    provider_response_id="gen-test",
                    provider_usage_json={"total_cost": 0.000000125},
                )

        from expenses.ai.spending_chat import SpendingChatService, SpendingChatRequest

        request = SpendingChatRequest(
            messages=[{"role": "user", "content": "Summarize June"}]
        )

        service = SpendingChatService(session, user_id=1, runner=FakeRunner())
        events = []
        async for event in service.stream_turn(request=request):
            events.append(event)
        assert [event["type"] for event in events[:-1]] == [
            "turn_started",
            "text_chunk",
            "text_commit",
        ]
        job = session.scalars(select(LLMJob)).one()
        assert job.feature == "spending_chat"
        assert job.prompt_version == "spending_chat"
        assert job.status == "completed"
        assert job.usage_input_tokens == 11
        assert job.usage_output_tokens == 7
        assert job.usage_total_tokens == 18
        assert job.usage_cached_input_tokens == 3
        assert job.usage_cache_write_tokens == 2
        assert job.usage_reasoning_tokens == 4
        assert job.usage_request_count == 2
        assert job.usage_tool_call_count == 1
        assert job.usage_cost_decimal == "0.000000125"
        assert job.usage_cost_unit == "openrouter_credits"
        assert job.provider_name == "openrouter"
        assert job.provider_model == "openai/gpt-test"
        assert job.provider_response_id == "gen-test"
        output_trace = json.loads(job.output_json or "{}")
        assert "assistant_message" not in output_trace
        assert "message_history" not in output_trace
        assert output_trace["assistant_message_sha256"] == (
            "b2a3aa602762a782e47a4f8e93bb5ae1b8819d1b92b7e6ceb3ef46a3c7077eb0"
        )
        assert output_trace["assistant_message_chars"] == 6


def test_ai_usage_summary_returns_precise_spending_chat_accounting(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    data_dir = tmp_path / "usage-data"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(data_dir))
    get_settings.cache_clear()
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    select_statements: list[str] = []

    @event.listens_for(engine, "before_cursor_execute")
    def capture_select(
        conn, cursor, statement, parameters, context, executemany
    ) -> None:
        if statement.lstrip().lower().startswith("select"):
            select_statements.append(statement)

    def override_get_db():
        session = session_local()
        try:
            yield session
        finally:
            session.close()

    app_main.app.dependency_overrides[app_main.get_db] = override_get_db
    try:
        with TestClient(app_main.app) as client:
            setup_response = client.post(
                "/api/auth/setup",
                json={"username": "bootstrap", "password": "pw-12345"},
            )
            assert setup_response.status_code == 200
            now = datetime.utcnow()
            with session_local() as session:
                session.add_all(
                    [
                        LLMJob(
                            user_id=1,
                            feature="spending_chat",
                            status="completed",
                            prompt_version="spending_chat",
                            model="openai/gpt-test",
                            input_hash="hash-1",
                            usage_input_tokens=100,
                            usage_output_tokens=40,
                            usage_total_tokens=140,
                            usage_cached_input_tokens=10,
                            usage_cache_write_tokens=5,
                            usage_reasoning_tokens=8,
                            usage_request_count=2,
                            usage_tool_call_count=3,
                            usage_cost_decimal="0.000000125",
                            usage_cost_unit="openrouter_credits",
                            input_json="x" * 10_000,
                            output_json="y" * 10_000,
                            provider_usage_json="z" * 10_000,
                            duration_ms=1200,
                            created_at=now - timedelta(days=2),
                            finished_at=now - timedelta(days=2),
                        ),
                        LLMJob(
                            user_id=1,
                            feature="spending_chat",
                            status="completed",
                            prompt_version="spending_chat",
                            model="openai/gpt-test",
                            input_hash="hash-2",
                            usage_input_tokens=50,
                            usage_output_tokens=20,
                            usage_total_tokens=70,
                            usage_cached_input_tokens=4,
                            usage_cache_write_tokens=0,
                            usage_reasoning_tokens=2,
                            usage_request_count=1,
                            usage_tool_call_count=1,
                            usage_cost_decimal="0.000000075",
                            usage_cost_unit="openrouter_credits",
                            duration_ms=900,
                            created_at=now - timedelta(days=1),
                            finished_at=now - timedelta(days=1),
                        ),
                        LLMJob(
                            user_id=1,
                            feature="spending_chat",
                            status="failed",
                            prompt_version="spending_chat",
                            model="openai/gpt-test",
                            input_hash="hash-3",
                            error="provider timeout",
                            duration_ms=500,
                            created_at=now - timedelta(hours=1),
                            finished_at=now - timedelta(hours=1),
                        ),
                    ]
                )
                session.commit()

            select_statements.clear()
            response = client.get(
                "/api/ai/usage/summary",
                params={"feature": "spending_chat", "period": "week"},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload["feature"] == "spending_chat"
        assert payload["period"] == "week"
        assert payload["total_chats"] == 3
        assert payload["completed_chats"] == 2
        assert payload["failed_chats"] == 1
        assert payload["input_tokens"] == 150
        assert payload["output_tokens"] == 60
        assert payload["total_tokens"] == 210
        assert payload["cached_input_tokens"] == 14
        assert payload["cache_write_tokens"] == 5
        assert payload["reasoning_tokens"] == 10
        assert payload["total_cost_decimal"] == "0.000000200"
        assert payload["average_cost_decimal"] == "0.000000100"
        assert payload["cost_unit"] == "openrouter_credits"
        assert payload["average_total_tokens"] == 105
        assert payload["p95_duration_ms"] == 1200
        selected_sql = "\n".join(select_statements).lower()
        assert "input_json" not in selected_sql
        assert "output_json" not in selected_sql
        assert "provider_usage_json" not in selected_sql
    finally:
        app_main.app.dependency_overrides.clear()
        get_settings.cache_clear()
