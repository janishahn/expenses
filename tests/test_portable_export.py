import hashlib
import json
from io import BytesIO
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from zipfile import ZipFile

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import expenses_web.app as app_main
from expenses_web.core.config import get_settings
from expenses_web.db.models import (
    BalanceAnchor,
    BankStatementRow,
    BudgetFrequency,
    BudgetOverride,
    BudgetTemplate,
    Category,
    CurrencyCode,
    DurablePurchase,
    IntervalUnit,
    MonthDayPolicy,
    ReceiptAttachment,
    ReimbursementAllocation,
    RecurringRule,
    Rule,
    RuleMatchType,
    Tag,
    Transaction,
    TransactionClassificationEvent,
    TransactionTemplate,
    TransactionType,
)
from expenses_web.db.session import Base
from expenses_web.exporters.portable import PortableExportService
from expenses_web.services import ReceiptAttachmentService


def _read_ndjson(archive: ZipFile, path: str) -> list[dict[str, object]]:
    text = archive.read(path).decode("utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _create_session() -> Session:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def test_portable_export_zip_is_self_describing_and_includes_rare_fields(
    tmp_path: Path, monkeypatch
) -> None:
    receipts_dir = tmp_path / "receipts"
    monkeypatch.setenv("EXPENSES_RECEIPTS_DIR", str(receipts_dir))
    get_settings.cache_clear()

    session = _create_session()
    try:
        expense_category = Category(
            user_id=1,
            name="Travel",
            type=TransactionType.expense,
            color="#123456",
            icon="airplane",
            order=2,
        )
        income_category = Category(
            user_id=1,
            name="Reimbursements",
            type=TransactionType.income,
            color="#654321",
            icon="arrow-u-up-left",
            order=3,
        )
        tag = Tag(
            user_id=1,
            name="Client",
            color="#abcdef",
            is_hidden_from_budget=True,
        )
        session.add_all([expense_category, income_category, tag])
        session.flush()

        recurring = RecurringRule(
            user_id=1,
            name="Monthly rail pass",
            type=TransactionType.expense,
            currency_code=CurrencyCode.eur,
            amount_cents=4999,
            category_id=expense_category.id,
            anchor_date=date(2026, 1, 1),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=date(2026, 2, 1),
            end_date=None,
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        )
        session.add(recurring)
        session.flush()

        expense = Transaction(
            user_id=1,
            date=date(2026, 1, 12),
            occurred_at=datetime(2026, 1, 12, 9, 30),
            type=TransactionType.expense,
            is_reimbursement=False,
            amount_cents=12345,
            source_currency_code=CurrencyCode.usd,
            source_amount_cents=13579,
            fx_rate_micros=908_000,
            fx_rate_date=date(2026, 1, 11),
            fx_provider="fixture-bank",
            fx_fetched_at=datetime(2026, 1, 11, 18, 0),
            category_id=expense_category.id,
            title="Client train",
            description=None,
            latitude=Decimal("52.520008"),
            longitude=Decimal("13.404954"),
            origin_rule_id=recurring.id,
            occurrence_date=date(2026, 1, 12),
        )
        expense.tags.append(tag)
        reimbursement = Transaction(
            user_id=1,
            date=date(2026, 1, 20),
            occurred_at=datetime(2026, 1, 20, 12, 0),
            type=TransactionType.income,
            is_reimbursement=True,
            amount_cents=5000,
            category_id=income_category.id,
            title="Client reimbursement",
        )
        session.add_all([expense, reimbursement])
        session.flush()

        session.add_all(
            [
                DurablePurchase(
                    user_id=1,
                    transaction_id=expense.id,
                    expected_lifespan_days=365,
                    acquired_on=date(2026, 1, 12),
                ),
                ReimbursementAllocation(
                    user_id=1,
                    reimbursement_transaction_id=reimbursement.id,
                    expense_transaction_id=expense.id,
                    amount_cents=5000,
                ),
                TransactionTemplate(
                    user_id=1,
                    name="Travel template",
                    type=TransactionType.expense,
                    category_id=expense_category.id,
                    default_amount_cents=12345,
                    title="Client train",
                    tags_json='["Client"]',
                    sort_order=1,
                ),
                BudgetTemplate(
                    user_id=1,
                    frequency=BudgetFrequency.monthly,
                    category_id=expense_category.id,
                    amount_cents=40_000,
                    starts_on=date(2026, 1, 1),
                    ends_on=None,
                ),
                BudgetOverride(
                    user_id=1,
                    year=2026,
                    month=1,
                    category_id=expense_category.id,
                    amount_cents=45_000,
                ),
                Rule(
                    user_id=1,
                    name="Travel client",
                    enabled=True,
                    priority=10,
                    match_type=RuleMatchType.contains,
                    match_value="train",
                    transaction_type=TransactionType.expense,
                    min_amount_cents=1000,
                    max_amount_cents=None,
                    set_category_id=expense_category.id,
                    add_tags_json='["Client"]',
                    budget_exclude_tag_id=tag.id,
                ),
                BalanceAnchor(
                    user_id=1,
                    as_of_at=datetime(2026, 1, 31, 23, 59),
                    balance_cents=250_000,
                    note="Month end",
                ),
                BankStatementRow(
                    user_id=1,
                    source="test_bank_csv",
                    account_label="Checking",
                    booking_date=date(2026, 1, 12),
                    value_date=date(2026, 1, 13),
                    amount_cents=-12345,
                    currency="EUR",
                    payee="Rail Company",
                    booking_text="Card",
                    purpose="Client train",
                    raw_description="Rail Company Client train",
                    import_hash="a" * 64,
                    matched_transaction_id=expense.id,
                    reviewed_at=datetime(2026, 1, 14, 8, 0),
                ),
                TransactionClassificationEvent(
                    user_id=1,
                    transaction_id=expense.id,
                    event_type="update",
                    source="rule",
                    before_category_id=None,
                    after_category_id=expense_category.id,
                    before_title="Train",
                    after_title="Client train",
                    before_tags_json="[]",
                    after_tags_json='["Client"]',
                ),
            ]
        )
        session.commit()

        attachment_bytes = b"%PDF-1.4 portable export fixture\n"
        attachment_service = ReceiptAttachmentService(session, user_id=1)
        storage_key = attachment_service.generate_storage_key(expense.id, "receipt.pdf")
        attachment_path = attachment_service.path_for_storage_key(storage_key)
        attachment_path.parent.mkdir(parents=True, exist_ok=True)
        attachment_path.write_bytes(attachment_bytes)
        attachment_service.create_metadata(
            transaction_id=expense.id,
            storage_key=storage_key,
            original_filename="receipt.pdf",
            mime_type="application/pdf",
            size_bytes=len(attachment_bytes),
            sha256_hex=hashlib.sha256(attachment_bytes).hexdigest(),
        )

        output_path = tmp_path / "portable.zip"
        PortableExportService(session, user_id=1).write_zip(
            output_path, app_version="9.9.9-test"
        )

        with ZipFile(output_path) as archive:
            names = set(archive.namelist())
            assert {"manifest.json", "schema.json", "IMPORT.md"}.issubset(names)
            assert "data/transactions.ndjson" in names
            assert "data/receipt_attachments.ndjson" in names

            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["format"] == "expenses-web-portable-export"
            assert manifest["format_version"] == 1
            assert manifest["app"] == {
                "name": "expenses-web",
                "version": "9.9.9-test",
            }
            assert manifest["scope"] == {"type": "current_user", "user_id": 1}
            assert "auth_sessions" in manifest["excluded_internal_tables"]
            assert manifest["datasets"]["transactions"]["row_count"] == 2

            txns_bytes = archive.read("data/transactions.ndjson")
            assert (
                manifest["datasets"]["transactions"]["sha256"]
                == hashlib.sha256(txns_bytes).hexdigest()
            )

            schema = json.loads(archive.read("schema.json"))
            transaction_properties = schema["datasets"]["transactions"]["properties"]
            for field_name in (
                "source_currency_code",
                "source_amount_cents",
                "fx_rate_micros",
                "fx_rate_date",
                "fx_provider",
                "fx_fetched_at",
                "latitude",
                "longitude",
                "deleted_at",
                "origin_rule_id",
                "occurrence_date",
                "tag_ids",
            ):
                assert field_name in transaction_properties

            transactions = _read_ndjson(archive, "data/transactions.ndjson")
            expense_export = next(
                row for row in transactions if row["id"] == expense.id
            )
            assert expense_export["source_currency_code"] == "USD"
            assert expense_export["source_amount_cents"] == 13579
            assert expense_export["fx_rate_micros"] == 908_000
            assert expense_export["latitude"] == "52.520008"
            assert expense_export["longitude"] == "13.404954"
            assert expense_export["deleted_at"] is None
            assert expense_export["tag_ids"] == [tag.id]

            attachments = _read_ndjson(archive, "data/receipt_attachments.ndjson")
            assert len(attachments) == 1
            attachment_export = attachments[0]
            archive_path = str(attachment_export["archive_path"])
            assert archive_path.startswith("attachments/")
            assert archive.read(archive_path) == attachment_bytes
            assert (
                attachment_export["sha256_hex"]
                == hashlib.sha256(attachment_bytes).hexdigest()
            )
    finally:
        session.close()
        get_settings.cache_clear()


