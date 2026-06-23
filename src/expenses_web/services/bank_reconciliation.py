import csv
import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from io import StringIO

from rapidfuzz import fuzz
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from expenses_web.db.models import BankStatementRow, Transaction, TransactionType
from expenses_web.schemas import TransactionIn
from expenses_web.services.main import TransactionService


COMMERZBANK_CSV_SOURCE = "commerzbank_csv"
MATCH_WINDOW_DAYS = 5


@dataclass(frozen=True, slots=True)
class ParsedBankStatementRow:
    booking_date: date
    value_date: date | None
    amount_cents: int
    currency: str
    payee: str | None
    booking_text: str | None
    purpose: str | None
    raw_description: str
    import_hash: str


BOOKING_DATE_HEADERS = {
    "buchungstag",
    "buchungsdatum",
    "buchung",
    "datum",
    "date",
}
VALUE_DATE_HEADERS = {
    "wertstellung",
    "wertstellungstag",
    "valuta",
    "valutadatum",
    "value_date",
}
AMOUNT_HEADERS = {
    "betrag",
    "betrageur",
    "betragineur",
    "umsatz",
    "umsatzineur",
    "amount",
}
CURRENCY_HEADERS = {"waehrung", "wahrung", "currency"}
PAYEE_HEADERS = {
    "auftraggeberbeguenstigter",
    "auftraggeberbegunstigter",
    "beguenstigterzahlungspflichtiger",
    "begunstigterzahlungspflichtiger",
    "empfaenger",
    "empfanger",
    "zahlungspflichtiger",
    "payee",
}
BOOKING_TEXT_HEADERS = {
    "buchungstext",
    "umsatzart",
    "vorgangverwendungszweck",
    "typ",
    "type",
}
PURPOSE_HEADERS = {"verwendungszweck", "beschreibung", "details", "purpose"}
ACCOUNT_HEADERS = {"auftragskonto", "konto", "kontonummer", "iban", "account"}


