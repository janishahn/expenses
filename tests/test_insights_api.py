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
    category_id: int,
    amount_cents: int,
    title: str,
    tags: list[str] | None = None,
) -> None:
    today = date.today()
    response = client.post(
        "/api/transactions",
        headers=headers,
        json={
            "date": today.isoformat(),
            "occurred_at": datetime.combine(today, datetime.min.time())
            .replace(hour=12)
            .isoformat(),
            "type": "expense",
            "amount_cents": amount_cents,
            "category_id": category_id,
            "title": title,
            "tags": tags or [],
        },
    )
    assert response.status_code == 200


def test_insights_tag_exclusions_apply_to_analysis_values(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(
        api_client, csrf_headers, "Insight exclusion", "expense"
    )
    _create_transaction(
        api_client,
        csrf_headers,
        category_id=category_id,
        amount_cents=9_000,
        title="Insight vacation spend",
        tags=["Insight vacation"],
    )
    _create_transaction(
        api_client,
        csrf_headers,
        category_id=category_id,
        amount_cents=3_000,
        title="Insight regular spend",
    )
    vacation_tag_id = next(
        int(tag["id"])
        for tag in api_client.get("/api/tags").json()["tags"]
        if tag["name"] == "Insight vacation"
    )

    unfiltered = api_client.get(
        f"/api/insights?period=this_month&trend_category={category_id}"
    )
    filtered = api_client.get(
        f"/api/insights?period=this_month&trend_category={category_id}&exclude_tags={vacation_tag_id}"
    )
    assert unfiltered.status_code == 200
    assert filtered.status_code == 200
    unfiltered_payload = unfiltered.json()
    filtered_payload = filtered.json()

    assert filtered_payload["filters"]["excluded_tag_ids"] == [vacation_tag_id]
    assert (
        sum(row["expense_cents"] for row in unfiltered_payload["series"])
        - sum(row["expense_cents"] for row in filtered_payload["series"])
        == 9_000
    )
    unfiltered_category = next(
        row
        for row in unfiltered_payload["expense_breakdown"]
        if row["name"] == "Insight exclusion"
    )
    filtered_category = next(
        row
        for row in filtered_payload["expense_breakdown"]
        if row["name"] == "Insight exclusion"
    )
    assert (
        unfiltered_category["amount_cents"] - filtered_category["amount_cents"] == 9_000
    )
    assert (
        sum(row["amount_cents"] for row in unfiltered_payload["trend"])
        - sum(row["amount_cents"] for row in filtered_payload["trend"])
        == 9_000
    )
    assert all(tag["id"] != vacation_tag_id for tag in filtered_payload["top_tags"])

    included = api_client.get(
        f"/api/insights?period=this_month&trend_category={category_id}&tags={vacation_tag_id}"
    )
    assert included.status_code == 200
    included_payload = included.json()
    assert included_payload["filters"]["included_tag_ids"] == [vacation_tag_id]
    assert sum(row["expense_cents"] for row in included_payload["series"]) == 9_000
    included_category = next(
        row
        for row in included_payload["expense_breakdown"]
        if row["name"] == "Insight exclusion"
    )
    assert included_category["amount_cents"] == 9_000
    assert sum(row["amount_cents"] for row in included_payload["trend"]) == 9_000
    assert included_payload["top_tags"] == [
        {
            "id": vacation_tag_id,
            "name": "Insight vacation",
            "amount_cents": 9_000,
        }
    ]


def test_insights_ignores_removed_page_wide_type_filter(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Type scope", "expense")
    _create_transaction(
        api_client,
        csrf_headers,
        category_id=category_id,
        amount_cents=2_000,
        title="Type scope expense",
    )

    response = api_client.get("/api/insights?period=this_month&type=income")

    assert response.status_code == 200
    assert "type" not in response.json()["filters"]
    assert sum(row["expense_cents"] for row in response.json()["series"]) == 2_000


def test_insights_normalizes_income_trend_category_to_expense(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    income_id = _create_category(api_client, csrf_headers, "Salary", "income")
    expense_id = _create_category(api_client, csrf_headers, "Groceries", "expense")

    response = api_client.get(
        f"/api/insights?period=this_month&trend_category={income_id}"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["trend_category_id"] == expense_id
    assert len(payload["trend"]) == 12


def test_insights_ignores_invalid_trend_category_value(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    expense_id = _create_category(api_client, csrf_headers, "Groceries", "expense")

    response = api_client.get("/api/insights?period=this_month&trend_category=bogus")

    assert response.status_code == 200
    payload = response.json()
    assert payload["trend_category_id"] == expense_id
    assert len(payload["trend"]) == 12


def test_insights_serializes_budget_progress_keys_as_strings(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")
    for category_id in (None, groceries_id):
        response = api_client.post(
            "/api/budgets/templates",
            headers=csrf_headers,
            json={
                "frequency": "monthly",
                "category_id": category_id,
                "amount_cents": 12_000,
                "starts_on": "2025-01-01",
                "ends_on": None,
            },
        )
        assert response.status_code == 200

    response = api_client.get("/api/insights?period=all&budget_month=2025-01")

    assert response.status_code == 200
    payload = response.json()
    assert set(payload["budget_progress"]) == {"null", str(groceries_id)}
    assert payload["budget_progress"]["null"]["remaining_cents"] == 12_000
    assert payload["budget_progress"][str(groceries_id)]["remaining_cents"] == 12_000
