from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient


def _create_category(
    client: TestClient, headers: dict[str, str], name: str, txn_type: str
) -> int:
    response = client.post(
        "/api/categories",
        headers=headers,
        json={"name": name, "type": txn_type, "order": 0},
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def _create_transaction(
    client: TestClient,
    headers: dict[str, str],
    *,
    txn_date: date,
    occurred_at: datetime,
    category_id: int,
    title: str,
) -> int:
    response = client.post(
        "/api/transactions",
        headers=headers,
        json={
            "date": txn_date.isoformat(),
            "occurred_at": occurred_at.isoformat(),
            "type": "expense",
            "amount_cents": 1_000,
            "category_id": category_id,
            "title": title,
            "tags": [],
        },
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def test_dashboard_recent_transactions_returns_latest_ten(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(
        api_client, csrf_headers, "Dashboard Recent", "expense"
    )
    base_day = date.today()

    for index in range(12):
        txn_day = base_day - timedelta(days=index)
        occurred_at = datetime.combine(txn_day, datetime.min.time()).replace(
            hour=12, minute=index
        )
        _create_transaction(
            api_client,
            csrf_headers,
            txn_date=txn_day,
            occurred_at=occurred_at,
            category_id=category_id,
            title=f"Recent {index:02d}",
        )

    response = api_client.get("/api/dashboard?period=all")
    assert response.status_code == 200
    payload = response.json()

    assert len(payload["recent"]) == 10
    assert [item["title"] for item in payload["recent"]] == [
        f"Recent {index:02d}" for index in range(10)
    ]
