import hashlib
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import expenses.cli.mock_db as mock_db
from expenses.auth.security import verify_password
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
from expenses.services.main import DurablePurchaseService


def test_mock_db_seed_provides_usable_demo_data(tmp_path, monkeypatch) -> None:
    class FrozenDate(date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 18)

    today = FrozenDate.today()
    monkeypatch.setenv("EXPENSES_ENV", "test")
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_RECEIPTS_DIR", str(tmp_path / "receipts"))
    monkeypatch.setattr(mock_db, "date", FrozenDate)
    monkeypatch.setattr("expenses.services.main.local_today", lambda: today)
    get_settings.cache_clear()

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            # Inspect all demo surfaces from one seed instead of recreating the
            # complete history for each assertion group.
            mock_db._seed(session)
            user = session.query(User).filter(User.username == "test").one()
            assert user.id == 1
            assert user.is_admin
            assert verify_password("test", user.password_hash)

            durable_items = DurablePurchaseService(session).list_computed()
            assert {item["fully_amortized"] for item in durable_items} == {False, True}

            transactions = session.query(Transaction).all()
            assert transactions
            assert all(txn.date <= today for txn in transactions)
            anchor = session.query(BalanceAnchor).one()
            assert anchor.as_of_at < min(txn.occurred_at for txn in transactions)

            active_transactions = [
                txn for txn in transactions if txn.deleted_at is None
            ]
            expected_months = {
                divmod(today.year * 12 + today.month - 1 - offset, 12)
                for offset in range(12)
            }
            for year, zero_based_month in expected_months:
                month_transactions = [
                    txn
                    for txn in active_transactions
                    if (txn.date.year, txn.date.month) == (year, zero_based_month + 1)
                ]
                assert {txn.type for txn in month_transactions} == {
                    TransactionType.income,
                    TransactionType.expense,
                }, (
                    f"Demo history needs income and expenses for {year}-{zero_based_month + 1:02d}"
                )

            ending_balance_cents = anchor.balance_cents + sum(
                txn.amount_cents
                if txn.type == TransactionType.income
                else -txn.amount_cents
                for txn in active_transactions
            )
            assert ending_balance_cents > 0

            attachments = session.query(ReceiptAttachment).all()
            assert attachments
            for attachment in attachments:
                path = get_settings().receipts_dir / attachment.storage_key
                content = path.read_bytes()
                assert attachment.mime_type == "image/png"
                assert content.startswith(b"\x89PNG\r\n\x1a\n")
                assert attachment.original_filename.endswith(".png")
                assert attachment.size_bytes == len(content)
                assert attachment.sha256_hex == hashlib.sha256(content).hexdigest()

            bank_rows = session.query(BankStatementRow).all()
            assert any(row.matched_transaction_id is not None for row in bank_rows)
            assert any(row.reviewed_at is not None for row in bank_rows)
            assert any(
                row.matched_transaction_id is None and row.reviewed_at is None
                for row in bank_rows
            )
    finally:
        engine.dispose()
        get_settings.cache_clear()
