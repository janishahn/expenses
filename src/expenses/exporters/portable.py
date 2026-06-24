from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Iterable, Iterator
from datetime import UTC, date, datetime
from decimal import Decimal
from enum import Enum
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from expenses.db.models import (
    BalanceAnchor,
    BankStatementRow,
    BudgetOverride,
    BudgetTemplate,
    Category,
    DurablePurchase,
    ReceiptAttachment,
    ReimbursementAllocation,
    RecurringRule,
    Rule,
    Tag,
    Transaction,
    TransactionClassificationEvent,
    TransactionTemplate,
)
from expenses.services import ReceiptAttachmentService


FORMAT_NAME = "expenses-portable-export"
FORMAT_VERSION = 1
_STREAM_BATCH = 500
EXCLUDED_INTERNAL_TABLES = [
    "users",
    "auth_sessions",
    "mobile_auth_sessions",
    "user_ingest_tokens",
    "monthly_rollups",
    "fx_quotes",
    "llm_jobs",
    "transaction_llm_suggestions",
    "rule_llm_suggestions",
]
IMPORT_GUIDE = """# Expenses Portable Export

This archive is intended for migration tools and agents importing Expenses data into
another system.

Read `manifest.json` and `schema.json` before reading data rows. Do not infer the
schema from a small row sample: sparse fields such as location, foreign-currency
details, recurring links, and reimbursement links may only appear on a few records.

Amounts are integer cents. Dates and datetimes are ISO strings. IDs are scoped to
this export and are included so relationships can be reconstructed. Attachment
metadata references receipt binaries by `archive_path`, relative to the ZIP root.
"""


class PortableExportError(Exception):
    """A receipt attachment could not be exported faithfully."""


def _enum_value(value: Enum | None) -> str | None:
    if value is None:
        return None
    return value.value


def _json_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [str(item) for item in json.loads(value)]


def _safe_archive_name(value: str) -> str:
    name = Path(value).name.strip() or "attachment"
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)


class ExportModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CategoryExport(ExportModel):
    id: int
    user_id: int
    name: str
    type: str
    color: str | None
    icon: str | None
    order: int
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TagExport(ExportModel):
    id: int
    user_id: int
    name: str
    color: str | None
    is_hidden_from_budget: bool
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TransactionExport(ExportModel):
    id: int
    user_id: int
    date: date
    occurred_at: datetime
    type: str
    is_reimbursement: bool
    amount_cents: int
    source_currency_code: str | None
    source_amount_cents: int | None
    fx_rate_micros: int | None
    fx_rate_date: date | None
    fx_provider: str | None
    fx_fetched_at: datetime | None
    category_id: int
    title: str | None
    description: str | None
    latitude: Decimal | None
    longitude: Decimal | None
    deleted_at: datetime | None
    origin_rule_id: int | None
    occurrence_date: date | None
    tag_ids: list[int]
    created_at: datetime
    updated_at: datetime


class ReceiptAttachmentExport(ExportModel):
    id: int
    user_id: int
    transaction_id: int
    storage_key: str
    archive_path: str
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256_hex: str
    created_at: datetime
    updated_at: datetime


class RecurringRuleExport(ExportModel):
    id: int
    user_id: int
    name: str | None
    type: str
    currency_code: str
    amount_cents: int
    category_id: int
    anchor_date: date
    interval_unit: str
    interval_count: int
    next_occurrence: date
    end_date: date | None
    auto_post: bool
    skip_weekends: bool
    month_day_policy: str
    created_at: datetime
    updated_at: datetime


class TransactionTemplateExport(ExportModel):
    id: int
    user_id: int
    name: str
    type: str
    category_id: int
    default_amount_cents: int | None
    title: str | None
    tags: list[str]
    sort_order: int
    created_at: datetime
    updated_at: datetime


class DurablePurchaseExport(ExportModel):
    id: int
    user_id: int
    transaction_id: int
    expected_lifespan_days: int
    acquired_on: date
    created_at: datetime
    updated_at: datetime


