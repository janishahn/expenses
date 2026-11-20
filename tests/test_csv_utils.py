from datetime import date, datetime

from hypothesis import example, given
from hypothesis import strategies as st

from expenses.db.models import Category, Transaction, TransactionType
from expenses.schemas import MAX_AMOUNT_CENTS
from expenses.services.csv_utils import (
    export_transactions,
    parse_csv,
    sanitize_csv_value,
)

# Export prefixes text that could run in a spreadsheet, so it does not read
# back unchanged; the import strips titles and category names.
text = st.text(
    st.characters(exclude_categories=["Cs"], exclude_characters="\x00"), max_size=40
)
plain = text.filter(lambda value: sanitize_csv_value(value) == value)
name = plain.map(str.strip).filter(bool)


@given(
    rows=st.lists(
        st.tuples(
            st.dates(date(1900, 1, 1), date(2199, 12, 31)),
            st.sampled_from(TransactionType),
            st.booleans(),
            st.integers(0, MAX_AMOUNT_CENTS),
            name,
            name,
            plain,
        ),
        max_size=5,
    )
)
# Whitespace in a note is kept, such as Markdown indentation and a hard break.
@example(
    rows=[
        (
            date(2026, 3, 8),
            TransactionType.expense,
            False,
            1_250,
            "Groceries",
            "Coffee",
            "  code block\n\nline with hard break  ",
        )
    ]
)
def test_exported_transactions_import_unchanged(rows) -> None:
    transactions = [
        Transaction(
            date=day,
            occurred_at=datetime.combine(day, datetime.min.time()),
            type=kind,
            is_reimbursement=reimbursement,
            amount_cents=cents,
            category=Category(name=category, type=kind),
            title=title,
            description=description,
        )
        for day, kind, reimbursement, cents, category, title, description in rows
    ]

    parsed, errors = parse_csv(export_transactions(transactions))

    assert errors == []
    assert [
        (
            r.date,
            r.type,
            r.is_reimbursement,
            r.amount_cents,
            r.category,
            r.title,
            r.description or "",
        )
        for r in parsed
    ] == [row[:6] + (row[6],) for row in rows]


def test_parse_csv_enforces_row_limit() -> None:
    csv_content = (
        "Date,Type,IsReimbursement,Amount,Category,Title,Description\n"
        "2026-03-08,expense,0,10.00,Groceries,Coffee,\n"
        "2026-03-09,expense,0,11.00,Groceries,Lunch,\n"
    )

    rows, errors = parse_csv(csv_content, max_rows=1)

    assert len(rows) == 1
    assert errors == ["CSV row limit exceeded (max 1)"]
