import asyncio
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelMessage, ToolReturnPart
from pydantic_ai.models.function import DeltaThinkingPart, DeltaToolCall, FunctionModel
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import expenses.app as app_main
from expenses.ai import assistant
from expenses.ai.assistant import (
    ITEMS,
    AssistantModel,
    AssistantService,
    stream_turn,
)
from expenses.ai.spending_chat import SpendingAnalysisService, tool_detail
from expenses.api import assistant_routes
from expenses.core.config import get_settings
from expenses.db.models import (
    AIFeatureSetting,
    AssistantChat,
    AssistantTurn,
    BudgetFrequency,
    LLMJob,
    TransactionType,
    User,
)
from expenses.db.session import Base, _enable_sqlite_pragmas
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


def _configure_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXPENSES_AI_BACKENDS", "local")
    monkeypatch.setenv("EXPENSES_AI_LOCAL_KIND", "openai-compatible")
    monkeypatch.setenv("EXPENSES_AI_LOCAL_BASE_URL", "http://llm.local/v1")
    get_settings.cache_clear()


def _enable_chat(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_backend(monkeypatch)
    sessions = app_main.app.dependency_overrides[app_main.get_db]()
    session = next(sessions)
    session.add(
        AIFeatureSetting(
            feature="spending_chat",
            enabled=True,
            backend="local",
            model="local-model",
            thinking="auto",
        )
    )
    session.commit()
    sessions.close()


def _elevate_admin(client: TestClient) -> None:
    token = client.get("/api/csrf").json()["token"]
    response = client.post(
        "/api/auth/admin-elevation",
        headers={"X-CSRF-Token": token},
        json={"password": "pw-12345"},
    )
    assert response.status_code == 200


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    event.listen(engine, "connect", _enable_sqlite_pragmas)
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
        "reimbursement_id": reimbursement.id,
    }


def test_tool_detail_formats_tool_outputs() -> None:
    assert (
        tool_detail(
            "get_spending_overview",
            {"totals": {"expense_cents": 123400, "income_cents": 200050}},
        )
        == "€1,234.00 spent · €2,000.50 income"
    )
    assert (
        tool_detail(
            "compare_spending_periods",
            {
                "totals": {
                    "current_expense_cents": 120000,
                    "baseline_expense_cents": 132000,
                    "expense_delta_cents": -12000,
                }
            },
        )
        == "€1,200.00 vs €1,320.00 · -€120.00"
    )
    assert (
        tool_detail(
            "breakdown_spending",
            {"group_by": "category", "rows": [{}, {}, {}], "transaction_count": 45},
        )
        == "3 categories · 45 transactions"
    )
    assert (
        tool_detail(
            "breakdown_spending",
            {"group_by": "month", "rows": [{}], "transaction_count": 1},
        )
        == "1 month · 1 transaction"
    )
    assert (
        tool_detail(
            "search_transactions",
            {
                "count": 23,
                "truncated": False,
                "transactions": [
                    {"net_amount_cents": 40000},
                    {"net_amount_cents": 1280},
                ],
            },
        )
        == "23 matches · €412.80 total"
    )
    assert (
        tool_detail(
            "search_transactions",
            {"count": 60, "truncated": True, "transactions": []},
        )
        == "60 matches"
    )
    assert (
        tool_detail(
            "search_transactions",
            {"count": 0, "truncated": False, "transactions": []},
        )
        == "No matches"
    )
    assert (
        tool_detail(
            "get_budget_context",
            {
                "budgets": [
                    {"remaining_cents": 5000},
                    {"remaining_cents": -2500},
                ]
            },
        )
        == "2 budgets · 1 over limit"
    )
    assert tool_detail("get_budget_context", {"budgets": []}) == ("No budgets set")
    assert (
        tool_detail(
            "get_transaction_detail",
            {"transaction": {"title": "Rewe", "net_amount_cents": 2345}},
        )
        == "Rewe · €23.45"
    )
    assert tool_detail("unknown_tool", {"ok": True}) is None


