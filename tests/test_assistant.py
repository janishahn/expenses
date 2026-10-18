import asyncio
import json
import tempfile
import threading
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import (
    ModelMessage,
    TextPart,
    ToolReturnPart,
    UserPromptPart,
)
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
from expenses.ai import assistant_tools
from expenses.ai.assistant_actions import (
    ActionConflict,
    BudgetRequest,
    BudgetScope,
    CategoryName,
    InvalidProposal,
    NewCategory,
    NewTransaction,
    apply_action,
    propose_allocate,
    propose_archive,
    propose_budgets,
    propose_create,
    propose_create_categories,
    propose_edit,
    propose_end_recurring,
    propose_remove_budgets,
    propose_rename_categories,
    propose_trash,
    propose_undo,
)
from expenses.ai.assistant_tools import AssistantReader
from expenses.api import assistant_routes
from expenses.core.config import get_settings
from expenses.db.models import (
    AIFeatureSetting,
    AssistantAction,
    AssistantChat,
    AssistantTurn,
    BudgetFrequency,
    Category,
    IntervalUnit,
    LLMJob,
    ReimbursementAllocation,
    RuleMatchType,
    Tag,
    Transaction,
    TransactionType,
    User,
)
from expenses.db.session import Base, _enable_sqlite_pragmas
from expenses.schemas import (
    BudgetOverrideIn,
    BudgetTemplateApplyFromIn,
    BudgetTemplateIn,
    CategoryIn,
    RecurringRuleIn,
    RuleIn,
    TransactionIn,
)
from expenses.services import (
    BudgetService,
    CategoryService,
    RecurringRuleService,
    ReimbursementService,
    RuleService,
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
        session,
        user_id=1,
        now=datetime.combine(today, datetime.min.time()),
        client="web",
    )


def test_sql_query_reads_only_the_users_rows_with_net_amounts() -> None:
    with make_session() as session:
        ids = _seed_spending_fixture(session)
        other = CategoryService(session, user_id=2).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        _create_txn(
            TransactionService(session, user_id=2),
            title="Someone else's groceries",
            amount_cents=99_900,
            txn_date=date(2026, 6, 3),
            category_id=other.id,
        )
        TransactionService(session, user_id=1).soft_delete(
            _create_txn(
                TransactionService(session, user_id=1),
                title="Deleted dinner",
                amount_cents=5_000,
                txn_date=date(2026, 6, 4),
                category_id=ids["leisure_id"],
            ).id
        )
        reader = _reader(session)

        by_category = reader.sql_query(
            sql="select category, sum(net_cents) from transactions "
            "where kind = 'expense' and date like '2026-06%' "
            "group by category order by 2 desc"
        )
        assert by_category == {
            "ok": True,
            "columns": ["category", "sum(net_cents)"],
            "rows": [["Groceries", 31_000], ["Free time", 18_000]],
        }
        # Each _cents column comes with its amount as text for the model to quote.
        concert = reader.sql_query(
            sql="select amount_cents, reimbursed_cents, net_cents from transactions "
            f"where id = {ids['concert_id']}"
        )
        assert concert == {
            "ok": True,
            "columns": [
                "amount_cents",
                "amount",
                "reimbursed_cents",
                "reimbursed",
                "net_cents",
                "net",
            ],
            "rows": [[30_000, "300,00", 12_000, "120,00", 18_000, "180,00"]],
        }
        assert reader.sql_query(
            sql="select 123456 as total_cents, -5 as change_cents, 'x' as odd_cents"
        )["rows"] == [[123_456, "1 234,56", -5, "-0,05", "x", None]]
        fuzzy = reader.sql_query(
            sql="select title from transactions where fuzzy(title, 'grocerry run')"
        )
        assert fuzzy["rows"] == [["Big grocery run"]]
        assert reader.sql_query(sql="select title, kind from trash")["rows"] == [
            ["Deleted dinner", "expense"]
        ]
        # A table named in a query is always this user's copy.
        assert reader.sql_query(
            sql="with transactions as (select * from main.transactions) "
            "select count(*) from transactions"
        )["rows"] == [[5]]


