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
    MonthlyRollup,
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
_SIDES = range(4)
# A few round amounts make full and overlapping allocations likely.
_cents = st.sampled_from([6_000, 10_000])
# Sides 0 and 1 start as expenses and sides 2 and 3 as reimbursements paying them back.
_ORIGINAL_ROLES = ["expense", "expense", "reimbursement", "reimbursement"]
_allocation = st.tuples(
    st.just("allocate"), st.sampled_from([2, 3]), st.sampled_from([0, 1]), _cents
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


def _type_locked(session, txn_id):
    """Whether an allocation ties this side to a live counterpart in its role.

    Such a side cannot change between expense and income.
    """
    session.expire_all()
    txn = session.get(Transaction, txn_id)
    for row in session.scalars(select(ReimbursementAllocation)):
        if txn.type == TransactionType.expense and row.expense_transaction_id == txn.id:
            other = session.get(Transaction, row.reimbursement_transaction_id)
            if other.deleted_at is None and other.is_reimbursement:
                return True
        if (
            txn.type == TransactionType.income
            and row.reimbursement_transaction_id == txn.id
        ):
            other = session.get(Transaction, row.expense_transaction_id)
            if other.deleted_at is None and other.type == TransactionType.expense:
                return True
    return False


def _overruns(session, ids, revived=None, changed=None, added=None):
    """Whether any side's counted allocations exceed its amount.

    An allocation counts as the rollups count it: both sides are live, the
    expense is an expense, and the reimbursement is reimbursement income.
    A revived side counts as live, a changed side, given as (id, role,
    amount), counts with that role and amount, and an added allocation, given
    as (reimbursement id, expense id, amount), counts in place of any stored
    one between the same pair.
    """
    session.expire_all()
    sides = {
        t.id: (t.type.value, t.is_reimbursement, t.amount_cents, t.deleted_at is None)
        for t in session.scalars(select(Transaction).where(Transaction.id.in_(ids)))
    }
    if revived is not None:
        sides[revived] = (*sides[revived][:3], True)
    if changed is not None:
        txn_id, role, amount = changed
        sides[txn_id] = (*_ROLES[role], amount, sides[txn_id][3])
    rows = [
        (
            row.reimbursement_transaction_id,
            row.expense_transaction_id,
            row.amount_cents,
        )
        for row in session.scalars(
            select(ReimbursementAllocation).where(
                ReimbursementAllocation.expense_transaction_id.in_(ids)
            )
        )
    ]
    if added is not None:
        # Allocating to the same pair again replaces the amount.
        rows = [row for row in rows if row[:2] != added[:2]] + [added]
    totals = defaultdict(int)
    for reimbursement_id, expense_id, amount in rows:
        expense = sides[expense_id]
        reimbursement = sides[reimbursement_id]
        if (
            expense[3]
            and reimbursement[3]
            and expense[0] == "expense"
            and reimbursement[:2] == ("income", True)
        ):
            totals[expense_id] += amount
            totals[reimbursement_id] += amount
    return any(total > sides[txn_id][2] for txn_id, total in totals.items())


def _expected_rows(step, response, before, ids, role_change, removed):
    """The stored allocations after a step, as (id, expense, reimbursement, amount).

    Allocating sets the pair's amount and unallocating removes the row. Other
    edits keep allocations or are refused, except that a reimbursement turned
    into plain income gives its allocations up.
    """
    if response.status_code != 200:
        return before
    match step:
        case ("allocate", r, e, amount):
            kept = {row for row in before if row[1:3] != (ids[e], ids[r])}
            return kept | {(response.json()["allocation_id"], ids[e], ids[r], amount)}
        case ("unallocate", _):
            return {row for row in before if row[0] != removed}
        case ("role", i, _) if role_change == ("reimbursement", "income"):
            return {row for row in before if row[2] != ids[i]}
    return before


def _june_rollup(session):
    session.expire_all()
    rollup = session.scalar(
        select(MonthlyRollup.expense_cents).where(
            MonthlyRollup.year == 2025, MonthlyRollup.month == 6
        )
    )
    return rollup or 0


def _june_spending(session, ids):
    """These transactions' June 2025 spending, recomputed from the stored rows.

    Live expenses count less what live reimbursements allocated to them.
    """
    session.expire_all()
    txns = {
        t.id: t
        for t in session.scalars(select(Transaction).where(Transaction.id.in_(ids)))
    }

    def counts(txn, kind, reimbursement):
        return (
            txn.deleted_at is None
            and txn.type.value == kind
            and txn.is_reimbursement == reimbursement
            and date(2025, 6, 1) <= txn.date <= date(2025, 6, 30)
        )

    total = sum(t.amount_cents for t in txns.values() if counts(t, "expense", False))
    for row in session.scalars(
        select(ReimbursementAllocation).where(
            ReimbursementAllocation.expense_transaction_id.in_(ids)
        )
    ):
        expense = txns[row.expense_transaction_id]
        reimbursement = txns[row.reimbursement_transaction_id]
        if counts(expense, "expense", False) and (
            reimbursement.deleted_at is None
            and reimbursement.type == TransactionType.income
            and reimbursement.is_reimbursement
        ):
            total -= row.amount_cents
    return total


# Restoring an expense after its reimbursement paid another one.
@example(
    amounts=[10_000, 10_000, 6_000, 6_000],
    steps=[
        ("allocate", 2, 0, 6_000),
        ("delete", 0),
        ("allocate", 2, 1, 6_000),
        ("restore", 0, "one"),
    ],
)
# Restoring a reimbursement after its expense was lowered.
@example(
    amounts=[10_000, 10_000, 8_000, 6_000],
    steps=[
        ("allocate", 2, 0, 8_000),
        ("delete", 2),
        ("amount", 0, 5_000),
        ("restore", 2, "bulk"),
    ],
)
# Switching an expense back after its reimbursement paid another one.
@example(
    amounts=[10_000, 10_000, 10_000, 6_000],
    steps=[
        ("allocate", 2, 0, 10_000),
        ("delete", 2),
        ("role", 0, "income"),
        ("restore", 2, "one"),
        ("allocate", 2, 1, 10_000),
        ("role", 0, "expense"),
    ],
)
# Restoring a reimbursement after another one paid the same expense.
@example(
    amounts=[10_000, 10_000, 6_000, 6_000],
    steps=[
        ("allocate", 2, 0, 6_000),
        ("delete", 2),
        ("allocate", 3, 0, 6_000),
        ("restore", 2, "one"),
    ],
)
@settings(
    max_examples=100,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
@given(amounts=st.lists(_cents, min_size=4, max_size=4), steps=_steps())
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

    earlier = _june_rollup(db_session)
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
                    ReimbursementAllocation.expense_transaction_id,
                    ReimbursementAllocation.reimbursement_transaction_id,
                    ReimbursementAllocation.amount_cents,
                ).where(ReimbursementAllocation.expense_transaction_id.in_(ids))
            )
        )

    for step in steps:
        before = stored_allocations()
        removed = None
        roles_before = list(roles)
        locked = step[0] == "role" and _type_locked(db_session, ids[step[1]])
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
                removed = allocations[n % len(allocations)]
                response = api_client.delete(
                    f"/api/reimbursements/allocations/{removed}",
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
        assert not _overruns(db_session, ids), step
        # Earlier examples' transactions stay as they were.
        assert _june_rollup(db_session) == earlier + _june_spending(db_session, ids)
        db_session.expire_all()
        for i in _SIDES:
            txn = db_session.get(Transaction, ids[i])
            assert (txn.type.value, txn.is_reimbursement, txn.amount_cents) == (
                *_ROLES[roles[i]],
                amounts[i],
            ), (step, i)

        match step:
            case ("allocate", r, e, amount):
                # Only live sides in their roles take an allocation, and it is
                # refused only when it would push a side past its amount.
                db_session.expire_all()
                eligible = (
                    db_session.get(Transaction, ids[r]).deleted_at is None
                    and db_session.get(Transaction, ids[e]).deleted_at is None
                    and (roles[r], roles[e]) == ("reimbursement", "expense")
                )
                if response.status_code == 200:
                    assert eligible, step
                else:
                    assert not eligible or _overruns(
                        db_session, ids, added=(ids[r], ids[e], amount)
                    ), (step, response.text)
        expected = _expected_rows(
            step,
            response,
            before,
            ids,
            (roles_before[step[1]], roles[step[1]]) if step[0] == "role" else None,
            removed,
        )
        assert stored_allocations() == expected, step
        if step[0] == "unallocate":
            # A stored allocation can always be removed.
            stored = any(row[0] == removed for row in before)
            assert (response.status_code == 200) == stored, (step, response.text)
        if step[0] in ("allocate", "unallocate"):
            continue

        # A refusal must have a reason: the step would push a side past its
        # amount, change the type of a side with counted allocations, or edit
        # a side in Trash. Changing such a side's type is always refused.
        index = step[1]
        refused = response.status_code != 200
        db_session.expire_all()
        in_trash = db_session.get(Transaction, ids[index]).deleted_at is not None
        match step:
            case ("restore", _, _) if in_trash:
                assert refused, (step, response.text)
                assert _overruns(db_session, ids, revived=ids[index]), step
            case ("amount", _, amount) if refused and not in_trash:
                assert _overruns(
                    db_session, ids, changed=(ids[index], roles[index], amount)
                ), (step, response.text)
            case ("role", _, role) if not in_trash:
                kinds = (_ROLES[roles_before[index]][0], _ROLES[role][0])
                switches_locked_type = kinds[0] != kinds[1] and locked
                assert refused or not switches_locked_type, step
                assert (
                    not refused
                    or switches_locked_type
                    or _overruns(
                        db_session, ids, changed=(ids[index], role, amounts[index])
                    )
                ), (step, response.text)
