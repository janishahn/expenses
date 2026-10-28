from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import update

from expenses.core.periods import add_months, month_start
from expenses.db.models import Transaction
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


def _month_label(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


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


def test_insights_totals_cover_the_exact_period(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Exact period", "expense")
    for day, amount_cents, title in (
        ("2025-10-01", 100_000, "Rent"),
        ("2025-10-11", 5_000, "Groceries"),
        ("2024-01-15", 2_000, "First purchase"),
    ):
        response = api_client.post(
            "/api/transactions",
            headers=csrf_headers,
            json={
                "date": day,
                "occurred_at": f"{day}T12:00:00",
                "type": "expense",
                "amount_cents": amount_cents,
                "category_id": category_id,
                "title": title,
            },
        )
        assert response.status_code == 200

    partial = api_client.get(
        "/api/insights?period=custom&start=2025-10-10&end=2025-10-13"
    ).json()
    # The monthly series counts the whole month; the totals keep to the dates.
    assert sum(point["expense_cents"] for point in partial["series"]) == 105_000
    assert (partial["expense_cents"], partial["month_count"]) == (5_000, 1)

    all_time = api_client.get("/api/insights?period=all").json()
    today = date.today()
    assert all_time["expense_cents"] == 107_000
    assert all_time["month_count"] == (today.year - 2024) * 12 + today.month


def test_month_grid_returns_thirteen_months_per_category_income_and_tag(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = local_today()
    current = month_start(today.year, today.month)
    food = _create_category(api_client, csrf_headers, "Food", "expense")
    _create_category(api_client, csrf_headers, "Idle", "expense")
    salary = _create_category(api_client, csrf_headers, "Salary", "income")
    _transaction(
        api_client,
        csrf_headers,
        amount_cents=3_000,
        title="Old shop",
        on=add_months(current, -12),
        category_id=food,
        tags=["Trip"],
    )
    _transaction(
        api_client,
        csrf_headers,
        amount_cents=2_000,
        title="Shop",
        category_id=food,
        tags=["Trip"],
    )
    _transaction(
        api_client, csrf_headers, amount_cents=2_000, title="Hidden", tags=["Secret"]
    )
    _transaction(
        api_client,
        csrf_headers,
        amount_cents=90_000,
        title="Pay",
        category_id=salary,
        txn_type="income",
    )
    # Older than twelve full months: outside the grid.
    _transaction(
        api_client,
        csrf_headers,
        amount_cents=7_000,
        title="Ancient",
        on=add_months(current, -13),
        category_id=food,
    )
    secret = next(
        tag["id"]
        for tag in api_client.get("/api/tags").json()["tags"]
        if tag["name"] == "Secret"
    )
    api_client.put(
        f"/api/tags/{secret}",
        headers=csrf_headers,
        json={"name": "Secret", "is_hidden_from_filters": True},
    )

    expense = api_client.get("/api/insights/month-grid?kind=expense").json()
    assert len(expense["months"]) == 13
    assert expense["months"][0] == _month_label(add_months(current, -12))
    assert expense["current_month"] == expense["months"][-1] == _month_label(current)
    rows = {row["name"]: row for row in expense["rows"]}
    assert rows["Food"]["values_cents"] == [3_000] + [0] * 11 + [2_000]
    assert rows["Food"]["id"] == food
    assert rows["Idle"]["values_cents"] == [0] * 13
    assert "Salary" not in rows
    assert [row["name"] for row in expense["rows"]][0] == "Food"

    income = api_client.get("/api/insights/month-grid?kind=income").json()
    assert {row["name"]: row["values_cents"][-1] for row in income["rows"]} == {
        "Salary": 90_000
    }
    tags = api_client.get("/api/insights/month-grid?kind=tag").json()
    assert {row["name"]: row["values_cents"] for row in tags["rows"]} == {
        "Trip": [3_000] + [0] * 11 + [2_000]
    }
    assert api_client.get("/api/insights/month-grid?kind=nope").status_code == 422


def test_recurring_split_separates_rule_postings(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Subscriptions", "expense")
    rule = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={
            "name": "Streaming",
            "type": "expense",
            "amount_cents": 1_200,
            "category_id": category_id,
            "anchor_date": "2030-01-01",
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": "2030-01-01",
            "auto_post": False,
        },
    ).json()
    posted = _transaction(
        api_client, csrf_headers, amount_cents=1_200, title="Streaming"
    )
    _transaction(api_client, csrf_headers, amount_cents=800, title="Snack")
    db_session.execute(
        update(Transaction)
        .where(Transaction.id == posted)
        .values(origin_rule_id=rule["id"])
    )
    db_session.commit()

    split = api_client.get("/api/insights/recurring-split").json()
    assert len(split["months"]) == 13
    assert split["rows"][-1] == {
        "month": split["current_month"],
        "recurring_cents": 1_200,
        "other_cents": 800,
    }
    assert split["rows"][0]["recurring_cents"] == split["rows"][0]["other_cents"] == 0
    assert api_client.get("/api/insights").json()["recurring_cents"] == 1_200


def test_day_calendar_excludes_recurring_and_reports_weekday_stats(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    today = local_today()
    saturday = max(
        today - timedelta(days=offset)
        for offset in range(21)
        if (today - timedelta(days=offset)).weekday() == 5
    )
    wednesday = max(
        today - timedelta(days=offset)
        for offset in range(21)
        if (today - timedelta(days=offset)).weekday() == 2
    )
    category_id = _create_category(api_client, csrf_headers, "Subscriptions", "expense")
    rule = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={
            "name": "Rule",
            "type": "expense",
            "amount_cents": 9_999,
            "category_id": category_id,
            "anchor_date": "2030-01-01",
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": "2030-01-01",
            "auto_post": False,
        },
    ).json()
    _transaction(api_client, csrf_headers, amount_cents=5_300, title="Sat", on=saturday)
    _transaction(
        api_client, csrf_headers, amount_cents=10_600, title="Wed", on=wednesday
    )
    recurring = _transaction(
        api_client, csrf_headers, amount_cents=9_999, title="Auto", on=wednesday
    )
    _transaction(
        api_client,
        csrf_headers,
        amount_cents=4_000,
        title="Too old",
        on=today - timedelta(days=400),
    )
    db_session.execute(
        update(Transaction)
        .where(Transaction.id == recurring)
        .values(origin_rule_id=rule["id"])
    )
    db_session.commit()

    calendar = api_client.get("/api/insights/day-calendar").json()
    assert calendar["end"] == today.isoformat()
    assert (
        date.fromisoformat(calendar["end"]) - date.fromisoformat(calendar["start"])
    ).days == 53 * 7 - 1
    assert sorted((day["date"], day["amount_cents"]) for day in calendar["days"]) == (
        sorted(
            [(saturday.isoformat(), 5_300), (wednesday.isoformat(), 10_600)],
        )
    )
    averages = [0] * 7
    averages[5], averages[2] = 100, 200
    assert calendar["weekday_avg_cents"] == averages
    assert calendar["weekend_share"] == 5_300 / 15_900


def test_day_calendar_without_spending_has_zero_weekend_share(
    api_client: TestClient,
) -> None:
    calendar = api_client.get("/api/insights/day-calendar").json()
    assert calendar["days"] == []
    assert calendar["weekday_avg_cents"] == [0] * 7
    assert calendar["weekend_share"] == 0


def test_budget_history_reports_budget_and_spend_per_month(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = local_today()
    current = month_start(today.year, today.month)
    food = _create_category(api_client, csrf_headers, "Food", "expense")
    started = add_months(current, -3)
    for category_id, amount in ((food, 30_000), (None, 100_000)):
        response = api_client.post(
            "/api/budgets/templates",
            headers=csrf_headers,
            json={
                "frequency": "monthly",
                "category_id": category_id,
                "amount_cents": amount,
                "starts_on": started.isoformat(),
            },
        )
        assert response.status_code == 200
    response = api_client.post(
        "/api/budgets/overrides",
        headers=csrf_headers,
        json={
            "year": current.year,
            "month": current.month,
            "category_id": food,
            "amount_cents": 45_000,
        },
    )
    assert response.status_code == 200
    _transaction(
        api_client, csrf_headers, amount_cents=12_000, title="Food", category_id=food
    )

    history = api_client.get("/api/insights/budget-history").json()
    assert len(history["months"]) == 13
    overall, food_row = history["rows"]
    assert (overall["category_id"], overall["name"]) == (None, "Overall")
    assert (food_row["category_id"], food_row["name"]) == (food, "Food")
    assert food_row["first_month"] == _month_label(started)
    cells = {cell["month"]: cell for cell in food_row["cells"]}
    assert cells[_month_label(add_months(current, -4))] == {
        "month": _month_label(add_months(current, -4)),
        "budget_cents": None,
        "spent_cents": 0,
    }
    assert cells[_month_label(started)]["budget_cents"] == 30_000
    assert cells[_month_label(current)] == {
        "month": _month_label(current),
        "budget_cents": 45_000,
        "spent_cents": 12_000,
    }
    assert overall["cells"][-1]["spent_cents"] == 12_000


def test_spread_durables_counts_each_day_of_their_life(
    monkeypatch, api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date(2026, 7, 15)
    monkeypatch.setattr("expenses.services.main.local_today", lambda: today)
    monkeypatch.setattr("expenses.api.routes.local_today", lambda: today)
    gear = _create_category(api_client, csrf_headers, "Gear", "expense")
    refunds = _create_category(api_client, csrf_headers, "Refunds", "income")
    # 11,000 less a 1,000 refund over 100 days: 100 a day from 22 May.
    bike = _transaction(
        api_client,
        csrf_headers,
        amount_cents=11_000,
        title="Bike",
        on=date(2026, 5, 22),
        category_id=gear,
    )
    refund = _transaction(
        api_client,
        csrf_headers,
        amount_cents=1_000,
        title="Bike refund",
        on=date(2026, 5, 25),
        category_id=refunds,
        txn_type="income",
        is_reimbursement=True,
    )
    api_client.post(
        f"/api/reimbursements/{refund}/allocations",
        headers=csrf_headers,
        json={"expense_transaction_id": bike, "amount_cents": 1_000},
    )
    # 5,000 over 50 days that ended after 10: 100 a day, then 4,000 on its end date.
    lamp = _transaction(
        api_client,
        csrf_headers,
        amount_cents=5_000,
        title="Lamp",
        on=date(2026, 6, 1),
        category_id=gear,
    )
    for transaction_id, durable in (
        (bike, {"expected_lifespan_days": 100}),
        (lamp, {"expected_lifespan_days": 50, "ended_on": "2026-06-11"}),
    ):
        response = api_client.post(
            f"/api/transactions/{transaction_id}/durable",
            headers=csrf_headers,
            json=durable,
        )
        assert response.status_code == 200

    query = (
        "/api/insights?period=custom&start=2026-05-01&end=2026-07-31"
        f"&trend_category={gear}"
    )
    cash = api_client.get(query).json()
    spread = api_client.get(f"{query}&spread_durables=true").json()
    assert [point["expense_cents"] for point in cash["series"]] == [10_000, 5_000, 0]
    # July counts its days up to today.
    assert [point["expense_cents"] for point in spread["series"]] == [
        1_000,
        8_000,
        1_500,
    ]
    assert [point["amount_cents"] for point in spread["trend"][-3:]] == [
        1_000,
        8_000,
        1_500,
    ]
    assert spread["expense_cents"] == cash["expense_cents"] == 15_000

    june = api_client.get(
        "/api/insights?period=custom&start=2026-06-01&end=2026-06-30"
        "&spread_durables=true"
    ).json()
    assert june["deltas"]["increases"][0]["current_cents"] == 8_000
    assert june["deltas"]["increases"][0]["previous_cents"] == 1_000

    grid = api_client.get("/api/insights/month-grid?spread_durables=true").json()
    rows = {row["name"]: row["values_cents"] for row in grid["rows"]}
    assert rows["Gear"][-3:] == [1_000, 8_000, 1_500]
    split = api_client.get("/api/insights/recurring-split?spread_durables=true").json()
    assert [row["other_cents"] for row in split["rows"][-3:]] == [1_000, 8_000, 1_500]
    calendar = api_client.get("/api/insights/day-calendar?spread_durables=true").json()
    days = {day["date"]: day["amount_cents"] for day in calendar["days"]}
    assert (days["2026-06-10"], days["2026-06-11"], days["2026-06-12"]) == (
        200,
        4_100,
        100,
    )
    assert sum(days.values()) == 10_500