def test_sql_query_refuses_writes_and_runaway_queries_then_deletes_its_copy(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    with make_session() as session:
        _seed_spending_fixture(session)
        reader = _reader(session)

        assert reader.sql_query(sql="delete from transactions") == {
            "ok": False,
            "status": "invalid_sql",
            "message": "Only a SELECT can run; it can't change data or settings.",
        }
        assert reader.sql_query(sql="attach ':memory:' as other")["ok"] is False
        assert reader.sql_query(sql="select * from users")["message"] == (
            "no such table: users"
        )
        assert reader.sql_query(sql="select 1; select 2")["ok"] is False
        many = reader.sql_query(
            sql="with recursive n(i) as (select 1 union all select i + 1 from n "
            "where i < 150) select i from n"
        )
        assert (len(many["rows"]), many["more"]) == (100, True)

        monkeypatch.setattr(assistant_tools, "SQL_SECONDS", 0.05)
        endless = reader.sql_query(
            sql="with recursive n(i) as (select 1 union all select i + 1 from n) "
            "select count(*) from n"
        )
        assert endless["status"] == "invalid_sql"
        assert endless["message"].startswith("The query ran longer than")
        # The copy stays usable after a refused query.
        assert reader.sql_query(sql="select count(*) from tags")["rows"] == [[2]]

        # The copy is one temporary file, deleted when the turn closes the reader.
        assert len(list(tmp_path.iterdir())) == 1
        reader.close()
        assert list(tmp_path.iterdir()) == []


def test_reader_reports_budgets_balance_and_reference() -> None:
    with make_session() as session:
        ids = _seed_spending_fixture(session)
        reader = _reader(session)

        budgets = {
            row["scope_category_id"]: row
            for row in reader.get_budgets(year=2026, month=6)["budgets"]
        }
        assert budgets[ids["groceries_id"]]["remaining_cents"] == 4_000
        assert budgets[ids["leisure_id"]]["remaining_cents"] == -6_000
        assert budgets[ids["leisure_id"]]["remaining"] == "-60,00"

        history = reader.get_balance(months_back=2, months_ahead=0)
        assert [row["month"] for row in history["history"]] == ["2026-05", "2026-06"]
        assert "forecast" not in history
        forecast = reader.get_balance(months_back=0, months_ahead=3)
        assert len(forecast["forecast"]["months"]) == 3
        assert "history" not in forecast

        reference = assistant_tools.reference_block(reader.reference())
        assert "Today is Saturday, 2026-06-27." in reference
        assert "The user is in the web app." in reference
        assert f"- {ids['groceries_id']}: Groceries, expense" in reference
        assert ": Food" in reference


def _session_factory(path: Path | None = None):
    # In memory, every session shares one connection; a file gives each its own.
    engine = (
        create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
        if path
        else create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
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
        backend="test",
        llm_provider="test",
    )


def _after_tool(messages: list[ModelMessage]) -> bool:
    return any(isinstance(part, ToolReturnPart) for part in messages[-1].parts)


def _prompts(messages: list[ModelMessage]) -> str:
    """What the user's side sent the model: questions and the app's reference."""
    return "\n".join(
        part.content
        for message in messages
        for part in message.parts
        if isinstance(part, UserPromptPart) and isinstance(part.content, str)
    )


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
            turn,
            model=_test_model(stream_function),
            session_factory=factory,
            client="web",
        )
    ]


def _final_items(events: list[dict]) -> list[dict]:
    items: dict[str, dict] = {}
    for row in events:
        _apply(items, row)
    return list(items.values())


