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
    txn_type: str,
    amount_cents: int,
    category_id: int,
    title: str,
) -> int:
    occurred_at = datetime.combine(txn_date, datetime.min.time()).replace(hour=12)
    response = client.post(
        "/api/transactions",
        headers=headers,
        json={
            "date": txn_date.isoformat(),
            "occurred_at": occurred_at.isoformat(),
            "type": txn_type,
            "amount_cents": amount_cents,
            "category_id": category_id,
            "title": title,
            "tags": [],
        },
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def test_weekly_digest_sections_and_metrics(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    week_of = week_start.isoformat()

    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")
    rent_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    salary_id = _create_category(api_client, csrf_headers, "Salary", "income")

    api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": None,
            "amount_cents": 150_000,
            "starts_on": f"{today.year:04d}-{today.month:02d}-01",
            "ends_on": None,
        },
    )

    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=week_start + timedelta(days=1),
        txn_type="expense",
        amount_cents=20_00,
        category_id=groceries_id,
        title="Weekly groceries",
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=week_start + timedelta(days=2),
        txn_type="expense",
        amount_cents=30_00,
        category_id=rent_id,
        title="Rent share",
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=week_start,
        txn_type="income",
        amount_cents=100_000,
        category_id=salary_id,
        title="Salary",
    )

    previous_week = week_start - timedelta(days=7)
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=previous_week,
        txn_type="expense",
        amount_cents=10_00,
        category_id=groceries_id,
        title="Previous week groceries",
    )

    for weeks_back in range(1, 5):
        trailing_day = week_start - timedelta(days=7 * weeks_back)
        _create_transaction(
            api_client,
            csrf_headers,
            txn_date=trailing_day,
            txn_type="expense",
            amount_cents=500,
            category_id=groceries_id,
            title=f"Trailing groceries {weeks_back}",
        )

    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=week_start + timedelta(days=3),
        txn_type="expense",
        amount_cents=10_000,
        category_id=groceries_id,
        title="Unusual groceries spike",
    )

    response = api_client.get(f"/api/digest?week_of={week_of}")
    assert response.status_code == 200
    payload = response.json()

    assert payload["week_start"] == week_start.isoformat()
    assert payload["headline"]["total_spent_cents"] >= 15_000
    assert payload["headline"]["transaction_count"] >= 3
    assert isinstance(payload["top_categories"], list)
    assert payload["top_categories"]
    assert isinstance(payload["budget_pulse"], list)
    assert payload["budget_pulse"]
    assert isinstance(payload["unusual_transactions"], list)
    assert any(
        "Unusual groceries spike" in row["title"]
        for row in payload["unusual_transactions"]
    )
    assert isinstance(payload["recurring_postings"], list)


def test_weekly_digest_rejects_invalid_week_of(api_client: TestClient) -> None:
    response = api_client.get("/api/digest?week_of=bad-date")
    assert response.status_code == 400
