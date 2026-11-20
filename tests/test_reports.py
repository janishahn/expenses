from datetime import date, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from expenses.db.models import (
    BalanceAnchor,
    Category,
    CurrencyCode,
    IntervalUnit,
    RecurringRule,
    TransactionType,
)
from expenses.db.session import Base, _enable_sqlite_pragmas
from expenses.reports.pdf_renderer import render_report_html
from expenses.schemas import ReportOptions, TransactionIn
from expenses.services import (
    BalanceAnchorService,
    ReimbursementService,
    ReportService,
    TagService,
    TransactionService,
)


def make_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    event.listen(engine, "connect", _enable_sqlite_pragmas)
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    return session_local()


def test_report_tag_scope_filters_every_transaction_derived_section() -> None:
    session = make_session()
    category = Category(
        user_id=1, name="Travel expenses", type=TransactionType.expense, order=0
    )
    session.add(category)
    session.commit()
    session.refresh(category)

    vacation_tag = TagService(session).create("Vacation")
    transactions = TransactionService(session)
    transactions.create(
        TransactionIn(
            date=date(2026, 8, 10),
            occurred_at=datetime(2026, 8, 10, 12, 0),
            type=TransactionType.expense,
            amount_cents=5_000,
            category_id=category.id,
            title="Vacation hotel",
            tags=[vacation_tag.name],
        )
    )
    transactions.create(
        TransactionIn(
            date=date(2026, 8, 11),
            occurred_at=datetime(2026, 8, 11, 12, 0),
            type=TransactionType.expense,
            amount_cents=3_000,
            category_id=category.id,
            title="Regular groceries",
        )
    )

    common_options = {
        "start": date(2026, 8, 1),
        "end": date(2026, 8, 31),
        "sections": ["summary", "category_breakdown", "trend", "recent_transactions"],
    }

    included = ReportService(session).gather_data(
        ReportOptions(**common_options, tag_ids=[vacation_tag.id])
    )
    assert included["summary"]["total_expenses"] == 5_000
    assert included["summary"]["closing_balance"] is None
    assert included["category_breakdown"][0]["amount_cents"] == 5_000
    assert included["trend"] == [{"date": date(2026, 8, 10), "amount_cents": 5_000}]
    assert [txn.title for txn in included["recent_transactions"]] == ["Vacation hotel"]

    excluded = ReportService(session).gather_data(
        ReportOptions(**common_options, excluded_tag_ids=[vacation_tag.id])
    )
    assert excluded["summary"]["total_expenses"] == 3_000
    assert excluded["summary"]["closing_balance"] is None
    assert excluded["category_breakdown"][0]["amount_cents"] == 3_000
    assert excluded["trend"] == [{"date": date(2026, 8, 11), "amount_cents": 3_000}]
    assert [txn.title for txn in excluded["recent_transactions"]] == [
        "Regular groceries"
    ]


def test_report_rejects_simultaneous_include_and_exclude_tag_scopes() -> None:
    with pytest.raises(ValidationError, match="cannot include and exclude"):
        ReportOptions(
            start=date(2026, 8, 1),
            end=date(2026, 8, 31),
            tag_ids=[1],
            excluded_tag_ids=[2],
        )


def test_tag_scoped_report_uses_net_reimbursed_amount_everywhere() -> None:
    session = make_session()
    expense_category = Category(
        user_id=1, name="Travel", type=TransactionType.expense, order=0
    )
    income_category = Category(
        user_id=1, name="Income", type=TransactionType.income, order=0
    )
    session.add_all([expense_category, income_category])
    session.commit()
    tag = TagService(session).create("Vacation")
    transactions = TransactionService(session)
    expense = transactions.create(
        TransactionIn(
            date=date(2026, 8, 10),
            occurred_at=datetime(2026, 8, 10, 12),
            type=TransactionType.expense,
            amount_cents=10_000,
            category_id=expense_category.id,
            title="Vacation hotel",
            tags=[tag.name],
        )
    )
    reimbursement = transactions.create(
        TransactionIn(
            date=date(2026, 8, 11),
            occurred_at=datetime(2026, 8, 11, 12),
            type=TransactionType.income,
            is_reimbursement=True,
            amount_cents=4_000,
            category_id=income_category.id,
            title="Hotel share",
        )
    )
    ReimbursementService(session).upsert_allocation(reimbursement.id, expense.id, 4_000)

    data = ReportService(session).gather_data(
        ReportOptions(
            start=date(2026, 8, 1),
            end=date(2026, 8, 31),
            sections=["summary", "recent_transactions", "category_breakdown"],
            tag_ids=[tag.id],
            show_running_balance=True,
            include_category_subtotals=True,
        )
    )

    rows = data["recent_transactions"]
    assert data["summary"]["total_expenses"] == 6_000
    assert data["category_breakdown"][0]["amount_cents"] == 6_000
    assert [row.title for row in rows] == ["Vacation hotel"]
    assert rows[0].report_amount_cents == 6_000
    assert rows[0].running_balance_cents == -6_000
    assert data["category_subtotals"][0]["amount_cents"] == 6_000


