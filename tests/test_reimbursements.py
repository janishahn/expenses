from datetime import date, datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import pytest

from expenses.db.session import Base
from expenses.db.models import Category, TransactionType
from expenses.core.periods import Period
from expenses.schemas import TransactionIn
from expenses.services import (
    BudgetService,
    InsightsService,
    MetricsService,
    ReimbursementService,
    TransactionService,
)


def make_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    return SessionLocal()


def test_reimbursement_applies_to_original_expense_period() -> None:
    session = make_session()
    income = Category(name="Income", type=TransactionType.income, order=0)
    expense = Category(name="Food", type=TransactionType.expense, order=0)
    session.add_all([income, expense])
    session.commit()
    session.refresh(income)
    session.refresh(expense)

    txns = TransactionService(session)
    reimb = ReimbursementService(session)

    dinner = txns.create(
        TransactionIn(
            date=date(2025, 1, 10),
            occurred_at=datetime(2025, 1, 10, 20, 0),
            type=TransactionType.expense,
            amount_cents=10_000,
            category_id=expense.id,
            title="Dinner for group",
        )
    )

    payback = txns.create(
        TransactionIn(
            date=date(2025, 2, 5),
            occurred_at=datetime(2025, 2, 5, 12, 0),
            type=TransactionType.income,
            is_reimbursement=True,
            amount_cents=6_000,
            category_id=income.id,
            title="Payback",
        )
    )
    reimb.upsert_allocation(payback.id, dinner.id, 6_000)

    jan = MetricsService(session).kpis(
        Period("jan", date(2025, 1, 1), date(2025, 1, 31))
    )
    assert jan["income"] == 0
    assert jan["expenses"] == 4_000

    feb = MetricsService(session).kpis(
        Period("feb", date(2025, 2, 1), date(2025, 2, 28))
    )
    assert feb["income"] == 0
    assert feb["expenses"] == 0


def test_budgets_use_net_expense() -> None:
    session = make_session()
    income = Category(name="Income", type=TransactionType.income, order=0)
    expense = Category(name="Travel", type=TransactionType.expense, order=0)
    session.add_all([income, expense])
    session.commit()
    session.refresh(income)
    session.refresh(expense)

    txns = TransactionService(session)
    reimb = ReimbursementService(session)

    booking = txns.create(
        TransactionIn(
            date=date(2025, 3, 3),
            occurred_at=datetime(2025, 3, 3, 9, 0),
            type=TransactionType.expense,
            amount_cents=20_000,
            category_id=expense.id,
            title="Hotel booking",
        )
    )
    payback = txns.create(
        TransactionIn(
            date=date(2025, 3, 10),
            occurred_at=datetime(2025, 3, 10, 10, 0),
            type=TransactionType.income,
            is_reimbursement=True,
            amount_cents=5_000,
            category_id=income.id,
            title="Hotel share",
        )
    )
    reimb.upsert_allocation(payback.id, booking.id, 5_000)

    spent = BudgetService(session).spent_by_category_for_month(2025, 3)
    assert spent[expense.id] == 15_000
    assert spent[None] == 15_000


def test_deleting_reimbursement_removes_netting() -> None:
    session = make_session()
    income = Category(name="Income", type=TransactionType.income, order=0)
    expense = Category(name="Food", type=TransactionType.expense, order=0)
    session.add_all([income, expense])
    session.commit()
    session.refresh(income)
    session.refresh(expense)

    txns = TransactionService(session)
    reimb = ReimbursementService(session)

    meal = txns.create(
        TransactionIn(
            date=date(2025, 4, 2),
            occurred_at=datetime(2025, 4, 2, 19, 0),
            type=TransactionType.expense,
            amount_cents=8_000,
            category_id=expense.id,
            title="Meal",
        )
    )
    payback = txns.create(
        TransactionIn(
            date=date(2025, 5, 1),
            occurred_at=datetime(2025, 5, 1, 9, 0),
            type=TransactionType.income,
            is_reimbursement=True,
            amount_cents=3_000,
            category_id=income.id,
            title="Payback",
        )
    )
    reimb.upsert_allocation(payback.id, meal.id, 3_000)

    april = MetricsService(session).kpis(
        Period("april", date(2025, 4, 1), date(2025, 4, 30))
    )
    assert april["expenses"] == 5_000

    txns.soft_delete(payback.id)
    april_after = MetricsService(session).kpis(
        Period("april", date(2025, 4, 1), date(2025, 4, 30))
    )
    assert april_after["expenses"] == 8_000