def test_assistant_route_streams_and_saves_a_turn(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_chat(monkeypatch)
    answer = "Nothing matched in June.\n\n- No transactions"
    heard: list[dict] = []

    async def stream(messages, info):
        if returns := _tool_returns(messages):
            heard.append(returns[-1].content)
        else:
            assert "The user is in the web app." in _prompts(messages)
            yield {0: DeltaThinkingPart(content="Look up June.")}
            yield "Checking June."
            yield _call(
                "sql_query",
                {
                    "label": "June spending",
                    "sql": "select count(*) from transactions "
                    "where date like '2026-06%'",
                },
                "call-1",
            )
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

    assert events[-1] == {"type": "end", "status": "completed"}
    items = _final_items(events)
    assert [(item["kind"], item["state"]) for item in items] == [
        ("thinking", "done"),
        ("note", "done"),
        ("tool", "done"),
        ("text", "done"),
    ]
    assert items[2]["label"] == "June spending"
    assert items[3]["text"] == answer
    assert heard == [{"ok": True, "columns": ["count(*)"], "rows": [[0]]}]

    chat = api_client.get(f"/api/assistant/chats/{events[0]['chat_id']}").json()
    [turn] = chat["turns"]
    assert turn["status"] == "completed"
    assert turn["items"] == items

    with factory() as session:
        job = session.scalars(select(LLMJob)).one()
    assert (
        job.feature,
        job.status,
        job.usage_tool_call_count,
        job.backend,
        job.chat_id,
    ) == ("spending_chat", "completed", 1, "test", events[0]["chat_id"])
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
        # The bearer token marks the iOS app.
        assert "The user is in the iOS app." in _prompts(messages)
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
    histories: list[list[str]] = []

    async def stream(messages, info):
        histories.append(
            [
                # The app's reference block comes before the first question.
                part.content.split("</reference>\n\n", 1)[-1]
                for message in messages
                for part in message.parts
                if isinstance(part, UserPromptPart | TextPart)
            ]
        )
        yield f"Answer {len(histories)}."

    first = await _collect(factory, stream, "First question")
    chat_id = first[0]["chat_id"]
    await _collect(factory, stream, "Second question", chat_id=chat_id)
    with factory() as session:
        retry = AssistantService(session, user_id=1).retry_turn(chat_id)
    events = [
        json.loads(line)
        async for line in stream_turn(
            retry, model=_test_model(stream), session_factory=factory, client="web"
        )
    ]

    # A retry drops the turn it replaces.
    assert histories == [
        ["First question"],
        ["First question", "Answer 1.", "Second question"],
        ["First question", "Answer 1.", "Second question"],
    ]
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
    lines = stream_turn(
        turn, model=_test_model(stream), session_factory=factory, client="web"
    )
    assert json.loads(await anext(lines))["type"] == "start"

    async def buffer_filled() -> None:
        while produced < assistant.STREAM_BUFFER_LINES // 2:
            await asyncio.sleep(0.01)

    await asyncio.wait_for(buffer_filled(), timeout=5)
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
async def test_assistant_keeps_a_chat_deleted_during_a_turn_deleted() -> None:
    factory = _session_factory()
    streaming = asyncio.Event()
    release = asyncio.Event()

    async def stream(messages, info):
        # The follow-up waits so the chat can be deleted while it runs.
        if len(messages) > 1:
            streaming.set()
            await release.wait()
        yield "Answer."

    first = await _collect(factory, stream, "First question")
    chat_id = first[0]["chat_id"]
    with factory() as session:
        follow_up = AssistantService(session, user_id=1).new_turn(
            chat_id=chat_id, text="And now?"
        )
    lines = stream_turn(
        follow_up, model=_test_model(stream), session_factory=factory, client="web"
    )
    assert json.loads(await anext(lines))["type"] == "start"
    await streaming.wait()
    with factory() as session:
        AssistantService(session, user_id=1).delete_chat(chat_id)
    release.set()
    rest = [json.loads(line) async for line in lines]

    assert rest[-1] == {"type": "end", "status": "completed"}
    with factory() as session:
        assert session.scalars(select(AssistantChat)).all() == []
        assert session.scalars(select(AssistantTurn)).all() == []
        # Usage still counts both answers.
        assert len(session.scalars(select(LLMJob)).all()) == 2


@pytest.mark.anyio
async def test_assistant_numbers_turns_that_finish_together(tmp_path: Path) -> None:
    factory = _session_factory(tmp_path / "expenses.db")

    async def stream(messages, info):
        yield "Answer."

    first = await _collect(factory, stream, "First question")
    chat_id = first[0]["chat_id"]
    other: list[list[dict]] = []
    other_turn = threading.Thread(
        target=lambda: other.append(
            asyncio.run(_collect(factory, stream, "Other question", chat_id=chat_id))
        )
    )
    other_saving = threading.Event()

    def numbering(conn, cursor, statement, *args) -> None:
        # A turn in another worker finishes while this one numbers itself.
        if "max(assistant_turns.seq)" in statement and other_turn.ident is None:
            other_turn.start()
            other_saving.wait(timeout=5)

    def saving(conn, cursor, statement, *args) -> None:
        if threading.current_thread() is other_turn and statement.startswith(
            "UPDATE assistant_chats"
        ):
            other_saving.set()

    engine = factory.kw["bind"]
    event.listen(engine, "after_cursor_execute", numbering)
    event.listen(engine, "before_cursor_execute", saving)
    events = await _collect(factory, stream, "Second question", chat_id=chat_id)
    other_turn.join()

    assert events[-1] == {"type": "end", "status": "completed"}
    assert other[0][-1] == {"type": "end", "status": "completed"}
    with factory() as session:
        assert session.execute(
            select(AssistantTurn.seq, AssistantTurn.user_text).order_by(
                AssistantTurn.seq
            )
        ).all() == [
            (1, "First question"),
            (2, "Second question"),
            (3, "Other question"),
        ]


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
    # A reopened chat shows the same reason.
    assert saved.error_message == events[-1]["message"]
    # A failed turn adds nothing to what the model sees next time.
    assert saved.messages_json == "[]"
    assert job.status == "failed"
    assert "429" in (job.error or "")


@pytest.mark.anyio
async def test_assistant_tools_are_not_strict() -> None:
    factory = _session_factory()
    tools = []

    async def stream(messages, info):
        tools.extend(info.function_tools)
        yield "Done."

    await _collect(factory, stream, "Summarize June")

    # Anthropic compiles strict schemas into a grammar and rejects propose_change's
    # union of change kinds as too large, though it is within the documented limits.
    assert {tool.name for tool in tools} >= {"sql_query", "propose_change"}
    assert not [tool.name for tool in tools if tool.strict]


@pytest.mark.anyio
async def test_assistant_dates_use_the_configured_timezone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EXPENSES_TIMEZONE", "Etc/GMT-14")
    get_settings.cache_clear()
    seen_prompts: list[str] = []

    async def stream(messages, info):
        seen_prompts.append(_prompts(messages))
        yield "Done."

    try:
        await _collect(_session_factory(), stream, "What day is it?")
    finally:
        get_settings.cache_clear()

    today = datetime.now(ZoneInfo("Etc/GMT-14")).date()
    assert f"{today.isoformat()}." in seen_prompts[0]


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
    if name == "propose_change":
        args = {"change": args}
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
            turn,
            model=_test_model(stream_function),
            session_factory=factory,
            client="web",
        )
    ]


