from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient

from expenses.db.models import RuleLLMSuggestion
from expenses.recurrence.engine import local_today
from expenses.services import BudgetService


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


def test_category_merge_moves_templates_and_pending_suggestions(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    groceries = _create_category(api_client, csrf_headers, "Groceries", "expense")
    food = _create_category(api_client, csrf_headers, "Food", "expense")
    response = api_client.post(
        "/api/templates",
        headers=csrf_headers,
        json={
            "name": "Weekly shop",
            "type": "expense",
            "category_id": groceries,
            "default_amount_cents": 5_000,
            "title": "Weekly shop",
            "tags": [],
        },
    )
    assert response.status_code == 200
    template_id = response.json()["id"]
    suggestion = RuleLLMSuggestion(
        user_id=1,
        name="Lidl",
        match_type="contains",
        match_value="LIDL",
        set_category_id=groceries,
        reason="Corrections",
    )
    db_session.add(suggestion)
    db_session.commit()

    preview = api_client.post(
        "/api/categories/merge/preview",
        headers=csrf_headers,
        json={"source_category_id": groceries, "target_category_id": food},
    )
    assert preview.json()["counts"]["templates"] == 1
    response = _merge(api_client, csrf_headers, groceries, food)
    assert response.status_code == 200
    assert response.json()["counts"]["templates"] == 1

    templates = api_client.get("/api/templates").json()["templates"]
    assert [(t["id"], t["category_id"]) for t in templates] == [(template_id, food)]
    db_session.expire_all()
    assert db_session.get(RuleLLMSuggestion, suggestion.id).set_category_id == food


def _budget_template(
    client: TestClient,
    headers: dict[str, str],
    category_id: int,
    amount_cents: int,
    starts_on: str,
    ends_on: str | None = None,
) -> None:
    response = client.post(
        "/api/budgets/templates",
        headers=headers,
        json={
            "frequency": "monthly",
            "category_id": category_id,
            "amount_cents": amount_cents,
            "starts_on": starts_on,
            "ends_on": ends_on,
        },
    )
    assert response.status_code == 200


def _merge(client: TestClient, headers: dict[str, str], source: int, target: int):
    return client.post(
        "/api/categories/merge",
        headers=headers,
        json={"source_category_id": source, "target_category_id": target},
    )


def test_category_merge_refuses_to_drop_a_budget(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    food = _create_category(api_client, csrf_headers, "Food", "expense")
    groceries = _create_category(api_client, csrf_headers, "Groceries", "expense")
    _budget_template(api_client, csrf_headers, food, 30_000, "2025-01-01")
    _budget_template(api_client, csrf_headers, groceries, 20_000, "2025-03-01")

    response = _merge(api_client, csrf_headers, groceries, food)
    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Cannot merge: Groceries and Food both have a budget for the same period "
        "(Groceries monthly budget from 2025-03-01 and Food monthly budget from "
        "2025-01-01). End or delete one of these budgets first."
    )
    june = {
        budget.scope_category_id: budget.amount_cents
        for budget in BudgetService(db_session, 1).effective_budgets_for_month(2025, 6)
    }
    assert june == {food: 30_000, groceries: 20_000}

    # A one-month adjustment would replace the other category's monthly budget.
    snacks = _create_category(api_client, csrf_headers, "Snacks", "expense")
    response = api_client.post(
        "/api/budgets/overrides",
        headers=csrf_headers,
        json={"year": 2025, "month": 6, "category_id": snacks, "amount_cents": 4_000},
    )
    assert response.status_code == 200
    response = _merge(api_client, csrf_headers, snacks, food)
    assert response.status_code == 400
    assert (
        "Snacks budget for 2025-06 and Food monthly budget from 2025-01-01"
        in response.json()["detail"]
    )

    # Budgets for different months move over unchanged.
    old = _create_category(api_client, csrf_headers, "Old food", "expense")
    _budget_template(api_client, csrf_headers, old, 25_000, "2024-01-01", "2024-12-31")
    response = _merge(api_client, csrf_headers, old, food)
    assert response.status_code == 200
    budgets = BudgetService(db_session, 1)
    assert {
        b.scope_category_id: b.amount_cents
        for b in budgets.effective_budgets_for_month(2024, 6)
    } == {food: 25_000}
    assert {
        b.scope_category_id: b.amount_cents
        for b in budgets.effective_budgets_for_month(2025, 2)
    } == {food: 30_000}


def test_uncategorized_keeps_its_name_and_stays_active(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    txn_id = _transaction(api_client, csrf_headers, amount_cents=500, title="Unknown")
    uncategorized = api_client.get(f"/api/transactions/{txn_id}").json()["category"]
    food = _create_category(api_client, csrf_headers, "Food", "expense")
    salary = _create_category(api_client, csrf_headers, "Salary", "income")

    response = api_client.put(
        f"/api/categories/{uncategorized['id']}",
        headers=csrf_headers,
        json={"name": "Sonstiges", "icon": None, "order": 0},
    )
    assert (response.status_code, response.json()["detail"]) == (
        400,
        "Uncategorized can't be renamed; transactions without a category use it",
    )
    response = api_client.put(
        f"/api/categories/{uncategorized['id']}",
        headers=csrf_headers,
        json={"name": "Uncategorized", "icon": "question", "order": 3},
    )
    assert response.status_code == 200
    response = api_client.post(
        f"/api/categories/{uncategorized['id']}/archive", headers=csrf_headers
    )
    assert (response.status_code, response.json()["detail"]) == (
        400,
        "Uncategorized can't be archived; transactions without a category use it",
    )
    response = _merge(api_client, csrf_headers, uncategorized["id"], food)
    assert (response.status_code, response.json()["detail"]) == (
        400,
        "Uncategorized can't be merged into another category; "
        "transactions without a category use it",
    )
    response = api_client.put(
        f"/api/categories/{salary}",
        headers=csrf_headers,
        json={"name": "uncategorized", "icon": None, "order": 0},
    )
    assert (response.status_code, response.json()["detail"]) == (
        400,
        "Uncategorized is reserved for transactions without a category",
    )

    response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={"name": "UNCATEGORIZED", "type": "expense", "order": 0},
    )
    assert (response.status_code, response.json()["detail"]) == (
        400,
        "Category with this name already exists",
    )

    response = _merge(api_client, csrf_headers, food, uncategorized["id"])
    assert response.status_code == 200
