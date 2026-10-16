import asyncio
import json
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelMessage, ToolReturnPart, UserPromptPart
from pydantic_ai.models.function import DeltaThinkingPart, DeltaToolCall, FunctionModel
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import expenses.app as app_main
from expenses.ai import assistant
from expenses.ai.assistant import (
    ITEMS,
    AssistantConflictError,
    AssistantModel,
    AssistantService,
    stream_turn,
)
from expenses.ai.assistant_actions import (
    BudgetRequest,
    InvalidProposal,
    NewTransaction,
    apply_action,
    propose_allocate,
    propose_budgets,
    propose_create,
    propose_edit,
    propose_undo,
)
from expenses.ai.assistant_tools import AssistantReader, tool_detail, tool_label
from expenses.api import assistant_routes
from expenses.core.config import get_settings
from expenses.db.models import (
    AIFeatureSetting,
    AssistantAction,
    AssistantChat,
    AssistantTurn,
    BudgetFrequency,
    LLMJob,
    Transaction,
    TransactionType,
    User,
)
from expenses.db.session import Base, _enable_sqlite_pragmas
from expenses.schemas import (
    BudgetOverrideIn,
    BudgetTemplateIn,
    CategoryIn,
    TransactionIn,
)
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


def _reader(session: Session, today: date = date(2026, 6, 27)) -> AssistantReader:
    return AssistantReader(
        session, user_id=1, now=datetime.combine(today, datetime.min.time())
    )


def test_query_transactions_uses_net_amounts() -> None:
    with make_session() as session:
        ids = _seed_spending_fixture(session)
        reader = _reader(session)
        june = {"start": date(2026, 6, 1), "end": date(2026, 6, 30)}

        by_category = reader.query_transactions(**june, group_by="category")
        assert by_category["totals"] == {
            "count": 3,
            "net_cents": 49_000,
            "gross_cents": 61_000,
            "reimbursed_cents": 12_000,
        }
        assert [
            (row["label"], row["net_cents"], row["share_percent"])
            for row in by_category["groups"]
        ] == [("Groceries", 31_000, 63.3), ("Free time", 18_000, 36.7)]

        largest = reader.query_transactions(**june, sort="amount_desc", limit=2)
        assert [row["title"] for row in largest["transactions"]] == [
            "Big grocery run",
            "Concert weekend",
        ]
        concert = largest["transactions"][1]
        assert concert["id"] == ids["concert_id"]
        assert (concert["net_cents"], concert["gross_cents"]) == (18_000, 30_000)
        assert largest["next_offset"] == 2

        fuzzy = reader.query_transactions(**june, text="grocerry run")
        assert [row["title"] for row in fuzzy["transactions"]] == ["Big grocery run"]

        reimbursements = reader.query_transactions(**june, kind="reimbursement")
        assert [row["title"] for row in reimbursements["transactions"]] == [
            "Friend paid back ticket"
        ]
        assert reader.query_transactions(**june, kind="income")["totals"]["count"] == 0


def test_query_transactions_compares_groups_with_a_baseline() -> None:
    with make_session() as session:
        _seed_spending_fixture(session)
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

        comparison = _reader(session).query_transactions(
            start=date(2026, 6, 1),
            end=date(2026, 6, 30),
            group_by="category",
            compare_start=date(2026, 5, 1),
            compare_end=date(2026, 5, 31),
        )

        assert comparison["baseline"]["totals"]["net_cents"] == 28_500
        assert comparison["baseline"]["net_delta_cents"] == 20_500
        groups = {row["label"]: row for row in comparison["groups"]}
        assert comparison["groups"][0]["label"] == "Free time"
        assert groups["Free time"]["delta_cents"] == 18_000
        assert groups["Groceries"]["delta_cents"] == 7_000
        assert groups["Baseline small 1"]["net_cents"] == 0
        assert groups["Baseline small 1"]["baseline_net_cents"] == 100