def _decode_csv(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return content.decode("cp1252")


def _normalize_header(value: str) -> str:
    normalized = value.strip().lower()
    normalized = (
        normalized.replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss")
    )
    return re.sub(r"[^a-z0-9]", "", normalized)


def _clean_cell(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(value.replace("\xa0", " ").strip().split())


def _pick(row: dict[str, str], headers: set[str]) -> str:
    for key, value in row.items():
        if _normalize_header(key) in headers:
            return _clean_cell(value)
    return ""


def _parse_date(value: str) -> date:
    clean = _clean_cell(value)
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(clean, fmt).date()
        except ValueError:
            continue
    raise ValueError("Invalid date")


def _parse_amount(value: str) -> int:
    clean = _clean_cell(value)
    if not clean:
        raise ValueError("Missing amount")
    negative = clean.startswith("-") or clean.endswith(" S")
    clean = clean.replace("EUR", "").replace("€", "").replace(" ", "")
    clean = clean.removeprefix("+").removeprefix("-")
    clean = clean.removesuffix("S").removesuffix("H")
    if "," in clean and "." in clean:
        clean = clean.replace(".", "").replace(",", ".")
    elif "," in clean:
        clean = clean.replace(",", ".")
    try:
        cents = int((Decimal(clean) * 100).quantize(Decimal("1")))
    except InvalidOperation as exc:
        raise ValueError("Invalid amount") from exc
    return -abs(cents) if negative else cents


def _hash_row(
    *,
    account_label: str,
    booking_date: date,
    value_date: date | None,
    amount_cents: int,
    currency: str,
    raw_description: str,
) -> str:
    payload = "|".join(
        [
            account_label.strip().lower(),
            booking_date.isoformat(),
            value_date.isoformat() if value_date else "",
            str(amount_cents),
            currency.upper(),
            _clean_cell(raw_description).lower(),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _read_csv_rows(content: bytes) -> tuple[list[list[str]], str]:
    text = _decode_csv(content)
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return [], ";"
    delimiter = ";"
    if lines[0].lower().startswith("sep=") and len(lines[0]) >= 5:
        delimiter = lines[0][-1]
        lines = lines[1:]
    elif lines[0].count(",") > lines[0].count(";"):
        delimiter = ","
    return list(csv.reader(StringIO("\n".join(lines)), delimiter=delimiter)), delimiter


def parse_commerzbank_csv(
    content: bytes, *, account_label: str
) -> tuple[list[ParsedBankStatementRow], list[str]]:
    csv_rows, _delimiter = _read_csv_rows(content)
    if not csv_rows:
        return [], ["CSV file is empty"]

    headers = [_clean_cell(value) for value in csv_rows[0]]
    normalized_headers = {_normalize_header(header) for header in headers}
    use_header_mapping = bool(
        normalized_headers & BOOKING_DATE_HEADERS
        and normalized_headers & AMOUNT_HEADERS
    )

    parsed_rows: list[ParsedBankStatementRow] = []
    errors: list[str] = []
    data_rows = csv_rows[1:]
    for index, raw_cells in enumerate(data_rows, start=2):
        if not any(_clean_cell(cell) for cell in raw_cells):
            continue
        row = dict(zip(headers, raw_cells, strict=False))
        try:
            if use_header_mapping:
                booking_date = _parse_date(_pick(row, BOOKING_DATE_HEADERS))
                value_date_raw = _pick(row, VALUE_DATE_HEADERS)
                amount_cents = _parse_amount(_pick(row, AMOUNT_HEADERS))
                currency = (_pick(row, CURRENCY_HEADERS) or "EUR").upper()
                payee = _pick(row, PAYEE_HEADERS) or None
                booking_text = _pick(row, BOOKING_TEXT_HEADERS) or None
                purpose = _pick(row, PURPOSE_HEADERS) or None
                account = _pick(row, ACCOUNT_HEADERS)
            elif len(raw_cells) >= 5:
                booking_date = _parse_date(raw_cells[0])
                value_date_raw = raw_cells[1] if len(raw_cells) > 1 else ""
                booking_text = _clean_cell(raw_cells[2]) or None
                payee = _clean_cell(raw_cells[3]) or None
                amount_cents = _parse_amount(raw_cells[4])
                currency = (
                    _clean_cell(raw_cells[5]).upper() if len(raw_cells) > 5 else "EUR"
                )
                purpose = (
                    _clean_cell(raw_cells[6]) or None if len(raw_cells) > 6 else None
                )
                account = ""
            else:
                raise ValueError("Missing required Commerzbank columns")
            value_date = (
                _parse_date(value_date_raw) if _clean_cell(value_date_raw) else None
            )
            description_parts = [
                part for part in (booking_text, payee, purpose) if part
            ]
            raw_description = " · ".join(dict.fromkeys(description_parts))
            if not raw_description:
                raw_description = "Bank transaction"
            row_account_label = _clean_cell(account) or account_label
            import_hash = _hash_row(
                account_label=row_account_label,
                booking_date=booking_date,
                value_date=value_date,
                amount_cents=amount_cents,
                currency=currency,
                raw_description=raw_description,
            )
            parsed_rows.append(
                ParsedBankStatementRow(
                    booking_date=booking_date,
                    value_date=value_date,
                    amount_cents=amount_cents,
                    currency=currency,
                    payee=payee,
                    booking_text=booking_text,
                    purpose=purpose,
                    raw_description=raw_description,
                    import_hash=import_hash,
                )
            )
        except ValueError as exc:
            errors.append(f"Row {index}: {exc}")

    if not parsed_rows and not errors:
        errors.append("No statement rows found")
    return parsed_rows, errors


class BankReconciliationService:
    def __init__(self, session: Session, user_id: int) -> None:
        self.session = session
        self.user_id = user_id

    def preview_commerzbank_csv(
        self, content: bytes, *, account_label: str
    ) -> dict[str, object]:
        rows, errors = parse_commerzbank_csv(content, account_label=account_label)
        existing_hashes = self._existing_hashes([row.import_hash for row in rows])
        seen_hashes = set(existing_hashes)
        preview_rows = []
        for row in rows:
            duplicate = row.import_hash in seen_hashes
            preview_rows.append(self._serialize_preview_row(row, duplicate=duplicate))
            seen_hashes.add(row.import_hash)
        return {
            "account_label": account_label,
            "rows": preview_rows,
            "errors": errors,
            "new_count": sum(1 for row in preview_rows if not bool(row["duplicate"])),
            "duplicate_count": sum(1 for row in preview_rows if bool(row["duplicate"])),
        }

    def import_commerzbank_csv(
        self, content: bytes, *, account_label: str
    ) -> dict[str, int]:
        rows, errors = parse_commerzbank_csv(content, account_label=account_label)
        if errors:
            raise ValueError("; ".join(errors))
        existing_hashes = self._existing_hashes([row.import_hash for row in rows])
        imported_count = 0
        for parsed in rows:
            if parsed.import_hash in existing_hashes:
                continue
            existing_hashes.add(parsed.import_hash)
            self.session.add(
                BankStatementRow(
                    user_id=self.user_id,
                    source=COMMERZBANK_CSV_SOURCE,
                    account_label=account_label,
                    booking_date=parsed.booking_date,
                    value_date=parsed.value_date,
                    amount_cents=parsed.amount_cents,
                    currency=parsed.currency,
                    payee=parsed.payee,
                    booking_text=parsed.booking_text,
                    purpose=parsed.purpose,
                    raw_description=parsed.raw_description,
                    import_hash=parsed.import_hash,
                )
            )
            imported_count += 1
        self.session.commit()
        return {
            "imported_count": imported_count,
            "duplicate_count": len(rows) - imported_count,
        }

    def reconciliation(self) -> dict[str, object]:
        rows = self.session.scalars(
            select(BankStatementRow)
            .options(
                joinedload(BankStatementRow.matched_transaction).joinedload(
                    Transaction.category
                )
            )
            .where(BankStatementRow.user_id == self.user_id)
            .order_by(BankStatementRow.booking_date.desc(), BankStatementRow.id.desc())
            .limit(200)
        ).all()
        reserved_transaction_ids = {
            int(row.matched_transaction_id)
            for row in rows
            if row.matched_transaction_id is not None
        }
        row_items = []
        status_counts = {
            "matched": 0,
            "suggested": 0,
            "ambiguous": 0,
            "missing": 0,
            "reviewed": 0,
        }
        for row in rows:
            item, reserved_id = self._serialize_statement_row(
                row, reserved_transaction_ids
            )
            if reserved_id is not None:
                reserved_transaction_ids.add(reserved_id)
            status_counts[str(item["status"])] += 1
            row_items.append(item)

        only_in_expenses = self._only_in_expenses(rows, reserved_transaction_ids)
        return {
            "summary": {
                "row_count": len(row_items),
                "unresolved_count": status_counts["missing"]
                + status_counts["ambiguous"],
                "suggested_count": status_counts["suggested"],
                "matched_count": status_counts["matched"],
                "reviewed_count": status_counts["reviewed"],
                "bank_total_cents": sum(int(row.amount_cents) for row in rows),
                "only_in_expenses_count": only_in_expenses["count"],
            },
            "rows": row_items,
            "only_in_expenses": only_in_expenses["items"],
        }

    def accept_suggestion(self, row_id: int) -> None:
        row = self._get_row(row_id)
        reserved_transaction_ids = set(
            self.session.scalars(
                select(BankStatementRow.matched_transaction_id).where(
                    BankStatementRow.user_id == self.user_id,
                    BankStatementRow.id != row.id,
                    BankStatementRow.matched_transaction_id.is_not(None),
                )
            )
        )
        candidates = self._candidate_transactions(row, reserved_transaction_ids)
        if len(candidates) != 1:
            raise ValueError("Bank row does not have exactly one suggested match")
        row.matched_transaction_id = candidates[0].id
        row.reviewed_at = None
        self.session.commit()

    def mark_reviewed(self, row_id: int) -> None:
        row = self._get_row(row_id)
        row.reviewed_at = datetime.now(UTC).replace(tzinfo=None)
        self.session.commit()

    def reopen(self, row_id: int) -> None:
        row = self._get_row(row_id)
        row.reviewed_at = None
        row.matched_transaction_id = None
        self.session.commit()

    def create_transaction(self, row_id: int) -> int:
        row = self._get_row(row_id)
        title = (row.payee or row.booking_text or row.purpose or "Bank transaction")[
            :200
        ]
        txn_type = (
            TransactionType.income if row.amount_cents > 0 else TransactionType.expense
        )
        txn = TransactionService(self.session, self.user_id).create(
            TransactionIn(
                date=row.booking_date,
                occurred_at=datetime.combine(row.booking_date, time(12, 0)),
                type=txn_type,
                amount_cents=abs(row.amount_cents),
                category_id=None,
                title=title,
                description=f"Commerzbank CSV: {row.raw_description}",
                tags=[],
            ),
            source="reconciliation",
        )
        row.matched_transaction_id = txn.id
        row.reviewed_at = None
        self.session.commit()
        return txn.id

    def _existing_hashes(self, hashes: list[str]) -> set[str]:
        if not hashes:
            return set()
        return set(
            self.session.scalars(
                select(BankStatementRow.import_hash).where(
                    BankStatementRow.user_id == self.user_id,
                    BankStatementRow.source == COMMERZBANK_CSV_SOURCE,
                    BankStatementRow.import_hash.in_(hashes),
                )
            )
        )

    def _get_row(self, row_id: int) -> BankStatementRow:
        row = self.session.scalar(
            select(BankStatementRow).where(
                BankStatementRow.user_id == self.user_id,
                BankStatementRow.id == row_id,
            )
        )
        if row is None:
            raise ValueError("Bank row not found")
        return row

    def _candidate_transactions(
        self, row: BankStatementRow, reserved_ids: set[int]
    ) -> list[Transaction]:
        txn_type = (
            TransactionType.income if row.amount_cents > 0 else TransactionType.expense
        )
        start = row.booking_date - timedelta(days=MATCH_WINDOW_DAYS)
        end = row.booking_date + timedelta(days=MATCH_WINDOW_DAYS)
        stmt = (
            select(Transaction)
            .options(joinedload(Transaction.category))
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == txn_type,
                Transaction.amount_cents == abs(row.amount_cents),
                Transaction.date >= start,
                Transaction.date <= end,
            )
        )
        if reserved_ids:
            stmt = stmt.where(Transaction.id.not_in(reserved_ids))
        candidates = list(self.session.scalars(stmt))
        candidates.sort(
            key=lambda txn: (
                abs((txn.date - row.booking_date).days),
                -fuzz.token_set_ratio(
                    row.raw_description.lower(), (txn.title or "").lower()
                ),
                txn.id,
            )
        )
        return candidates

    def _serialize_preview_row(
        self, row: ParsedBankStatementRow, *, duplicate: bool
    ) -> dict[str, object]:
        return {
            "booking_date": row.booking_date.isoformat(),
            "value_date": row.value_date.isoformat() if row.value_date else None,
            "amount_cents": row.amount_cents,
            "currency": row.currency,
            "payee": row.payee,
            "booking_text": row.booking_text,
            "purpose": row.purpose,
            "raw_description": row.raw_description,
            "duplicate": duplicate,
        }

    def _serialize_statement_row(
        self, row: BankStatementRow, reserved_ids: set[int]
    ) -> tuple[dict[str, object], int | None]:
        if row.matched_transaction_id is not None and row.matched_transaction:
            return (
                {
                    **self._serialize_bank_row_base(row),
                    "status": "matched",
                    "candidate_count": 1,
                    "suggested_transaction": self._serialize_transaction(
                        row.matched_transaction, row.booking_date
                    ),
                },
                None,
            )
        if row.reviewed_at is not None:
            return (
                {
                    **self._serialize_bank_row_base(row),
                    "status": "reviewed",
                    "candidate_count": 0,
                    "suggested_transaction": None,
                },
                None,
            )

        candidates = self._candidate_transactions(row, reserved_ids)
        if len(candidates) == 1:
            candidate = candidates[0]
            return (
                {
                    **self._serialize_bank_row_base(row),
                    "status": "suggested",
                    "candidate_count": 1,
                    "suggested_transaction": self._serialize_transaction(
                        candidate, row.booking_date
                    ),
                },
                candidate.id,
            )
        status = "ambiguous" if candidates else "missing"
        return (
            {
                **self._serialize_bank_row_base(row),
                "status": status,
                "candidate_count": len(candidates),
                "suggested_transaction": None,
            },
            None,
        )

    def _serialize_bank_row_base(self, row: BankStatementRow) -> dict[str, object]:
        return {
            "id": row.id,
            "account_label": row.account_label,
            "booking_date": row.booking_date.isoformat(),
            "value_date": row.value_date.isoformat() if row.value_date else None,
            "amount_cents": row.amount_cents,
            "currency": row.currency,
            "payee": row.payee,
            "booking_text": row.booking_text,
            "purpose": row.purpose,
            "raw_description": row.raw_description,
            "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        }

    def _serialize_transaction(
        self, txn: Transaction, booking_date: date
    ) -> dict[str, object]:
        return {
            "id": txn.id,
            "date": txn.date.isoformat(),
            "type": txn.type.value,
            "amount_cents": txn.amount_cents,
            "signed_amount_cents": txn.amount_cents
            if txn.type == TransactionType.income
            else -txn.amount_cents,
            "title": txn.title,
            "category": txn.category.name if txn.category else None,
            "date_delta_days": (booking_date - txn.date).days,
        }

    def _only_in_expenses(
        self, rows: list[BankStatementRow], reserved_transaction_ids: set[int]
    ) -> dict[str, object]:
        if not rows:
            return {"count": 0, "items": []}
        start = min(row.booking_date for row in rows) - timedelta(
            days=MATCH_WINDOW_DAYS
        )
        end = max(row.booking_date for row in rows) + timedelta(days=MATCH_WINDOW_DAYS)
        base_filters = [
            Transaction.user_id == self.user_id,
            Transaction.deleted_at.is_(None),
            Transaction.date >= start,
            Transaction.date <= end,
        ]
        count_stmt = select(func.count(Transaction.id)).where(*base_filters)
        item_stmt = (
            select(Transaction)
            .options(joinedload(Transaction.category))
            .where(*base_filters)
            .order_by(Transaction.date.desc(), Transaction.id.desc())
            .limit(30)
        )
        if reserved_transaction_ids:
            count_stmt = count_stmt.where(
                Transaction.id.not_in(reserved_transaction_ids)
            )
            item_stmt = item_stmt.where(Transaction.id.not_in(reserved_transaction_ids))
        return {
            "count": int(self.session.scalar(count_stmt) or 0),
            "items": [
                self._serialize_transaction(txn, txn.date)
                for txn in self.session.scalars(item_stmt)
            ],
        }
