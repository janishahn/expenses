from collections import defaultdict
from datetime import date, datetime

import pytest
from hypothesis import HealthCheck, example, given, settings
from hypothesis import strategies as st
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from expenses.core.periods import Period
from expenses.db.models import (
    Category,
    ReimbursementAllocation,
    Transaction,
    TransactionType,
)
from expenses.db.session import Base
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


_ROLES = {
    "expense": ("expense", False),
    "reimbursement": ("income", True),
    "income": ("income", False),
}
_SIDES = range(3)
# A few round amounts make full and overlapping allocations likely.
_cents = st.sampled_from([6_000, 10_000])
# Sides 0 and 1 start as expenses and side 2 as the reimbursement paying them back.
_ORIGINAL_ROLES = ["expense", "expense", "reimbursement"]
_allocation = st.tuples(
    st.just("allocate"), st.just(2), st.sampled_from([0, 1]), _cents
)
_change = st.one_of(
    _allocation,
    st.tuples(st.just("unallocate"), st.integers(0, 2)),
    st.tuples(st.just("amount"), st.sampled_from(_SIDES), _cents),
    st.tuples(st.just("delete"), st.sampled_from(_SIDES)),
    st.tuples(st.just("restore"), st.sampled_from(_SIDES), st.just("one")),
    st.tuples(
        st.just("role"), st.sampled_from(_SIDES), st.sampled_from(sorted(_ROLES))
    ),
)


@st.composite
def _steps(draw):
    """Allocations, then one side leaves and comes back while the others change.

    While a side is in Trash or has another role its allocations do not count,
    so the other sides can be allocated or edited past what fits on its return.
    """
    out = draw(st.sampled_from(_SIDES))
    leave, back = draw(
        st.sampled_from(
            [
                (("delete", out), ("restore", out, "one")),
                (("delete", out), ("restore", out, "many")),
                (("delete", out), ("restore", out, "bulk")),
                (("role", out, "income"), ("role", out, _ORIGINAL_ROLES[out])),
            ]
        )
    )
    return [
        *draw(st.lists(_allocation, min_size=1, max_size=2)),
        leave,
        *draw(st.lists(_change, min_size=1, max_size=4)),
        back,
    ]


def _counted_totals(session, ids, revived=None):
    """Allocated cents per side, counting an allocation as the rollups do.

    It counts when both sides are live, the expense is an expense, and the
    reimbursement is reimbursement income. A revived side counts as live.
    """
    session.expire_all()
    txns = {
        t.id: t
        for t in session.scalars(select(Transaction).where(Transaction.id.in_(ids)))
    }

    def live(txn):
        return txn.deleted_at is None or txn.id == revived

    totals = defaultdict(int)
    for row in session.scalars(
        select(ReimbursementAllocation).where(
            ReimbursementAllocation.expense_transaction_id.in_(ids)
        )
    ):
        expense = txns[row.expense_transaction_id]
        reimbursement = txns[row.reimbursement_transaction_id]
        if (
            live(expense)
            and live(reimbursement)
            and expense.type == TransactionType.expense
            and reimbursement.type == TransactionType.income
            and reimbursement.is_reimbursement
        ):
            totals[expense.id] += row.amount_cents
            totals[reimbursement.id] += row.amount_cents
    return txns, totals