def _wire(instructions: str | None, messages: list[ModelMessage]) -> list:
    """What a provider receives, without timestamps: instructions, then every part."""
    return [
        instructions,
        *(
            (
                part.part_kind,
                repr(getattr(part, "content", getattr(part, "args", None))),
            )
            for message in messages
            for part in message.parts
        ),
    ]


@pytest.mark.anyio
async def test_assistant_requests_keep_their_prefix_across_approvals() -> None:
    factory = _session_factory()
    with factory() as session:
        ids = _seed_trip(session)
    requests: list[list] = []

    async def stream(messages, info):
        requests.append(_wire(info.instructions, messages))
        if _tool_returns(messages):
            yield "Done."
        elif len(requests) == 1:
            yield {0: DeltaThinkingPart(content="Trash the hotel.")}
            yield _call(
                "propose_change",
                {"kind": "trash_transactions", "transaction_ids": [ids["hotel_id"]]},
                "call-1",
            )
        else:
            yield "You're welcome."

    events = await _collect(factory, stream, "Trash the hotel")
    chat_id = events[0]["chat_id"]
    [approval] = [item for item in _final_items(events) if item["kind"] == "approval"]
    await _decide(factory, stream, chat_id, approval["id"], approve=True)
    await _collect(factory, stream, "Thanks", chat_id=chat_id)
    await _collect(factory, stream, "Thanks again", chat_id=chat_id)

    # Each request repeats the one before it, so the provider keeps its cache and
    # the model's earlier reasoning.
    assert len(requests) == 4
    for earlier, later in zip(requests, requests[1:]):
        assert later[: len(earlier)] == earlier
    # The approval added a recent change, so the next question repeats only that
    # part of the reference; an unchanged reference is not sent again.
    assert "Categories (" in requests[0][-1][1]
    assert "<changes>\\nChanges you made recently" in requests[0][-1][1]
    assert "- none\\n</changes>" in requests[0][-1][1]
    assert "<changes>\\nChanges you made recently" in requests[2][-1][1]
    assert "- none\\n</changes>" not in requests[2][-1][1]
    assert "Categories (" not in requests[2][-1][1]
    assert requests[3][-1] == ("user-prompt", repr("Thanks again"))


