from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient

from expenses.recurrence.engine import local_today


def _create_category(
    client: TestClient,
    headers: dict[str, str],
    name: str,
    txn_type: str,
    icon: str | None = "currency-circle-dollar",
) -> int:
    response = client.post(
        "/api/categories",
        headers=headers,
        json={"name": name, "type": txn_type, "icon": icon, "order": 0},
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


def test_create_category_with_icon_success(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={
            "name": "Salary",
            "type": "income",
            "icon": "briefcase",
            "order": 1,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Salary"
    assert payload["type"] == "income"
    assert payload["icon"] == "briefcase"
    assert payload["order"] == 1


def test_update_category_success(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Food", "expense")

    response = api_client.put(
        f"/api/categories/{category_id}",
        headers=csrf_headers,
        json={"name": "Groceries", "icon": "shopping-cart", "order": 12},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == category_id
    assert payload["name"] == "Groceries"
    assert payload["icon"] == "shopping-cart"
    assert payload["order"] == 12
    assert payload["type"] == "expense"


def test_update_category_icon_can_be_cleared(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(
        api_client,
        csrf_headers,
        "Food",
        "expense",
        icon="shopping-cart",
    )

    response = api_client.put(
        f"/api/categories/{category_id}",
        headers=csrf_headers,
        json={"name": "Food", "icon": None, "order": 0},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == category_id
    assert payload["icon"] is None


def test_update_category_duplicate_name_fails(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _create_category(api_client, csrf_headers, "Food", "expense")
    second_id = _create_category(api_client, csrf_headers, "Travel", "expense")

    response = api_client.put(
        f"/api/categories/{second_id}",
        headers=csrf_headers,
        json={"name": "Food", "icon": "airplane", "order": 3},
    )
    assert response.status_code == 400
    assert "already exists" in response.text


def test_update_category_not_found(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.put(
        "/api/categories/99999",
        headers=csrf_headers,
        json={"name": "Anything", "icon": "airplane", "order": 0},
    )
    assert response.status_code == 404
    assert "Category not found" in response.text


def test_create_category_icon_too_long_fails_validation(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={
            "name": "Income",
            "type": "income",
            "icon": "a" * 51,
            "order": 0,
        },
    )
    assert response.status_code == 422


def test_update_category_icon_too_long_fails_validation(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Food", "expense")

    response = api_client.put(
        f"/api/categories/{category_id}",
        headers=csrf_headers,
        json={"name": "Food", "icon": "a" * 51, "order": 0},
    )
    assert response.status_code == 422


def test_create_category_whitespace_name_rejected(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={"name": "   ", "type": "expense", "icon": None, "order": 0},
    )
    assert response.status_code == 422
    assert "Category name cannot be blank" in response.text


def test_create_category_trimmed_duplicate_fails_with_400(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    first_response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={"name": "Food", "type": "expense", "icon": None, "order": 0},
    )
    assert first_response.status_code == 200

    duplicate_response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={"name": "Food   ", "type": "expense", "icon": None, "order": 0},
    )
    assert duplicate_response.status_code == 400
    assert "already exists" in duplicate_response.text


def test_category_options_list_names_without_totals(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Groceries", "expense")

    categories = api_client.get("/api/categories/options").json()["categories"]

    groceries = next(
        category for category in categories if category["id"] == category_id
    )
    assert groceries == {
        "id": category_id,
        "name": "Groceries",
        "type": "expense",
        "icon": "currency-circle-dollar",
        "order": 0,
        "archived_at": None,
    }


def test_categories_and_tags_report_period_totals_and_created_at(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    food = _create_category(api_client, csrf_headers, "Food", "expense")
    salary = _create_category(api_client, csrf_headers, "Salary", "income")
    _transaction(
        api_client,
        csrf_headers,
        amount_cents=2_000,
        title="Shop",
        category_id=food,
        tags=["Trip"],
    )
    _transaction(
        api_client,
        csrf_headers,
        amount_cents=9_000,
        title="Pay",
        category_id=salary,
        txn_type="income",
        tags=["Trip"],
    )
    _transaction(
        api_client,
        csrf_headers,
        amount_cents=1_000,
        title="Last year",
        on=local_today() - timedelta(days=500),
        category_id=food,
    )

    categories = {
        item["name"]: item
        for item in api_client.get("/api/categories?period=this_month").json()[
            "categories"
        ]
    }
    assert (
        categories["Food"]["expense_cents"],
        categories["Food"]["income_cents"],
    ) == (
        2_000,
        0,
    )
    assert categories["Salary"]["income_cents"] == 9_000
    all_time = {
        item["name"]: item
        for item in api_client.get("/api/categories?period=all").json()["categories"]
    }
    assert all_time["Food"]["expense_cents"] == 3_000

    tags = api_client.get("/api/tags?period=this_month").json()["tags"]
    assert [(t["name"], t["expense_cents"], t["income_cents"]) for t in tags] == [
        ("Trip", 2_000, 9_000)
    ]
    assert datetime.fromisoformat(tags[0]["created_at"])

    created = api_client.post("/api/tags", headers=csrf_headers, json={"name": "New"})
    assert datetime.fromisoformat(created.json()["created_at"])
    tag_id = tags[0]["id"]
    updated = api_client.put(
        f"/api/tags/{tag_id}", headers=csrf_headers, json={"name": "Trip"}
    )
    assert updated.json()["created_at"] == tags[0]["created_at"]
    detail = api_client.get(f"/api/tags/{tag_id}").json()
    assert detail["tag"]["created_at"] == tags[0]["created_at"]
    assert {"kpis", "donut", "transactions"} <= detail.keys()
