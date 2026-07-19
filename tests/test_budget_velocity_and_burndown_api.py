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


def test_budgets_progress_includes_velocity_fields(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    month_value = f"{today.year:04d}-{today.month:02d}"
    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")

    response = api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": groceries_id,
            "amount_cents": 50_000,
            "starts_on": f"{today.year:04d}-{today.month:02d}-01",
            "ends_on": None,
        },
    )
    assert response.status_code == 200

    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today,
        txn_type="expense",
        amount_cents=10_000,
        category_id=groceries_id,
        title="Groceries this month",
    )

    response = api_client.get(f"/api/budgets?view=month&month={month_value}")
    assert response.status_code == 200
    payload = response.json()

    progress_row = next(
        row for row in payload["progress"] if row["scope_category_id"] == groceries_id
    )
    assert "velocity_ratio" in progress_row
    assert "daily_remaining_cents" in progress_row
    assert "projected_total_cents" in progress_row
    assert "days_elapsed" in progress_row
    assert "days_remaining" in progress_row
    assert progress_row["spent_cents"] == 10_000


def test_budget_burndown_endpoint_with_compare_month(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    current_month = f"{today.year:04d}-{today.month:02d}"
    previous_month_date = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    previous_month = f"{previous_month_date.year:04d}-{previous_month_date.month:02d}"

    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")

    api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": groceries_id,
            "amount_cents": 60_000,
            "starts_on": f"{previous_month_date.year:04d}-{previous_month_date.month:02d}-01",
            "ends_on": None,
        },
    )

    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today,
        txn_type="expense",
        amount_cents=2_000,
        category_id=groceries_id,
        title="Current month groceries",
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=previous_month_date,
        txn_type="expense",
        amount_cents=1_500,
        category_id=groceries_id,
        title="Previous month groceries",
    )

    response = api_client.get(
        f"/api/budgets/burndown?month={current_month}&scope={groceries_id}&compare_month={previous_month}"
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["days_in_month"] >= 28
    assert payload["budget_amount_cents"] == 60_000
    assert len(payload["daily_series"]) == payload["days_in_month"]
    assert payload["compare_month"] == previous_month
    assert payload["compare_daily_series"]
    assert isinstance(payload["top_spending_days"], list)


def test_dashboard_budget_pace_only_for_overall_budget(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.get("/api/dashboard?period=this_month")
    assert response.status_code == 200
    assert "budget_pace" not in response.json()
    assert "category_budget_summary" not in response.json()

    today = date.today()
    response = api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": None,
            "amount_cents": 200_000,
            "starts_on": f"{today.year:04d}-{today.month:02d}-01",
            "ends_on": None,
        },
    )
    assert response.status_code == 200

    response = api_client.get("/api/dashboard?period=this_month")
    assert response.status_code == 200
    payload = response.json()
    assert "budget_pace" in payload
    assert "category_budget_summary" not in payload
    assert set(payload["budget_pace"].keys()) == {
        "velocity_ratio",
        "projected_cents",
        "budget_cents",
        "sparkline",
    }
    sparkline = payload["budget_pace"]["sparkline"]
    values = [float(value) for value in sparkline.split(",")]
    assert len(values) == 7


