from datetime import date, datetime, timedelta
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from expenses.api import routes
from expenses.core.config import get_settings
from expenses.db.session import Base, _fuzzy_text_match
from expenses.db.models import Category, Transaction, TransactionType
from expenses.schemas import TransactionIn
from expenses.services import TransactionService


def make_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    return session_local()


def test_api_delete_transaction_soft_deletes(monkeypatch) -> None:
    session = make_session()
    category = Category(name="Food", type=TransactionType.expense, order=0)
    session.add(category)
    session.commit()
    session.refresh(category)

    txn = TransactionService(session).create(
        TransactionIn(
            date=date(2025, 1, 10),
            occurred_at=datetime(2025, 1, 10, 12, 0),
            type=TransactionType.expense,
            amount_cents=5_000,
            category_id=category.id,
            title="Lunch",
        )
    )

    monkeypatch.setattr(routes, "validate_csrf_token", lambda _: True)
    monkeypatch.setattr(routes, "_require_current_user_id", lambda _request, _db: 1)
    request = Request(
        {
            "type": "http",
            "method": "DELETE",
            "path": f"/api/transactions/{txn.id}",
            "headers": [(b"x-csrf-token", b"valid")],
        }
    )

    response = routes.api_delete_transaction(txn.id, request, session)

    assert response == {"status": "ok"}
    deleted = session.get(Transaction, txn.id)
    assert deleted is not None
    assert deleted.deleted_at is not None


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


def test_attachment_thumbnail_rejects_images_over_pixel_limit(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EXPENSES_RECEIPT_THUMBNAIL_MAX_PIXELS", "1")
    get_settings.cache_clear()

    category_response = api_client.post(
        "/api/categories",
        json={"name": "Receipt bomb", "type": "expense", "order": 0},
        headers=csrf_headers,
    )
    category_id = int(category_response.json()["id"])
    create_response = api_client.post(
        "/api/transactions",
        json={
            "date": "2026-04-19",
            "occurred_at": "2026-04-19T10:15:00",
            "type": "expense",
            "amount_cents": 999,
            "category_id": category_id,
            "title": "Receipt bomb transaction",
        },
        headers=csrf_headers,
    )
    transaction_id = int(create_response.json()["id"])

    from PIL import Image

    image_bytes = BytesIO()
    Image.new("RGB", (3, 1), color="white").save(image_bytes, format="PNG")
    upload_response = api_client.post(
        f"/api/transactions/{transaction_id}/attachments",
        files={"file": ("large-pixels.png", image_bytes.getvalue(), "image/png")},
        headers=csrf_headers,
    )
    assert upload_response.status_code == 200
    attachment_id = int(upload_response.json()["id"])

    thumbnail = api_client.get(f"/api/attachments/{attachment_id}/thumbnail")

    assert thumbnail.status_code == 400
