from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi.testclient import TestClient

from expenses_web.infra.fx_rates import FxQuote


def _add_months(base: date, months: int) -> date:
    month_index = (base.year * 12) + (base.month - 1) + months
    year = month_index // 12
    month = (month_index % 12) + 1
    return date(year, month, 1)


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


def _create_recurring_rule(
    client: TestClient,
    headers: dict[str, str],
    *,
    name: str,
    txn_type: str,
    category_id: int,
    amount_cents: int,
    next_occurrence: date,
    currency_code: str = "EUR",
) -> int:
    response = client.post(
        "/api/recurring",
        headers=headers,
        json={
            "name": name,
            "type": txn_type,
            "currency_code": currency_code,
            "amount_cents": amount_cents,
            "category_id": category_id,
            "anchor_date": next_occurrence.isoformat(),
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": next_occurrence.isoformat(),
            "end_date": None,
            "auto_post": True,
            "skip_weekends": False,
            "month_day_policy": "snap_to_end",
        },
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def test_forecast_modes_include_expected_series(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    next_month = _add_months(today.replace(day=1), 1)
    salary_id = _create_category(api_client, csrf_headers, "Salary", "income")
    rent_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")

    _create_recurring_rule(
        api_client,
        csrf_headers,
        name="Salary",
        txn_type="income",
        category_id=salary_id,
        amount_cents=300_000,
        next_occurrence=next_month,
    )
    _create_recurring_rule(
        api_client,
        csrf_headers,
        name="Rent",
        txn_type="expense",
        category_id=rent_id,
        amount_cents=120_000,
        next_occurrence=next_month,
    )

    for offset in (1, 2, 3):
        month_start = _add_months(today.replace(day=1), -offset)
        _create_transaction(
            api_client,
            csrf_headers,
            txn_date=month_start.replace(day=7),
            txn_type="expense",
            amount_cents=30_000,
            category_id=groceries_id,
            title=f"Groceries {offset}",
        )

    recurring_response = api_client.get("/api/forecast?horizon=3&mode=recurring")
    assert recurring_response.status_code == 200
    recurring_payload = recurring_response.json()
    assert recurring_payload["horizon"] == 3
    assert recurring_payload["mode"] == "recurring"
    assert len(recurring_payload["months"]) == 3

    full_response = api_client.get("/api/forecast?horizon=3&mode=full")
    assert full_response.status_code == 200
    full_payload = full_response.json()
    assert full_payload["mode"] == "full"
    assert len(full_payload["months"]) == 3

    recurring_first = recurring_payload["months"][0]
    full_first = full_payload["months"][0]
    assert recurring_first["projected_income_cents"] == 300_000
    assert recurring_first["projected_expenses_cents"] == 120_000
    assert (
        full_first["projected_expenses_cents"]
        > recurring_first["projected_expenses_cents"]
    )
    assert full_first["breakdown"]["variable_estimates"]
    assert isinstance(full_payload["summary"]["months_until_negative"], int | None)


def test_forecast_rejects_invalid_query_params(api_client: TestClient) -> None:
    response = api_client.get("/api/forecast?horizon=4")
    assert response.status_code == 400
    response = api_client.get("/api/forecast?mode=bad")
    assert response.status_code == 400


def test_forecast_and_scenario_use_app_timezone_today(
    monkeypatch, api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    fixed_today = date(2025, 1, 31)
    monkeypatch.setattr("expenses_web.services.main.local_today", lambda: fixed_today)

    forecast_response = api_client.get("/api/forecast?horizon=3&mode=recurring")
    assert forecast_response.status_code == 200
    forecast_payload = forecast_response.json()
    assert forecast_payload["months"][0]["month"] == "2025-02"

    scenario_response = api_client.post(
        "/api/forecast/scenario?mode=full",
        headers=csrf_headers,
        json={"horizon": 3, "modifications": []},
    )
    assert scenario_response.status_code == 200
    scenario_payload = scenario_response.json()
    assert scenario_payload["baseline"]["months"][0]["month"] == "2025-02"
    assert scenario_payload["months"][0]["month"] == "2025-02"


def test_forecast_usd_uses_resolved_quotes(
    monkeypatch, api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    fixed_today = date(2025, 1, 15)
    monkeypatch.setattr("expenses_web.services.main.local_today", lambda: fixed_today)
    next_month = _add_months(fixed_today.replace(day=1), 1)
    rent_id = _create_category(api_client, csrf_headers, "USD Rent", "expense")
    _create_recurring_rule(
        api_client,
        csrf_headers,
        name="USD Rent",
        txn_type="expense",
        category_id=rent_id,
        amount_cents=15_000,
        next_occurrence=next_month,
        currency_code="USD",
    )

    calls = {"count": 0}

    def fake_resolve(
        self, on_dates, *, allow_stale_cache=False, allow_static_fallback=False
    ):
        calls["count"] += 1
        return {
            on_date: FxQuote(
                provider="ecb",
                base="USD",
                quote="EUR",
                rate=Decimal("0.9"),
                rate_date=fixed_today,
                fetched_at=datetime(2025, 1, 15, tzinfo=timezone.utc),
                source="cache_exact",
            )
            for on_date in on_dates
        }

    monkeypatch.setattr(
        "expenses_web.infra.fx_rates.FxRateService.resolve_usd_to_eur_quotes",
        fake_resolve,
    )

    response = api_client.get("/api/forecast?horizon=3&mode=recurring")
    assert response.status_code == 200
    payload = response.json()
    first_month = payload["months"][0]
    assert first_month["projected_expenses_cents"] == 13_500
    assert first_month["breakdown"]["recurring_rules"]
    assert first_month["breakdown"]["recurring_rules"][0]["amount_cents"] == 13_500
    assert calls["count"] == 1


def test_forecast_scenario_applies_modifications(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    next_month = _add_months(today.replace(day=1), 1)
    month_after_next = _add_months(today.replace(day=1), 2)

    salary_id = _create_category(api_client, csrf_headers, "Salary", "income")
    rent_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")

    salary_rule_id = _create_recurring_rule(
        api_client,
        csrf_headers,
        name="Salary",
        txn_type="income",
        category_id=salary_id,
        amount_cents=250_000,
        next_occurrence=next_month,
    )
    rent_rule_id = _create_recurring_rule(
        api_client,
        csrf_headers,
        name="Rent",
        txn_type="expense",
        category_id=rent_id,
        amount_cents=110_000,
        next_occurrence=next_month,
    )

    for offset in (1, 2, 3):
        month_start = _add_months(today.replace(day=1), -offset)
        _create_transaction(
            api_client,
            csrf_headers,
            txn_date=month_start.replace(day=6),
            txn_type="expense",
            amount_cents=20_000,
            category_id=groceries_id,
            title=f"Groceries {offset}",
        )

    payload = {
        "horizon": 6,
        "modifications": [
            {"type": "remove_rule", "rule_id": rent_rule_id},
            {
                "type": "modify_rule",
                "rule_id": salary_rule_id,
                "new_amount_cents": 300_000,
                "effective_month": next_month.isoformat()[:7],
            },
            {
                "type": "one_time",
                "name": "Vacation",
                "tx_type": "expense",
                "amount_cents": 80_000,
                "month": month_after_next.isoformat()[:7],
            },
            {
                "type": "adjust_category",
                "category_id": groceries_id,
                "new_monthly_cents": 5_000,
            },
            {
                "type": "add_rule",
                "name": "Side gig",
                "tx_type": "income",
                "amount_cents": 30_000,
                "interval": "monthly",
            },
        ],
    }
    response = api_client.post(
        "/api/forecast/scenario?mode=full",
        headers=csrf_headers,
        json=payload,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["horizon"] == 6
    assert data["mode"] == "full"
    assert len(data["baseline"]["months"]) == 6
    assert len(data["months"]) == 6
    assert len(data["impact"]["monthly_delta"]) == 6
    assert len(data["impact"]["by_modification"]) == 5
    assert all("monthly_delta" in row for row in data["impact"]["by_modification"])
    assert data["impact"]["final_delta_cents"] > 0


def test_forecast_scenario_is_stateless_and_validates_inputs(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    next_month = _add_months(today.replace(day=1), 1)
    expense_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    _create_recurring_rule(
        api_client,
        csrf_headers,
        name="Rent",
        txn_type="expense",
        category_id=expense_id,
        amount_cents=100_000,
        next_occurrence=next_month,
    )

    rules_before = api_client.get("/api/recurring").json()["rules"]
    txns_before = api_client.get("/api/transactions?period=all").json()["items"]

    response = api_client.post(
        "/api/forecast/scenario?mode=full",
        headers=csrf_headers,
        json={
            "horizon": 3,
            "modifications": [
                {"type": "remove_rule", "rule_id": 999_999},
            ],
        },
    )
    assert response.status_code == 400

    response = api_client.post(
        "/api/forecast/scenario?mode=full",
        headers=csrf_headers,
        json={"horizon": 3, "modifications": []},
    )
    assert response.status_code == 200

    rules_after = api_client.get("/api/recurring").json()["rules"]
    txns_after = api_client.get("/api/transactions?period=all").json()["items"]
    assert len(rules_before) == len(rules_after)
    assert len(txns_before) == len(txns_after)