# Restoring an expense after its reimbursement paid another one.
@example(
    amounts=[10_000, 10_000, 6_000],
    steps=[
        ("allocate", 2, 0, 6_000),
        ("delete", 0),
        ("allocate", 2, 1, 6_000),
        ("restore", 0, "one"),
    ],
)
# Restoring a reimbursement after its expense was lowered.
@example(
    amounts=[10_000, 10_000, 8_000],
    steps=[
        ("allocate", 2, 0, 8_000),
        ("delete", 2),
        ("amount", 0, 5_000),
        ("restore", 2, "bulk"),
    ],
)
# Switching an expense back after its reimbursement paid another one.
@example(
    amounts=[10_000, 10_000, 10_000],
    steps=[
        ("allocate", 2, 0, 10_000),
        ("delete", 2),
        ("role", 0, "income"),
        ("restore", 2, "one"),
        ("allocate", 2, 1, 10_000),
        ("role", 0, "expense"),
    ],
)
@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(amounts=st.lists(_cents, min_size=3, max_size=3), steps=_steps())
def test_allocations_never_exceed_either_side(
    api_client, csrf_headers, db_session, amounts, steps
) -> None:
    roles = list(_ORIGINAL_ROLES)

    def body(index):
        kind, reimbursement = _ROLES[roles[index]]
        return {
            "date": "2025-06-01",
            "occurred_at": "2025-06-01T12:00:00",
            "type": kind,
            "is_reimbursement": reimbursement,
            "amount_cents": amounts[index],
            "title": f"Side {index}",
        }

    ids = []
    for index in _SIDES:
        response = api_client.post(
            "/api/transactions", headers=csrf_headers, json=body(index)
        )
        assert response.status_code == 200, response.text
        ids.append(response.json()["id"])
    allocations: list[int] = []

    def stored_allocations():
        db_session.expire_all()
        return set(
            db_session.execute(
                select(
                    ReimbursementAllocation.id,
                    ReimbursementAllocation.reimbursement_transaction_id,
                    ReimbursementAllocation.amount_cents,
                ).where(ReimbursementAllocation.expense_transaction_id.in_(ids))
            )
        )

    for step in steps:
        before = stored_allocations()
        roles_before = list(roles)
        match step:
            case ("allocate", r, e, amount):
                response = api_client.post(
                    f"/api/reimbursements/{ids[r]}/allocations",
                    headers=csrf_headers,
                    json={"expense_transaction_id": ids[e], "amount_cents": amount},
                )
                if response.status_code == 200:
                    allocations.append(response.json()["allocation_id"])
            case ("unallocate", n):
                if not allocations:
                    continue
                response = api_client.delete(
                    f"/api/reimbursements/allocations/{allocations[n % len(allocations)]}",
                    headers=csrf_headers,
                )
            case ("delete", i):
                response = api_client.delete(
                    f"/api/transactions/{ids[i]}", headers=csrf_headers
                )
            case ("restore", i, "one"):
                response = api_client.post(
                    f"/api/transactions/{ids[i]}/restore", headers=csrf_headers
                )
            case ("restore", i, "many"):
                response = api_client.post(
                    "/api/transactions/deleted/restore",
                    headers=csrf_headers,
                    json={"ids": [ids[i]]},
                )
            case ("restore", i, "bulk"):
                response = api_client.post(
                    "/api/transactions/bulk/apply",
                    headers=csrf_headers,
                    json={
                        "selection": {"mode": "ids", "transaction_ids": [ids[i]]},
                        "operation": {"lifecycle": "restore"},
                    },
                )
            case ("amount", i, amount):
                previous = amounts[i]
                amounts[i] = amount
                response = api_client.put(
                    f"/api/transactions/{ids[i]}", headers=csrf_headers, json=body(i)
                )
                if response.status_code != 200:
                    amounts[i] = previous
            case ("role", i, role):
                previous = roles[i]
                roles[i] = role
                response = api_client.put(
                    f"/api/transactions/{ids[i]}", headers=csrf_headers, json=body(i)
                )
                if response.status_code != 200:
                    roles[i] = previous
        assert response.status_code < 500, (step, response.text)

        txns, totals = _counted_totals(db_session, ids)
        for txn_id, total in totals.items():
            assert total <= txns[txn_id].amount_cents, (step, txn_id, total)
        if step[0] not in ("allocate", "unallocate"):
            # Other edits keep allocations or are refused, except that a
            # reimbursement turned into plain income gives its allocations up.
            expected = before
            if step[0] == "role" and (roles_before[step[1]], roles[step[1]]) == (
                "reimbursement",
                "income",
            ):
                expected = {row for row in before if row[1] != ids[step[1]]}
            assert stored_allocations() == expected, step
        if step[0] == "restore" and txns[ids[step[1]]].deleted_at is not None:
            # A restore is refused only when the side would not fit.
            txns, revived = _counted_totals(db_session, ids, revived=ids[step[1]])
            assert any(
                total > txns[txn_id].amount_cents for txn_id, total in revived.items()
            ), (step, response.text)