def test_spending_analysis_uses_net_amounts_across_tools() -> None:
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

        fuzzy_results = service.search_transactions(
            query="grocerry run",
            start=date(2026, 6, 1),
            end=date(2026, 6, 30),
        )
        assert fuzzy_results["ok"] is True
        assert [row["title"] for row in fuzzy_results["transactions"]] == [
            "Big grocery run"
        ]

        detail = service.get_transaction_detail(transaction_id=ids["reimbursement_id"])
        assert detail["transaction"]["net_amount_cents"] == 12_000
        assert (
            detail["reimbursement_allocations"][0]["expense_transaction_id"]
            == ids["concert_id"]
        )


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


def test_breakdown_spending_category_uses_sql_aggregation() -> None:
    with make_session() as session:
        ids = _seed_spending_fixture(session)
        select_statements: list[str] = []

        @event.listens_for(session.bind, "before_cursor_execute")
        def capture_select(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().lower().startswith("select"):
                select_statements.append(statement.lower())

        service = SpendingAnalysisService(session, user_id=1, today=date(2026, 6, 27))
        breakdown = service.breakdown_spending(
            start=date(2026, 6, 1),
            end=date(2026, 6, 30),
            group_by="category",
            limit=10,
        )

        assert breakdown["ok"] is True
        assert breakdown["transaction_count"] == 3
        assert breakdown["candidate_truncated"] is False
        assert breakdown["rows"] == [
            {
                "id": ids["groceries_id"],
                "name": "Groceries",
                "amount_cents": 31_000,
                "percent": pytest.approx(63.26530612244898),
            },
            {
                "id": ids["leisure_id"],
                "name": "Free time",
                "amount_cents": 18_000,
                "percent": pytest.approx(36.734693877551024),
            },
        ]
        assert not any(
            "select transactions.id, transactions.user_id" in statement
            and "order by transactions.occurred_at desc" in statement
            and "limit" in statement
            for statement in select_statements
        )


def test_search_transactions_amount_desc_finds_largest_beyond_candidate_window() -> (
    None
):
    with make_session() as session:
        category = CategoryService(session, user_id=1).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        transaction_service = TransactionService(session, user_id=1)
        # 250 recent small expenses fill the date-ordered candidate window.
        for index in range(250):
            _create_txn(
                transaction_service,
                title=f"Small {index}",
                amount_cents=1_000,
                txn_date=date(2026, 6, 1),
                category_id=category.id,
            )
        # The single largest expense is the oldest, so a date-ordered candidate
        # slice would drop it before the amount sort runs.
        _create_txn(
            transaction_service,
            title="Largest oldest",
            amount_cents=500_000,
            txn_date=date(2020, 1, 1),
            category_id=category.id,
        )

        analysis = SpendingAnalysisService(session, user_id=1, today=date(2026, 6, 30))
        result = analysis.search_transactions(sort="amount_desc", limit=1)

        assert result["ok"] is True
        assert result["candidate_truncated"] is True
        assert [txn["title"] for txn in result["transactions"]] == ["Largest oldest"]
        assert result["transactions"][0]["net_amount_cents"] == 500_000


def _session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(engine, "connect", _enable_sqlite_pragmas)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        session.commit()
    return factory


def _test_model(stream_function) -> AssistantModel:
    return AssistantModel(
        model=FunctionModel(stream_function=stream_function, model_name="test-model"),
        settings={},
        llm_provider="test",
    )


def _after_tool(messages: list[ModelMessage]) -> bool:
    return any(isinstance(part, ToolReturnPart) for part in messages[-1].parts)


def _apply(items: dict[str, dict], row: dict) -> None:
    """Applies a stream event the way clients do."""
    if row["type"] == "item":
        items[row["item"]["id"]] = row["item"]
    elif row["type"] == "delta":
        items[row["id"]]["text"] += row["text"]


async def _collect(
    factory, stream_function, text: str, *, chat_id: str | None = None
) -> list[dict]:
    with factory() as session:
        service = AssistantService(session, user_id=1)
        turn = service.new_turn(chat_id=chat_id, text=text)
    return [
        json.loads(line)
        async for line in stream_turn(
            turn, model=_test_model(stream_function), session_factory=factory
        )
    ]


def _final_items(events: list[dict]) -> list[dict]:
    items: dict[str, dict] = {}
    for row in events:
        _apply(items, row)
    return list(items.values())


def test_assistant_disabled_returns_503_before_stream(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/assistant/messages/stream",
        headers=csrf_headers,
        json={"message": "What changed this month?"},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "Assistant is turned off on this server"


def test_assistant_route_streams_and_saves_a_turn(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_chat(monkeypatch)
    answer = "Nothing matched in June.\n\n- No transactions"
    seen_instructions: list[str] = []

    async def stream(messages, info):
        if not _after_tool(messages):
            seen_instructions.append(info.instructions)
            yield {0: DeltaThinkingPart(content="Look up June.")}
            yield "Checking June."
            yield {
                1: DeltaToolCall(
                    name="search_transactions",
                    json_args='{"sort": "amount_desc"}',
                    tool_call_id="call-1",
                )
            }
            return
        yield answer[:10]
        yield answer[10:]

    sessions = app_main.app.dependency_overrides[app_main.get_db]
    db_engine = next(sessions()).get_bind()
    factory = sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)
    app_main.app.dependency_overrides[assistant_routes.get_assistant_model] = (
        lambda: _test_model(stream)
    )
    app_main.app.dependency_overrides[assistant_routes.get_stream_session_factory] = (
        lambda: factory
    )
    with api_client.stream(
        "POST",
        "/api/assistant/messages/stream",
        headers=csrf_headers,
        json={"message": "What did I spend most on?"},
    ) as response:
        assert response.status_code == 200
        # GZipMiddleware would withhold every line until the turn ends.
        assert response.headers.get("content-encoding") == "identity"
        events = [json.loads(line) for line in response.iter_lines() if line.strip()]

    assert events[0]["type"] == "start"
    assert events[0]["title"] == "What did I spend most on?"
    assert events[-1] == {"type": "end", "status": "completed"}
    items = _final_items(events)
    assert [(item["kind"], item["state"]) for item in items] == [
        ("thinking", "done"),
        ("note", "done"),
        ("tool", "done"),
        ("text", "done"),
    ]
    assert items[0]["text"] == "Look up June."
    assert items[1]["text"] == "Checking June."
    assert items[2]["label"] == "Transaction search"
    assert items[2]["detail"] == "No matches"
    assert items[3]["text"] == answer
    assert "Current date:" in seen_instructions[0]

    chat_id = events[0]["chat_id"]
    listed = api_client.get("/api/assistant/chats")
    assert [chat["id"] for chat in listed.json()] == [chat_id]
    chat = api_client.get(f"/api/assistant/chats/{chat_id}").json()
    assert chat["title"] == "What did I spend most on?"
    [turn] = chat["turns"]
    assert turn["user_text"] == "What did I spend most on?"
    assert turn["status"] == "completed"
    assert turn["items"] == items

    with factory() as session:
        job = session.scalars(select(LLMJob)).one()
    assert job.feature == "spending_chat"
    assert job.status == "completed"
    assert job.prompt_version == "assistant"
    assert job.llm_provider == "test"
    assert job.usage_tool_call_count == 1
    assert "What did I spend most on?" not in (job.input_json or "")


def test_assistant_allows_mobile_bearer_without_csrf(
    anonymous_api_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    setup = anonymous_api_client.post(
        "/api/mobile/auth/setup",
        json={
            "username": "bootstrap",
            "password": "pw-12345",
            "device_id": "iphone-1",
            "device_name": "Test iPhone",
        },
    )
    assert setup.status_code == 200
    token = setup.json()["token"]
    _enable_chat(monkeypatch)
    anonymous_api_client.cookies.clear()

    async def stream(messages, info):
        yield "Net spending is down."

    sessions = app_main.app.dependency_overrides[app_main.get_db]
    db_engine = next(sessions()).get_bind()
    app_main.app.dependency_overrides[assistant_routes.get_assistant_model] = (
        lambda: _test_model(stream)
    )
    app_main.app.dependency_overrides[assistant_routes.get_stream_session_factory] = (
        lambda: sessionmaker(bind=db_engine, expire_on_commit=False)
    )
    with anonymous_api_client.stream(
        "POST",
        "/api/assistant/messages/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": "How does my spending look?"},
    ) as response:
        assert response.status_code == 200
        events = [json.loads(line) for line in response.iter_lines() if line.strip()]

    assert events[-1] == {"type": "end", "status": "completed"}
    assert _final_items(events)[0]["text"] == "Net spending is down."


def test_assistant_chats_belong_to_their_user(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_chat(monkeypatch)
    now = datetime(2026, 6, 1, 12, 0)
    db_session.add(User(id=2, username="other", password_hash="unused"))
    db_session.flush()
    db_session.add_all(
        [
            AssistantChat(
                id="a" * 32, user_id=1, title="Mine", created_at=now, updated_at=now
            ),
            AssistantChat(
                id="b" * 32, user_id=2, title="Theirs", created_at=now, updated_at=now
            ),
        ]
    )
    db_session.commit()

    assert [
        chat["title"] for chat in api_client.get("/api/assistant/chats").json()
    ] == ["Mine"]
    assert api_client.get(f"/api/assistant/chats/{'b' * 32}").status_code == 404
    other = api_client.post(
        "/api/assistant/messages/stream",
        headers=csrf_headers,
        json={"chat_id": "b" * 32, "message": "Hi"},
    )
    assert other.status_code == 404
    assert (
        api_client.delete(
            f"/api/assistant/chats/{'b' * 32}", headers=csrf_headers
        ).status_code
        == 404
    )
    assert (
        api_client.delete(
            f"/api/assistant/chats/{'a' * 32}", headers=csrf_headers
        ).status_code
        == 204
    )
    assert api_client.get("/api/assistant/chats").json() == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("chunks", "calls_tool", "kind"),
    [
        (["Checking ", "June."], True, "note"),
        (["Net spending ", "is down."], False, "text"),
        (["June looks calm.\n", "- Groceries"], True, "text"),
        (["  " + "x" * 160], True, "text"),
    ],
)
async def test_assistant_text_before_a_tool_call_is_a_note(
    chunks: list[str], calls_tool: bool, kind: str
) -> None:
    async def stream(messages, info):
        if _after_tool(messages):
            yield "Done."
            return
        for chunk in chunks:
            yield chunk
        if calls_tool:
            yield {
                1: DeltaToolCall(
                    name="get_budget_context",
                    json_args='{"year": 2026, "month": 6}',
                    tool_call_id="call-1",
                )
            }

    events = await _collect(_session_factory(), stream, "How is June?")

    first = _final_items(events)[0]
    assert first["kind"] == kind
    assert first["text"] == "".join(chunks).strip()


@pytest.mark.anyio
async def test_assistant_follow_up_and_retry_use_earlier_turns() -> None:
    factory = _session_factory()
    history_sizes: list[int] = []

    async def stream(messages, info):
        history_sizes.append(len(messages))
        yield f"Answer {len(history_sizes)}."

    first = await _collect(factory, stream, "First question")
    chat_id = first[0]["chat_id"]
    await _collect(factory, stream, "Second question", chat_id=chat_id)
    with factory() as session:
        retry = AssistantService(session, user_id=1).retry_turn(chat_id)
    events = [
        json.loads(line)
        async for line in stream_turn(
            retry, model=_test_model(stream), session_factory=factory
        )
    ]

    # Each turn adds a request and a response; a retry drops the turn it replaces.
    assert history_sizes == [1, 3, 3]
    assert _final_items(events)[0]["text"] == "Answer 3."
    with factory() as session:
        chat = AssistantService(session, user_id=1).chat_out(chat_id)
    assert [(turn.user_text, turn.items[0].text) for turn in chat.turns] == [
        ("First question", "Answer 1."),
        ("Second question", "Answer 3."),
    ]


@pytest.mark.anyio
async def test_assistant_stop_saves_the_partial_turn() -> None:
    factory = _session_factory()
    streaming = asyncio.Event()

    async def stream(messages, info):
        yield "Partial answer"
        streaming.set()
        await asyncio.sleep(30)
        yield " never sent"

    with factory() as session:
        turn = AssistantService(session, user_id=1).new_turn(
            chat_id=None, text="Summarize June"
        )
    lines = stream_turn(turn, model=_test_model(stream), session_factory=factory)
    assert json.loads(await anext(lines))["type"] == "start"
    await streaming.wait()
    # Closing the response stops the run, as a client disconnect does.
    await lines.aclose()
    await asyncio.gather(*assistant._RUNNING)

    with factory() as session:
        saved = session.scalars(select(AssistantTurn)).one()
        job = session.scalars(select(LLMJob)).one()
    assert saved.status == "stopped"
    [item] = ITEMS.validate_json(saved.items_json)
    assert (item.kind, item.text, item.state) == ("text", "Partial answer", "done")
    assert job.status == "stopped"


@pytest.mark.anyio
async def test_assistant_failure_ends_with_a_message() -> None:
    factory = _session_factory()

    async def stream(messages, info):
        raise ModelHTTPError(status_code=429, model_name="test-model")
        yield

    events = await _collect(factory, stream, "Summarize June")

    assert events[-1] == {
        "type": "end",
        "status": "failed",
        "message": "The AI backend is busy or over its limit. Try again in a moment.",
    }
    with factory() as session:
        saved = session.scalars(select(AssistantTurn)).one()
        job = session.scalars(select(LLMJob)).one()
    assert saved.status == "failed"
    # A failed turn adds nothing to what the model sees next time.
    assert saved.messages_json == "[]"
    assert job.status == "failed"
    assert "429" in (job.error or "")


@pytest.mark.anyio
async def test_assistant_dates_use_the_configured_timezone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EXPENSES_TIMEZONE", "Etc/GMT-14")
    get_settings.cache_clear()
    seen_instructions: list[str] = []

    async def stream(messages, info):
        seen_instructions.append(info.instructions)
        yield "Done."

    try:
        await _collect(_session_factory(), stream, "What day is it?")
    finally:
        get_settings.cache_clear()

    today = datetime.now(ZoneInfo("Etc/GMT-14")).date()
    assert f"Current date: {today.isoformat()}." in seen_instructions[0]


def test_ai_usage_summary_average_cost_keeps_division_precision(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    data_dir = tmp_path / "usage-avg-data"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(data_dir))
    get_settings.cache_clear()
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        session = session_local()
        try:
            yield session
        finally:
            session.close()

    monkeypatch.setattr(app_main.scheduler_manager, "start", lambda: None)
    monkeypatch.setattr(app_main.scheduler_manager, "stop", lambda: None)
    app_main.app.dependency_overrides[app_main.get_db] = override_get_db
    try:
        with TestClient(app_main.app) as client:
            assert (
                client.post(
                    "/api/auth/setup",
                    json={"username": "bootstrap", "password": "pw-12345"},
                ).status_code
                == 200
            )
            _elevate_admin(client)
            with session_local() as session:
                session.add_all(
                    [
                        LLMJob(
                            user_id=1,
                            feature="spending_chat",
                            status="completed",
                            prompt_version="spending_chat",
                            model="openai/gpt-test",
                            input_hash="hash-cost-1",
                            usage_cost_decimal="0.01",
                            usage_cost_unit="openrouter_credits",
                        ),
                        LLMJob(
                            user_id=1,
                            feature="spending_chat",
                            status="completed",
                            prompt_version="spending_chat",
                            model="openai/gpt-test",
                            input_hash="hash-cost-2",
                            usage_cost_decimal="0.02",
                            usage_cost_unit="openrouter_credits",
                        ),
                    ]
                )
                session.commit()

            response = client.get(
                "/api/ai/usage/summary",
                params={"feature": "spending_chat", "period": "all"},
            )
            assert response.status_code == 200
            payload = response.json()
            assert payload["total_cost_decimal"] == "0.03"
            assert payload["average_cost_decimal"] == "0.015"
    finally:
        app_main.app.dependency_overrides.pop(app_main.get_db, None)
        get_settings.cache_clear()


def test_ai_usage_summary_labels_mixed_when_a_costed_job_lacks_a_unit(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    data_dir = tmp_path / "usage-mixed-data"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(data_dir))
    get_settings.cache_clear()
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        session = session_local()
        try:
            yield session
        finally:
            session.close()

    monkeypatch.setattr(app_main.scheduler_manager, "start", lambda: None)
    monkeypatch.setattr(app_main.scheduler_manager, "stop", lambda: None)
    app_main.app.dependency_overrides[app_main.get_db] = override_get_db
    try:
        with TestClient(app_main.app) as client:
            assert (
                client.post(
                    "/api/auth/setup",
                    json={"username": "bootstrap", "password": "pw-12345"},
                ).status_code
                == 200
            )
            _elevate_admin(client)
            with session_local() as session:
                # The unitless costed job is inserted first, so an unordered scan
                # sees it before the job that carries a real unit.
                session.add_all(
                    [
                        LLMJob(
                            user_id=1,
                            feature="spending_chat",
                            status="completed",
                            prompt_version="spending_chat",
                            model="openai/gpt-test",
                            input_hash="hash-no-unit",
                            usage_cost_decimal="0.5",
                            usage_cost_unit=None,
                        ),
                        LLMJob(
                            user_id=1,
                            feature="spending_chat",
                            status="completed",
                            prompt_version="spending_chat",
                            model="openai/gpt-test",
                            input_hash="hash-real-unit",
                            usage_cost_decimal="0.3",
                            usage_cost_unit="openrouter_credits",
                        ),
                    ]
                )
                session.commit()

            response = client.get(
                "/api/ai/usage/summary",
                params={"feature": "spending_chat", "period": "all"},
            )
            assert response.status_code == 200
            payload = response.json()
            assert payload["costed_chats"] == 2
            assert payload["cost_unit"] == "mixed"
    finally:
        app_main.app.dependency_overrides.pop(app_main.get_db, None)
        get_settings.cache_clear()


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

    monkeypatch.setattr(app_main.scheduler_manager, "start", lambda: None)
    monkeypatch.setattr(app_main.scheduler_manager, "stop", lambda: None)
    app_main.app.dependency_overrides[app_main.get_db] = override_get_db
    try:
        with TestClient(app_main.app) as client:
            setup_response = client.post(
                "/api/auth/setup",
                json={"username": "bootstrap", "password": "pw-12345"},
            )
            assert setup_response.status_code == 200
            _elevate_admin(client)
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
                        LLMJob(
                            user_id=1,
                            feature="spending_chat",
                            status="stopped",
                            prompt_version="assistant",
                            model="openai/gpt-test",
                            input_hash="hash-4",
                            duration_ms=600,
                            created_at=now - timedelta(minutes=30),
                            finished_at=now - timedelta(minutes=30),
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
        assert payload["total_chats"] == 4
        assert payload["completed_chats"] == 2
        assert payload["failed_chats"] == 1
        assert payload["cancelled_chats"] == 1
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
