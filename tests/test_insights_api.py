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
