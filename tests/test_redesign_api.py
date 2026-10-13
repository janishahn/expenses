from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import update

from expenses.core.periods import add_months, month_start
from expenses.db.models import Transaction
from expenses.recurrence.engine import local_today
from expenses.services import auto_categorization


def _category(
    client: TestClient, headers: dict[str, str], name: str, txn_type: str = "expense"
) -> int:
    response = client.post(
        "/api/categories",
        headers=headers,
        json={"name": name, "type": txn_type, "order": 0},
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


def _month_label(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def test_transactions_list_total_counts_every_filtered_row(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    for title in ("Coffee beans", "Coffee filter", "Monthly rent"):
        _transaction(api_client, csrf_headers, amount_cents=1_000, title=title)

    page = api_client.get("/api/transactions?limit=2").json()
    assert (len(page["items"]), page["has_more"], page["total"]) == (2, True, 3)
    assert api_client.get("/api/transactions?q=coffee").json()["total"] == 2
    assert api_client.get("/api/transactions/uncategorized").json()["total"] == 3


def test_transaction_detail_includes_net_amount_and_created_at(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    income_category = _category(api_client, csrf_headers, "Refunds", "income")
    expense_id = _transaction(
        api_client, csrf_headers, amount_cents=2_500, title="Lunch"
    )
    reimbursement_id = _transaction(
        api_client,
        csrf_headers,
        amount_cents=1_000,
        title="Lunch refund",
        txn_type="income",
        category_id=income_category,
        is_reimbursement=True,
    )
    response = api_client.post(
        f"/api/reimbursements/{reimbursement_id}/allocations",
        headers=csrf_headers,
        json={"expense_transaction_id": expense_id, "amount_cents": 1_000},
    )
    assert response.status_code == 200

    detail = api_client.get(f"/api/transactions/{expense_id}").json()
    listed = next(
        item
        for item in api_client.get("/api/transactions").json()["items"]
        if item["id"] == expense_id
    )
    assert detail["amount_cents"] == 2_500
    assert detail["net_amount_cents"] == listed["net_amount_cents"] == 1_500
    assert detail["reimbursed_total_cents"] == listed["reimbursed_total_cents"] == 1_000
    assert datetime.fromisoformat(detail["created_at"])
    assert detail["bank_row"] is None


def test_deleted_transactions_keep_default_page_and_support_paging_and_bulk_actions(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    ids = [
        _transaction(api_client, csrf_headers, amount_cents=500, title=f"Trash {n}")
        for n in range(3)
    ]
    keeper = _transaction(api_client, csrf_headers, amount_cents=500, title="Keeper")
    for transaction_id in ids:
        assert (
            api_client.delete(
                f"/api/transactions/{transaction_id}", headers=csrf_headers
            ).status_code
            == 200
        )

    default = api_client.get("/api/transactions/deleted").json()
    assert default["total"] == 3
    assert {item["id"] for item in default["transactions"]} == set(ids)
    paged = api_client.get("/api/transactions/deleted?page=2&limit=2").json()
    assert paged["total"] == 3
    assert len(paged["transactions"]) == 1
    assert api_client.get("/api/transactions/deleted?page=0").status_code == 422

    restored = api_client.post(
        "/api/transactions/deleted/restore",
        headers=csrf_headers,
        json={"ids": [ids[0], keeper, 999_999]},
    )
    assert restored.json() == {"restored": 1}
    purged = api_client.post(
        "/api/transactions/deleted/purge",
        headers=csrf_headers,
        json={"ids": [ids[1], keeper, 999_999]},
    )
    assert purged.json() == {"deleted": 1}
    remaining = api_client.get("/api/transactions/deleted").json()
    assert [item["id"] for item in remaining["transactions"]] == [ids[2]]
    assert api_client.get(f"/api/transactions/{keeper}").status_code == 200
    assert api_client.get(f"/api/transactions/{ids[0]}").status_code == 200


def test_bulk_trash_actions_ignore_other_users_transactions(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    transaction_id = _transaction(
        api_client, csrf_headers, amount_cents=500, title="Mine"
    )
    api_client.delete(f"/api/transactions/{transaction_id}", headers=csrf_headers)
    api_client.post("/api/auth/logout", headers=csrf_headers)
    credentials = {"username": "second", "password": "pw-12345"}
    assert api_client.post("/api/auth/signup", json=credentials).status_code == 200
    assert api_client.post("/api/auth/login", json=credentials).status_code == 200
    second_headers = {"X-CSRF-Token": api_client.get("/api/csrf").json()["token"]}

    for action, key in (("restore", "restored"), ("purge", "deleted")):
        response = api_client.post(
            f"/api/transactions/deleted/{action}",
            headers=second_headers,
            json={"ids": [transaction_id]},
        )
        assert response.json() == {key: 0}

    api_client.post("/api/auth/logout", headers=second_headers)
    assert (
        api_client.post(
            "/api/auth/login", json={"username": "bootstrap", "password": "pw-12345"}
        ).status_code
        == 200
    )
    assert len(api_client.get("/api/transactions/deleted").json()["transactions"]) == 1


def test_admin_purge_preview_counts_without_deleting(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    assert (
        api_client.post(
            "/api/auth/admin-elevation",
            headers=csrf_headers,
            json={"password": "pw-12345"},
        ).status_code
        == 200
    )
    transaction_id = _transaction(
        api_client, csrf_headers, amount_cents=500, title="Old trash"
    )
    api_client.delete(f"/api/transactions/{transaction_id}", headers=csrf_headers)
    assert api_client.get("/api/admin/purge-deleted/preview?days=1").json() == {
        "count": 0
    }
    db_session.execute(
        update(Transaction).values(deleted_at=datetime.utcnow() - timedelta(days=40))
    )
    db_session.commit()

    assert api_client.get("/api/admin/purge-deleted/preview?days=30").json() == {
        "count": 1
    }
    assert api_client.get("/api/admin/purge-deleted/preview?days=0").status_code == 422
    assert len(api_client.get("/api/transactions/deleted").json()["transactions"]) == 1


def test_balance_history_returns_month_end_balances_and_validates_months(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = local_today()
    income_category = _category(api_client, csrf_headers, "Pay", "income")
    first_day = add_months(month_start(today.year, today.month), -2)
    _transaction(
        api_client,
        csrf_headers,
        amount_cents=100_000,
        title="Salary",
        on=first_day,
        txn_type="income",
        category_id=income_category,
    )
    _transaction(api_client, csrf_headers, amount_cents=25_000, title="Rent")

    history = api_client.get("/api/dashboard/balance-history?months=6").json()["months"]
    assert [point["month"] for point in history] == [
        _month_label(add_months(month_start(today.year, today.month), offset))
        for offset in (-2, -1, 0)
    ]
    assert [point["balance_cents"] for point in history] == [100_000, 100_000, 75_000]
    assert api_client.get("/api/dashboard/balance-history").status_code == 200
    assert api_client.get("/api/dashboard/balance-history?months=5").status_code == 422


def test_category_breakdown_months_param_and_category_ids(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _category(api_client, csrf_headers, "Groceries")
    _transaction(
        api_client,
        csrf_headers,
        amount_cents=4_000,
        title="Food",
        category_id=category_id,
    )

    assert (
        len(api_client.get("/api/category-breakdown?view=monthly").json()["months"])
        == 6
    )
    assert (
        len(
            api_client.get("/api/category-breakdown?view=monthly&months=12").json()[
                "months"
            ]
        )
        == 12
    )
    assert (
        api_client.get("/api/category-breakdown?view=monthly&months=7").status_code
        == 422
    )
    flat = api_client.get("/api/category-breakdown").json()
    assert [(item["category_id"], item["id"]) for item in flat] == [
        (category_id, category_id)
    ]
    donut = api_client.get("/api/dashboard").json()["donut"]["expense_breakdown"]
    assert donut[0]["category_id"] == category_id
    insights = api_client.get("/api/insights").json()
    assert insights["expense_breakdown"][0]["category_id"] == category_id


def test_month_grid_returns_thirteen_months_per_category_income_and_tag(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = local_today()
    current = month_start(today.year, today.month)
    food = _category(api_client, csrf_headers, "Food")
    _category(api_client, csrf_headers, "Idle")
    salary = _category(api_client, csrf_headers, "Salary", "income")
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
    category_id = _category(api_client, csrf_headers, "Subscriptions")
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


def test_digest_recurring_postings_report_their_type(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    category_id = _category(api_client, csrf_headers, "Salary", "income")
    rule = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={
            "name": "Payday",
            "type": "income",
            "amount_cents": 300_000,
            "category_id": category_id,
            "anchor_date": "2030-01-01",
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": "2030-01-01",
            "auto_post": False,
        },
    ).json()
    posted = _transaction(
        api_client,
        csrf_headers,
        amount_cents=300_000,
        title="Payday",
        category_id=category_id,
        txn_type="income",
    )
    db_session.execute(
        update(Transaction)
        .where(Transaction.id == posted)
        .values(origin_rule_id=rule["id"])
    )
    db_session.commit()

    postings = api_client.get("/api/digest").json()["recurring_postings"]
    assert [(row["transaction_id"], row["type"]) for row in postings] == [
        (posted, "income")
    ]


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
    category_id = _category(api_client, csrf_headers, "Subscriptions")
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
    food = _category(api_client, csrf_headers, "Food")
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


def test_categories_and_tags_report_period_totals_and_created_at(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    food = _category(api_client, csrf_headers, "Food")
    salary = _category(api_client, csrf_headers, "Salary", "income")
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


def test_uncategorized_suggestions_use_the_local_model_and_can_be_dismissed(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    auto_categorization._model_cache.clear()
    bakery = _category(api_client, csrf_headers, "Bakery")
    transit = _category(api_client, csrf_headers, "Transit")
    for index in range(80):
        bakery_purchase = index % 2 == 0
        _transaction(
            api_client,
            csrf_headers,
            amount_cents=500 if bakery_purchase else 340,
            title="Corner bakery" if bakery_purchase else "City metro",
            on=local_today() - timedelta(days=index),
            category_id=bakery if bakery_purchase else transit,
        )
    pending = _transaction(
        api_client, csrf_headers, amount_cents=500, title="Corner bakery"
    )

    def suggestion():
        items = api_client.get("/api/transactions/uncategorized").json()["items"]
        return next(item for item in items if item["id"] == pending)["suggestion"]

    assert suggestion() is None
    response = api_client.put(
        "/api/settings/auto-categorization",
        headers=csrf_headers,
        json={"enabled": True, "threshold": 0.8},
    )
    assert response.status_code == 200
    current = suggestion()
    assert current["category_id"] == bakery
    assert 0 < current["confidence"] <= 1
    assert len(auto_categorization._model_cache) == 1

    wrong = api_client.post(
        f"/api/transactions/{pending}/category-suggestion/dismiss",
        headers=csrf_headers,
        json={"category_id": 999_999},
    )
    assert wrong.status_code == 400
    dismissed = api_client.post(
        f"/api/transactions/{pending}/category-suggestion/dismiss",
        headers=csrf_headers,
        json={"category_id": bakery},
    )
    assert dismissed.json() == {"status": "ok"}
    assert suggestion() is None
    missing = api_client.post(
        "/api/transactions/999999/category-suggestion/dismiss",
        headers=csrf_headers,
        json={"category_id": bakery},
    )
    assert missing.status_code == 404

    api_client.put(
        "/api/settings/auto-categorization",
        headers=csrf_headers,
        json={"enabled": False, "threshold": 0.8},
    )
    assert suggestion() is None
