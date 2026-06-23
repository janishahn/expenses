from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from expenses_web.api import routes
from expenses_web.db.session import Base
from expenses_web.db.models import Category, Transaction, TransactionType
from expenses_web.schemas import TransactionIn
from expenses_web.services import TransactionService


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
