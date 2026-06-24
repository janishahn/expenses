from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi.testclient import TestClient

from expenses.infra.fx_rates import FxQuote


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


def test_recurring_response_contains_monthly_equivalent(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Subscriptions", "expense")

    response = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={
            "name": "Test subscription",
            "type": "expense",
            "currency_code": "EUR",
            "amount_cents": 1200,
            "category_id": category_id,
            "anchor_date": date.today().isoformat(),
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": date.today().isoformat(),
            "end_date": None,
            "auto_post": True,
            "skip_weekends": False,
            "month_day_policy": "snap_to_end",
        },
    )
    assert response.status_code == 200

    response = api_client.get("/api/recurring")
    assert response.status_code == 200
    rules = response.json()["rules"]
    assert rules
    assert isinstance(rules[0]["monthly_equivalent_cents"], int)


def test_usd_rule_monthly_equivalent_uses_single_quote_lookup(
    api_client: TestClient, csrf_headers: dict[str, str], monkeypatch
) -> None:
    category_id = _create_category(api_client, csrf_headers, "USD Rent", "expense")

    response = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={
            "name": "USD Rent",
            "type": "expense",
            "currency_code": "USD",
            "amount_cents": 10000,
            "category_id": category_id,
            "anchor_date": date.today().isoformat(),
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": date.today().isoformat(),
            "end_date": None,
            "auto_post": True,
            "skip_weekends": False,
            "month_day_policy": "snap_to_end",
        },
    )
    assert response.status_code == 200

    calls = {"count": 0}

    def fake_quote(self, on_date, **kwargs):
        calls["count"] += 1
        return FxQuote(
            provider="ecb",
            base="USD",
            quote="EUR",
            rate=Decimal("0.92"),
            rate_date=on_date,
            fetched_at=datetime(2026, 3, 25, tzinfo=timezone.utc),
            source="cache_exact",
        )

    monkeypatch.setattr(
        "expenses.infra.fx_rates.FxRateService.usd_to_eur_quote_for_date",
        fake_quote,
    )

    response = api_client.get("/api/recurring")
    assert response.status_code == 200
    rules = response.json()["rules"]
    usd_rule = next(r for r in rules if r["currency_code"] == "USD")
    assert usd_rule["monthly_equivalent_cents"] == 9200
    assert calls["count"] == 1

    stats = response.json()["stats"]
    assert stats["total_monthly_expenses"] == 9200


def test_recurring_rule_create_allows_omitted_optional_fields(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Utilities", "expense")

    response = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={
            "type": "expense",
            "currency_code": "EUR",
            "amount_cents": 4500,
            "category_id": category_id,
            "anchor_date": date.today().isoformat(),
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": date.today().isoformat(),
            "auto_post": True,
            "skip_weekends": False,
            "month_day_policy": "snap_to_end",
        },
    )
    assert response.status_code == 200

    response = api_client.get("/api/recurring")
    assert response.status_code == 200
    rule = next(r for r in response.json()["rules"] if r["category_id"] == category_id)
    assert rule["name"] is None
    assert rule["end_date"] is None


def test_recurring_rule_update_allows_omitted_end_date(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Memberships", "expense")
    today = date.today().isoformat()
    response = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={
            "name": "Membership",
            "type": "expense",
            "currency_code": "EUR",
            "amount_cents": 900,
            "category_id": category_id,
            "anchor_date": today,
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": today,
            "end_date": None,
            "auto_post": True,
            "skip_weekends": False,
            "month_day_policy": "snap_to_end",
        },
    )
    assert response.status_code == 200
    rule_id = int(response.json()["id"])

    response = api_client.put(
        f"/api/recurring/{rule_id}",
        headers=csrf_headers,
        json={
            "name": "Updated membership",
            "type": "expense",
            "currency_code": "EUR",
            "amount_cents": 1100,
            "category_id": category_id,
            "anchor_date": today,
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": today,
            "auto_post": True,
            "skip_weekends": False,
            "month_day_policy": "snap_to_end",
        },
    )
    assert response.status_code == 200

    response = api_client.get("/api/recurring")
    assert response.status_code == 200
    rule = next(r for r in response.json()["rules"] if r["id"] == rule_id)
    assert rule["amount_cents"] == 1100
    assert rule["end_date"] is None
