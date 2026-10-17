from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient

from expenses.core.periods import add_months, month_start
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
    occurred_at: datetime,
    category_id: int,
    title: str,
    amount_cents: int = 1_000,
    tags: list[str] | None = None,
) -> int:
    response = client.post(
        "/api/transactions",
        headers=headers,
        json={
            "date": txn_date.isoformat(),
            "occurred_at": occurred_at.isoformat(),
            "type": "expense",
            "amount_cents": amount_cents,
            "category_id": category_id,
            "title": title,
            "tags": tags or [],
        },
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


def test_dashboard_tag_exclusions_filter_activity_but_keep_actual_balance(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(
        api_client, csrf_headers, "Dashboard exclusion", "expense"
    )
    today = date.today()
    occurred_at = datetime.combine(today, datetime.min.time()).replace(hour=12)
    vacation_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today,
        occurred_at=occurred_at,
        category_id=category_id,
        title="Dashboard vacation spend",
        amount_cents=9_000,
        tags=["Dashboard vacation"],
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today,
        occurred_at=occurred_at.replace(hour=13),
        category_id=category_id,
        title="Dashboard regular spend",
        amount_cents=3_000,
    )
    tags = api_client.get("/api/tags").json()["tags"]
    vacation_tag_id = next(
        int(tag["id"]) for tag in tags if tag["name"] == "Dashboard vacation"
    )

    unfiltered = api_client.get("/api/dashboard?period=all")
    filtered = api_client.get(
        f"/api/dashboard?period=all&exclude_tags={vacation_tag_id}"
    )
    assert unfiltered.status_code == 200
    assert filtered.status_code == 200
    unfiltered_payload = unfiltered.json()
    filtered_payload = filtered.json()

    assert filtered_payload["filters"]["excluded_tag_ids"] == [vacation_tag_id]
    assert (
        unfiltered_payload["kpis"]["expenses"] - filtered_payload["kpis"]["expenses"]
        == 9_000
    )
    assert filtered_payload["kpis"]["balance"] == unfiltered_payload["kpis"]["balance"]
    assert vacation_id not in {item["id"] for item in filtered_payload["recent"]}

    unfiltered_bands = api_client.get(
        "/api/category-breakdown?view=monthly&period=this_month"
    ).json()["months"]
    filtered_bands = api_client.get(
        f"/api/category-breakdown?view=monthly&period=this_month&exclude_tags={vacation_tag_id}"
    ).json()["months"]
    assert (
        unfiltered_bands[-1]["total_cents"] - filtered_bands[-1]["total_cents"] == 9_000
    )
    assert filtered_bands[-1]["balance_cents"] == unfiltered_bands[-1]["balance_cents"]

    included = api_client.get(f"/api/dashboard?period=all&tags={vacation_tag_id}")
    assert included.status_code == 200
    included_payload = included.json()
    assert included_payload["filters"]["included_tag_ids"] == [vacation_tag_id]
    assert included_payload["kpis"]["expenses"] == 9_000
    assert included_payload["kpis"]["balance"] == unfiltered_payload["kpis"]["balance"]
    assert {item["id"] for item in included_payload["recent"]} == {vacation_id}

    included_bands = api_client.get(
        f"/api/category-breakdown?view=monthly&period=this_month&tags={vacation_tag_id}"
    ).json()["months"]
    assert included_bands[-1]["total_cents"] == 9_000
    assert included_bands[-1]["balance_cents"] == unfiltered_bands[-1]["balance_cents"]

    removed_type_filter = api_client.get("/api/dashboard?period=all&type=income")
    assert removed_type_filter.status_code == 200
    removed_type_payload = removed_type_filter.json()
    assert "type" not in removed_type_payload["filters"]
    assert removed_type_payload["kpis"] == unfiltered_payload["kpis"]
    assert removed_type_payload["donut"]["mode"] == "both"
    assert vacation_id in {item["id"] for item in removed_type_payload["recent"]}


def test_dashboard_recent_transactions_returns_latest_ten(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(
        api_client, csrf_headers, "Dashboard Recent", "expense"
    )
    base_day = date.today()

    for index in range(12):
        txn_day = base_day - timedelta(days=index)
        occurred_at = datetime.combine(txn_day, datetime.min.time()).replace(
            hour=12, minute=index
        )
        _create_transaction(
            api_client,
            csrf_headers,
            txn_date=txn_day,
            occurred_at=occurred_at,
            category_id=category_id,
            title=f"Recent {index:02d}",
        )

    response = api_client.get("/api/dashboard?period=all")
    assert response.status_code == 200
    payload = response.json()

    assert len(payload["recent"]) == 10
    assert [item["title"] for item in payload["recent"]] == [
        f"Recent {index:02d}" for index in range(10)
    ]


def test_monthly_category_breakdown_returns_six_month_spending_bands(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    groceries_id = _create_category(
        api_client, csrf_headers, "Band Groceries", "expense"
    )
    transport_id = _create_category(
        api_client, csrf_headers, "Band Transport", "expense"
    )
    today = date.today()
    previous_month = today.replace(day=1) - timedelta(days=1)

    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today,
        occurred_at=datetime.combine(today, datetime.min.time()).replace(hour=10),
        category_id=groceries_id,
        title="Current groceries",
        amount_cents=12_500,
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=today,
        occurred_at=datetime.combine(today, datetime.min.time()).replace(hour=11),
        category_id=transport_id,
        title="Current transport",
        amount_cents=4_000,
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=previous_month,
        occurred_at=datetime.combine(previous_month, datetime.min.time()).replace(
            hour=12
        ),
        category_id=groceries_id,
        title="Previous groceries",
        amount_cents=8_000,
    )

    response = api_client.get("/api/category-breakdown?view=monthly&period=this_month")
    assert response.status_code == 200
    bands = response.json()["months"]

    assert len(bands) == 6
    assert all(isinstance(month["balance_cents"], int) for month in bands)
    assert bands[-1]["month"] == f"{today.year:04d}-{today.month:02d}"
    assert bands[-1]["total_cents"] == 16_500
    assert [segment["name"] for segment in bands[-1]["segments"]] == [
        "Band Groceries",
        "Band Transport",
    ]
    assert bands[-2]["month"] == (
        f"{previous_month.year:04d}-{previous_month.month:02d}"
    )
    assert bands[-2]["total_cents"] == 8_000


def test_monthly_category_breakdown_omits_balances_before_first_snapshot(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    previous_month = today.replace(day=1) - timedelta(days=1)
    snapshot_at = datetime.combine(previous_month, datetime.min.time()).replace(hour=18)
    response = api_client.post(
        "/api/settings/balance-anchors",
        headers=csrf_headers,
        json={
            "as_of_at": snapshot_at.isoformat(),
            "balance_cents": 50_000,
            "note": "First known balance",
        },
    )
    assert response.status_code == 200

    response = api_client.get("/api/category-breakdown?view=monthly&period=this_month")
    assert response.status_code == 200
    bands = response.json()["months"]

    assert all(month["balance_cents"] is None for month in bands[:-2])
    assert bands[-2]["balance_cents"] == 50_000
    assert bands[-1]["balance_cents"] == 50_000


def test_balance_history_returns_month_end_balances_and_validates_months(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = local_today()
    income_category = _create_category(api_client, csrf_headers, "Pay", "income")
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
    category_id = _create_category(api_client, csrf_headers, "Groceries", "expense")
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


def test_dashboard_category_share_lists_every_category(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    for index in range(10):
        _transaction(
            api_client,
            csrf_headers,
            amount_cents=1_000 * (index + 1),
            title=f"Purchase {index}",
            category_id=_create_category(
                api_client, csrf_headers, f"Category {index}", "expense"
            ),
        )

    donut = api_client.get("/api/dashboard").json()["donut"]["expense_breakdown"]
    assert len(donut) == 10
    assert sum(item["amount_cents"] for item in donut) == 55_000
    assert round(sum(item["percent"] for item in donut)) == 100