def _create_category(
    client: TestClient, headers: dict[str, str], name: str, txn_type: str
) -> int:
    response = client.post(
        "/api/categories",
        headers=headers,
        json={"name": name, "type": txn_type, "order": 0},
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def _create_transaction(
    client: TestClient,
    headers: dict[str, str],
    *,
    category_id: int,
    title: str,
) -> int:
    response = client.post(
        "/api/transactions",
        headers=headers,
        json={
            "date": "2026-01-12",
            "occurred_at": "2026-01-12T12:00:00",
            "type": "expense",
            "amount_cents": 1299,
            "category_id": category_id,
            "title": title,
            "tags": ["Portable"],
        },
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def test_portable_export_api_returns_zip(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Portable", "expense")
    _create_transaction(api_client, csrf_headers, category_id=category_id, title="Zip")

    response = api_client.get("/api/export/portable.zip")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/zip")
    assert "expenses_portable_export_" in response.headers["content-disposition"]

    with ZipFile(BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["format"] == "expenses-web-portable-export"
        assert manifest["datasets"]["transactions"]["row_count"] == 1


def test_portable_export_api_requires_authentication(
    anonymous_api_client: TestClient,
) -> None:
    response = anonymous_api_client.get("/api/export/portable.zip")

    assert response.status_code == 401
    assert response.json()["detail"] == "Authentication required"


def test_portable_export_api_rejects_missing_receipt_file(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Missing file", "expense")
    transaction_id = _create_transaction(
        api_client, csrf_headers, category_id=category_id, title="Receipt"
    )
    upload = api_client.post(
        f"/api/transactions/{transaction_id}/attachments",
        headers=csrf_headers,
        files={"file": ("receipt.pdf", b"%PDF missing\n", "application/pdf")},
    )
    assert upload.status_code == 200

    override = app_main.app.dependency_overrides[app_main.get_db]
    db_iterator = override()
    db = next(db_iterator)
    try:
        attachment = db.scalar(select(ReceiptAttachment))
        assert attachment is not None
        ReceiptAttachmentService(db, user_id=1).path_for_storage_key(
            attachment.storage_key
        ).unlink()
    finally:
        db_iterator.close()

    response = api_client.get("/api/export/portable.zip")

    assert response.status_code == 409
    assert response.json()["detail"] == "Attachment file not found"
