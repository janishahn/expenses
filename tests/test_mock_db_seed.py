from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import expenses.cli.mock_db as mock_db
from expenses.auth.security import verify_password
from expenses.cli.mock_db import _seed
from expenses.core.config import get_settings
from expenses.db.models import (
    BalanceAnchor,
    BankStatementRow,
    ReceiptAttachment,
    Transaction,
    TransactionType,
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


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _add_months(value: date, months: int) -> date:
    year = value.year + (value.month - 1 + months) // 12
    month = (value.month - 1 + months) % 12 + 1
    return date(year, month, 1)


def test_mock_db_seed_has_active_and_fully_amortized_durable_purchase(
    tmp_path, monkeypatch
) -> None:
    with seeded_session(tmp_path, monkeypatch) as session:
        durable_items = DurablePurchaseService(session).list_computed()

    assert len(durable_items) == 2

    by_title = {str(item["title"]): item for item in durable_items}
    assert by_title["MacBook Pro 14"]["fully_amortized"] is False
    assert by_title["Ergonomic office chair"]["fully_amortized"] is True


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


def test_mock_db_seed_has_dense_positive_recent_history(tmp_path, monkeypatch) -> None:
    class FrozenDate(mock_db.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 18)

    monkeypatch.setattr(mock_db, "date", FrozenDate)

    with seeded_session(tmp_path, monkeypatch) as session:
        first_month = _add_months(_month_start(FrozenDate.today()), -11)
        active_transactions = (
            session.query(Transaction)
            .filter(
                Transaction.deleted_at.is_(None),
                Transaction.date >= first_month,
                Transaction.date <= FrozenDate.today(),
            )
            .all()
        )
        anchors = session.query(BalanceAnchor).all()
        all_active_transactions = (
            session.query(Transaction).filter(Transaction.deleted_at.is_(None)).all()
        )

    transactions_by_month: dict[tuple[int, int], list[Transaction]] = {}
    for txn in active_transactions:
        transactions_by_month.setdefault((txn.date.year, txn.date.month), []).append(
            txn
        )

    expected_months = {
        (_add_months(first_month, offset).year, _add_months(first_month, offset).month)
        for offset in range(12)
    }
    assert set(transactions_by_month) == expected_months
    assert len(active_transactions) >= 320
    assert all(len(transactions_by_month[month]) >= 20 for month in expected_months)

    assert len(anchors) == 1
    ending_balance_cents = anchors[0].balance_cents + sum(
        txn.amount_cents if txn.type == TransactionType.income else -txn.amount_cents
        for txn in all_active_transactions
    )
    assert ending_balance_cents >= 400_000


def test_mock_db_seed_creates_receipt_image_attachments(tmp_path, monkeypatch) -> None:
    with seeded_session(tmp_path, monkeypatch) as session:
        attachments = session.query(ReceiptAttachment).all()
        receipts_dir = get_settings().receipts_dir

    assert len(attachments) >= 4
    assert {attachment.mime_type for attachment in attachments} == {"image/png"}

    for attachment in attachments:
        path = receipts_dir / attachment.storage_key
        assert path.is_file()
        content = path.read_bytes()
        assert content.startswith(b"\x89PNG\r\n\x1a\n")
        assert attachment.original_filename.endswith(".png")
        assert attachment.size_bytes == len(content)
        assert len(attachment.sha256_hex) == 64


def test_mock_db_seed_creates_bank_reconciliation_examples(
    tmp_path, monkeypatch
) -> None:
    with seeded_session(tmp_path, monkeypatch) as session:
        rows = session.query(BankStatementRow).all()

    assert len(rows) >= 4
    assert any(row.matched_transaction_id is not None for row in rows)
    assert any(row.reviewed_at is not None for row in rows)
    assert any(
        row.matched_transaction_id is None and row.reviewed_at is None for row in rows
    )