class ReimbursementAllocationExport(ExportModel):
    id: int
    user_id: int
    reimbursement_transaction_id: int
    expense_transaction_id: int
    amount_cents: int
    created_at: datetime
    updated_at: datetime


class BudgetTemplateExport(ExportModel):
    id: int
    user_id: int
    frequency: str
    category_id: int | None
    amount_cents: int
    starts_on: date
    ends_on: date | None
    created_at: datetime
    updated_at: datetime


class BudgetOverrideExport(ExportModel):
    id: int
    user_id: int
    year: int
    month: int
    category_id: int | None
    amount_cents: int
    created_at: datetime
    updated_at: datetime


class RuleExport(ExportModel):
    id: int
    user_id: int
    name: str
    enabled: bool
    priority: int
    match_type: str
    match_value: str
    transaction_type: str | None
    min_amount_cents: int | None
    max_amount_cents: int | None
    set_category_id: int | None
    add_tags: list[str]
    budget_exclude_tag_id: int | None
    created_at: datetime
    updated_at: datetime


class BalanceAnchorExport(ExportModel):
    id: int
    user_id: int
    as_of_at: datetime
    balance_cents: int
    note: str | None
    created_at: datetime
    updated_at: datetime


class BankStatementRowExport(ExportModel):
    id: int
    user_id: int
    source: str
    account_label: str
    booking_date: date
    value_date: date | None
    amount_cents: int
    currency: str
    payee: str | None
    booking_text: str | None
    purpose: str | None
    raw_description: str
    import_hash: str
    matched_transaction_id: int | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TransactionClassificationEventExport(ExportModel):
    id: int
    user_id: int
    transaction_id: int
    event_type: str
    source: str
    before_category_id: int | None
    after_category_id: int | None
    before_title: str | None
    after_title: str | None
    before_tags: list[str]
    after_tags: list[str]
    created_at: datetime


DATASET_MODELS: dict[str, type[ExportModel]] = {
    "categories": CategoryExport,
    "tags": TagExport,
    "transactions": TransactionExport,
    "receipt_attachments": ReceiptAttachmentExport,
    "recurring_rules": RecurringRuleExport,
    "transaction_templates": TransactionTemplateExport,
    "durable_purchases": DurablePurchaseExport,
    "reimbursement_allocations": ReimbursementAllocationExport,
    "budget_templates": BudgetTemplateExport,
    "budget_overrides": BudgetOverrideExport,
    "rules": RuleExport,
    "balance_anchors": BalanceAnchorExport,
    "bank_statement_rows": BankStatementRowExport,
    "transaction_classification_events": TransactionClassificationEventExport,
}


