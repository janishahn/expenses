from datetime import date, datetime

from expenses_web.db.models import Category, Transaction, TransactionType
from expenses_web.services.csv_utils import export_transactions, parse_csv


def test_parse_csv_preserves_whitespace_significant_description() -> None:
    description = "  code block\n\nline with hard break  "
    csv_content = (
        "Date,Type,IsReimbursement,Amount,Category,Title,Description\n"
        f'2026-03-08,expense,0,10.00,Groceries,Coffee,"{description}"\n'
    )

    rows, errors = parse_csv(csv_content)

    assert errors == []
    assert len(rows) == 1
    assert rows[0].description == description


def test_export_transactions_preserves_description_whitespace() -> None:
    category = Category(
        id=1,
        user_id=1,
        name="Groceries",
        type=TransactionType.expense,
        order=0,
    )
    description = "  indented\n\nline with hard break  "
    txn = Transaction(
        id=1,
        user_id=1,
        date=date(2026, 3, 8),
        occurred_at=datetime(2026, 3, 8, 12, 0),
        type=TransactionType.expense,
        is_reimbursement=False,
        amount_cents=1_250,
        category_id=1,
        category=category,
        title="Coffee",
        description=description,
    )

    csv_text = export_transactions([txn])
    rows, errors = parse_csv(csv_text)

    assert errors == []
    assert len(rows) == 1
    assert rows[0].description == description
