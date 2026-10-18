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


def _horizon(
    months: int,
    samples: int = 0,
    model_mae: int | None = None,
    average_mae: int | None = None,
    last_year_samples: int = 0,
    last_year_mae: int | None = None,
    range_samples: int = 0,
    range_coverage: int | None = None,
) -> dict[str, int | None]:
    return {
        "months": months,
        "samples": samples,
        "model_mae_cents": model_mae,
        "average_mae_cents": average_mae,
        "same_month_last_year_samples": last_year_samples,
        "same_month_last_year_mae_cents": last_year_mae,
        "range_samples": range_samples,
        "range_coverage_bps": range_coverage,
    }


def test_backtest_evaluates_each_horizon_after_first_three_months() -> None:
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
        "history_months": 6,
        "horizons": [
            _horizon(1, samples=3, model_mae=0, average_mae=0),
            _horizon(3, samples=1, model_mae=0, average_mae=0),
            _horizon(6),
            _horizon(12),
        ],
    }


def test_backtest_compares_baselines_and_counts_actuals_outside_range() -> None:
    with _session() as session:
        expense = Category(user_id=1, name="Shopping", type=TransactionType.expense)
        session.add(expense)
        session.flush()
        for offset in range(13):
            month_number = offset % 12 + 1
            _add_monthly_txn(
                session,
                category_id=expense.id,
                month=date(2025 + offset // 12, month_number, 1),
                amount_cents=100_000 if offset == 12 else 10_000,
                txn_type=TransactionType.expense,
            )
        session.commit()

        result = ForecastService(session, user_id=1).backtest(today=date(2026, 2, 15))

    # Only the last month is unusual: it is the one actual outside the range.
    assert result == {
        "history_months": 13,
        "horizons": [
            _horizon(
                1,
                samples=10,
                model_mae=9_000,
                average_mae=9_000,
                last_year_samples=1,
                last_year_mae=90_000,
                range_samples=4,
                range_coverage=7_500,
            ),
            _horizon(
                3,
                samples=8,
                model_mae=11_250,
                average_mae=11_250,
                range_samples=2,
                range_coverage=5_000,
            ),
            _horizon(6, samples=5, model_mae=18_000, average_mae=18_000),
            _horizon(12),
        ],
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
        "history_months": 3,
        "horizons": [_horizon(months) for months in (1, 3, 6, 12)],
    }