@pytest.mark.anyio
async def test_assistant_applies_an_approved_allocation_and_undoes_it() -> None:
    factory = _session_factory()
    with factory() as session:
        ids = _seed_trip(session)
    heard: list[dict] = []
    prompts: list[str] = []

    async def stream(messages, info):
        prompts.append(_prompts(messages))
        if returns := _tool_returns(messages):
            heard.append(returns[-1].content)
            yield "Done."
            return
        if len(heard) == 0:
            yield "Allocating half of each."
            yield _call(
                "propose_change",
                {
                    "kind": "allocate_reimbursement",
                    "reimbursement_id": ids["refund_id"],
                    "expense_ids": [ids["hotel_id"], ids["train_id"]],
                    "split": "share",
                    "share_percent": 50,
                },
                "call-1",
            )
            return
        yield _call(
            "propose_change",
            {"kind": "undo", "action_id": heard[0]["action_id"]},
            "call-2",
        )

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
    assert f"- {heard[0]['action_id']}: Allocated 87,61{NBSP}€" in prompts[-1]
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

    async def stream(messages, info):
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
        # Every turn reuses one tool call id, as some local backends do.
        yield _call(
            "propose_change",
            {
                "kind": "create_transactions",
                "transactions": [
                    {
                        "date": "2026-06-21",
                        "kind": "expense",
                        "amount_cents": 1_250,
                        "title": "Lunch",
                        "category_id": ids["travel_id"],
                        "tags": ["Work"],
                    }
                ],
            },
            "call-1",
        )

    events = await _collect(factory, stream, "Add lunch for 12,50")
    chat_id = events[0]["chat_id"]
    [approval] = [item for item in _final_items(events) if item["kind"] == "approval"]
    assert approval["card"]["title"] == "Add 1 transaction"
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
async def test_assistant_retry_keeps_a_change_approved_while_it_ran() -> None:
    factory = _session_factory()
    with factory() as session:
        ids = _seed_trip(session)
    asked = 0
    retrying = asyncio.Event()
    release = asyncio.Event()

    async def stream(messages, info):
        nonlocal asked
        if _tool_returns(messages):
            yield "Added."
            return
        asked += 1
        if asked == 2:
            # The retry waits so another window can approve the card meanwhile.
            retrying.set()
            await release.wait()
            yield "Answer again."
            return
        yield _call(
            "propose_change",
            {
                "kind": "create_transactions",
                "transactions": [
                    {
                        "date": "2026-06-21",
                        "kind": "expense",
                        "amount_cents": 1_250,
                        "title": "Lunch",
                        "category_id": ids["travel_id"],
                        "tags": [],
                    }
                ],
            },
            "call-1",
        )

    events = await _collect(factory, stream, "Add lunch for 12,50")
    chat_id = events[0]["chat_id"]
    [approval] = [item for item in _final_items(events) if item["kind"] == "approval"]
    with factory() as session:
        retry = AssistantService(session, user_id=1).retry_turn(chat_id)
    lines = stream_turn(
        retry, model=_test_model(stream), session_factory=factory, client="web"
    )
    assert json.loads(await anext(lines))["type"] == "start"
    await retrying.wait()
    await _decide(factory, stream, chat_id, approval["id"], approve=True)
    release.set()
    async for _ in lines:
        pass

    with factory() as session:
        [turn] = AssistantService(session, user_id=1).chat_out(chat_id).turns
        assert [(item.kind, item.state) for item in turn.items] == [
            ("tool", "done"),
            ("approval", "applied"),
            ("text", "done"),
        ]
        assert session.scalars(select(AssistantAction)).one().status == "applied"
        assert session.scalars(
            select(Transaction).where(Transaction.title == "Lunch")
        ).one()
        # Usage still counts the retry.
        assert len(session.scalars(select(LLMJob)).all()) == 3


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
            "propose_change",
            {
                "kind": "edit_transactions",
                "transaction_ids": [supermarket.id],
                "category_id": ids["leisure_id"],
            },
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
                    amounts_cents=[],
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
                    notes=None,
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
                    notes=None,
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

        def classification(title: str) -> tuple[int, list[str], str | None]:
            txn = session.scalars(
                select(Transaction).where(Transaction.title == title)
            ).one()
            return (
                txn.category_id,
                sorted(tag.name for tag in txn.tags),
                txn.description,
            )

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
        edit = propose_edit(
            reader,
            transaction_ids=[supermarket.id],
            category_id=ids["leisure_id"],
            add_tags=["trip"],
            remove_tags=["Food"],
            title=None,
            notes=" Split with Anna ",
        )
        assert edit.card.rows[0].detail == (
            "Groceries → Free time · +Trip · −Food · Notes: Split with Anna"
        )
        edited = _apply_proposal(session, edit)
        assert classification("Weekly supermarket") == (
            ids["leisure_id"],
            ["Trip"],
            "Split with Anna",
        )
        # An amount edited after the change doesn't block undoing it.
        supermarket.amount_cents += 100
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
            ("Groceries", "From Jan 2026 on · was Jan 2026 – Jun 2026", 35_000),
            ("Groceries", "From Jul 2026 on · removed", 40_000),
            ("Groceries", "Jul 2026 only · restored", 38_000),
            ("Overall budget", "Jul 2026 only · removed", 100_000),
        ]
        _apply_proposal(session, undo_budgets)
        for action in (edited, created):
            _apply_proposal(session, propose_undo(reader, action.id))

        assert july_budgets() == before_budgets
        assert classification("Weekly supermarket") == (
            ids["groceries_id"],
            ["Food"],
            None,
        )
        taxi = session.scalars(
            select(Transaction).where(Transaction.title == "Taxi")
        ).one()
        assert taxi.deleted_at is not None
        assert {created.status, edited.status, set_budgets.status} == {"undone"}
        with pytest.raises(InvalidProposal):
            propose_undo(reader, created.id)


