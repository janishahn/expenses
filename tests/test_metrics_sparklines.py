from datetime import date, datetime

from sqlalchemy import create_engine, delete
from sqlalchemy.orm import sessionmaker

from expenses.core.periods import Period
from expenses.db.models import Category, MonthlyRollup, TransactionType
from expenses.db.session import Base
from expenses.schemas import TransactionIn
from expenses.services import MetricsService, TransactionService


def make_session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    return session_local()


def parse_y_values(points: str) -> list[float]:
    values: list[float] = []
    for pair in points.split():
        _, y = pair.split(",")
        values.append(float(y))
    return values


def test_kpi_sparklines_fall_back_to_transactions_when_rollup_missing() -> None:
    session = make_session()

    income = Category(user_id=1, name="Income", type=TransactionType.income, order=0)
    session.add(income)
    session.commit()
    session.refresh(income)

    txns = TransactionService(session)
    txns.create(
        TransactionIn(
            date=date(2025, 1, 10),
            occurred_at=datetime(2025, 1, 10, 12, 0),
            type=TransactionType.income,
            amount_cents=10_000,
            category_id=income.id,
            title="January income",
        )
    )
    txns.create(
        TransactionIn(
            date=date(2025, 2, 10),
            occurred_at=datetime(2025, 2, 10, 12, 0),
            type=TransactionType.income,
            amount_cents=30_000,
            category_id=income.id,
            title="February income",
        )
    )

    metrics = MetricsService(session)
    period = Period("custom", date(2025, 1, 1), date(2025, 2, 28))
    with_rollups = metrics.kpi_sparklines(period)["income"]

    session.execute(delete(MonthlyRollup).where(MonthlyRollup.user_id == 1))
    session.commit()

    without_rollups = metrics.kpi_sparklines(period)["income"]
    y_values = parse_y_values(without_rollups)

    assert without_rollups == with_rollups
    assert len(set(y_values)) > 1
