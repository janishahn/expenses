from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
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
            "name": "Power",
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
    assert rule["name"] == "Power"
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


def _fifteenth_from(day: date) -> date:
    if day.day <= 15:
        return day.replace(day=15)
    return (day.replace(day=1) + timedelta(days=32)).replace(day=15)


def test_recurring_rule_start_on_a_later_day_moves_next_occurrence_forward(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    from expenses.recurrence.engine import local_today

    today = local_today()
    old_next = _fifteenth_from(today + timedelta(days=20))
    next_occurrence = _next_occurrence_after_start_change(
        api_client,
        csrf_headers,
        anchor=date(today.year - 1, 1, 15),
        next_occurrence=old_next,
        new_anchor=date(today.year - 1, 1, 25),
    )
    # The 25th of the month before would post a second time before the 15th.
    assert next_occurrence == old_next.replace(day=25).isoformat()


def test_recurring_rule_start_on_an_earlier_day_moves_next_occurrence_back(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    from expenses.recurrence.engine import local_today

    today = local_today()
    old_next = _fifteenth_from(today + timedelta(days=20))
    next_occurrence = _next_occurrence_after_start_change(
        api_client,
        csrf_headers,
        anchor=date(today.year - 1, 1, 15),
        next_occurrence=old_next,
        new_anchor=date(today.year - 1, 1, 5),
    )
    # The 5th of the following month would skip a posting.
    assert next_occurrence == old_next.replace(day=5).isoformat()


@pytest.mark.parametrize(
    ("anchor", "old_next", "new_anchor", "expected"),
    [
        # March already posted on the 1st; the 28th of March would post it again.
        (date(2026, 1, 1), date(2026, 4, 1), date(2026, 1, 28), "2026-04-28"),
        (date(2026, 1, 15), date(2026, 4, 15), date(2026, 1, 14), "2026-04-14"),
        # The 1st of March is already past, while the pending 28 March was not.
        (date(2026, 1, 28), date(2026, 3, 28), date(2026, 1, 1), "2026-04-01"),
    ],
)
def test_recurring_rule_start_move_keeps_the_pending_month(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch,
    anchor: date,
    old_next: date,
    new_anchor: date,
    expected: str,
) -> None:
    monkeypatch.setattr("expenses.services.main.local_today", lambda: date(2026, 3, 10))
    next_occurrence = _next_occurrence_after_start_change(
        api_client,
        csrf_headers,
        anchor=anchor,
        next_occurrence=old_next,
        new_anchor=new_anchor,
    )
    assert next_occurrence == expected


@pytest.mark.parametrize(
    ("today", "unit", "count", "anchor", "old_next", "new_anchor", "expected"),
    [
        # Moved to December: no January occurrence, so the nearest one stays.
        (
            date(2026, 11, 20),
            "year",
            1,
            date(2025, 1, 15),
            date(2027, 1, 15),
            date(2024, 12, 15),
            "2026-12-15",
        ),
        (
            date(2026, 3, 10),
            "month",
            2,
            date(2026, 1, 1),
            date(2026, 5, 1),
            date(2026, 2, 28),
            "2026-04-28",
        ),
    ],
)
def test_recurring_rule_start_move_to_another_month_keeps_the_nearest_occurrence(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch,
    today: date,
    unit: str,
    count: int,
    anchor: date,
    old_next: date,
    new_anchor: date,
    expected: str,
) -> None:
    monkeypatch.setattr("expenses.services.main.local_today", lambda: today)
    category_id = _create_category(api_client, csrf_headers, "Insurance", "expense")
    payload = {
        **_rule_payload(category_id, anchor, old_next),
        "interval_unit": unit,
        "interval_count": count,
    }
    response = api_client.post("/api/recurring", headers=csrf_headers, json=payload)
    assert response.status_code == 200
    rule_id = int(response.json()["id"])
    response = api_client.put(
        f"/api/recurring/{rule_id}",
        headers=csrf_headers,
        json={**payload, "anchor_date": new_anchor.isoformat()},
    )
    assert response.status_code == 200
    rule = next(
        r
        for r in api_client.get("/api/recurring").json()["rules"]
        if r["id"] == rule_id
    )
    assert rule["next_occurrence"] == expected


@pytest.mark.parametrize(
    ("today", "extra", "anchor", "old_next", "new_anchor", "expected"),
    [
        # Saturday 28 Feb was stored as Monday 2 Mar; February is still pending.
        (
            date(2026, 2, 25),
            {"skip_weekends": True},
            date(2026, 1, 28),
            date(2026, 3, 2),
            date(2026, 1, 27),
            "2026-02-27",
        ),
        # February has no 31st, so the next payment is in March, not January.
        (
            date(2026, 1, 29),
            {"month_day_policy": "skip"},
            date(2025, 10, 28),
            date(2026, 2, 28),
            date(2025, 10, 31),
            "2026-03-31",
        ),
    ],
)
def test_recurring_rule_start_move_follows_the_scheduled_billing_month(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch,
    today: date,
    extra: dict,
    anchor: date,
    old_next: date,
    new_anchor: date,
    expected: str,
) -> None:
    monkeypatch.setattr("expenses.services.main.local_today", lambda: today)
    category_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    payload = {**_rule_payload(category_id, anchor, old_next), **extra}
    response = api_client.post("/api/recurring", headers=csrf_headers, json=payload)
    assert response.status_code == 200
    rule_id = int(response.json()["id"])
    response = api_client.put(
        f"/api/recurring/{rule_id}",
        headers=csrf_headers,
        json={**payload, "anchor_date": new_anchor.isoformat()},
    )
    assert response.status_code == 200
    rule = next(
        r
        for r in api_client.get("/api/recurring").json()["rules"]
        if r["id"] == rule_id
    )
    assert rule["next_occurrence"] == expected


def test_recurring_rule_weekly_start_moves_next_occurrence_to_new_weekday(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    from expenses.recurrence.engine import local_today

    today = local_today()
    thursday = date(2026, 1, 1)
    old_next = today + timedelta(days=7 + (thursday - today).days % 7)
    category_id = _create_category(api_client, csrf_headers, "Cleaning", "expense")
    payload = {
        **_rule_payload(category_id, thursday, old_next),
        "interval_unit": "week",
    }
    response = api_client.post("/api/recurring", headers=csrf_headers, json=payload)
    assert response.status_code == 200
    rule_id = int(response.json()["id"])
    response = api_client.put(
        f"/api/recurring/{rule_id}",
        headers=csrf_headers,
        json={**payload, "anchor_date": "2025-12-29"},
    )
    assert response.status_code == 200
    rule = next(
        r
        for r in api_client.get("/api/recurring").json()["rules"]
        if r["id"] == rule_id
    )
    assert rule["next_occurrence"] == (old_next - timedelta(days=3)).isoformat()


def test_recurring_rule_start_change_does_not_move_next_occurrence_into_the_past(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    from expenses.recurrence.engine import local_today

    today = local_today()
    old_next = today + timedelta(days=1)
    anchor = old_next - timedelta(days=70)
    category_id = _create_category(api_client, csrf_headers, "Cleaning", "expense")
    payload = {**_rule_payload(category_id, anchor, old_next), "interval_unit": "week"}
    response = api_client.post("/api/recurring", headers=csrf_headers, json=payload)
    assert response.status_code == 200
    rule_id = int(response.json()["id"])
    new_anchor = anchor - timedelta(days=2)
    response = api_client.put(
        f"/api/recurring/{rule_id}",
        headers=csrf_headers,
        json={**payload, "anchor_date": new_anchor.isoformat()},
    )
    assert response.status_code == 200
    rule = next(
        r
        for r in api_client.get("/api/recurring").json()["rules"]
        if r["id"] == rule_id
    )
    # Yesterday is nearer, but it would post a payment that is already past.
    assert rule["next_occurrence"] == (today + timedelta(days=6)).isoformat()


def test_recurring_rule_start_change_keeps_an_overdue_next_occurrence_nearby(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    from expenses.recurrence.engine import local_today

    today = local_today()
    old_next = _fifteenth_from(today - timedelta(days=70))
    category_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    payload = {
        **_rule_payload(category_id, date(today.year - 2, 1, 15), old_next),
        "auto_post": False,
    }
    response = api_client.post("/api/recurring", headers=csrf_headers, json=payload)
    assert response.status_code == 200
    rule_id = int(response.json()["id"])
    response = api_client.put(
        f"/api/recurring/{rule_id}",
        headers=csrf_headers,
        json={**payload, "anchor_date": date(today.year - 2, 1, 5).isoformat()},
    )
    assert response.status_code == 200
    rule = next(
        r
        for r in api_client.get("/api/recurring").json()["rules"]
        if r["id"] == rule_id
    )
    assert rule["next_occurrence"] == old_next.replace(day=5).isoformat()


def test_recurring_rule_start_change_keeps_a_chosen_next_occurrence(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    from expenses.recurrence.engine import local_today

    today = local_today()
    old_next = _fifteenth_from(today + timedelta(days=20))
    chosen = old_next + timedelta(days=3)
    category_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    payload = _rule_payload(category_id, date(today.year - 1, 1, 15), old_next)
    response = api_client.post("/api/recurring", headers=csrf_headers, json=payload)
    assert response.status_code == 200
    rule_id = int(response.json()["id"])
    response = api_client.put(
        f"/api/recurring/{rule_id}",
        headers=csrf_headers,
        json={
            **payload,
            "anchor_date": date(today.year - 1, 1, 25).isoformat(),
            "next_occurrence": chosen.isoformat(),
        },
    )
    assert response.status_code == 200
    rule = next(
        r
        for r in api_client.get("/api/recurring").json()["rules"]
        if r["id"] == rule_id
    )
    assert rule["next_occurrence"] == chosen.isoformat()


def test_recurring_rule_requires_a_name(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    payload = _rule_payload(category_id, date.today(), date.today())
    for name in (None, "", "   "):
        response = api_client.post(
            "/api/recurring", headers=csrf_headers, json={**payload, "name": name}
        )
        assert response.status_code == 422, name
    payload.pop("name")
    response = api_client.post("/api/recurring", headers=csrf_headers, json=payload)
    assert response.status_code == 422

    response = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={**payload, "name": "  Rent  "},
    )
    assert response.status_code == 200
    rule_id = response.json()["id"]
    response = api_client.put(
        f"/api/recurring/{rule_id}", headers=csrf_headers, json={**payload, "name": " "}
    )
    assert response.status_code == 422
    rules = api_client.get("/api/recurring").json()["rules"]
    assert [rule["name"] for rule in rules] == ["Rent"]


def test_recurring_rule_rejects_values_outside_schedule_range(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    payload = _rule_payload(category_id, date.today(), date.today())
    for changes in (
        {"interval_count": 1001},
        {"interval_count": 120000},
        {"amount_cents": 1_000_000_000_001},
        {"next_occurrence": "2200-01-01"},
        {"anchor_date": "1899-12-31"},
        {"end_date": "9999-12-31"},
    ):
        response = api_client.post(
            "/api/recurring", headers=csrf_headers, json={**payload, **changes}
        )
        assert response.status_code == 422, changes
    response = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={**payload, "interval_count": 1000, "interval_unit": "year"},
    )
    assert response.status_code == 200


def _catch_up(client: TestClient, headers: dict[str, str]) -> dict:
    response = client.post(
        "/api/auth/admin-elevation", headers=headers, json={"password": "pw-12345"}
    )
    assert response.status_code == 200
    response = client.post("/api/admin/recurring-catch-up", headers=headers)
    assert response.status_code == 200
    return response.json()


def _rule_transaction_dates(client: TestClient, rule_id: int) -> list[str]:
    response = client.get(f"/api/recurring/{rule_id}/occurrences")
    assert response.status_code == 200
    return sorted(row["occurrence_date"] for row in response.json()["occurrences"])


def test_switching_manual_rule_to_automatic_posts_no_past_occurrences(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    from expenses.recurrence.engine import local_today

    today = local_today()
    category_id = _create_category(api_client, csrf_headers, "Gym", "expense")
    start = today - timedelta(days=200)
    ids = []
    for _ in range(2):
        response = api_client.post(
            "/api/recurring",
            headers=csrf_headers,
            json={
                **_rule_payload(category_id, start, start),
                "interval_unit": "week",
                "auto_post": False,
            },
        )
        assert response.status_code == 200
        ids.append(int(response.json()["id"]))
    toggled_id, edited_id = ids

    response = api_client.post(
        f"/api/recurring/{toggled_id}/toggle",
        headers=csrf_headers,
        json={"auto_post": True},
    )
    assert response.status_code == 200
    response = api_client.put(
        f"/api/recurring/{edited_id}",
        headers=csrf_headers,
        json={
            **_rule_payload(category_id, start, start),
            "interval_unit": "week",
            "auto_post": True,
        },
    )
    assert response.status_code == 200

    _catch_up(api_client, csrf_headers)
    rules = {
        rule["id"]: rule for rule in api_client.get("/api/recurring").json()["rules"]
    }
    for rule_id in ids:
        next_occurrence = date.fromisoformat(rules[rule_id]["next_occurrence"])
        # Still on the weekly schedule from the start date.
        assert (next_occurrence - start).days % 7 == 0
        posted = _rule_transaction_dates(api_client, rule_id)
        assert all(day >= today.isoformat() for day in posted), posted
        assert len(posted) <= 1
        assert next_occurrence > today or (
            next_occurrence == today and posted == [today.isoformat()]
        )


def test_ended_rules_leave_recurring_totals_and_overdue_count(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    from expenses.recurrence.engine import local_today

    today = local_today()
    category_id = _create_category(api_client, csrf_headers, "Gym", "expense")
    ended_payload = {
        **_rule_payload(category_id, date(2025, 1, 15), date(2025, 1, 15)),
        "name": "Old gym",
        "amount_cents": 5000,
        "end_date": "2025-06-30",
    }
    manual_ended_payload = {**ended_payload, "name": "Old club", "auto_post": False}
    active_payload = {
        **_rule_payload(category_id, today, today + timedelta(days=3)),
        "name": "New gym",
        "amount_cents": 3000,
    }
    for payload in (ended_payload, manual_ended_payload, active_payload):
        response = api_client.post("/api/recurring", headers=csrf_headers, json=payload)
        assert response.status_code == 200

    assert _catch_up(api_client, csrf_headers)["overdue_rules"] == 0

    body = api_client.get("/api/recurring").json()
    assert {rule["name"] for rule in body["rules"]} == {
        "Old gym",
        "Old club",
        "New gym",
    }
    assert body["stats"]["total_monthly_expenses"] == 3000
    assert body["stats"]["rule_counts"] == {"income": 0, "expense": 1, "total": 1}
    assert body["stats"]["expense_breakdown"] == [
        {"name": "Gym", "amount_cents": 3000, "percent": 100.0}
    ]


def test_report_upcoming_recurring_leaves_out_ended_rules(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    from expenses.recurrence.engine import local_today
    from expenses.schemas import ReportOptions
    from expenses.services import ReportService

    today = local_today()
    category_id = _create_category(api_client, csrf_headers, "Gym", "expense")
    for payload in (
        {
            **_rule_payload(category_id, date(2025, 1, 15), date(2025, 1, 15)),
            "name": "Old gym",
            "end_date": "2025-06-30",
        },
        {
            **_rule_payload(category_id, today, today + timedelta(days=3)),
            "name": "New gym",
        },
    ):
        response = api_client.post("/api/recurring", headers=csrf_headers, json=payload)
        assert response.status_code == 200
    _catch_up(api_client, csrf_headers)

    user_id = int(api_client.get("/api/auth/me").json()["user"]["id"])
    data = ReportService(db_session, user_id).gather_data(
        ReportOptions(
            start=today - timedelta(days=30), end=today, sections=["recurring_upcoming"]
        )
    )
    assert [rule.name for rule in data["recurring_upcoming"]] == ["New gym"]


def test_unnamed_stored_rule_posts_and_its_transactions_stay_readable(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    from expenses.db.models import (
        CurrencyCode,
        IntervalUnit,
        MonthDayPolicy,
        RecurringRule,
        Transaction,
        TransactionType,
    )

    category_id = _create_category(api_client, csrf_headers, "Streaming", "expense")
    user_id = int(api_client.get("/api/auth/me").json()["user"]["id"])
    start = date.today() - timedelta(days=40)
    rule = RecurringRule(
        user_id=user_id,
        name=None,
        type=TransactionType.expense,
        currency_code=CurrencyCode.eur,
        amount_cents=999,
        category_id=category_id,
        anchor_date=start,
        interval_unit=IntervalUnit.month,
        interval_count=1,
        next_occurrence=start,
        auto_post=True,
        skip_weekends=False,
        month_day_policy=MonthDayPolicy.snap_to_end,
    )
    # A transaction an older server posted for an unnamed rule.
    legacy = Transaction(
        user_id=user_id,
        date=start - timedelta(days=30),
        occurred_at=datetime.combine(start - timedelta(days=30), datetime.min.time()),
        type=TransactionType.expense,
        amount_cents=999,
        category_id=category_id,
        title=None,
    )
    db_session.add_all([rule, legacy])
    db_session.commit()

    _catch_up(api_client, csrf_headers)
    posted = _rule_transaction_dates(api_client, rule.id)
    assert len(posted) >= 1

    rows = api_client.get(
        "/api/transactions", params={"period": "all", "category_id": category_id}
    ).json()["items"]
    titles = {row["id"]: row["title"] for row in rows}
    assert titles.pop(legacy.id) is None
    assert set(titles.values()) == {"Streaming"}

    response = api_client.get(f"/api/transactions/{legacy.id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Streaming"

    export = api_client.get("/api/transactions/export.csv", params={"period": "all"})
    assert export.status_code == 200
    lines = [line for line in export.text.splitlines()[1:] if line]
    assert lines and all(",Streaming,Streaming," in line for line in lines), lines


def test_unnamed_stored_rule_stays_editable_and_can_be_named(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    from expenses.db.models import (
        CurrencyCode,
        IntervalUnit,
        MonthDayPolicy,
        RecurringRule,
        TransactionType,
    )

    category_id = _create_category(api_client, csrf_headers, "Streaming", "expense")
    user_id = int(api_client.get("/api/auth/me").json()["user"]["id"])
    start = date.today() + timedelta(days=10)
    rule = RecurringRule(
        user_id=user_id,
        name=None,
        type=TransactionType.expense,
        currency_code=CurrencyCode.eur,
        amount_cents=999,
        category_id=category_id,
        anchor_date=start,
        interval_unit=IntervalUnit.month,
        interval_count=1,
        next_occurrence=start,
        auto_post=True,
        skip_weekends=False,
        month_day_policy=MonthDayPolicy.snap_to_end,
    )
    db_session.add(rule)
    db_session.commit()

    payload = _rule_payload(category_id, start, start)
    for name, amount in ((None, 1299), ("  ", 1399)):
        response = api_client.put(
            f"/api/recurring/{rule.id}",
            headers=csrf_headers,
            json={**payload, "name": name, "amount_cents": amount},
        )
        assert response.status_code == 200, response.text
        stored = next(
            r
            for r in api_client.get("/api/recurring").json()["rules"]
            if r["id"] == rule.id
        )
        assert (stored["name"], stored["amount_cents"]) == (None, amount)

    response = api_client.put(
        f"/api/recurring/{rule.id}",
        headers=csrf_headers,
        json={**payload, "name": " Music "},
    )
    assert response.status_code == 200
    response = api_client.put(
        f"/api/recurring/{rule.id}",
        headers=csrf_headers,
        json={**payload, "name": None},
    )
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "name"]
    rules = api_client.get("/api/recurring").json()["rules"]
    assert [r["name"] for r in rules if r["id"] == rule.id] == ["Music"]


def test_blank_name_on_create_points_at_the_name_field(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    response = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={**_rule_payload(category_id, date.today(), date.today()), "name": " "},
    )
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "name"]


def test_recurring_list_marks_ended_rules(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    from expenses.recurrence.engine import local_today

    today = local_today()
    category_id = _create_category(api_client, csrf_headers, "Gym", "expense")
    for payload in (
        {
            **_rule_payload(category_id, date(2025, 1, 15), date(2025, 1, 15)),
            "name": "Past end",
            "auto_post": False,
            "end_date": "2025-06-30",
        },
        {
            **_rule_payload(category_id, today, today + timedelta(days=40)),
            "name": "Beyond end",
            "end_date": (today + timedelta(days=30)).isoformat(),
        },
        {
            **_rule_payload(category_id, today, today + timedelta(days=3)),
            "name": "Running",
            "end_date": (today + timedelta(days=30)).isoformat(),
        },
        {
            **_rule_payload(category_id, today, today + timedelta(days=3)),
            "name": "Open",
        },
    ):
        response = api_client.post("/api/recurring", headers=csrf_headers, json=payload)
        assert response.status_code == 200

    rules = api_client.get("/api/recurring").json()["rules"]
    assert {rule["name"]: rule["ended"] for rule in rules} == {
        "Past end": True,
        "Beyond end": True,
        "Running": False,
        "Open": False,
    }
    rule_id = next(rule["id"] for rule in rules if rule["name"] == "Past end")
    body = api_client.get(f"/api/recurring/{rule_id}/occurrences").json()
    assert body["rule"]["ended"] is True