def test_assistant_destructive_changes_undo_exactly() -> None:
    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_spending_fixture(session)
        reader = _reader(session)

        def refused(build) -> str:
            with pytest.raises(InvalidProposal) as caught:
                build()
            return caught.value.status

        supermarket = session.scalars(
            select(Transaction).where(Transaction.title == "Weekly supermarket")
        ).one()
        trash = propose_trash(reader, [supermarket.id])
        assert (trash.card.title, trash.card.rows[0].detail) == (
            "Move 1 transaction to Trash",
            "Groceries",
        )
        trashed = _apply_proposal(session, trash)
        assert supermarket.deleted_at is not None
        restore = propose_undo(reader, trashed.id)
        assert [row.detail for row in restore.card.rows] == ["Restores from Trash"]
        _apply_proposal(session, restore)
        assert supermarket.deleted_at is None

        food = session.scalars(select(Tag).where(Tag.name == "Food")).one()
        uncategorized = CategoryService(session, user_id=1).get_or_create_uncategorized(
            TransactionType.expense
        )
        assert (
            refused(
                lambda: propose_archive(
                    reader, category_ids=[uncategorized.id], tag_ids=[]
                )
            )
            == "uncategorized"
        )
        archive = propose_archive(
            reader, category_ids=[ids["leisure_id"]], tag_ids=[food.id]
        )
        assert archive.card.title == "Archive 1 category and 1 tag"
        archived = _apply_proposal(session, archive)
        leisure = session.get_one(Category, ids["leisure_id"])
        assert leisure.archived_at is not None
        assert food.archived_at is not None
        _apply_proposal(session, propose_undo(reader, archived.id))
        assert leisure.archived_at is None
        assert food.archived_at is None

        budgets = BudgetService(session, user_id=1)
        budgets.apply_template_from(
            BudgetTemplateApplyFromIn(
                frequency=BudgetFrequency.monthly,
                category_id=ids["leisure_id"],
                amount_cents=15_000,
                starts_on=date(2026, 9, 1),
            )
        )
        budgets.upsert_override(
            BudgetOverrideIn(
                year=2026, month=8, category_id=ids["leisure_id"], amount_cents=20_000
            )
        )

        def leisure_budgets() -> list[int | None]:
            return [
                {
                    row.scope_category_id: row.amount_cents
                    for row in budgets.effective_budgets_for_month(2026, month)
                }.get(ids["leisure_id"])
                for month in (6, 7, 8, 9)
            ]

        assert leisure_budgets() == [12_000, 12_000, 20_000, 15_000]
        july_on = [BudgetScope(category_id=ids["leisure_id"], month="2026-07")]
        remove = propose_remove_budgets(reader, july_on)
        assert [
            (row.title, row.detail, row.amount_cents) for row in remove.card.rows
        ] == [("Free time", "From Jul 2026 on", 12_000)]
        removed = _apply_proposal(session, remove)
        assert leisure_budgets() == [12_000, None, None, None]
        assert refused(lambda: propose_remove_budgets(reader, july_on)) == "no_budget"
        undo_removal = propose_undo(reader, removed.id)
        assert [(row.detail, row.amount_cents) for row in undo_removal.card.rows] == [
            ("Jan 2026 – Aug 2026 · was Jan 2026 – Jun 2026", 12_000),
            ("From Sep 2026 on · restored", 15_000),
            ("Aug 2026 only · restored", 20_000),
        ]
        _apply_proposal(session, undo_removal)
        assert leisure_budgets() == [12_000, 12_000, 20_000, 15_000]

        gym = RecurringRuleService(session, user_id=1).create(
            RecurringRuleIn(
                name="Gym",
                type=TransactionType.expense,
                amount_cents=3_000,
                category_id=ids["leisure_id"],
                anchor_date=date(2026, 1, 5),
                interval_unit=IntervalUnit.month,
                interval_count=1,
                next_occurrence=date(2026, 7, 5),
            )
        )
        end = propose_end_recurring(
            reader, recurring_ids=[gym.id], end_date=date(2026, 6, 30)
        )
        assert [(row.title, row.detail, row.amount_cents) for row in end.card.rows] == [
            ("Gym", "Last on 30 Jun 2026", 3_000)
        ]
        ended = _apply_proposal(session, end)
        assert gym.end_date == date(2026, 6, 30)
        _apply_proposal(session, propose_undo(reader, ended.id))
        assert gym.end_date is None