class PortableExportService:
    def __init__(self, session: Session, user_id: int) -> None:
        self.session = session
        self.user_id = user_id
        self.attachment_service = ReceiptAttachmentService(session, user_id=user_id)

    def write_zip(self, output_path: Path, *, app_version: str) -> dict[str, object]:
        try:
            with ZipFile(
                output_path,
                mode="w",
                compression=ZIP_DEFLATED,
                allowZip64=True,
            ) as archive:
                archive.writestr("schema.json", self._schema_json())
                archive.writestr("IMPORT.md", IMPORT_GUIDE)

                datasets: dict[str, dict[str, object]] = {}
                for name, build_rows in self._datasets().items():
                    datasets[name] = self._write_dataset(archive, name, build_rows())

                attachment_summary = self._write_attachments_dataset(archive, datasets)
                manifest = {
                    "format": FORMAT_NAME,
                    "format_version": FORMAT_VERSION,
                    "app": {"name": "expenses", "version": app_version},
                    "generated_at": datetime.now(UTC).isoformat(),
                    "scope": {"type": "current_user", "user_id": self.user_id},
                    "datasets": datasets,
                    "attachments": attachment_summary,
                    "excluded_internal_tables": EXCLUDED_INTERNAL_TABLES,
                }
                archive.writestr(
                    "manifest.json",
                    json.dumps(manifest, indent=2, sort_keys=True) + "\n",
                )
        except Exception:
            output_path.unlink(missing_ok=True)
            raise
        return manifest

    def _schema_json(self) -> str:
        schema = {
            "format": FORMAT_NAME,
            "format_version": FORMAT_VERSION,
            "datasets": {
                name: model.model_json_schema()
                for name, model in DATASET_MODELS.items()
            },
        }
        return json.dumps(schema, indent=2, sort_keys=True) + "\n"

    def _write_dataset(
        self, archive: ZipFile, name: str, rows: Iterable[ExportModel]
    ) -> dict[str, object]:
        path = f"data/{name}.ndjson"
        digest = hashlib.sha256()
        row_count = 0
        with archive.open(path, "w") as out:
            for row in rows:
                line = row.model_dump_json() + "\n"
                data = line.encode("utf-8")
                digest.update(data)
                out.write(data)
                row_count += 1
        return {"path": path, "row_count": row_count, "sha256": digest.hexdigest()}

    def _write_attachments_dataset(
        self, archive: ZipFile, datasets: dict[str, dict[str, object]]
    ) -> dict[str, int]:
        rows = self._receipt_attachment_rows()
        exported_rows: list[ReceiptAttachmentExport] = []
        total_bytes = 0
        for attachment in rows:
            source_path = self.attachment_service.path_for_storage_key(
                attachment.storage_key
            )
            if not source_path.exists():
                raise PortableExportError("Attachment file not found")

            archive_path = self._attachment_archive_path(attachment)
            file_digest = hashlib.sha256()
            size_bytes = 0
            with (
                source_path.open("rb") as source,
                archive.open(archive_path, "w") as attachment_out,
            ):
                while chunk := source.read(1024 * 1024):
                    file_digest.update(chunk)
                    attachment_out.write(chunk)
                    size_bytes += len(chunk)

            if size_bytes != attachment.size_bytes:
                raise PortableExportError("Attachment size mismatch")
            if file_digest.hexdigest() != attachment.sha256_hex:
                raise PortableExportError("Attachment checksum mismatch")

            exported_rows.append(
                ReceiptAttachmentExport(
                    id=attachment.id,
                    user_id=attachment.user_id,
                    transaction_id=attachment.transaction_id,
                    storage_key=attachment.storage_key,
                    archive_path=archive_path,
                    original_filename=attachment.original_filename,
                    mime_type=attachment.mime_type,
                    size_bytes=attachment.size_bytes,
                    sha256_hex=attachment.sha256_hex,
                    created_at=attachment.created_at,
                    updated_at=attachment.updated_at,
                )
            )
            total_bytes += size_bytes

        datasets["receipt_attachments"] = self._write_dataset(
            archive, "receipt_attachments", exported_rows
        )
        return {
            "included_count": len(rows),
            "total_bytes": total_bytes,
        }

    def _attachment_archive_path(self, attachment: ReceiptAttachment) -> str:
        safe_name = _safe_archive_name(attachment.original_filename)
        return f"attachments/transactions_{attachment.transaction_id}/{attachment.id}_{safe_name}"

    def _datasets(self) -> dict[str, Callable[[], Iterable[ExportModel]]]:
        return {
            "categories": self._category_rows,
            "tags": self._tag_rows,
            "transactions": self._transaction_rows,
            "recurring_rules": self._recurring_rule_rows,
            "transaction_templates": self._transaction_template_rows,
            "durable_purchases": self._durable_purchase_rows,
            "reimbursement_allocations": self._reimbursement_allocation_rows,
            "budget_templates": self._budget_template_rows,
            "budget_overrides": self._budget_override_rows,
            "rules": self._rule_rows,
            "balance_anchors": self._balance_anchor_rows,
            "bank_statement_rows": self._bank_statement_row_rows,
            "transaction_classification_events": (
                self._transaction_classification_event_rows
            ),
        }

    def _category_rows(self) -> Iterator[CategoryExport]:
        rows = self.session.scalars(
            select(Category)
            .where(Category.user_id == self.user_id)
            .order_by(Category.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield CategoryExport(
                id=row.id,
                user_id=row.user_id,
                name=row.name,
                type=row.type.value,
                color=row.color,
                icon=row.icon,
                order=row.order,
                archived_at=row.archived_at,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _tag_rows(self) -> Iterator[TagExport]:
        rows = self.session.scalars(
            select(Tag).where(Tag.user_id == self.user_id).order_by(Tag.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield TagExport(
                id=row.id,
                user_id=row.user_id,
                name=row.name,
                color=row.color,
                is_hidden_from_budget=row.is_hidden_from_budget,
                archived_at=row.archived_at,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _transaction_rows(self) -> Iterator[TransactionExport]:
        rows = self.session.scalars(
            select(Transaction)
            .options(selectinload(Transaction.tags))
            .where(Transaction.user_id == self.user_id)
            .order_by(Transaction.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield TransactionExport(
                id=row.id,
                user_id=row.user_id,
                date=row.date,
                occurred_at=row.occurred_at,
                type=row.type.value,
                is_reimbursement=row.is_reimbursement,
                amount_cents=row.amount_cents,
                source_currency_code=_enum_value(row.source_currency_code),
                source_amount_cents=row.source_amount_cents,
                fx_rate_micros=row.fx_rate_micros,
                fx_rate_date=row.fx_rate_date,
                fx_provider=row.fx_provider,
                fx_fetched_at=row.fx_fetched_at,
                category_id=row.category_id,
                title=row.title,
                description=row.description,
                latitude=row.latitude,
                longitude=row.longitude,
                deleted_at=row.deleted_at,
                origin_rule_id=row.origin_rule_id,
                occurrence_date=row.occurrence_date,
                tag_ids=sorted(tag.id for tag in row.tags),
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _receipt_attachment_rows(self) -> list[ReceiptAttachment]:
        return self.session.scalars(
            select(ReceiptAttachment)
            .where(ReceiptAttachment.user_id == self.user_id)
            .order_by(ReceiptAttachment.id.asc())
        ).all()

    def _recurring_rule_rows(self) -> Iterator[RecurringRuleExport]:
        rows = self.session.scalars(
            select(RecurringRule)
            .where(RecurringRule.user_id == self.user_id)
            .order_by(RecurringRule.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield RecurringRuleExport(
                id=row.id,
                user_id=row.user_id,
                name=row.name,
                type=row.type.value,
                currency_code=row.currency_code.value,
                amount_cents=row.amount_cents,
                category_id=row.category_id,
                anchor_date=row.anchor_date,
                interval_unit=row.interval_unit.value,
                interval_count=row.interval_count,
                next_occurrence=row.next_occurrence,
                end_date=row.end_date,
                auto_post=row.auto_post,
                skip_weekends=row.skip_weekends,
                month_day_policy=row.month_day_policy.value,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _transaction_template_rows(self) -> Iterator[TransactionTemplateExport]:
        rows = self.session.scalars(
            select(TransactionTemplate)
            .where(TransactionTemplate.user_id == self.user_id)
            .order_by(TransactionTemplate.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield TransactionTemplateExport(
                id=row.id,
                user_id=row.user_id,
                name=row.name,
                type=row.type.value,
                category_id=row.category_id,
                default_amount_cents=row.default_amount_cents,
                title=row.title,
                tags=_json_list(row.tags_json),
                sort_order=row.sort_order,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _durable_purchase_rows(self) -> Iterator[DurablePurchaseExport]:
        rows = self.session.scalars(
            select(DurablePurchase)
            .where(DurablePurchase.user_id == self.user_id)
            .order_by(DurablePurchase.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield DurablePurchaseExport(
                id=row.id,
                user_id=row.user_id,
                transaction_id=row.transaction_id,
                expected_lifespan_days=row.expected_lifespan_days,
                acquired_on=row.acquired_on,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _reimbursement_allocation_rows(self) -> Iterator[ReimbursementAllocationExport]:
        rows = self.session.scalars(
            select(ReimbursementAllocation)
            .where(ReimbursementAllocation.user_id == self.user_id)
            .order_by(ReimbursementAllocation.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield ReimbursementAllocationExport(
                id=row.id,
                user_id=row.user_id,
                reimbursement_transaction_id=row.reimbursement_transaction_id,
                expense_transaction_id=row.expense_transaction_id,
                amount_cents=row.amount_cents,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _budget_template_rows(self) -> Iterator[BudgetTemplateExport]:
        rows = self.session.scalars(
            select(BudgetTemplate)
            .where(BudgetTemplate.user_id == self.user_id)
            .order_by(BudgetTemplate.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield BudgetTemplateExport(
                id=row.id,
                user_id=row.user_id,
                frequency=row.frequency.value,
                category_id=row.category_id,
                amount_cents=row.amount_cents,
                starts_on=row.starts_on,
                ends_on=row.ends_on,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _budget_override_rows(self) -> Iterator[BudgetOverrideExport]:
        rows = self.session.scalars(
            select(BudgetOverride)
            .where(BudgetOverride.user_id == self.user_id)
            .order_by(BudgetOverride.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield BudgetOverrideExport(
                id=row.id,
                user_id=row.user_id,
                year=row.year,
                month=row.month,
                category_id=row.category_id,
                amount_cents=row.amount_cents,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _rule_rows(self) -> Iterator[RuleExport]:
        rows = self.session.scalars(
            select(Rule).where(Rule.user_id == self.user_id).order_by(Rule.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield RuleExport(
                id=row.id,
                user_id=row.user_id,
                name=row.name,
                enabled=row.enabled,
                priority=row.priority,
                match_type=row.match_type.value,
                match_value=row.match_value,
                transaction_type=_enum_value(row.transaction_type),
                min_amount_cents=row.min_amount_cents,
                max_amount_cents=row.max_amount_cents,
                set_category_id=row.set_category_id,
                add_tags=_json_list(row.add_tags_json),
                budget_exclude_tag_id=row.budget_exclude_tag_id,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _balance_anchor_rows(self) -> Iterator[BalanceAnchorExport]:
        rows = self.session.scalars(
            select(BalanceAnchor)
            .where(BalanceAnchor.user_id == self.user_id)
            .order_by(BalanceAnchor.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield BalanceAnchorExport(
                id=row.id,
                user_id=row.user_id,
                as_of_at=row.as_of_at,
                balance_cents=row.balance_cents,
                note=row.note,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _bank_statement_row_rows(self) -> Iterator[BankStatementRowExport]:
        rows = self.session.scalars(
            select(BankStatementRow)
            .where(BankStatementRow.user_id == self.user_id)
            .order_by(BankStatementRow.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield BankStatementRowExport(
                id=row.id,
                user_id=row.user_id,
                source=row.source,
                account_label=row.account_label,
                booking_date=row.booking_date,
                value_date=row.value_date,
                amount_cents=row.amount_cents,
                currency=row.currency,
                payee=row.payee,
                booking_text=row.booking_text,
                purpose=row.purpose,
                raw_description=row.raw_description,
                import_hash=row.import_hash,
                matched_transaction_id=row.matched_transaction_id,
                reviewed_at=row.reviewed_at,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )

    def _transaction_classification_event_rows(
        self,
    ) -> Iterator[TransactionClassificationEventExport]:
        rows = self.session.scalars(
            select(TransactionClassificationEvent)
            .where(TransactionClassificationEvent.user_id == self.user_id)
            .order_by(TransactionClassificationEvent.id.asc())
        ).yield_per(_STREAM_BATCH)
        for row in rows:
            yield TransactionClassificationEventExport(
                id=row.id,
                user_id=row.user_id,
                transaction_id=row.transaction_id,
                event_type=row.event_type,
                source=row.source,
                before_category_id=row.before_category_id,
                after_category_id=row.after_category_id,
                before_title=row.before_title,
                after_title=row.after_title,
                before_tags=_json_list(row.before_tags_json),
                after_tags=_json_list(row.after_tags_json),
                created_at=row.created_at,
            )