def test_scoped_report_opening_balance_counts_reimbursements_once() -> None:
    session = make_session()
    expense_category = Category(
        user_id=1, name="Travel", type=TransactionType.expense, order=0
    )
    income_category = Category(
        user_id=1, name="Income", type=TransactionType.income, order=0
    )
    session.add_all([expense_category, income_category])
    session.commit()
    tag = TagService(session).create("Trip")
    transactions = TransactionService(session)
    expense = transactions.create(
        TransactionIn(
            date=date(2026, 7, 10),
            occurred_at=datetime(2026, 7, 10, 12),
            type=TransactionType.expense,
            amount_cents=10_000,
            category_id=expense_category.id,
            title="Taxi",
            tags=[tag.name],
        )
    )
    reimbursement = transactions.create(
        TransactionIn(
            date=date(2026, 7, 11),
            occurred_at=datetime(2026, 7, 11, 12),
            type=TransactionType.income,
            is_reimbursement=True,
            amount_cents=10_000,
            category_id=income_category.id,
            title="Taxi refund",
            tags=[tag.name],
        )
    )
    ReimbursementService(session).upsert_allocation(
        reimbursement.id, expense.id, 10_000
    )

    for scope in ({"tag_ids": [tag.id]}, {"transaction_type": "income"}):
        data = ReportService(session).gather_data(
            ReportOptions(
                start=date(2026, 8, 1),
                end=date(2026, 8, 31),
                sections=["recent_transactions"],
                show_running_balance=True,
                **scope,
            )
        )
        # The refund only cancels the taxi; nothing was gained before August.
        assert data["opening_balance_cents"] == 0


def test_report_running_balance_does_not_reapply_a_transaction_at_a_snapshot() -> None:
    session = make_session()
    category = Category(user_id=1, name="Food", type=TransactionType.expense, order=0)
    session.add(category)
    session.commit()
    transactions = TransactionService(session)
    for title, at in (
        ("Lunch", datetime(2026, 8, 5, 12)),
        ("Coffee", datetime(2026, 8, 5, 12)),
        ("Dinner", datetime(2026, 8, 6, 19)),
    ):
        transactions.create(
            TransactionIn(
                date=at.date(),
                occurred_at=at,
                type=TransactionType.expense,
                amount_cents=2_000,
                category_id=category.id,
                title=title,
            )
        )
    session.add(
        BalanceAnchor(
            user_id=1, as_of_at=datetime(2026, 8, 5, 12), balance_cents=50_000
        )
    )
    session.commit()

    data = ReportService(session).gather_data(
        ReportOptions(
            start=date(2026, 8, 1),
            end=date(2026, 8, 31),
            sections=["summary", "recent_transactions"],
            show_running_balance=True,
        )
    )

    rows = data["recent_transactions"]
    balances = BalanceAnchorService(session)
    assert [row.running_balance_cents for row in rows] == [50_000, 50_000, 48_000]
    assert rows[1].running_balance_cents == balances.balance_as_of(
        datetime(2026, 8, 5, 12)
    )
    assert rows[-1].running_balance_cents == data["summary"]["closing_balance"]


def test_report_category_breakdown_lists_every_category() -> None:
    session = make_session()
    categories = [
        Category(user_id=1, name=f"C{index}", type=TransactionType.expense, order=0)
        for index in range(10)
    ]
    session.add_all(categories)
    session.commit()
    transactions = TransactionService(session)
    for index, category in enumerate(categories):
        transactions.create(
            TransactionIn(
                date=date(2026, 8, 5),
                occurred_at=datetime(2026, 8, 5, 12),
                type=TransactionType.expense,
                amount_cents=1_000 * (10 - index),
                category_id=category.id,
                title=category.name,
            )
        )

    data = ReportService(session).gather_data(
        ReportOptions(
            start=date(2026, 8, 1),
            end=date(2026, 8, 31),
            sections=["summary", "category_breakdown"],
        )
    )

    breakdown = data["category_breakdown"]
    assert len(breakdown) == 10
    assert sum(row["amount_cents"] for row in breakdown) == 55_000
    assert data["summary"]["total_expenses"] == 55_000


def test_report_prints_recurring_amounts_in_their_own_currency() -> None:
    session = make_session()
    category = Category(user_id=1, name="Apps", type=TransactionType.expense, order=0)
    session.add(category)
    session.commit()
    session.add(
        RecurringRule(
            user_id=1,
            name="Cloud storage",
            type=TransactionType.expense,
            currency_code=CurrencyCode.usd,
            amount_cents=10_000,
            category_id=category.id,
            anchor_date=date(2026, 8, 20),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=date(2026, 8, 20),
            auto_post=True,
        )
    )
    session.commit()

    data = ReportService(session).gather_data(
        ReportOptions(
            start=date(2026, 8, 1),
            end=date(2026, 8, 31),
            sections=["recurring_upcoming"],
        )
    )
    html = render_report_html(data)

    assert "100,00 $" in html
    assert "100,00 €" not in html


def test_report_options_bound_notes_and_dates() -> None:
    with pytest.raises(ValidationError):
        ReportOptions(start=date(2026, 8, 1), end=date(2026, 8, 31), notes="x" * 2001)
    with pytest.raises(ValidationError):
        ReportOptions(start=date(1, 1, 1), end=date(1, 12, 31))
    ReportOptions(start=date(2026, 8, 1), end=date(2026, 8, 31), notes="x" * 2000)