def test_assistant_adds_and_renames_categories_and_undoes_both() -> None:
    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_spending_fixture(session)
        reader = _reader(session)
        uncategorized = CategoryService(session, user_id=1).get_or_create_uncategorized(
            TransactionType.expense
        )

        def refused(build) -> str:
            with pytest.raises(InvalidProposal) as caught:
                build()
            return caught.value.status

        def add(*names: tuple[str, str]):
            return propose_create_categories(
                reader, [NewCategory(name=name, kind=kind) for name, kind in names]
            )

        def rename(category_id: int, name: str):
            return propose_rename_categories(
                reader, [CategoryName(category_id=category_id, name=name)]
            )

        # Names match without case, within one type.
        assert refused(lambda: add(("groceries", "expense"))) == "name_taken"
        assert refused(lambda: add(("Trips", "expense"), ("trips", "expense"))) == (
            "duplicate"
        )
        assert refused(lambda: rename(uncategorized.id, "Misc")) == "uncategorized"
        assert refused(lambda: rename(ids["leisure_id"], "GROCERIES")) == "name_taken"

        create = add((" Trips ", "expense"), ("Groceries", "income"))
        assert create.card.title == "Add 2 categories"
        assert [(row.title, row.detail) for row in create.card.rows] == [
            ("Trips", "Expense category"),
            ("Groceries", "Income category"),
        ]
        created = _apply_proposal(session, create)
        trips = session.scalars(select(Category).where(Category.name == "Trips")).one()
        assert trips.type == TransactionType.expense

        renaming = rename(ids["groceries_id"], "Food")
        assert [(row.title, row.detail) for row in renaming.card.rows] == [
            ("Groceries", "Renamed to Food")
        ]
        renamed = _apply_proposal(session, renaming)
        groceries = session.get_one(Category, ids["groceries_id"])
        assert groceries.name == "Food"

        undo_create = propose_undo(reader, created.id)
        assert [row.detail for row in undo_create.card.rows] == [
            "Archives the category",
            "Archives the category",
        ]
        _apply_proposal(session, undo_create)
        assert trips.archived_at is not None
        _apply_proposal(session, propose_undo(reader, renamed.id))
        assert groceries.name == "Groceries"


def test_assistant_adds_transactions_exactly_as_the_card_shows() -> None:
    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_trip(session)
        RuleService(session, 1).create(
            RuleIn(
                name="Lunch is travel",
                match_type=RuleMatchType.contains,
                match_value="lunch",
                set_category_id=ids["travel_id"],
            )
        )
        proposal = propose_create(
            _reader(session),
            [
                NewTransaction(
                    date=date(2026, 6, 21),
                    kind="expense",
                    amount_cents=1_250,
                    title="Lunch",
                )
            ],
        )
        assert proposal.card.rows[0].detail == "Uncategorized"

        _apply_proposal(session, proposal)

        # The rule would have chosen Travel, but the card said Uncategorized.
        lunch = session.scalars(
            select(Transaction).where(Transaction.title == "Lunch")
        ).one()
        assert lunch.category.name == "Uncategorized"