def test_dashboard_category_budget_pulse_shows_top_category_budgets(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    categories = {
        "Groceries": _create_category(api_client, csrf_headers, "Groceries", "expense"),
        "Other food": _create_category(
            api_client, csrf_headers, "Other food", "expense"
        ),
        "Transport": _create_category(api_client, csrf_headers, "Transport", "expense"),
        "Home": _create_category(api_client, csrf_headers, "Home", "expense"),
    }
    amounts = {
        "Groceries": 10_000,
        "Other food": 50_000,
        "Transport": 100_000,
        "Home": 100_000,
    }
    spent = {
        "Groceries": 12_000,
        "Other food": 40_000,
        "Transport": 20_000,
        "Home": 1_000,
    }

    for name, category_id in categories.items():
        response = api_client.post(
            "/api/budgets/templates",
            headers=csrf_headers,
            json={
                "frequency": "monthly",
                "category_id": category_id,
                "amount_cents": amounts[name],
                "starts_on": f"{today.year:04d}-{today.month:02d}-01",
                "ends_on": None,
            },
        )
        assert response.status_code == 200
        _create_transaction(
            api_client,
            csrf_headers,
            txn_date=today,
            txn_type="expense",
            amount_cents=spent[name],
            category_id=category_id,
            title=name,
        )

    response = api_client.get("/api/dashboard?period=this_month")
    assert response.status_code == 200
    payload = response.json()

    assert "budget_pace" not in payload
    assert [row["scope_label"] for row in payload["category_budget_pulse"]] == [
        "Groceries",
        "Other food",
        "Transport",
    ]
    assert payload["category_budget_pulse"][0] == {
        "scope_category_id": categories["Groceries"],
        "scope_label": "Groceries",
        "amount_cents": 10_000,
        "spent_cents": 12_000,
        "remaining_cents": -2_000,
        "velocity_ratio": payload["category_budget_pulse"][0]["velocity_ratio"],
    }
    assert payload["category_budget_summary"]["total"] == 4
    assert (
        payload["category_budget_summary"]["priority"]
        == payload["category_budget_pulse"][0]
    )


def test_dashboard_category_budget_summary_counts_attention(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    at_risk_id = _create_category(api_client, csrf_headers, "At risk", "expense")
    safe_id = _create_category(api_client, csrf_headers, "Safe", "expense")

    for category_id, amount_cents in ((at_risk_id, 10_000), (safe_id, 100_000)):
        response = api_client.post(
            "/api/budgets/templates",
            headers=csrf_headers,
            json={
                "frequency": "monthly",
                "category_id": category_id,
                "amount_cents": amount_cents,
                "starts_on": f"{today.year:04d}-{today.month:02d}-01",
                "ends_on": None,
            },
        )
        assert response.status_code == 200

    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today,
        txn_type="expense",
        amount_cents=12_000,
        category_id=at_risk_id,
        title="At-risk spending",
    )

    response = api_client.get("/api/dashboard?period=this_month")
    assert response.status_code == 200
    payload = response.json()

    assert "budget_pace" not in payload
    assert payload["category_budget_summary"]["total"] == 2
    assert payload["category_budget_summary"]["needs_attention"] == 1
    assert payload["category_budget_summary"]["priority"]["scope_label"] == "At risk"


def test_dashboard_budget_pulse_tracks_selected_period_month(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    first_of_this_month = today.replace(day=1)
    last_month_end = first_of_this_month - timedelta(days=1)
    last_month_first = last_month_end.replace(day=1)
    last_month_mid = last_month_end.replace(day=15)

    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")

    # A monthly budget effective for both last month and this month.
    response = api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": groceries_id,
            "amount_cents": 50_000,
            "starts_on": last_month_first.isoformat(),
            "ends_on": None,
        },
    )
    assert response.status_code == 200

    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=last_month_mid,
        txn_type="expense",
        amount_cents=30_000,
        category_id=groceries_id,
        title="Groceries last month",
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today,
        txn_type="expense",
        amount_cents=12_000,
        category_id=groceries_id,
        title="Groceries this month",
    )

    def pulse_spent(period: str) -> int:
        response = api_client.get(f"/api/dashboard?period={period}")
        assert response.status_code == 200
        rows = response.json()["category_budget_pulse"]
        groceries = next(row for row in rows if row["scope_label"] == "Groceries")
        return int(groceries["spent_cents"])

    # The dashboard budget pulse reflects the month the selected period refers to.
    assert pulse_spent("this_month") == 12_000
    assert pulse_spent("last_month") == 30_000
    # "All time" includes the current month, so it falls back to the current month.
    assert pulse_spent("all") == 12_000


def test_burndown_matches_progress_when_hidden_budget_tags_exist(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    month_value = f"{today.year:04d}-{today.month:02d}"
    groceries_id = _create_category(
        api_client, csrf_headers, "Flow Groceries", "expense"
    )
    tag_response = api_client.post(
        "/api/tags",
        headers=csrf_headers,
        json={"name": f"Hidden {today.isoformat()}", "is_hidden_from_budget": True},
    )
    assert tag_response.status_code == 200
    hidden_tag_name = tag_response.json()["name"]

    response = api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": groceries_id,
            "amount_cents": 50_000,
            "starts_on": f"{today.year:04d}-{today.month:02d}-01",
            "ends_on": None,
        },
    )
    assert response.status_code == 200

    occurred_at = datetime.combine(today, datetime.min.time()).replace(hour=12)
    response = api_client.post(
        "/api/transactions",
        headers=csrf_headers,
        json={
            "date": today.isoformat(),
            "occurred_at": occurred_at.isoformat(),
            "type": "expense",
            "amount_cents": 10_000,
            "category_id": groceries_id,
            "title": "Included spend",
            "tags": [],
        },
    )
    assert response.status_code == 200
    response = api_client.post(
        "/api/transactions",
        headers=csrf_headers,
        json={
            "date": today.isoformat(),
            "occurred_at": occurred_at.isoformat(),
            "type": "expense",
            "amount_cents": 8_000,
            "category_id": groceries_id,
            "title": "Hidden spend",
            "tags": [hidden_tag_name],
        },
    )
    assert response.status_code == 200

    budgets_response = api_client.get(f"/api/budgets?view=month&month={month_value}")
    assert budgets_response.status_code == 200
    progress_row = next(
        row
        for row in budgets_response.json()["progress"]
        if row["scope_category_id"] == groceries_id
    )
    assert progress_row["spent_cents"] == 10_000

    burndown_response = api_client.get(
        f"/api/budgets/burndown?month={month_value}&scope={groceries_id}"
    )
    assert burndown_response.status_code == 200
    daily_series = burndown_response.json()["daily_series"]
    assert daily_series[-1]["cumulative_cents"] == 10_000
