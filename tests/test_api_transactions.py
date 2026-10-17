from datetime import date, datetime, timedelta
from io import BytesIO
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, event, update
from sqlalchemy.orm import sessionmaker

from expenses.core.config import get_settings
from expenses.core.periods import Period, month_end, month_start
from expenses.db.models import Transaction, TransactionType
from expenses.db.session import Base, _enable_sqlite_pragmas, _fuzzy_text_match
from expenses.recurrence.engine import local_today
from expenses.schemas import TransactionIn
from expenses.services import (
    ReimbursementService,
    TransactionFilters,
    TransactionService,
    auto_categorization,
)


def make_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    event.listen(engine, "connect", _enable_sqlite_pragmas)
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    return session_local()


def _category(
    client: TestClient, headers: dict[str, str], name: str, txn_type: str = "expense"
) -> int:
    response = client.post(
        "/api/categories",
        headers=headers,
        json={"name": name, "type": txn_type, "order": 0},
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def _transaction(
    client: TestClient,
    headers: dict[str, str],
    *,
    amount_cents: int,
    title: str,
    on: date | None = None,
    category_id: int | None = None,
    txn_type: str = "expense",
    tags: list[str] | None = None,
    is_reimbursement: bool = False,
) -> int:
    on = on or local_today()
    response = client.post(
        "/api/transactions",
        headers=headers,
        json={
            "date": on.isoformat(),
            "occurred_at": datetime.combine(on, datetime.min.time()).isoformat(),
            "type": txn_type,
            "amount_cents": amount_cents,
            "category_id": category_id,
            "title": title,
            "tags": tags or [],
            "is_reimbursement": is_reimbursement,
        },
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def test_api_create_transaction_stores_location(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/transactions",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:00:00",
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Lunch",
            "latitude": 52.520008,
            "longitude": 13.404954,
        },
        headers=csrf_headers,
    )

    assert response.status_code == 200
    transaction_id = int(response.json()["id"])

    response = api_client.get(f"/api/transactions/{transaction_id}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["latitude"] == 52.520008
    assert payload["longitude"] == 13.404954


def test_transaction_occurred_at_is_timezone_aware(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    # occurred_at is stored as a naive local datetime; the API must emit it
    # timezone-aware so clients that assume UTC (the native iOS app) do not shift
    # the displayed wall-clock by the local offset.
    response = api_client.post(
        "/api/transactions",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:00:00",
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Lunch",
        },
        headers=csrf_headers,
    )
    assert response.status_code == 200
    transaction_id = int(response.json()["id"])

    detail = api_client.get(f"/api/transactions/{transaction_id}")
    assert detail.status_code == 200
    raw = detail.json()["occurred_at"]
    parsed = datetime.fromisoformat(raw)
    assert parsed.utcoffset() is not None
    assert parsed.replace(tzinfo=None) == datetime(2025, 1, 10, 12, 0, 0)

    # Every serialization site agrees (list endpoint matches detail endpoint).
    listing = api_client.get("/api/transactions?period=all")
    assert listing.status_code == 200
    item = next(row for row in listing.json()["items"] if row["id"] == transaction_id)
    assert item["occurred_at"] == raw


def test_period_all_includes_future_dated_transactions(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    tomorrow = date.today() + timedelta(days=1)
    create_response = api_client.post(
        "/api/transactions",
        json={
            "date": tomorrow.isoformat(),
            "occurred_at": datetime.combine(tomorrow, datetime.min.time())
            .replace(hour=12)
            .isoformat(),
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Future lunch",
        },
        headers=csrf_headers,
    )
    assert create_response.status_code == 200
    transaction_id = int(create_response.json()["id"])

    list_response = api_client.get("/api/transactions?period=all")
    assert list_response.status_code == 200
    listed_ids = {int(item["id"]) for item in list_response.json()["items"]}
    assert transaction_id in listed_ids

    export_response = api_client.get("/api/transactions/export.csv?period=all")
    assert export_response.status_code == 200
    assert "Future lunch" in export_response.text


def test_transaction_summary_aggregates_the_filtered_query(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    for transaction_type, amount_cents, title in [
        ("expense", 5_000, "Summary lunch"),
        ("expense", 2_000, "Different purchase"),
        ("income", 10_000, "Summary pay"),
    ]:
        response = api_client.post(
            "/api/transactions",
            json={
                "date": "2025-01-10",
                "occurred_at": "2025-01-10T12:00:00",
                "type": transaction_type,
                "amount_cents": amount_cents,
                "title": title,
            },
            headers=csrf_headers,
        )
        assert response.status_code == 200

    response = api_client.get("/api/transactions/summary?period=all&q=Sumary")
    assert response.status_code == 200
    assert response.json() == {
        "income_cents": 10_000,
        "expense_cents": 5_000,
        "net_cents": 5_000,
        "count": 2,
    }


def test_multi_tag_filters_apply_to_list_summary_export_and_bulk_scope(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    created: dict[str, int] = {}
    for title, amount_cents, tags in [
        ("Exclude scope vacation", 9_000, ["Vacation scope"]),
        ("Exclude scope gifts", 5_000, ["Gift scope"]),
        ("Exclude scope regular", 3_000, []),
    ]:
        response = api_client.post(
            "/api/transactions",
            json={
                "date": "2025-01-10",
                "occurred_at": "2025-01-10T12:00:00",
                "type": "expense",
                "amount_cents": amount_cents,
                "title": title,
                "tags": tags,
            },
            headers=csrf_headers,
        )
        assert response.status_code == 200
        created[title] = int(response.json()["id"])

    tags_response = api_client.get("/api/tags")
    assert tags_response.status_code == 200
    vacation_tag_id = next(
        int(tag["id"])
        for tag in tags_response.json()["tags"]
        if tag["name"] == "Vacation scope"
    )
    gift_tag_id = next(
        int(tag["id"])
        for tag in tags_response.json()["tags"]
        if tag["name"] == "Gift scope"
    )
    query = f"period=all&q=Exclude+scope&exclude_tags={vacation_tag_id},{gift_tag_id}"

    listing = api_client.get(f"/api/transactions?{query}")
    assert listing.status_code == 200
    assert listing.json()["filters"]["excluded_tag_ids"] == [
        vacation_tag_id,
        gift_tag_id,
    ]
    assert [item["id"] for item in listing.json()["items"]] == [
        created["Exclude scope regular"]
    ]

    summary = api_client.get(f"/api/transactions/summary?{query}")
    assert summary.status_code == 200
    assert summary.json() == {
        "income_cents": 0,
        "expense_cents": 3_000,
        "net_cents": -3_000,
        "count": 1,
    }

    export = api_client.get(f"/api/transactions/export.csv?{query}")
    assert export.status_code == 200
    assert "Exclude scope regular" in export.text
    assert "Exclude scope vacation" not in export.text
    assert "Exclude scope gifts" not in export.text

    bulk_preview = api_client.post(
        "/api/transactions/bulk/preview",
        headers=csrf_headers,
        json={
            "selection": {
                "mode": "query",
                "query": {
                    "period": "all",
                    "exclude_tags": [vacation_tag_id, gift_tag_id],
                    "q": "Exclude scope",
                },
            },
            "operation": {
                "tag_patch": {"mode": "add", "tags": ["Reviewed scope"]},
                "lifecycle": "none",
            },
        },
    )
    assert bulk_preview.status_code == 200
    assert bulk_preview.json()["resolved_count"] == 1
    assert bulk_preview.json()["sample_ids"] == [created["Exclude scope regular"]]

    include_query = f"period=all&q=Exclude+scope&tags={vacation_tag_id},{gift_tag_id}"
    included_listing = api_client.get(f"/api/transactions?{include_query}")
    assert included_listing.status_code == 200
    assert included_listing.json()["filters"]["included_tag_ids"] == [
        vacation_tag_id,
        gift_tag_id,
    ]
    assert {item["id"] for item in included_listing.json()["items"]} == {
        created["Exclude scope vacation"],
        created["Exclude scope gifts"],
    }

    included_summary = api_client.get(f"/api/transactions/summary?{include_query}")
    assert included_summary.status_code == 200
    assert included_summary.json() == {
        "income_cents": 0,
        "expense_cents": 14_000,
        "net_cents": -14_000,
        "count": 2,
    }

    included_export = api_client.get(f"/api/transactions/export.csv?{include_query}")
    assert included_export.status_code == 200
    assert "Exclude scope vacation" in included_export.text
    assert "Exclude scope gifts" in included_export.text
    assert "Exclude scope regular" not in included_export.text

    included_bulk_preview = api_client.post(
        "/api/transactions/bulk/preview",
        headers=csrf_headers,
        json={
            "selection": {
                "mode": "query",
                "query": {
                    "period": "all",
                    "tags": [vacation_tag_id, gift_tag_id],
                    "q": "Exclude scope",
                },
            },
            "operation": {
                "tag_patch": {"mode": "add", "tags": ["Reviewed scope"]},
                "lifecycle": "none",
            },
        },
    )
    assert included_bulk_preview.status_code == 200
    assert included_bulk_preview.json()["resolved_count"] == 2

    contradictory_listing = api_client.get(
        f"/api/transactions?period=all&tags={vacation_tag_id}&exclude_tags={gift_tag_id}"
    )
    assert contradictory_listing.status_code == 400

    contradictory_bulk = api_client.post(
        "/api/transactions/bulk/preview",
        headers=csrf_headers,
        json={
            "selection": {
                "mode": "query",
                "query": {
                    "period": "all",
                    "tags": [vacation_tag_id],
                    "exclude_tags": [gift_tag_id],
                },
            },
            "operation": {"lifecycle": "soft_delete"},
        },
    )
    assert contradictory_bulk.status_code == 422


def test_transaction_summary_evaluates_fuzzy_filter_once() -> None:
    session = make_session()
    transactions = TransactionService(session)
    created: dict[str, Transaction] = {}
    for transaction_type, amount_cents, title, is_reimbursement in [
        (TransactionType.expense, 5_000, "Summary lunch", False),
        (TransactionType.expense, 2_000, "Different purchase", False),
        (TransactionType.income, 10_000, "Summary pay", False),
        (TransactionType.income, 1_000, "Payback", True),
    ]:
        created[title] = transactions.create(
            TransactionIn(
                date=date(2025, 1, 10),
                occurred_at=datetime(2025, 1, 10, 12, 0),
                type=transaction_type,
                is_reimbursement=is_reimbursement,
                amount_cents=amount_cents,
                title=title,
            )
        )
    ReimbursementService(session).upsert_allocation(
        created["Payback"].id, created["Summary lunch"].id, 1_000
    )
    select_statements: list[str] = []

    @event.listens_for(session.bind, "before_cursor_execute")
    def capture_select(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().lower().startswith("select"):
            select_statements.append(statement.lower())

    summary = transactions.summary_for_period(
        Period("all", date(1970, 1, 1), date(2025, 1, 31)),
        TransactionFilters(query="Sumary"),
    )

    assert summary == {
        "income_cents": 10_000,
        "expense_cents": 4_000,
        "net_cents": 6_000,
        "count": 2,
    }
    assert (
        sum("expenses_fuzzy_text_match" in statement for statement in select_statements)
        == 1
    )


def test_fuzzy_text_match_uses_balanced_whole_query_semantics() -> None:
    assert _fuzzy_text_match("  NETFLX  ", "Netflix", None) == 1
    assert _fuzzy_text_match("receipt", "Lunch", "Receipt attached") == 1
    assert _fuzzy_text_match("receipt", None, "Receipt attached") == 1
    assert _fuzzy_text_match("receipt", None, None) == 0
    assert _fuzzy_text_match("zx", "ZX marker", None) == 1
    assert _fuzzy_text_match("zy", "ZX marker", None) == 0
    assert _fuzzy_text_match("coffee berlin", "Coffee", "Berlin") == 0


def test_transaction_search_combines_filters_and_preserves_chronology(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    food_response = api_client.post(
        "/api/categories",
        json={"name": "Search food", "type": "expense", "order": 0},
        headers=csrf_headers,
    )
    travel_response = api_client.post(
        "/api/categories",
        json={"name": "Search travel", "type": "expense", "order": 1},
        headers=csrf_headers,
    )
    assert food_response.status_code == 200
    assert travel_response.status_code == 200
    food_id = int(food_response.json()["id"])
    travel_id = int(travel_response.json()["id"])

    created_ids: list[int] = []
    for occurred_at, amount_cents, category_id, title, description in [
        ("2025-01-10T12:00:00", 1_000, food_id, "Coffee subscription", None),
        (
            "2025-01-11T12:00:00",
            2_000,
            food_id,
            "Monthly service",
            "Coffee subscription renewed",
        ),
        (
            "2025-01-12T12:00:00",
            3_000,
            travel_id,
            "Coffee subscription abroad",
            None,
        ),
    ]:
        response = api_client.post(
            "/api/transactions",
            json={
                "date": occurred_at[:10],
                "occurred_at": occurred_at,
                "type": "expense",
                "amount_cents": amount_cents,
                "category_id": category_id,
                "title": title,
                "description": description,
            },
            headers=csrf_headers,
        )
        assert response.status_code == 200
        created_ids.append(int(response.json()["id"]))

    response = api_client.get("/api/transactions?period=all&q=cofee+subscription")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == list(
        reversed(created_ids)
    )

    response = api_client.get(
        f"/api/transactions?period=all&q=cofee+subscription&category={food_id}"
    )
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [
        created_ids[1],
        created_ids[0],
    ]


def test_api_update_transaction_stores_location(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    create_response = api_client.post(
        "/api/transactions",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:00:00",
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Lunch",
        },
        headers=csrf_headers,
    )

    assert create_response.status_code == 200
    transaction_id = int(create_response.json()["id"])

    update_response = api_client.put(
        f"/api/transactions/{transaction_id}",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:00:00",
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Lunch",
            "latitude": 52.520008,
            "longitude": 13.404954,
        },
        headers=csrf_headers,
    )

    assert update_response.status_code == 200

    get_response = api_client.get(f"/api/transactions/{transaction_id}")
    assert get_response.status_code == 200
    payload = get_response.json()
    assert payload["latitude"] == 52.520008
    assert payload["longitude"] == 13.404954


def test_api_update_transaction_preserves_existing_location_when_omitted(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    create_response = api_client.post(
        "/api/transactions",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:00:00",
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Lunch",
            "latitude": 52.520008,
            "longitude": 13.404954,
        },
        headers=csrf_headers,
    )

    assert create_response.status_code == 200
    transaction_id = int(create_response.json()["id"])

    update_response = api_client.put(
        f"/api/transactions/{transaction_id}",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:30:00",
            "type": "expense",
            "amount_cents": 5_500,
            "title": "Late Lunch",
        },
        headers=csrf_headers,
    )

    assert update_response.status_code == 200

    get_response = api_client.get(f"/api/transactions/{transaction_id}")
    assert get_response.status_code == 200
    payload = get_response.json()
    assert payload["latitude"] == 52.520008
    assert payload["longitude"] == 13.404954


def test_api_update_transaction_clears_location_when_explicitly_null(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    create_response = api_client.post(
        "/api/transactions",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:00:00",
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Lunch",
            "latitude": 52.520008,
            "longitude": 13.404954,
        },
        headers=csrf_headers,
    )

    assert create_response.status_code == 200
    transaction_id = int(create_response.json()["id"])

    update_response = api_client.put(
        f"/api/transactions/{transaction_id}",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:30:00",
            "type": "expense",
            "amount_cents": 5_500,
            "title": "Late Lunch",
            "latitude": None,
            "longitude": None,
        },
        headers=csrf_headers,
    )

    assert update_response.status_code == 200

    get_response = api_client.get(f"/api/transactions/{transaction_id}")
    assert get_response.status_code == 200
    payload = get_response.json()
    assert payload["latitude"] is None
    assert payload["longitude"] is None


def test_api_create_transaction_rejects_out_of_range_location(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/transactions",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:00:00",
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Lunch",
            "latitude": 91,
            "longitude": 13.404954,
        },
        headers=csrf_headers,
    )

    assert response.status_code == 422


def test_transaction_input_rejects_null_and_present_location_pair_mismatch() -> None:
    with pytest.raises(
        ValidationError, match="Latitude and longitude must both be provided"
    ):
        TransactionIn(
            date=date(2025, 1, 10),
            occurred_at=datetime(2025, 1, 10, 12, 0),
            type=TransactionType.expense,
            amount_cents=5_000,
            title="Lunch",
            latitude=None,
            longitude=13.404954,
        )


def test_api_create_transaction_rejects_unknown_location_wrapper(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/transactions",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:00:00",
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Lunch",
            "location": {"latitude": 52.520008, "longitude": 13.404954},
        },
        headers=csrf_headers,
    )

    assert response.status_code == 422


def test_api_update_transaction_rejects_unknown_location_wrapper(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    create_response = api_client.post(
        "/api/transactions",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:00:00",
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Lunch",
        },
        headers=csrf_headers,
    )

    assert create_response.status_code == 200
    transaction_id = int(create_response.json()["id"])

    response = api_client.put(
        f"/api/transactions/{transaction_id}",
        json={
            "date": "2025-01-10",
            "occurred_at": "2025-01-10T12:00:00",
            "type": "expense",
            "amount_cents": 5_000,
            "title": "Lunch",
            "location": {"latitude": 52.520008, "longitude": 13.404954},
        },
        headers=csrf_headers,
    )

    assert response.status_code == 422


def test_api_transaction_detail_payload_includes_location_attachments_and_metadata(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_response = api_client.post(
        "/api/categories",
        json={"name": "Detail payload category", "type": "expense", "order": 0},
        headers=csrf_headers,
    )
    assert category_response.status_code == 200
    category_id = int(category_response.json()["id"])

    create_response = api_client.post(
        "/api/transactions",
        json={
            "date": "2026-04-18",
            "occurred_at": "2026-04-18T10:15:00",
            "type": "expense",
            "amount_cents": 4599,
            "category_id": category_id,
            "title": "Detail payload transaction",
            "description": "Pinned payload description",
            "tags": ["alpha", "beta"],
            "latitude": 52.520008,
            "longitude": 13.404954,
        },
        headers=csrf_headers,
    )
    assert create_response.status_code == 200
    transaction_id = int(create_response.json()["id"])

    durable_response = api_client.post(
        f"/api/transactions/{transaction_id}/durable",
        json={"expected_lifespan_days": 365, "acquired_on": "2026-04-01"},
        headers=csrf_headers,
    )
    assert durable_response.status_code == 200

    upload_response = api_client.post(
        f"/api/transactions/{transaction_id}/attachments",
        files={
            "file": (
                "detail-receipt.png",
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0bIDATx\x9cc```\x00\x00\x00\x04\x00\x01\x0b\x0f\x02\x1d\x00\x00\x00\x00IEND\xaeB`\x82",
                "image/png",
            )
        },
        headers=csrf_headers,
    )
    assert upload_response.status_code == 200

    detail_response = api_client.get(f"/api/transactions/{transaction_id}")
    assert detail_response.status_code == 200
    payload = detail_response.json()

    assert payload["description"] == "Pinned payload description"
    assert payload["tags"] == ["alpha", "beta"]
    assert payload["latitude"] == 52.520008
    assert payload["longitude"] == 13.404954
    assert payload["is_reimbursement"] is False

    durable = payload["durable_purchase"]
    assert durable is not None
    assert durable["expected_lifespan_days"] == 365
    assert durable["acquired_on"] == "2026-04-01"

    attachments = payload["attachments"]
    assert len(attachments) == 1
    assert attachments[0]["original_filename"] == "detail-receipt.png"
    assert attachments[0]["mime_type"] == "image/png"
    assert attachments[0]["size_bytes"] > 0


def test_attachment_download_and_thumbnail_caching(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_response = api_client.post(
        "/api/categories",
        json={"name": "Receipt caching", "type": "expense", "order": 0},
        headers=csrf_headers,
    )
    category_id = int(category_response.json()["id"])
    create_response = api_client.post(
        "/api/transactions",
        json={
            "date": "2026-04-18",
            "occurred_at": "2026-04-18T10:15:00",
            "type": "expense",
            "amount_cents": 999,
            "category_id": category_id,
            "title": "Receipt caching transaction",
        },
        headers=csrf_headers,
    )
    transaction_id = int(create_response.json()["id"])

    one_by_one_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0bIDATx\x9cc```\x00\x00\x00\x04\x00\x01\x0b\x0f\x02\x1d\x00\x00\x00\x00IEND\xaeB`\x82"
    upload_response = api_client.post(
        f"/api/transactions/{transaction_id}/attachments",
        files={"file": ("caching-receipt.png", one_by_one_png, "image/png")},
        headers=csrf_headers,
    )
    assert upload_response.status_code == 200
    attachment_id = int(upload_response.json()["id"])

    download = api_client.get(f"/api/attachments/{attachment_id}/download")
    assert download.status_code == 200
    assert "max-age" in download.headers["cache-control"]
    assert download.headers["content-disposition"].startswith("inline")
    etag = download.headers["etag"]
    assert etag

    not_modified = api_client.get(
        f"/api/attachments/{attachment_id}/download",
        headers={"If-None-Match": etag},
    )
    assert not_modified.status_code == 304

    thumbnail = api_client.get(f"/api/attachments/{attachment_id}/thumbnail")
    assert thumbnail.status_code == 200
    assert thumbnail.headers["content-type"] == "image/webp"
    thumb_etag = thumbnail.headers["etag"]
    assert thumb_etag != etag

    thumb_not_modified = api_client.get(
        f"/api/attachments/{attachment_id}/thumbnail",
        headers={"If-None-Match": thumb_etag},
    )
    assert thumb_not_modified.status_code == 304


def test_attachment_thumbnail_follows_photo_orientation(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _category(api_client, csrf_headers, "Receipt photos")
    transaction_id = _transaction(
        api_client,
        csrf_headers,
        amount_cents=300,
        title="Sideways receipt",
        category_id=category_id,
    )

    from PIL import Image

    # Stored landscape; orientation 6 tells viewers to turn it into a portrait.
    photo = Image.new("RGB", (40, 20), color="white")
    exif = photo.getexif()
    exif[0x0112] = 6
    photo_bytes = BytesIO()
    photo.save(photo_bytes, format="JPEG", exif=exif)
    upload_response = api_client.post(
        f"/api/transactions/{transaction_id}/attachments",
        files={"file": ("sideways.jpg", photo_bytes.getvalue(), "image/jpeg")},
        headers=csrf_headers,
    )
    assert upload_response.status_code == 200
    attachment_id = int(upload_response.json()["id"])

    thumbnail = api_client.get(f"/api/attachments/{attachment_id}/thumbnail")

    assert thumbnail.status_code == 200
    assert Image.open(BytesIO(thumbnail.content)).size == (20, 40)


def test_attachment_thumbnail_pixel_limit_applies_to_decoded_size(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A 2048 px square is over the limit, but a baseline JPEG of it decodes at 1024 px.
    monkeypatch.setenv("EXPENSES_RECEIPT_THUMBNAIL_MAX_PIXELS", "2000000")
    get_settings.cache_clear()
    category_id = _category(api_client, csrf_headers, "Large receipts")
    transaction_id = _transaction(
        api_client,
        csrf_headers,
        amount_cents=999,
        title="Large receipt",
        category_id=category_id,
    )

    from PIL import Image

    def thumbnail_status(filename: str, mime_type: str, **save_options: object) -> int:
        image_bytes = BytesIO()
        Image.new("RGB", (2048, 2048), color="white").save(image_bytes, **save_options)
        upload_response = api_client.post(
            f"/api/transactions/{transaction_id}/attachments",
            files={"file": (filename, image_bytes.getvalue(), mime_type)},
            headers=csrf_headers,
        )
        assert upload_response.status_code == 200
        attachment_id = int(upload_response.json()["id"])
        thumbnail = api_client.get(f"/api/attachments/{attachment_id}/thumbnail")
        return thumbnail.status_code

    assert thumbnail_status("large.jpg", "image/jpeg", format="JPEG") == 200
    assert (
        thumbnail_status(
            "progressive.jpg", "image/jpeg", format="JPEG", progressive=True
        )
        == 400
    )
    assert thumbnail_status("large.png", "image/png", format="PNG") == 400


def test_transactions_list_total_counts_every_filtered_row(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    for title in ("Coffee beans", "Coffee filter", "Monthly rent"):
        _transaction(api_client, csrf_headers, amount_cents=1_000, title=title)

    page = api_client.get("/api/transactions?limit=2").json()
    assert (len(page["items"]), page["has_more"], page["total"]) == (2, True, 3)
    assert api_client.get("/api/transactions?q=coffee").json()["total"] == 2
    assert api_client.get("/api/transactions/uncategorized").json()["total"] == 3


def test_transaction_detail_includes_net_amount_and_created_at(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    income_category = _category(api_client, csrf_headers, "Refunds", "income")
    expense_id = _transaction(
        api_client, csrf_headers, amount_cents=2_500, title="Lunch"
    )
    reimbursement_id = _transaction(
        api_client,
        csrf_headers,
        amount_cents=1_000,
        title="Lunch refund",
        txn_type="income",
        category_id=income_category,
        is_reimbursement=True,
    )
    response = api_client.post(
        f"/api/reimbursements/{reimbursement_id}/allocations",
        headers=csrf_headers,
        json={"expense_transaction_id": expense_id, "amount_cents": 1_000},
    )
    assert response.status_code == 200

    detail = api_client.get(f"/api/transactions/{expense_id}").json()
    listed = next(
        item
        for item in api_client.get("/api/transactions").json()["items"]
        if item["id"] == expense_id
    )
    assert detail["amount_cents"] == 2_500
    assert detail["net_amount_cents"] == listed["net_amount_cents"] == 1_500
    assert detail["reimbursed_total_cents"] == listed["reimbursed_total_cents"] == 1_000
    assert datetime.fromisoformat(detail["created_at"])
    assert detail["bank_row"] is None


def test_default_periods_end_on_the_app_timezone_today(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # These zones are 25 hours apart, so one is always on another date than the host.
    zone = next(
        name
        for name in ("Pacific/Kiritimati", "Pacific/Pago_Pago")
        if datetime.now(ZoneInfo(name)).date() != date.today()
    )
    monkeypatch.setattr(get_settings(), "timezone", zone)
    today = local_today()

    assert api_client.get("/api/transactions").json()["period"]["end"] == (
        today.isoformat()
    )
    this_month = api_client.get("/api/transactions?period=this_month").json()
    assert (
        this_month["period"]["start"]
        == month_start(today.year, today.month).isoformat()
    )
    assert this_month["period"]["end"] == month_end(today.year, today.month).isoformat()


def test_deleted_transactions_keep_default_page_and_support_paging_and_bulk_actions(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    ids = [
        _transaction(api_client, csrf_headers, amount_cents=500, title=f"Trash {n}")
        for n in range(3)
    ]
    keeper = _transaction(api_client, csrf_headers, amount_cents=500, title="Keeper")
    for transaction_id in ids:
        assert (
            api_client.delete(
                f"/api/transactions/{transaction_id}", headers=csrf_headers
            ).status_code
            == 200
        )

    default = api_client.get("/api/transactions/deleted").json()
    assert default["total"] == 3
    assert {item["id"] for item in default["transactions"]} == set(ids)
    paged = api_client.get("/api/transactions/deleted?page=2&limit=2").json()
    assert paged["total"] == 3
    assert len(paged["transactions"]) == 1
    assert api_client.get("/api/transactions/deleted?page=0").status_code == 422

    restored = api_client.post(
        "/api/transactions/deleted/restore",
        headers=csrf_headers,
        json={"ids": [ids[0], keeper, 999_999]},
    )
    assert restored.json() == {"restored": 1}
    purged = api_client.post(
        "/api/transactions/deleted/purge",
        headers=csrf_headers,
        json={"ids": [ids[1], keeper, 999_999]},
    )
    assert purged.json() == {"deleted": 1}
    remaining = api_client.get("/api/transactions/deleted").json()
    assert [item["id"] for item in remaining["transactions"]] == [ids[2]]
    assert api_client.get(f"/api/transactions/{keeper}").status_code == 200
    assert api_client.get(f"/api/transactions/{ids[0]}").status_code == 200


def test_bulk_restore_brings_back_the_month_totals(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    ids = [
        _transaction(
            api_client,
            csrf_headers,
            amount_cents=cents,
            title=f"March {cents}",
            on=date(2026, 3, day),
        )
        for day, cents in ((10, 1_000), (20, 2_500))
    ]
    march = "/api/dashboard?period=custom&start=2026-03-01&end=2026-03-31"
    for transaction_id in ids:
        api_client.delete(f"/api/transactions/{transaction_id}", headers=csrf_headers)
    assert api_client.get(march).json()["kpis"]["expenses"] == 0

    restored = api_client.post(
        "/api/transactions/deleted/restore", headers=csrf_headers, json={"ids": ids}
    )

    assert restored.json() == {"restored": 2}
    assert api_client.get(march).json()["kpis"]["expenses"] == 3_500


def test_bulk_apply_trash_and_restore_update_the_month_totals(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    ids = [
        _transaction(
            api_client,
            csrf_headers,
            amount_cents=cents,
            title=f"April {cents}",
            on=date(2026, 4, day),
        )
        for day, cents in ((5, 1_000), (15, 2_500), (25, 400))
    ]
    april = "/api/dashboard?period=custom&start=2026-04-01&end=2026-04-30"

    def apply(lifecycle: str) -> dict:
        response = api_client.post(
            "/api/transactions/bulk/apply",
            headers=csrf_headers,
            json={
                "selection": {"mode": "ids", "transaction_ids": ids},
                "operation": {"lifecycle": lifecycle},
            },
        )
        assert response.status_code == 200
        return response.json()["changes"]

    assert apply("soft_delete")["deleted"] == 3
    assert api_client.get(april).json()["kpis"]["expenses"] == 0
    assert apply("restore")["restored"] == 3
    assert api_client.get(april).json()["kpis"]["expenses"] == 3_900


def test_bulk_category_undo_skips_a_transaction_changed_since(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    filed = _category(api_client, csrf_headers, "Filed")
    newer = _category(api_client, csrf_headers, "Newer")
    original = _category(api_client, csrf_headers, "Original")
    transaction_id = _transaction(
        api_client, csrf_headers, amount_cents=900, title="Lunch", category_id=newer
    )

    def undo() -> dict:
        response = api_client.post(
            "/api/transactions/bulk/apply",
            headers=csrf_headers,
            json={
                "selection": {"mode": "ids", "transaction_ids": [transaction_id]},
                "operation": {
                    "set_category_id": original,
                    "expected_category_id": filed,
                },
            },
        )
        assert response.status_code == 200
        return response.json()

    skipped = undo()
    assert skipped["skipped_count"] == 1
    assert skipped["changes"]["category_changed"] == 0
    detail = api_client.get(f"/api/transactions/{transaction_id}").json()
    assert detail["category_id"] == newer

    api_client.post(
        "/api/transactions/bulk/apply",
        headers=csrf_headers,
        json={
            "selection": {"mode": "ids", "transaction_ids": [transaction_id]},
            "operation": {"set_category_id": filed},
        },
    )
    reverted = undo()
    assert reverted["skipped_count"] == 0
    assert reverted["changes"]["category_changed"] == 1
    detail = api_client.get(f"/api/transactions/{transaction_id}").json()
    assert detail["category_id"] == original


def test_bulk_trash_actions_ignore_other_users_transactions(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    transaction_id = _transaction(
        api_client, csrf_headers, amount_cents=500, title="Mine"
    )
    api_client.delete(f"/api/transactions/{transaction_id}", headers=csrf_headers)
    api_client.post("/api/auth/logout", headers=csrf_headers)
    credentials = {"username": "second", "password": "pw-12345"}
    assert api_client.post("/api/auth/signup", json=credentials).status_code == 200
    assert api_client.post("/api/auth/login", json=credentials).status_code == 200
    second_headers = {"X-CSRF-Token": api_client.get("/api/csrf").json()["token"]}

    for action, key in (("restore", "restored"), ("purge", "deleted")):
        response = api_client.post(
            f"/api/transactions/deleted/{action}",
            headers=second_headers,
            json={"ids": [transaction_id]},
        )
        assert response.json() == {key: 0}

    api_client.post("/api/auth/logout", headers=second_headers)
    assert (
        api_client.post(
            "/api/auth/login", json={"username": "bootstrap", "password": "pw-12345"}
        ).status_code
        == 200
    )
    assert len(api_client.get("/api/transactions/deleted").json()["transactions"]) == 1


def test_admin_purge_preview_counts_without_deleting(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    assert (
        api_client.post(
            "/api/auth/admin-elevation",
            headers=csrf_headers,
            json={"password": "pw-12345"},
        ).status_code
        == 200
    )
    transaction_id = _transaction(
        api_client, csrf_headers, amount_cents=500, title="Old trash"
    )
    api_client.delete(f"/api/transactions/{transaction_id}", headers=csrf_headers)
    assert api_client.get("/api/admin/purge-deleted/preview?days=1").json() == {
        "count": 0
    }
    db_session.execute(
        update(Transaction).values(deleted_at=datetime.utcnow() - timedelta(days=40))
    )
    db_session.commit()

    assert api_client.get("/api/admin/purge-deleted/preview?days=30").json() == {
        "count": 1
    }
    assert api_client.get("/api/admin/purge-deleted/preview?days=0").status_code == 422
    assert len(api_client.get("/api/transactions/deleted").json()["transactions"]) == 1


def test_uncategorized_suggestions_use_the_local_model_and_can_be_dismissed(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    auto_categorization._model_cache.clear()
    bakery = _category(api_client, csrf_headers, "Bakery")
    transit = _category(api_client, csrf_headers, "Transit")
    for index in range(80):
        bakery_purchase = index % 2 == 0
        _transaction(
            api_client,
            csrf_headers,
            amount_cents=500 if bakery_purchase else 340,
            title="Corner bakery" if bakery_purchase else "City metro",
            on=local_today() - timedelta(days=index),
            category_id=bakery if bakery_purchase else transit,
        )
    pending = _transaction(
        api_client, csrf_headers, amount_cents=500, title="Corner bakery"
    )

    def suggestion():
        items = api_client.get("/api/transactions/uncategorized").json()["items"]
        return next(item for item in items if item["id"] == pending)["suggestion"]

    assert suggestion() is None
    response = api_client.put(
        "/api/settings/auto-categorization",
        headers=csrf_headers,
        json={"enabled": True, "threshold": 0.8},
    )
    assert response.status_code == 200
    current = suggestion()
    assert current["category_id"] == bakery
    assert 0 < current["confidence"] <= 1
    assert len(auto_categorization._model_cache) == 1

    wrong = api_client.post(
        f"/api/transactions/{pending}/category-suggestion/dismiss",
        headers=csrf_headers,
        json={"category_id": 999_999},
    )
    assert wrong.status_code == 400
    dismissed = api_client.post(
        f"/api/transactions/{pending}/category-suggestion/dismiss",
        headers=csrf_headers,
        json={"category_id": bakery},
    )
    assert dismissed.json() == {"status": "ok"}
    assert suggestion() is None
    missing = api_client.post(
        "/api/transactions/999999/category-suggestion/dismiss",
        headers=csrf_headers,
        json={"category_id": bakery},
    )
    assert missing.status_code == 404

    # After a merge and retraining, the rejection still covers the merged category.
    bread = _category(api_client, csrf_headers, "Bread")
    merged = api_client.post(
        "/api/categories/merge",
        headers=csrf_headers,
        json={"source_category_id": bakery, "target_category_id": bread},
    )
    assert merged.status_code == 200
    for enabled in (False, True):
        api_client.put(
            "/api/settings/auto-categorization",
            headers=csrf_headers,
            json={"enabled": enabled, "threshold": 0.8},
        )
    assert suggestion() is None
    # The retrained model now picks the merged category, so the rejection is what hides it.
    other = _transaction(
        api_client, csrf_headers, amount_cents=500, title="Corner bakery"
    )
    assert api_client.get(f"/api/transactions/{other}").json()["category_id"] == bread

    api_client.put(
        "/api/settings/auto-categorization",
        headers=csrf_headers,
        json={"enabled": False, "threshold": 0.8},
    )
    assert suggestion() is None
