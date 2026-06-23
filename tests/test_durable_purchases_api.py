from datetime import date, datetime

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


def test_durable_purchase_endpoints_and_dashboard(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    expense_cat_id = _create_category(api_client, csrf_headers, "Shopping", "expense")
    income_cat_id = _create_category(api_client, csrf_headers, "Income", "income")

    expense_txn_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=120_000,
        category_id=expense_cat_id,
        title="Laptop",
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="income",
        amount_cents=5_000,
        category_id=income_cat_id,
        title="Salary",
    )

    response = api_client.post(
        f"/api/transactions/{expense_txn_id}/durable",
        headers=csrf_headers,
        json={
            "expected_lifespan_days": 730,
        },
    )
    assert response.status_code == 200
    assert response.json()["acquired_on"] == date.today().isoformat()

    response = api_client.get(f"/api/transactions/{expense_txn_id}")
    assert response.status_code == 200
    durable = response.json()["durable_purchase"]
    assert durable is not None
    assert durable["expected_lifespan_days"] == 730

    response = api_client.get("/api/durable-purchases")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["transaction_id"] == expense_txn_id
    assert items[0]["fully_amortized"] is False

    response = api_client.get("/api/dashboard?period=all")
    assert response.status_code == 200
    assert "durable_purchases" in response.json()
    assert response.json()["durable_purchases"][0]["transaction_id"] == expense_txn_id

    response = api_client.delete(
        f"/api/transactions/{expense_txn_id}/durable",
        headers=csrf_headers,
    )
    assert response.status_code == 200

    response = api_client.get(f"/api/transactions/{expense_txn_id}")
    assert response.status_code == 200
    assert response.json()["durable_purchase"] is None


def test_durable_purchase_listing_excludes_income_after_type_change(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    expense_cat_id = _create_category(api_client, csrf_headers, "Shopping", "expense")
    income_cat_id = _create_category(api_client, csrf_headers, "Income", "income")
    txn_date = date.today()
    occurred_at = datetime.combine(txn_date, datetime.min.time()).replace(hour=12)

    expense_txn_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=txn_date,
        txn_type="expense",
        amount_cents=85_000,
        category_id=expense_cat_id,
        title="Camera",
    )

    response = api_client.post(
        f"/api/transactions/{expense_txn_id}/durable",
        headers=csrf_headers,
        json={
            "expected_lifespan_days": 365,
            "acquired_on": txn_date.isoformat(),
        },
    )
    assert response.status_code == 200

    response = api_client.put(
        f"/api/transactions/{expense_txn_id}",
        headers=csrf_headers,
        json={
            "date": txn_date.isoformat(),
            "occurred_at": occurred_at.isoformat(),
            "type": "income",
            "amount_cents": 85_000,
            "category_id": income_cat_id,
            "title": "Camera resale",
            "is_reimbursement": False,
            "tags": [],
        },
    )
    assert response.status_code == 200

    response = api_client.get("/api/durable-purchases")
    assert response.status_code == 200
    assert response.json()["items"] == []

    response = api_client.get("/api/dashboard?period=all")
    assert response.status_code == 200
    durable_items = response.json().get("durable_purchases", [])
    assert durable_items == []

    response = api_client.get(f"/api/transactions/{expense_txn_id}")
    assert response.status_code == 200
    assert response.json()["durable_purchase"] is None


def test_durable_upsert_returns_404_for_missing_transaction(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/transactions/999999/durable",
        headers=csrf_headers,
        json={"expected_lifespan_days": 365},
    )
    assert response.status_code == 404
