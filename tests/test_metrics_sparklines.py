from datetime import date, datetime

from sqlalchemy import create_engine, delete, event
from sqlalchemy.orm import sessionmaker

from expenses.core.periods import Period
from expenses.db.models import Category, MonthlyRollup, TransactionType
from expenses.db.session import Base
from expenses.schemas import TransactionIn
from expenses.services import MetricsService, TagService, TransactionService


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


def test_filtered_kpi_sparklines_group_months_in_bounded_queries() -> None:
    session = make_session()
    category = Category(user_id=1, name="Travel", type=TransactionType.expense, order=0)
    session.add(category)
    session.commit()
    tag = TagService(session).create("Vacation")
    transactions = TransactionService(session)
    for month in range(1, 13):
        transactions.create(
            TransactionIn(
                date=date(2025, month, 10),
                occurred_at=datetime(2025, month, 10, 12),
                type=TransactionType.expense,
                amount_cents=month * 1_000,
                category_id=category.id,
                title=f"Month {month}",
                tags=[tag.name],
            )
        )

    query_count = 0

    def count_query(*_args: object) -> None:
        nonlocal query_count
        query_count += 1

    event.listen(session.bind, "before_cursor_execute", count_query)
    try:
        points = MetricsService(session).kpi_sparklines(
            Period("custom", date(2025, 1, 1), date(2025, 12, 31)),
            tag_ids=[tag.id],
            include_balance=False,
        )
    finally:
        event.remove(session.bind, "before_cursor_execute", count_query)

    assert points["expenses"]
    assert points["balance"] == ""
    assert query_count <= 2