def test_assistant_undo_leaves_expenses_in_trash_as_they_are() -> None:
    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_trip(session)
        reader = _reader(session)
        allocated = _apply_proposal(
            session,
            propose_allocate(
                reader,
                reimbursement_id=ids["refund_id"],
                expense_ids=[ids["hotel_id"], ids["train_id"]],
                split="share",
                share_percent=50,
                amounts_cents=[],
            ),
        )
        TransactionService(session, user_id=1).soft_delete(ids["train_id"])

        undo = propose_undo(reader, allocated.id)
        assert [row.title for row in undo.card.rows] == ["Hotel"]
        assert undo.card.meta == "Skips 1 expense in Trash"
        _apply_proposal(session, undo)

        # The expense in Trash keeps its allocation.
        assert session.scalars(
            select(ReimbursementAllocation.expense_transaction_id).where(
                ReimbursementAllocation.reimbursement_transaction_id == ids["refund_id"]
            )
        ).all() == [ids["train_id"]]


def test_assistant_approvals_refuse_amounts_changed_since_the_card() -> None:
    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_trip(session)
        proposal = propose_allocate(
            _reader(session),
            reimbursement_id=ids["refund_id"],
            expense_ids=[ids["hotel_id"]],
            split="share",
            share_percent=50,
            amounts_cents=[],
        )
        # The card showed 87,61 € to allocate from.
        session.get(Transaction, ids["refund_id"]).amount_cents = 9_000
        session.commit()

        with pytest.raises(ActionConflict):
            _apply_proposal(session, proposal)

    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_spending_fixture(session)
        proposal = propose_budgets(
            _reader(session),
            [
                BudgetRequest(
                    category_id=ids["groceries_id"],
                    month="2026-07",
                    amount_cents=40_000,
                    applies="month",
                )
            ],
        )
        # Edited elsewhere after the card showed the budget it replaces.
        BudgetService(session, user_id=1).upsert_override(
            BudgetOverrideIn(
                year=2026, month=7, category_id=ids["groceries_id"], amount_cents=38_000
            )
        )

        with pytest.raises(ActionConflict):
            _apply_proposal(session, proposal)

    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_trip(session)
        proposal = propose_edit(
            _reader(session),
            transaction_ids=[ids["hotel_id"]],
            category_id=None,
            add_tags=["Trip"],
            remove_tags=[],
            title=None,
            notes=None,
        )
        # The card showed 116,80 €.
        session.get(Transaction, ids["hotel_id"]).amount_cents = 12_000
        session.commit()

        with pytest.raises(ActionConflict):
            _apply_proposal(session, proposal)

    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_trip(session)
        reader = _reader(session)
        created = _apply_proposal(
            session,
            propose_create(
                reader,
                [
                    NewTransaction(
                        date=date(2026, 6, 21),
                        kind="expense",
                        amount_cents=1_250,
                        title="Lunch",
                    )
                ],
            ),
        )
        proposal = propose_undo(reader, created.id)
        # The card showed Jun 21.
        session.scalars(
            select(Transaction).where(Transaction.title == "Lunch")
        ).one().date = date(2026, 6, 22)
        session.commit()

        with pytest.raises(ActionConflict):
            _apply_proposal(session, proposal)

    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_trip(session)
        categories = CategoryService(session, user_id=1)
        lodging = categories.create(
            CategoryIn(name="Lodging", type=TransactionType.expense, order=1)
        )
        proposal = propose_edit(
            _reader(session),
            transaction_ids=[ids["hotel_id"]],
            category_id=lodging.id,
            add_tags=[],
            remove_tags=[],
            title=None,
            notes=None,
        )
        categories.archive(lodging.id)

        with pytest.raises(ActionConflict):
            _apply_proposal(session, proposal)

    with make_session() as session:
        session.add(User(id=1, username="owner", password_hash="unused"))
        ids = _seed_trip(session)
        reader = _reader(session)
        created = _apply_proposal(
            session,
            propose_create(
                reader,
                [
                    NewTransaction(
                        date=date(2026, 6, 21),
                        kind="expense",
                        amount_cents=1_250,
                        title="Lunch",
                    )
                ],
            ),
        )
        # 0.8.0 stored plans without what the card showed.
        created.undo_json = json.dumps(
            {"kind": "trash_transactions", "transaction_ids": [ids["hotel_id"]]}
        )
        with pytest.raises(InvalidProposal) as caught:
            propose_undo(reader, created.id)
        assert caught.value.status == "outdated"

        classification = {"category_id": ids["travel_id"], "tags": [], "title": "Hotel"}
        created.plan_json = json.dumps(
            {
                "kind": "edit_transactions",
                "rows": [
                    {
                        "transaction_id": ids["hotel_id"],
                        "before": classification,
                        "after": {**classification, "title": "Hostel"},
                    }
                ],
            }
        )
        with pytest.raises(ActionConflict):
            apply_action(session, created)
