import json
from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from expenses.cli.forecast_backtest import main
from expenses.db.models import Category, Transaction, TransactionType
from expenses.db.session import Base


def test_forecast_backtest_prints_machine_readable_metrics(monkeypatch, capsys) -> None:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        category = Category(user_id=1, name="Groceries", type=TransactionType.expense)
        session.add(category)
        session.flush()
        for month_number in range(3, 7):
            session.add(
                Transaction(
                    user_id=1,
                    date=date(2026, month_number, 10),
                    occurred_at=datetime(2026, month_number, 10, 12, 0),
                    type=TransactionType.expense,
                    is_reimbursement=False,
                    amount_cents=10_000,
                    category_id=category.id,
                    title=f"Groceries {month_number}",
                )
            )
        session.commit()

    monkeypatch.setattr("expenses.services.main.local_today", lambda: date(2026, 7, 15))
    monkeypatch.setattr(
        "expenses.cli.forecast_backtest.SessionLocal",
        sessionmaker(bind=engine, autoflush=False, expire_on_commit=False),
    )
    monkeypatch.setattr("sys.argv", ["forecast-backtest", "--json"])

    assert main() == 0
    assert json.loads(capsys.readouterr().out) == {
        "months_evaluated": 1,
        "model_mae_cents": 0,
        "baseline_mae_cents": 0,
        "interval_coverage_bps": 10_000,
    }
