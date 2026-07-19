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
    amount_cents: int = 1_000,
) -> int:
    response = client.post(
        "/api/transactions",
        headers=headers,
        json={
            "date": txn_date.isoformat(),
            "occurred_at": occurred_at.isoformat(),
            "type": "expense",
            "amount_cents": amount_cents,
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


def test_monthly_category_breakdown_returns_six_month_spending_bands(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    groceries_id = _create_category(
        api_client, csrf_headers, "Band Groceries", "expense"
    )
    transport_id = _create_category(
        api_client, csrf_headers, "Band Transport", "expense"
    )
    today = date.today()
    previous_month = today.replace(day=1) - timedelta(days=1)

    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today,
        occurred_at=datetime.combine(today, datetime.min.time()).replace(hour=10),
        category_id=groceries_id,
        title="Current groceries",
        amount_cents=12_500,
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today,
        occurred_at=datetime.combine(today, datetime.min.time()).replace(hour=11),
        category_id=transport_id,
        title="Current transport",
        amount_cents=4_000,
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=previous_month,
        occurred_at=datetime.combine(previous_month, datetime.min.time()).replace(
            hour=12
        ),
        category_id=groceries_id,
        title="Previous groceries",
        amount_cents=8_000,
    )

    response = api_client.get("/api/category-breakdown?view=monthly&period=this_month")
    assert response.status_code == 200
    bands = response.json()["months"]

    assert len(bands) == 6
    assert all(isinstance(month["balance_cents"], int) for month in bands)
    assert bands[-1]["month"] == f"{today.year:04d}-{today.month:02d}"
    assert bands[-1]["total_cents"] == 16_500
    assert [segment["name"] for segment in bands[-1]["segments"]] == [
        "Band Groceries",
        "Band Transport",
    ]
    assert bands[-2]["month"] == (
        f"{previous_month.year:04d}-{previous_month.month:02d}"
    )
    assert bands[-2]["total_cents"] == 8_000