def test_query_transactions_groups_by_tag_title_and_time() -> None:
    with make_session() as session:
        snacks = CategoryService(session, user_id=1).create(
            CategoryIn(name="Snacks", type=TransactionType.expense, order=0)
        )
        transaction_service = TransactionService(session, user_id=1)
        for day in range(1, 31):
            _create_txn(
                transaction_service,
                title="REWE" if day % 2 else "rewe ",
                amount_cents=100,
                txn_date=date(2026, 6, day),
                category_id=snacks.id,
                tags=["Snacks"],
            )
        _create_txn(
            transaction_service,
            title="Kiosk",
            amount_cents=250,
            txn_date=date(2026, 6, 1),
            category_id=snacks.id,
        )
        reader = _reader(session)
        june = {"start": date(2026, 6, 1), "end": date(2026, 6, 30)}

        by_tag = reader.query_transactions(**june, group_by="tag")
        assert [
            (row["label"], row["count"], row["net_cents"]) for row in by_tag["groups"]
        ] == [
            ("Snacks", 30, 3_000),
            ("No tag", 1, 250),
        ]

        by_title = reader.query_transactions(**june, group_by="title")
        assert [(row["count"], row["net_cents"]) for row in by_title["groups"]] == [
            (30, 3_000),
            (1, 250),
        ]

        by_week = reader.query_transactions(**june, group_by="week")
        # 1 June 2026 is a Monday.
        assert [row["key"] for row in by_week["groups"]] == [
            "2026-06-01",
            "2026-06-08",
            "2026-06-15",
            "2026-06-22",
            "2026-06-29",
        ]
        assert by_week["groups"][0]["net_cents"] == 950

        by_weekday = reader.query_transactions(**june, group_by="weekday")
        assert [row["label"] for row in by_weekday["groups"]][:2] == [
            "Monday",
            "Tuesday",
        ]
        assert by_weekday["groups"][-1]["label"] == "Sunday"

        months = reader.query_transactions(**june, group_by="month", limit=1)
        assert [row["key"] for row in months["groups"]] == ["2026-06"]


def test_query_transactions_sorts_by_amount_across_all_matches() -> None:
    with make_session() as session:
        category = CategoryService(session, user_id=1).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        transaction_service = TransactionService(session, user_id=1)
        for index in range(250):
            _create_txn(
                transaction_service,
                title=f"Small {index}",
                amount_cents=1_000,
                txn_date=date(2026, 6, 1),
                category_id=category.id,
            )
        _create_txn(
            transaction_service,
            title="Largest oldest",
            amount_cents=500_000,
            txn_date=date(2020, 1, 1),
            category_id=category.id,
        )

        result = _reader(session).query_transactions(
            start=date(2020, 1, 1), end=date(2026, 6, 30), sort="amount_desc", limit=1
        )

        assert result["totals"]["count"] == 251
        assert [txn["title"] for txn in result["transactions"]] == ["Largest oldest"]


def test_query_transactions_rejects_bad_periods() -> None:
    with make_session() as session:
        reader = _reader(session)
        backwards = reader.query_transactions(
            start=date(2026, 6, 30), end=date(2026, 6, 1)
        )
        half_comparison = reader.query_transactions(
            start=date(2026, 6, 1),
            end=date(2026, 6, 30),
            compare_start=date(2026, 5, 1),
        )
    assert backwards["ok"] is False
    assert half_comparison["status"] == "invalid_comparison"


def test_reader_reports_budgets_links_and_reimbursements() -> None:
    with make_session() as session:
        ids = _seed_spending_fixture(session)
        salary = CategoryService(session, user_id=1).list_all()[2]
        _create_txn(
            TransactionService(session, user_id=1),
            title="Deposit back",
            amount_cents=5_000,
            txn_date=date(2026, 6, 20),
            category_id=salary.id,
            txn_type=TransactionType.income,
            is_reimbursement=True,
        )
        reader = _reader(session)

        budgets = {
            row["scope_category_id"]: row
            for row in reader.get_budgets(year=2026, month=6)["budgets"]
        }
        assert budgets[ids["groceries_id"]]["remaining_cents"] == 4_000
        assert budgets[ids["leisure_id"]]["remaining_cents"] == -6_000

        reimbursement = reader.get_transaction(transaction_id=ids["reimbursement_id"])
        assert (
            reimbursement["transaction"]["allocated_to"][0]["transaction_id"]
            == (ids["concert_id"])
        )
        concert = reader.get_transaction(transaction_id=ids["concert_id"])
        assert concert["transaction"]["net_cents"] == 18_000
        assert concert["transaction"]["reimbursed_by"][0]["amount_cents"] == 12_000

        open_only = reader.list_reimbursements(
            start=date(2026, 6, 1), end=date(2026, 6, 30), only_open=True
        )
        assert [
            (row["title"], row["unallocated_cents"])
            for row in open_only["reimbursements"]
        ] == [("Deposit back", 5_000)]

        reference = reader.reference()
        assert "Today is Saturday, 2026-06-27." in reference
        assert f"- {ids['groceries_id']}: Groceries, expense" in reference
        assert ": Food" in reference

        assert reader.list_recurring()["rules"] == []
        assert reader.list_durable_purchases()["purchases"] == []
        assert reader.get_balance_history(months=3)["ok"] is True
        assert len(reader.get_forecast(horizon_months=3)["months"]) == 3


