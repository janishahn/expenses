from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import expenses.cli.mock_db as mock_db
from expenses.auth.security import verify_password
from expenses.cli.mock_db import _seed
from expenses.core.config import get_settings
from expenses.db.models import (
    Transaction,
    User,
)
from expenses.db.session import Base
from expenses.services.main import BalanceAnchorService, DurablePurchaseService


@contextmanager
def seeded_session(tmp_path: Path, monkeypatch) -> Iterator[Session]:
    monkeypatch.setenv("EXPENSES_ENV", "test")
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_RECEIPTS_DIR", str(tmp_path / "receipts"))
    get_settings.cache_clear()

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    session = session_local()
    try:
        _seed(session)
        yield session
    finally:
        session.close()
        get_settings.cache_clear()


def test_mock_db_seed_has_active_amortized_and_ended_durable_purchases(
    tmp_path, monkeypatch
) -> None:
    with seeded_session(tmp_path, monkeypatch) as session:
        durable_items = DurablePurchaseService(session).list_computed()

    assert len(durable_items) == 3

    by_title = {str(item["title"]): item for item in durable_items}
    assert by_title["MacBook Pro 14"]["fully_amortized"] is False
    assert by_title["Ergonomic office chair"]["fully_amortized"] is True
    assert by_title["Ergonomic office chair"]["ended_on"] is None
    assert by_title["Espresso machine"]["ended_on"] is not None


def test_mock_db_seed_creates_test_account_for_local_login(
    tmp_path, monkeypatch
) -> None:
    with seeded_session(tmp_path, monkeypatch) as session:
        user = session.query(User).filter(User.username == "test").one()

    assert user.id == 1
    assert user.is_admin is True
    assert verify_password("test", user.password_hash)


def test_mock_db_seed_balance_anchor_predates_all_transactions(
    tmp_path, monkeypatch
) -> None:
    with seeded_session(tmp_path, monkeypatch) as session:
        anchors = BalanceAnchorService(session).list_all()
        earliest_transaction = (
            session.query(Transaction)
            .order_by(Transaction.occurred_at.asc(), Transaction.id.asc())
            .first()
        )

    assert len(anchors) == 1
    assert earliest_transaction is not None
    assert anchors[0].as_of_at < earliest_transaction.occurred_at


def test_mock_db_seed_does_not_create_future_transactions(
    tmp_path, monkeypatch
) -> None:
    class FrozenDate(mock_db.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 18)

    monkeypatch.setattr(mock_db, "date", FrozenDate)

    with seeded_session(tmp_path, monkeypatch) as session:
        future_transaction = (
            session.query(Transaction)
            .filter(Transaction.date > FrozenDate.today())
            .order_by(Transaction.date.asc(), Transaction.id.asc())
            .first()
        )

    assert future_transaction is None
