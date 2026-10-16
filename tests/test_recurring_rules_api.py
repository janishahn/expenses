from datetime import date, datetime, timedelta, timezone
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


def _rule_payload(category_id: int, anchor: date, next_occurrence: date) -> dict:
    return {
        "name": "Rent",
        "type": "expense",
        "currency_code": "EUR",
        "amount_cents": 90000,
        "category_id": category_id,
        "anchor_date": anchor.isoformat(),
        "interval_unit": "month",
        "interval_count": 1,
        "next_occurrence": next_occurrence.isoformat(),
        "auto_post": True,
        "skip_weekends": False,
        "month_day_policy": "snap_to_end",
    }


def _next_occurrence_after_start_change(
    client: TestClient,
    headers: dict[str, str],
    *,
    anchor: date,
    next_occurrence: date,
    new_anchor: date,
) -> str:
    category_id = _create_category(client, headers, "Rent", "expense")
    response = client.post(
        "/api/recurring",
        headers=headers,
        json=_rule_payload(category_id, anchor, next_occurrence),
    )
    assert response.status_code == 200
    rule_id = int(response.json()["id"])

    # Clients send the stored next occurrence back unchanged.
    response = client.put(
        f"/api/recurring/{rule_id}",
        headers=headers,
        json=_rule_payload(category_id, new_anchor, next_occurrence),
    )
    assert response.status_code == 200

    response = client.get("/api/recurring")
    assert response.status_code == 200
    rule = next(r for r in response.json()["rules"] if r["id"] == rule_id)
    assert rule["anchor_date"] == new_anchor.isoformat()
    return rule["next_occurrence"]


def test_recurring_rule_later_start_moves_next_occurrence(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    next_occurrence = _next_occurrence_after_start_change(
        api_client,
        csrf_headers,
        anchor=today - timedelta(days=60),
        next_occurrence=today + timedelta(days=5),
        new_anchor=today + timedelta(days=35),
    )
    assert next_occurrence == (today + timedelta(days=35)).isoformat()


def test_recurring_rule_earlier_start_keeps_next_occurrence(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    today = date.today()
    next_occurrence = _next_occurrence_after_start_change(
        api_client,
        csrf_headers,
        anchor=today - timedelta(days=60),
        next_occurrence=today + timedelta(days=5),
        new_anchor=today - timedelta(days=90),
    )
    assert next_occurrence == (today + timedelta(days=5)).isoformat()