def test_tool_labels_and_details_read_like_the_app() -> None:
    june = {"start": "2026-06-01", "end": "2026-06-30"}
    assert (
        tool_label("query_transactions", {**june, "group_by": "category"})
        == "Spending by category, Jun 2026"
    )
    assert (
        tool_label(
            "query_transactions",
            {
                **june,
                "text": "rewe",
                "compare_start": "2026-05-01",
                "compare_end": "2026-05-31",
            },
        )
        == "Spending matching “rewe”, Jun 2026 vs May 2026"
    )
    assert (
        tool_label("query_transactions", {"start": "2026-06-03", "end": "2026-07-09"})
        == "Spending, 3 Jun – 9 Jul 2026"
    )
    assert tool_label("query_transactions", {"start": "soon"}) == "Spending"
    assert tool_label("get_budgets", {"year": 2026, "month": 6}) == "Budgets, Jun 2026"

    assert (
        tool_detail(
            "query_transactions",
            {
                "totals": {"count": 2, "net_cents": 123_456},
                "transactions": [],
                "baseline": {"totals": {"net_cents": 99_900}},
            },
        )
        == "2 transactions · 1 234,56 € vs 999,00 €"
    )
    assert (
        tool_detail(
            "query_transactions",
            {
                "totals": {"count": 5, "net_cents": 5},
                "group_by": "title",
                "groups": [{}, {}],
                "more_groups": 1,
            },
        )
        == "3 merchants · 0,05 €"
    )
    assert (
        tool_detail("get_budgets", {"budgets": [{"remaining_cents": -1}]})
        == "1 budget · 1 over"
    )


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
                    name="query_transactions",
                    json_args='{"start": "2026-06-01", "end": "2026-06-30"}',
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
    assert items[2]["label"] == "Spending, Jun 2026"
    assert items[2]["detail"] == "No matches"
    assert items[3]["text"] == answer
    assert "Today is" in seen_instructions[0]

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