def test_deleting_expense_frees_reimbursement_amount() -> None:
    session = make_session()
    income = Category(name="Income", type=TransactionType.income, order=0)
    expense = Category(name="Food", type=TransactionType.expense, order=0)
    session.add_all([income, expense])
    session.commit()
    session.refresh(income)
    session.refresh(expense)

    txns = TransactionService(session)
    reimb = ReimbursementService(session)

    first = txns.create(
        TransactionIn(
            date=date(2025, 6, 1),
            occurred_at=datetime(2025, 6, 1, 12, 0),
            type=TransactionType.expense,
            amount_cents=10_000,
            category_id=expense.id,
            title="First expense",
        )
    )
    second = txns.create(
        TransactionIn(
            date=date(2025, 6, 2),
            occurred_at=datetime(2025, 6, 2, 12, 0),
            type=TransactionType.expense,
            amount_cents=10_000,
            category_id=expense.id,
            title="Second expense",
        )
    )
    payback = txns.create(
        TransactionIn(
            date=date(2025, 6, 3),
            occurred_at=datetime(2025, 6, 3, 12, 0),
            type=TransactionType.income,
            is_reimbursement=True,
            amount_cents=6_000,
            category_id=income.id,
            title="Payback",
        )
    )

    reimb.upsert_allocation(payback.id, first.id, 6_000)
    assert reimb.allocated_total_for_reimbursement(payback.id) == 6_000

    txns.soft_delete(first.id)
    assert reimb.allocated_total_for_reimbursement(payback.id) == 0

    reimb.upsert_allocation(payback.id, second.id, 6_000)
    assert reimb.allocated_total_for_reimbursement(payback.id) == 6_000


def test_failed_type_conversion_with_uncategorized_does_not_create_category() -> None:
    session = make_session()
    income = Category(name="Income", type=TransactionType.income, order=0)
    expense = Category(name="Food", type=TransactionType.expense, order=0)
    session.add_all([income, expense])
    session.commit()
    session.refresh(income)
    session.refresh(expense)

    txns = TransactionService(session)
    reimb = ReimbursementService(session)

    dinner = txns.create(
        TransactionIn(
            date=date(2025, 1, 10),
            occurred_at=datetime(2025, 1, 10, 20, 0),
            type=TransactionType.expense,
            amount_cents=10_000,
            category_id=expense.id,
            title="Dinner for group",
        )
    )
    payback = txns.create(
        TransactionIn(
            date=date(2025, 2, 5),
            occurred_at=datetime(2025, 2, 5, 12, 0),
            type=TransactionType.income,
            is_reimbursement=True,
            amount_cents=6_000,
            category_id=income.id,
            title="Payback",
        )
    )
    reimb.upsert_allocation(payback.id, dinner.id, 6_000)

    with pytest.raises(
        ValueError,
        match="Cannot convert reimbursed expense to income; remove allocations first",
    ):
        txns.update(
            dinner.id,
            TransactionIn(
                date=date(2025, 1, 10),
                occurred_at=datetime(2025, 1, 10, 20, 0),
                type=TransactionType.income,
                is_reimbursement=False,
                amount_cents=10_000,
                category_id=None,
                title="Dinner for group",
            ),
        )

    uncategorized_income = session.scalar(
        select(Category).where(
            Category.type == TransactionType.income,
            Category.name == "Uncategorized",
        )
    )

    assert uncategorized_income is None
    assert txns.get(dinner.id).type == TransactionType.expense


def test_top_tags_use_net_expense() -> None:
    session = make_session()
    income = Category(name="Income", type=TransactionType.income, order=0)
    food = Category(name="Food", type=TransactionType.expense, order=0)
    session.add_all([income, food])
    session.commit()
    session.refresh(income)
    session.refresh(food)

    txns = TransactionService(session)
    reimb = ReimbursementService(session)

    dinner = txns.create(
        TransactionIn(
            date=date(2025, 7, 1),
            occurred_at=datetime(2025, 7, 1, 20, 0),
            type=TransactionType.expense,
            amount_cents=20_000,
            category_id=food.id,
            title="Dinner",
            tags=["group"],
        )
    )
    payback = txns.create(
        TransactionIn(
            date=date(2025, 7, 2),
            occurred_at=datetime(2025, 7, 2, 10, 0),
            type=TransactionType.income,
            is_reimbursement=True,
            amount_cents=10_000,
            category_id=income.id,
            title="Payback",
        )
    )
    reimb.upsert_allocation(payback.id, dinner.id, 10_000)

    july = Period("july", date(2025, 7, 1), date(2025, 7, 31))
    top = InsightsService(session).top_tags(
        july, transaction_type=TransactionType.expense
    )
    assert top
    assert top[0]["name"] == "group"
    assert top[0]["amount_cents"] == 10_000


