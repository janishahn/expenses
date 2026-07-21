from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from expenses.db.models import Category, Transaction, TransactionType
from expenses.db.session import Base
from expenses.services import ForecastService

TODAY = date(2026, 7, 15)


def _session() -> Session:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def _add_monthly_txn(
    session: Session,
    *,
    category_id: int,
    month: date,
    amount_cents: int,
    txn_type: TransactionType,
) -> None:
    session.add(
        Transaction(
            user_id=1,
            date=month.replace(day=10),
            occurred_at=datetime(month.year, month.month, 10, 12, 0),
            type=txn_type,
            is_reimbursement=False,
            amount_cents=amount_cents,
            category_id=category_id,
            title=f"{txn_type.value} {month.isoformat()}",
        )
    )


def test_backtest_evaluates_each_rolling_window_after_first_three_months() -> None:
    with _session() as session:
        expense = Category(user_id=1, name="Groceries", type=TransactionType.expense)
        income = Category(user_id=1, name="Salary", type=TransactionType.income)
        session.add_all([expense, income])
        session.flush()
        for month_number in range(1, 7):
            month = date(2026, month_number, 1)
            _add_monthly_txn(
                session,
                category_id=expense.id,
                month=month,
                amount_cents=50_000,
                txn_type=TransactionType.expense,
            )
            _add_monthly_txn(
                session,
                category_id=income.id,
                month=month,
                amount_cents=200_000,
                txn_type=TransactionType.income,
            )
        session.commit()

        result = ForecastService(session, user_id=1).backtest(today=TODAY)

    assert result == {
        "months_evaluated": 3,
        "model_mae_cents": 0,
        "baseline_mae_cents": 200_000,
        "interval_coverage_bps": 10_000,
    }


def test_backtest_counts_actuals_outside_prediction_interval() -> None:
    with _session() as session:
        expense = Category(user_id=1, name="Shopping", type=TransactionType.expense)
        session.add(expense)
        session.flush()
        for month_number in range(1, 7):
            _add_monthly_txn(
                session,
                category_id=expense.id,
                month=date(2026, month_number, 1),
                amount_cents=100_000 if month_number == 6 else 10_000,
                txn_type=TransactionType.expense,
            )
        session.commit()

        result = ForecastService(session, user_id=1).backtest(today=TODAY)

    assert result == {
        "months_evaluated": 3,
        "model_mae_cents": 30_000,
        "baseline_mae_cents": 30_000,
        "interval_coverage_bps": 6_667,
    }


def test_backtest_returns_no_metrics_when_history_is_too_short() -> None:
    with _session() as session:
        expense = Category(user_id=1, name="Groceries", type=TransactionType.expense)
        session.add(expense)
        session.flush()
        for month_number in range(4, 7):
            _add_monthly_txn(
                session,
                category_id=expense.id,
                month=date(2026, month_number, 1),
                amount_cents=10_000,
                txn_type=TransactionType.expense,
            )
        session.commit()

        result = ForecastService(session, user_id=1).backtest(today=TODAY)

    assert result == {
        "months_evaluated": 0,
        "model_mae_cents": None,
        "baseline_mae_cents": None,
        "interval_coverage_bps": None,
    }