def test_assistant_keeps_chats_for_the_chosen_days(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_chat(monkeypatch)
    assert api_client.get("/api/assistant/settings").json() == {"chat_days": 14}
    odd = api_client.put(
        "/api/assistant/settings", headers=csrf_headers, json={"chat_days": 10}
    )
    assert odd.status_code == 422
    saved = api_client.put(
        "/api/assistant/settings", headers=csrf_headers, json={"chat_days": 7}
    )
    assert saved.json() == {"chat_days": 7}

    # The other user keeps the default 14 days. Chat d is old but had a recent message.
    now = datetime(2026, 6, 30, 4, 20)
    db_session.add(User(id=2, username="other", password_hash="unused"))
    db_session.flush()
    for name, user_id, age, last_message_age in [
        ("a", 1, 3, 3),
        ("b", 1, 8, 8),
        ("c", 2, 8, 8),
        ("d", 1, 20, 3),
    ]:
        at = now - timedelta(days=age)
        chat_id = name * 32
        db_session.add(
            AssistantChat(
                id=chat_id,
                user_id=user_id,
                title=name,
                created_at=at,
                updated_at=now - timedelta(days=last_message_age),
            )
        )
        db_session.flush()
        db_session.add_all(
            [
                AssistantTurn(
                    chat_id=chat_id,
                    seq=1,
                    user_text="Hi",
                    items_json="[]",
                    messages_json="[]",
                    status="completed",
                    created_at=at,
                ),
                AssistantAction(
                    user_id=user_id,
                    chat_id=chat_id,
                    tool_call_id="call",
                    kind="create_transactions",
                    summary="Added Lunch",
                    plan_json="{}",
                    status="applied",
                    created_at=at,
                ),
            ]
        )
    db_session.commit()

    assert assistant.prune_chats(db_session, now) == 1
    kept = {"a" * 32, "c" * 32, "d" * 32}
    assert set(db_session.scalars(select(AssistantChat.id))) == kept
    assert set(db_session.scalars(select(AssistantTurn.chat_id))) == kept
    assert set(db_session.scalars(select(AssistantAction.chat_id))) == kept


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
                    name="get_budgets",
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
    chunks = 4 * assistant.STREAM_BUFFER_LINES
    produced = 0

    async def stream(messages, info):
        nonlocal produced
        for _ in range(chunks):
            produced += 1
            yield "word "
        await asyncio.sleep(30)
        yield "never sent"

    with factory() as session:
        turn = AssistantService(session, user_id=1).new_turn(
            chat_id=None, text="Summarize June"
        )
    lines = stream_turn(turn, model=_test_model(stream), session_factory=factory)
    assert json.loads(await anext(lines))["type"] == "start"
    await asyncio.sleep(0.2)
    # The client reads nothing more, so the run waits once the buffer is full.
    assert produced < chunks
    # Closing the response stops the run, as a client disconnect does.
    await lines.aclose()
    await asyncio.wait_for(asyncio.gather(*assistant._RUNNING), timeout=5)

    with factory() as session:
        saved = session.scalars(select(AssistantTurn)).one()
        job = session.scalars(select(LLMJob)).one()
    assert saved.status == "stopped"
    [item] = ITEMS.validate_json(saved.items_json)
    assert (item.kind, item.state) == ("text", "done")
    assert item.text.startswith("word word")
    assert "never sent" not in item.text
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
    assert f"{today.isoformat()}." in seen_instructions[0]


NBSP = " "


def _seed_trip(session: Session) -> dict[str, int]:
    category_service = CategoryService(session, user_id=1)
    travel = category_service.create(
        CategoryIn(name="Travel", type=TransactionType.expense, order=0)
    )
    refunds = category_service.create(
        CategoryIn(name="Refunds", type=TransactionType.income, order=0)
    )
    service = TransactionService(session, user_id=1)
    hotel = _create_txn(
        service,
        title="Hotel",
        amount_cents=11_680,
        txn_date=date(2026, 6, 3),
        category_id=travel.id,
    )
    train = _create_txn(
        service,
        title="Train",
        amount_cents=5_841,
        txn_date=date(2026, 6, 2),
        category_id=travel.id,
    )
    refund = _create_txn(
        service,
        title="Trip refund",
        amount_cents=8_761,
        txn_date=date(2026, 6, 20),
        category_id=refunds.id,
        txn_type=TransactionType.income,
    )
    return {
        "travel_id": travel.id,
        "hotel_id": hotel.id,
        "train_id": train.id,
        "refund_id": refund.id,
    }


def _tool_returns(messages: list[ModelMessage]) -> list[ToolReturnPart]:
    return [part for part in messages[-1].parts if isinstance(part, ToolReturnPart)]


def _call(name: str, args: dict, call_id: str) -> dict[int, DeltaToolCall]:
    return {
        1: DeltaToolCall(name=name, json_args=json.dumps(args), tool_call_id=call_id)
    }


async def _decide(
    factory, stream_function, chat_id: str, item_id: str, *, approve: bool
) -> list[dict]:
    with factory() as session:
        turn = AssistantService(session, user_id=1).decide(
            chat_id, item_id, approve=approve
        )
    return [
        json.loads(line)
        async for line in stream_turn(
            turn, model=_test_model(stream_function), session_factory=factory
        )
    ]


@pytest.mark.anyio
async def test_assistant_applies_an_approved_allocation_and_undoes_it() -> None:
    factory = _session_factory()
    with factory() as session:
        ids = _seed_trip(session)
    heard: list[dict] = []
    instructions: list[str] = []

    async def stream(messages, info):
        instructions.append(info.instructions)
        if returns := _tool_returns(messages):
            heard.append(returns[-1].content)
            yield "Done."
            return
        if len(heard) == 0:
            yield "Allocating half of each."
            yield _call(
                "allocate_reimbursement",
                {
                    "reimbursement_id": ids["refund_id"],
                    "expense_ids": [ids["hotel_id"], ids["train_id"]],
                    "split": "share",
                    "share_percent": 50,
                },
                "call-1",
            )
            return
        yield _call("undo_action", {"action_id": heard[0]["action_id"]}, "call-2")

    events = await _collect(factory, stream, "The refund covers half of the trip")
    chat_id = events[0]["chat_id"]
    items = _final_items(events)
    assert events[-1] == {"type": "end", "status": "completed"}
    assert [(item["kind"], item["state"]) for item in items] == [
        ("note", "done"),
        ("tool", "done"),
        ("approval", "pending"),
    ]
    card = items[2]["card"]
    assert card["title"] == f"Allocate 87,61{NBSP}€ from Trip refund"
    assert card["meta"] == "Marks it as a reimbursement"
    # Half of 58,41 € rounds half up and the shares add up to the whole refund.
    assert [
        (row["title"], row["amount_cents"], row["of_cents"]) for row in card["rows"]
    ] == [("Hotel", 5_840, 11_680), ("Train", 2_921, 5_841)]
    assert (card["total_cents"], card["total_of_cents"]) == (8_761, 8_761)
    assert (card["verb"], card["done"]) == ("Allocate", "Allocated")
    with factory() as session:
        reimbursements = ReimbursementService(session, user_id=1)
        assert reimbursements.allocated_total_for_reimbursement(ids["refund_id"]) == 0
        assert session.scalars(select(AssistantAction)).one().status == "proposed"

    decided = await _decide(factory, stream, chat_id, items[2]["id"], approve=True)

    assert decided[-1] == {"type": "end", "status": "completed"}
    assert [(item["kind"], item["state"]) for item in _final_items(decided)] == [
        ("approval", "applied"),
        ("text", "done"),
    ]
    assert heard[0]["status"] == "applied"
    assert heard[0]["allocated_cents"] == 8_761
    with factory() as session:
        reimbursements = ReimbursementService(session, user_id=1)
        assert (
            reimbursements.allocated_total_for_reimbursement(ids["refund_id"]) == 8_761
        )
        assert session.get(Transaction, ids["refund_id"]).is_reimbursement
        service = AssistantService(session, user_id=1)
        [turn] = service.chat_out(chat_id).turns
        assert [(item.kind, item.state) for item in turn.items] == [
            ("note", "done"),
            ("tool", "done"),
            ("approval", "applied"),
            ("text", "done"),
        ]
        with pytest.raises(AssistantConflictError):
            service.decide(chat_id, items[2]["id"], approve=True)
        with pytest.raises(AssistantConflictError):
            service.retry_turn(chat_id)

    events = await _collect(factory, stream, "Undo that", chat_id=chat_id)
    [approval] = [item for item in _final_items(events) if item["kind"] == "approval"]
    assert f"- {heard[0]['action_id']}: Allocated 87,61{NBSP}€" in instructions[-1]
    assert approval["card"]["title"] == f"Undo: Allocated 87,61{NBSP}€ from Trip refund"
    await _decide(factory, stream, chat_id, approval["id"], approve=True)

    assert heard[1]["status"] == "applied"
    with factory() as session:
        reimbursements = ReimbursementService(session, user_id=1)
        assert reimbursements.allocated_total_for_reimbursement(ids["refund_id"]) == 0
        assert not session.get(Transaction, ids["refund_id"]).is_reimbursement
        assert [
            action.status
            for action in session.scalars(
                select(AssistantAction).order_by(AssistantAction.id)
            )
        ] == ["undone", "applied"]


@pytest.mark.anyio
async def test_assistant_dismissed_or_ignored_proposals_change_nothing() -> None:
    factory = _session_factory()
    with factory() as session:
        ids = _seed_trip(session)
    heard: list[dict] = []
    calls = 0

    async def stream(messages, info):
        nonlocal calls
        returns = _tool_returns(messages)
        prompts = [
            part.content
            for part in messages[-1].parts
            if isinstance(part, UserPromptPart)
        ]
        if returns:
            heard.append(returns[-1].content)
        if returns or prompts == ["Never mind"]:
            yield "Okay."
            return
        calls += 1
        yield _call(
            "create_transactions",
            {
                "transactions": [
                    {
                        "date": "2026-06-21",
                        "kind": "expense",
                        "amount_cents": 1_250,
                        "title": "Lunch",
                        "category_id": ids["travel_id"],
                        "tags": ["Work"],
                    }
                ]
            },
            f"call-{calls}",
        )

    events = await _collect(factory, stream, "Add lunch for 12,50")
    chat_id = events[0]["chat_id"]
    [approval] = [item for item in _final_items(events) if item["kind"] == "approval"]
    assert approval["card"]["title"] == "1 new transaction"
    assert approval["card"]["rows"][0]["detail"] == "Travel · Work"
    decided = await _decide(factory, stream, chat_id, approval["id"], approve=False)
    assert _final_items(decided)[0]["state"] == "dismissed"
    assert heard[-1]["status"] == "dismissed"

    events = await _collect(factory, stream, "Add it after all", chat_id=chat_id)
    await _collect(factory, stream, "Never mind", chat_id=chat_id)

    # Moving on closes the open card, and the model hears that with the new message.
    assert heard[-1]["status"] == "dismissed"
    assert "moved on" in heard[-1]["message"]
    with factory() as session:
        chat = AssistantService(session, user_id=1).chat_out(chat_id)
        assert [
            item.state
            for turn in chat.turns
            for item in turn.items
            if item.kind == "approval"
        ] == ["dismissed", "dismissed"]
        assert [
            action.status for action in session.scalars(select(AssistantAction))
        ] == [
            "dismissed",
            "dismissed",
        ]
        assert not session.scalars(
            select(Transaction).where(Transaction.title == "Lunch")
        ).all()


@pytest.mark.anyio
async def test_assistant_does_not_apply_a_change_the_data_outgrew() -> None:
    factory = _session_factory()
    with factory() as session:
        ids = _seed_spending_fixture(session)
        supermarket = session.scalars(
            select(Transaction).where(Transaction.title == "Weekly supermarket")
        ).one()
    heard: list[dict] = []

    async def stream(messages, info):
        if returns := _tool_returns(messages):
            heard.append(returns[-1].content)
            yield "It changed meanwhile."
            return
        yield _call(
            "edit_transactions",
            {"transaction_ids": [supermarket.id], "category_id": ids["leisure_id"]},
            "call-1",
        )

    events = await _collect(factory, stream, "Move the supermarket run to free time")
    chat_id = events[0]["chat_id"]
    [approval] = [item for item in _final_items(events) if item["kind"] == "approval"]
    assert approval["card"]["rows"][0]["detail"] == "Groceries → Free time"
    with factory() as session:
        session.get(Transaction, supermarket.id).title = "Supermarket"
        session.commit()

    decided = await _decide(factory, stream, chat_id, approval["id"], approve=True)

    [card, _] = _final_items(decided)
    assert card["state"] == "failed"
    assert card["message"] == "Supermarket changed since this was proposed."
    assert heard == [
        {
            "ok": False,
            "status": "conflict",
            "message": "Supermarket changed since this was proposed.",
        }
    ]
    with factory() as session:
        assert (
            session.get(Transaction, supermarket.id).category_id == ids["groceries_id"]
        )
        assert session.scalars(select(AssistantAction)).one().status == "failed"


def test_assistant_proposals_refuse_what_they_cannot_do_exactly() -> None:
    with make_session() as session:
        ids = _seed_spending_fixture(session)
        reader = _reader(session)
        supermarket = session.scalars(
            select(Transaction).where(Transaction.title == "Weekly supermarket")
        ).one()
        salary = CategoryService(session, user_id=1).list_all()[2]

        def refused(build) -> str:
            with pytest.raises(InvalidProposal) as caught:
                build()
            return caught.value.status

        # The friend's 120,00 € is already allocated in full to the concert.
        assert (
            refused(
                lambda: propose_allocate(
                    reader,
                    reimbursement_id=ids["reimbursement_id"],
                    expense_ids=[supermarket.id],
                    split="share",
                    share_percent=50,
                    amounts_cents=None,
                )
            )
            == "exceeds_reimbursement"
        )
        assert (
            refused(
                lambda: propose_edit(
                    reader,
                    transaction_ids=[supermarket.id],
                    category_id=salary.id,
                    add_tags=[],
                    remove_tags=[],
                    title=None,
                )
            )
            == "category_type"
        )
        # Tags match without case, so this asks for nothing new.
        assert (
            refused(
                lambda: propose_edit(
                    reader,
                    transaction_ids=[supermarket.id],
                    category_id=None,
                    add_tags=["food"],
                    remove_tags=[],
                    title=None,
                )
            )
            == "no_change"
        )


def _apply_proposal(session: Session, proposal) -> AssistantAction:
    now = datetime(2026, 6, 27, 12, 0)
    action = AssistantAction(
        user_id=1,
        chat_id="c" * 32,
        tool_call_id=f"call-{session.scalar(select(func.count(AssistantAction.id)))}",
        kind=proposal.plan.kind,
        summary=proposal.summary,
        plan_json=proposal.plan.model_dump_json(),
        status="applied",
        created_at=now,
        decided_at=now,
    )
    session.add(action)
    session.flush()
    apply_action(session, action)
    session.commit()
    return action


def test_assistant_undo_restores_the_exact_earlier_state() -> None:
    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_spending_fixture(session)
        reader = _reader(session)
        budgets = BudgetService(session, user_id=1)

        def classification(title: str) -> tuple[int, list[str]]:
            txn = session.scalars(
                select(Transaction).where(Transaction.title == title)
            ).one()
            return txn.category_id, sorted(tag.name for tag in txn.tags)

        def july_budgets() -> dict[int | None, int]:
            return {
                row.scope_category_id: row.amount_cents
                for row in budgets.effective_budgets_for_month(2026, 7)
            }

        created = _apply_proposal(
            session,
            propose_create(
                reader,
                [
                    NewTransaction(
                        date=date(2026, 6, 26),
                        kind="expense",
                        amount_cents=4_200,
                        title="Taxi",
                        tags=["Trip"],
                    )
                ],
            ),
        )
        supermarket = session.scalars(
            select(Transaction).where(Transaction.title == "Weekly supermarket")
        ).one()
        edited = _apply_proposal(
            session,
            propose_edit(
                reader,
                transaction_ids=[supermarket.id],
                category_id=ids["leisure_id"],
                add_tags=["trip"],
                remove_tags=["Food"],
                title=None,
            ),
        )
        assert classification("Weekly supermarket") == (ids["leisure_id"], ["Trip"])
        # The onward budget below deletes this July budget; undo brings it back.
        budgets.upsert_override(
            BudgetOverrideIn(
                year=2026, month=7, category_id=ids["groceries_id"], amount_cents=38_000
            )
        )
        before_budgets = july_budgets()
        set_budgets = _apply_proposal(
            session,
            propose_budgets(
                reader,
                [
                    BudgetRequest(
                        category_id=ids["groceries_id"],
                        month="2026-07",
                        amount_cents=40_000,
                        applies="onward",
                    ),
                    BudgetRequest(
                        month="2026-07", amount_cents=100_000, applies="month"
                    ),
                ],
            ),
        )
        assert july_budgets() == {
            None: 100_000,
            **before_budgets,
            ids["groceries_id"]: 40_000,
        }
        assert {
            row.scope_category_id: row.amount_cents
            for row in budgets.effective_budgets_for_month(2026, 6)
        }[ids["groceries_id"]] == 35_000

        undo_budgets = propose_undo(reader, set_budgets.id)
        assert [
            (row.title, row.detail, row.amount_cents) for row in undo_budgets.card.rows
        ] == [
            ("Groceries", "From Jan 2026 · was Jan 2026 – Jun 2026", 35_000),
            ("Groceries", "From Jul 2026 · removed", 40_000),
            ("Groceries", "Jul 2026 only · restored", 38_000),
            ("Overall budget", "Jul 2026 only · removed", 100_000),
        ]
        _apply_proposal(session, undo_budgets)
        for action in (edited, created):
            _apply_proposal(session, propose_undo(reader, action.id))

        assert july_budgets() == before_budgets
        assert classification("Weekly supermarket") == (ids["groceries_id"], ["Food"])
        taxi = session.scalars(
            select(Transaction).where(Transaction.title == "Taxi")
        ).one()
        assert taxi.deleted_at is not None
        assert {created.status, edited.status, set_budgets.status} == {"undone"}
        with pytest.raises(InvalidProposal):
            propose_undo(reader, created.id)


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