def _api_txn(client, headers, *, title, cents, on, kind="expense", reimb=False):
    response = client.post(
        "/api/transactions",
        headers=headers,
        json={
            "date": on.isoformat(),
            "occurred_at": f"{on.isoformat()}T12:00:00",
            "type": kind,
            "amount_cents": cents,
            "title": title,
            "is_reimbursement": reimb,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _api_edit(client, headers, transaction_id, *, title, cents, on, kind="expense"):
    return client.put(
        f"/api/transactions/{transaction_id}",
        headers=headers,
        json={
            "date": on.isoformat(),
            "occurred_at": f"{on.isoformat()}T12:00:00",
            "type": kind,
            "amount_cents": cents,
            "title": title,
        },
    )


def _allocate(client, headers, reimbursement_id, expense_id, cents):
    response = client.post(
        f"/api/reimbursements/{reimbursement_id}/allocations",
        headers=headers,
        json={"expense_transaction_id": expense_id, "amount_cents": cents},
    )
    assert response.status_code == 200, response.text
    return response.json()["allocation_id"]


def test_restoring_an_expense_cannot_overallocate_its_reimbursement(
    api_client, csrf_headers
) -> None:
    june = date(2025, 6, 1)
    first = _api_txn(api_client, csrf_headers, title="First", cents=10_000, on=june)
    second = _api_txn(api_client, csrf_headers, title="Second", cents=10_000, on=june)
    payback = _api_txn(
        api_client,
        csrf_headers,
        title="Payback",
        cents=6_000,
        on=june,
        kind="income",
        reimb=True,
    )
    _allocate(api_client, csrf_headers, payback, first, 6_000)
    api_client.delete(f"/api/transactions/{first}", headers=csrf_headers)
    to_second = _allocate(api_client, csrf_headers, payback, second, 6_000)

    single = api_client.post(f"/api/transactions/{first}/restore", headers=csrf_headers)
    many = api_client.post(
        "/api/transactions/deleted/restore",
        headers=csrf_headers,
        json={"ids": [first]},
    )
    bulk = api_client.post(
        "/api/transactions/bulk/apply",
        headers=csrf_headers,
        json={
            "selection": {"mode": "ids", "transaction_ids": [first]},
            "operation": {"lifecycle": "restore"},
        },
    )

    for response in (single, many, bulk):
        assert response.status_code == 409
        assert '"Payback"' in response.json()["detail"]
        assert "120,00 €" in response.json()["detail"]
    kpis = api_client.get(
        "/api/dashboard?period=custom&start=2025-06-01&end=2025-06-30"
    ).json()["kpis"]
    assert kpis["expenses"] == 4_000

    # Doing what the message asks lets the restore through.
    api_client.delete(
        f"/api/reimbursements/allocations/{to_second}", headers=csrf_headers
    )
    restored = api_client.post(
        f"/api/transactions/{first}/restore", headers=csrf_headers
    )
    assert restored.status_code == 200


def test_bulk_restore_is_all_or_nothing(api_client, csrf_headers) -> None:
    june = date(2025, 6, 1)
    first = _api_txn(api_client, csrf_headers, title="First", cents=10_000, on=june)
    second = _api_txn(api_client, csrf_headers, title="Second", cents=10_000, on=june)
    other = _api_txn(api_client, csrf_headers, title="Other", cents=500, on=june)
    payback = _api_txn(
        api_client,
        csrf_headers,
        title="Payback",
        cents=6_000,
        on=june,
        kind="income",
        reimb=True,
    )
    _allocate(api_client, csrf_headers, payback, first, 6_000)
    api_client.delete(f"/api/transactions/{first}", headers=csrf_headers)
    api_client.delete(f"/api/transactions/{other}", headers=csrf_headers)
    _allocate(api_client, csrf_headers, payback, second, 6_000)

    response = api_client.post(
        "/api/transactions/deleted/restore",
        headers=csrf_headers,
        json={"ids": [other, first]},
    )

    assert response.status_code == 409
    assert api_client.get(f"/api/transactions/{other}").status_code == 404


def test_restoring_a_reimbursement_cannot_reimburse_an_expense_past_its_amount(
    api_client, csrf_headers
) -> None:
    sept = date(2025, 9, 1)
    expense = _api_txn(api_client, csrf_headers, title="Shop", cents=10_000, on=sept)
    payback = _api_txn(
        api_client,
        csrf_headers,
        title="Payback",
        cents=8_000,
        on=sept,
        kind="income",
        reimb=True,
    )
    _allocate(api_client, csrf_headers, payback, expense, 8_000)
    api_client.delete(f"/api/transactions/{payback}", headers=csrf_headers)
    lowered = _api_edit(
        api_client, csrf_headers, expense, title="Shop", cents=5_000, on=sept
    )
    assert lowered.status_code == 200, lowered.text

    response = api_client.post(
        f"/api/transactions/{payback}/restore", headers=csrf_headers
    )

    assert response.status_code == 409
    assert '"Shop"' in response.json()["detail"]
    assert api_client.get(f"/api/transactions/{payback}").status_code == 404


def test_allocations_with_a_trashed_side_do_not_block_edits(
    api_client, csrf_headers
) -> None:
    july = date(2025, 7, 1)
    hotel = _api_txn(api_client, csrf_headers, title="Hotel", cents=10_000, on=july)
    old = _api_txn(
        api_client,
        csrf_headers,
        title="Old payback",
        cents=10_000,
        on=july,
        kind="income",
        reimb=True,
    )
    new = _api_txn(
        api_client,
        csrf_headers,
        title="New payback",
        cents=10_000,
        on=july,
        kind="income",
        reimb=True,
    )
    _allocate(api_client, csrf_headers, old, hotel, 10_000)
    api_client.delete(f"/api/transactions/{old}", headers=csrf_headers)

    _allocate(api_client, csrf_headers, new, hotel, 4_000)
    assert (
        _api_edit(
            api_client, csrf_headers, hotel, title="Hotel", cents=6_000, on=july
        ).status_code
        == 200
    )

    # A trashed expense's allocation does not block the reimbursement either.
    taxi = _api_txn(api_client, csrf_headers, title="Taxi", cents=3_000, on=july)
    refund = _api_txn(
        api_client,
        csrf_headers,
        title="Refund",
        cents=3_000,
        on=july,
        kind="income",
        reimb=True,
    )
    _allocate(api_client, csrf_headers, refund, taxi, 3_000)
    api_client.delete(f"/api/transactions/{taxi}", headers=csrf_headers)
    switched = _api_edit(
        api_client, csrf_headers, refund, title="Refund", cents=1_000, on=july
    )
    assert switched.status_code == 200, switched.text


def test_a_type_switch_cannot_revive_an_allocation_past_the_other_side(
    api_client, csrf_headers
) -> None:
    july = date(2025, 7, 1)
    hotel = _api_txn(api_client, csrf_headers, title="Hotel", cents=10_000, on=july)
    hostel = _api_txn(api_client, csrf_headers, title="Hostel", cents=10_000, on=july)
    payback = _api_txn(
        api_client,
        csrf_headers,
        title="Payback",
        cents=10_000,
        on=july,
        kind="income",
        reimb=True,
    )
    _allocate(api_client, csrf_headers, payback, hotel, 10_000)
    api_client.delete(f"/api/transactions/{payback}", headers=csrf_headers)
    to_income = _api_edit(
        api_client,
        csrf_headers,
        hotel,
        title="Hotel",
        cents=10_000,
        on=july,
        kind="income",
    )
    assert to_income.status_code == 200, to_income.text
    restore = api_client.post(
        f"/api/transactions/{payback}/restore", headers=csrf_headers
    )
    assert restore.status_code == 200, restore.text
    _allocate(api_client, csrf_headers, payback, hostel, 10_000)

    back = _api_edit(
        api_client, csrf_headers, hotel, title="Hotel", cents=10_000, on=july
    )

    assert back.status_code == 400
    assert '"Payback"' in back.json()["detail"]
