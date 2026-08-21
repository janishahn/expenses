from datetime import date, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from expenses.db.models import Category, TransactionType
from expenses.db.session import Base, _enable_sqlite_pragmas
from expenses.schemas import ReportOptions, TransactionIn
from expenses.services import (
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
