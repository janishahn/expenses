from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient

from expenses.recurrence.engine import local_today


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
        "spent_cents",
        "remaining_cents",
        "daily_remaining_cents",
        "days_remaining",
        "sparkline",
    }
    assert payload["budget_pace"]["spent_cents"] == 0
    assert payload["budget_pace"]["remaining_cents"] == 200_000
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
    # A month stepped to as a custom period is evaluated like last month.
    assert (
        pulse_spent(
            f"custom&start={last_month_first.isoformat()}&end={last_month_end.isoformat()}"
        )
        == 30_000
    )
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


def test_dashboard_budget_pace_counts_spend_up_to_the_period_end(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Shopping", "expense")
    response = api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": None,
            "amount_cents": 100_000,
            "starts_on": "2025-11-01",
        },
    )
    assert response.status_code == 200
    for day, amount in ((1, 5_000), (19, 60_000)):
        _create_transaction(
            api_client,
            csrf_headers,
            txn_date=date(2025, 11, day),
            txn_type="expense",
            amount_cents=amount,
            category_id=category_id,
            title=f"Nov {day}",
        )

    response = api_client.get(
        "/api/dashboard?period=custom&start=2025-11-01&end=2025-11-05"
    )
    assert response.status_code == 200
    pace = response.json()["budget_pace"]
    # Pace is as of Nov 5, so the Nov 19 purchase is not spent yet.
    assert pace["spent_cents"] == 5_000
    assert round(pace["velocity_ratio"], 2) == 0.3

    # A completed month still counts all of its spending.
    response = api_client.get(
        "/api/dashboard?period=custom&start=2025-11-01&end=2025-11-30"
    )
    assert response.json()["budget_pace"]["spent_cents"] == 65_000


def test_budget_progress_does_not_count_expenses_dated_after_today(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = local_today()
    month_value = f"{today.year:04d}-{today.month:02d}"
    category_id = _create_category(api_client, csrf_headers, "Planned", "expense")
    response = api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": None,
            "amount_cents": 100_000,
            "starts_on": f"{month_value}-01",
        },
    )
    assert response.status_code == 200

    def spent() -> tuple[int, int]:
        budgets = api_client.get(f"/api/budgets?month={month_value}").json()
        (overall,) = budgets["progress"]
        pace = api_client.get("/api/dashboard?period=this_month").json()
        return overall["spent_cents"], pace["budget_pace"]["spent_cents"]

    before = spent()
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today + timedelta(days=1),
        txn_type="expense",
        amount_cents=40_000,
        category_id=category_id,
        title="Due tomorrow",
    )
    assert spent() == before


def test_budgets_for_a_later_month_count_spend_as_of_today(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Planned", "expense")
    response = api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": None,
            "amount_cents": 100_000,
            "starts_on": "2100-01-01",
        },
    )
    assert response.status_code == 200
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date(2100, 3, 10),
        txn_type="expense",
        amount_cents=10_000,
        category_id=category_id,
        title="Planned",
    )

    (overall,) = api_client.get("/api/budgets?month=2100-03").json()["progress"]
    assert overall["spent_cents"] == 0
    assert overall["remaining_cents"] == 100_000
    dashboard = api_client.get(
        "/api/dashboard?period=custom&start=2100-03-01&end=2100-03-31"
    ).json()
    # A later month is shown as of its first day.
    assert dashboard["budget_pace"]["spent_cents"] == 0
    # The burndown chart still plots every day of the month.
    burndown = api_client.get("/api/budgets/burndown?month=2100-03").json()
    assert burndown["daily_series"][-1]["cumulative_cents"] == 10_000


def test_budget_endpoints_reject_malformed_query_values(
    api_client: TestClient,
) -> None:
    for url, detail in (
        ("/api/budgets?view=year&year=abc", "Invalid year value"),
        ("/api/budgets?view=year&year=0", "Invalid year value"),
        ("/api/budgets?month=0-05", "Invalid month value"),
        ("/api/budgets?month=2025-13", "Invalid month value"),
        ("/api/budgets?month=May", "Invalid month format"),
        ("/api/budgets/burndown?month=0-05", "Invalid month value"),
        (
            "/api/budgets/burndown?month=2025-05&compare_month=0-01",
            "Invalid compare_month value",
        ),
    ):
        response = api_client.get(url)
        assert response.status_code == 400, url
        assert response.json()["detail"] == detail


def test_budget_overrides_use_the_years_budgets_can_be_read_for(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    for year, status in ((2200, 422), (1950, 200)):
        response = api_client.post(
            "/api/budgets/overrides",
            headers=csrf_headers,
            json={"year": year, "month": 1, "category_id": None, "amount_cents": 100},
        )
        assert response.status_code == status, year
    budgets = api_client.get("/api/budgets?month=1950-01").json()
    assert [row["amount_cents"] for row in budgets["budgets"]] == [100]


def test_budget_amounts_above_the_limit_are_rejected(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    too_large = 1_000_000_000_001
    for path, payload in (
        (
            "/api/budgets/templates",
            {"frequency": "monthly", "starts_on": "2025-11-01"},
        ),
        (
            "/api/budgets/templates/apply-from",
            {"frequency": "monthly", "starts_on": "2025-11-01"},
        ),
        ("/api/budgets/overrides", {"year": 2025, "month": 11}),
    ):
        response = api_client.post(
            path,
            headers=csrf_headers,
            json={**payload, "category_id": None, "amount_cents": too_large},
        )
        assert response.status_code == 422, path
