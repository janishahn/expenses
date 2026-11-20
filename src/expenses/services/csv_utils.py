import csv
import re
from datetime import datetime
from io import StringIO
from typing import Iterable, Iterator, Sequence

from expenses.db.models import Transaction, TransactionType
from expenses.schemas import MAX_AMOUNT_CENTS, CSVRow


def sanitize_csv_value(value: str) -> str:
    """
    Sanitize CSV values to prevent formula injection by prefixing dangerous patterns with tab.
    """
    if value == "":
        return ""

    stripped = value.lstrip()

    formula_triggers = ("=", "+", "-", "@", "\t", "\r")

    if stripped.startswith(formula_triggers):
        return "\t" + value

    dangerous_patterns = [
        r"^cmd\s*",
        r"^powershell\s*",
        r"^bash\s*",
        r"^sh\s*",
        r"^\.",
        r"^http[s]?://",
    ]

    for pattern in dangerous_patterns:
        if re.match(pattern, stripped, re.IGNORECASE):
            return "\t" + value

    return value


def parse_date(value: str):
    value = value.strip()
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return datetime.strptime(value, "%d.%m.%Y").date()


_PLAIN_AMOUNT = re.compile(r"([0-9]+)(?:[.,]([0-9]{1,2})?)?")
_GERMAN_GROUPED_AMOUNT = re.compile(r"([0-9]{1,3}(?:\.[0-9]{3})+)(?:,([0-9]{1,2})?)?")
_ENGLISH_GROUPED_AMOUNT = re.compile(r"([0-9]{1,3}(?:,[0-9]{3})+)(?:\.([0-9]{1,2})?)?")
# One separator before exactly three digits reads as 1000 or as 1.000.
_AMBIGUOUS_AMOUNT = re.compile(r"[0-9]{1,3}[.,][0-9]{3}")


def unsigned_amount_cents(value: str) -> int:
    """Read an unsigned amount such as 12,50, 1.234,56 or 1,234.56 as cents."""
    if value[:1] in {".", ","} and value[1:2].isdigit():
        value = "0" + value
    if _AMBIGUOUS_AMOUNT.fullmatch(value):
        raise ValueError(
            f"Ambiguous amount '{value}': write it with decimals, such as 1000,00"
        )
    for pattern in (_PLAIN_AMOUNT, _GERMAN_GROUPED_AMOUNT, _ENGLISH_GROUPED_AMOUNT):
        match = pattern.fullmatch(value)
        if match is None:
            continue
        whole = match.group(1).replace(".", "").replace(",", "")
        if len(whole) > 18:
            raise ValueError("Amount is too large")
        cents = int(whole) * 100 + int((match.group(2) or "0").ljust(2, "0"))
        if cents > MAX_AMOUNT_CENTS:
            raise ValueError("Amount is too large")
        return cents
    raise ValueError("Invalid amount")


def parse_amount(value: str, *, allow_negative: bool = False) -> int:
    clean = value.strip().replace("€", "").replace("$", "").replace(" ", "")
    if not clean:
        raise ValueError("Amount is required")
    negative = clean.startswith("-")
    if clean[:1] in {"+", "-"}:
        clean = clean[1:]
    cents = unsigned_amount_cents(clean)
    if negative:
        cents = -cents
    if cents < 0 and not allow_negative:
        raise ValueError("Amount must be positive")
    return cents


def parse_csv(
    content: str, *, max_rows: int | None = None
) -> tuple[list[CSVRow], list[str]]:
    reader = csv.DictReader(StringIO(content))
    rows: list[CSVRow] = []
    errors: list[str] = []
    for idx, raw in enumerate(reader, start=1):
        if max_rows is not None and idx > max_rows:
            errors.append(f"CSV row limit exceeded (max {max_rows})")
            break
        try:
            date_value = parse_date((raw.get("Date") or "").strip())
            type_raw = (raw.get("Type") or "").strip().lower()
            type_value = TransactionType(type_raw)
            is_reimbursement_raw = (raw.get("IsReimbursement") or "").strip().lower()
            is_reimbursement_value = is_reimbursement_raw in {
                "1",
                "true",
                "yes",
                "y",
                "on",
            }
            amount_value = parse_amount(raw.get("Amount") or "")
            category = (raw.get("Category") or "").strip()
            title = (raw.get("Title") or "").strip()
            if not title:
                raise ValueError("Title is required")
            description_raw = raw.get("Description") or ""
            description = description_raw if description_raw else None
            rows.append(
                CSVRow(
                    row_number=idx,
                    date=date_value,
                    type=type_value,
                    is_reimbursement=is_reimbursement_value,
                    amount_cents=amount_value,
                    category=category,
                    title=title,
                    description=description,
                )
            )
        except ValueError as exc:
            errors.append(f"Row {idx}: {exc}")
    return rows, errors


def export_transactions(transactions: Sequence[Transaction]) -> str:
    return "".join(iter_export_transactions(transactions))


def iter_export_transactions(transactions: Iterable[Transaction]) -> Iterator[str]:
    """Yield the export CSV in chunks so a large ledger never sits in memory."""
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Date",
            "Type",
            "IsReimbursement",
            "Amount",
            "Category",
            "Title",
            "Description",
        ]
    )
    for index, txn in enumerate(transactions, start=1):
        writer.writerow(
            [
                txn.date.isoformat(),
                txn.type.value,
                "1" if txn.is_reimbursement else "0",
                f"{txn.amount_cents / 100:.2f}",
                sanitize_csv_value(txn.category.name if txn.category else ""),
                sanitize_csv_value(
                    txn.title
                    if (txn.title or "").strip()
                    else (txn.category.name if txn.category else "")
                ),
                sanitize_csv_value(txn.description or ""),
            ]
        )
        if index % 500 == 0:
            yield output.getvalue()
            output.seek(0)
            output.truncate()
    yield output.getvalue()
