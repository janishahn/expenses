from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from time import perf_counter
from typing import Any

from sqlalchemy import Connection, Engine, case, func, or_, select, update
from sqlalchemy.orm import Session, aliased, joinedload

from expenses.ai.client import (
    LLMDisabledError,
    LLMOutputError,
    LLMRunner,
    LLMRunResult,
    PydanticAILLMRunner,
)
from expenses.ai.features import Feature, resolve
from expenses.ai.schemas import (
    ProductMergesOutput,
    ReceiptReadingOutput,
    RuleMiningOutput,
    RuleProposalOut,
    RuleSuggestionOut,
    RuleSuggestionResult,
    TransactionSuggestionOut,
    TransactionTriageOutput,
)
from expenses.ai.usage import apply_usage_metadata
from expenses.core.app_logging import get_logger, log_event
from expenses.core.config import get_settings
from expenses.core.safe_regex import RegexRejected, safe_regex_search
from expenses.db.models import (
    Category,
    LLMJob,
    ReceiptAttachment,
    ReceiptItem,
    RuleLLMSuggestion,
    RuleMatchType,
    Tag,
    Transaction,
    TransactionClassificationEvent,
    TransactionLLMSuggestion,
    TransactionType,
)
from expenses.schemas import MAX_AMOUNT_CENTS, RuleIn, TransactionIn
from expenses.services.main import (
    CategoryService,
    ReceiptAttachmentService,
    RuleService,
    TransactionService,
    local_today,
)

logger = get_logger("expenses.ai")

TRANSACTION_TRIAGE_PROMPT = "transaction_triage_v2"
RULE_MINING_PROMPT = "rule_mining_v2"
RECEIPT_ITEMS_PROMPT = "receipt_items_v3"
RECEIPT_PRODUCTS_PROMPT = "receipt_products_v1"
# Long enough for small receipt print, small enough to keep the image's tokens low.
RECEIPT_IMAGE_EDGE = 1600
RECEIPT_PRODUCT_NAMES = 300
READABLE_RECEIPT_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
# A reading that failed with this error is tried again, at startup and each night.
RECEIPT_MODEL_UNREACHABLE = "The model could not be reached."
# The merge pass sees each product with a few of its printed labels.
MERGE_PRODUCT_NAMES = 1_000
MERGE_SAMPLE_LABELS = 3

DEFAULT_TRACE_KEEP_RECENT = 1_000
DEFAULT_TRACE_MAX_AGE_DAYS = 30
# No model call runs this long, so a run still running by then was cut off,
# for example by a restart.
ABANDONED_RUN_AGE = timedelta(days=1)


class LLMAssistantService:
    def __init__(
        self,
        session: Session,
        user_id: int,
        runner: LLMRunner | None = None,
    ) -> None:
        self.session = session
        self.user_id = user_id
        self.runner = runner

    async def suggest_uncategorized_transaction(
        self, transaction_id: int
    ) -> TransactionLLMSuggestion | None:
        txn = self._transaction_for_triage(transaction_id)
        if txn is None:
            return None
        fingerprint = self._transaction_fingerprint(txn)
        existing = self.session.scalar(
            select(TransactionLLMSuggestion).where(
                TransactionLLMSuggestion.user_id == self.user_id,
                TransactionLLMSuggestion.transaction_id == txn.id,
                TransactionLLMSuggestion.fingerprint_hash == fingerprint,
            )
        )
        if existing:
            if existing.status != "pending":
                existing.status = "pending"
                self.session.commit()
                self.session.refresh(existing)
            return existing
        payload = {
            "transaction": self._serialize_transaction(txn),
            "categories": self._category_payload(txn.type),
            "tags": [row["name"] for row in self._tag_payload()],
            "similar_confirmed_transactions": self._similar_confirmed_transactions(txn),
        }
        try:
            output, job_id = await self._run_llm(
                feature="transaction_triage",
                prompt_version=TRANSACTION_TRIAGE_PROMPT,
                payload=payload,
                output_type=TransactionTriageOutput,
                entity_type="transaction",
                entity_id=txn.id,
            )
        except LLMOutputError:
            return None
        fresh_txn = self._transaction_for_triage(transaction_id)
        if fresh_txn is None or self._transaction_fingerprint(fresh_txn) != fingerprint:
            log_event(
                logger,
                logging.INFO,
                "llm_transaction_triage_stale",
                transaction_id=transaction_id,
            )
            return None
        if output.category_id is not None:
            category = self.session.get(Category, output.category_id)
            if (
                category is None
                or category.user_id != self.user_id
                or category.type != fresh_txn.type
            ):
                return None
        allowed_tags = set(payload["tags"])
        if allowed_tags:
            output.tags = [tag for tag in output.tags if tag in allowed_tags]
        clean_title = output.clean_title or fresh_txn.title or ""
        if (
            output.category_id is None
            and not output.tags
            and clean_title.strip().casefold()
            == (fresh_txn.title or "").strip().casefold()
        ):
            return None
        suggestion = TransactionLLMSuggestion(
            user_id=self.user_id,
            transaction_id=fresh_txn.id,
            job_id=job_id,
            fingerprint_hash=fingerprint,
            category_id=output.category_id,
            clean_title=clean_title,
            tags_json=_json_dumps(output.tags),
            confidence_bps=_confidence_bps(output.confidence),
            reason=output.reason,
        )
        self.session.add(suggestion)
        self.session.commit()
        self.session.refresh(suggestion)
        return suggestion

    async def read_receipt_items(self, attachment_id: int) -> None:
        """Reads a receipt image marked reading into its items, or marks it failed."""
        attachment = self.session.get(ReceiptAttachment, attachment_id)
        if (
            attachment is None
            or attachment.user_id != self.user_id
            or attachment.items_status != "reading"
        ):
            return
        storage_key = attachment.storage_key
        path = ReceiptAttachmentService(
            self.session, user_id=self.user_id
        ).path_for_storage_key(storage_key)
        payload = {"products": self._receipt_product_names()}
        output: ReceiptReadingOutput | None = None
        error: str | None = None
        try:
            image = await asyncio.to_thread(_receipt_image, path)
            output, _ = await self._run_llm(
                feature="receipt_items",
                prompt_version=RECEIPT_ITEMS_PROMPT,
                payload=payload,
                output_type=ReceiptReadingOutput,
                entity_type="receipt_attachment",
                entity_id=attachment_id,
                images=[(image, "image/jpeg")],
            )
        except (ValueError, LLMDisabledError) as exc:
            error = str(exc)
        except LLMOutputError:
            error = "The model's answer was not a readable list of items."
        except Exception:  # noqa: BLE001
            # _run_llm has logged the cause.
            error = RECEIPT_MODEL_UNREACHABLE
        # The receipt may have been deleted, replaced, or read again during the
        # call. SQLite can give a deleted receipt's id to a new upload, so the
        # owner and stored file must still match.
        self.session.expire_all()
        attachment = self.session.get(ReceiptAttachment, attachment_id)
        if (
            attachment is None
            or attachment.user_id != self.user_id
            or attachment.storage_key != storage_key
            or attachment.items_status != "reading"
        ):
            return
        if output is None or not output.is_receipt:
            if attachment.items:
                # A failed re-read keeps the items read before.
                attachment.items_status = "read"
                attachment.items_error = error or "This image is not a receipt."
            elif output is not None:
                attachment.items_status = "not_receipt"
                attachment.items_error = None
            else:
                attachment.items_status = "failed"
                attachment.items_error = error
        else:
            # A label read before keeps its product, also on this receipt when read
            # again, so the same line always groups the same way and a product
            # named by hand stays named.
            known = {
                label: (product, by_user)
                for label, product, by_user in self.session.execute(
                    select(
                        ReceiptItem.label,
                        ReceiptItem.product,
                        ReceiptItem.product_named_by_user,
                    )
                    # Only each label's latest item.
                    .where(
                        ReceiptItem.id.in_(
                            select(func.max(ReceiptItem.id))
                            .where(
                                ReceiptItem.user_id == self.user_id,
                                ReceiptItem.label.in_(
                                    {line.label for line in output.items}
                                ),
                            )
                            .group_by(ReceiptItem.label)
                        )
                    )
                )
            }
            attachment.items.clear()
            attachment.items_status = "read"
            attachment.items_error = None
            for position, line in enumerate(output.items):
                product, by_user = known.get(line.label, (line.product, False))
                attachment.items.append(
                    ReceiptItem(
                        user_id=self.user_id,
                        position=position,
                        label=line.label,
                        product=product,
                        product_named_by_user=by_user,
                        kind=line.kind,
                        quantity=(
                            line.quantity.quantize(Decimal("0.001"))
                            if line.quantity is not None
                            else None
                        ),
                        unit=line.unit,
                        unit_price_cents=line.unit_price_cents,
                        amount_cents=line.amount_cents,
                    )
                )
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "receipt_items_read",
            attachment_id=attachment_id,
            status=attachment.items_status,
            items=len(attachment.items),
        )

    async def merge_receipt_products(self) -> int:
        """Lets the model merge product names that name the same kind of product.

        Returns how many items took a new name.
        """
        # The most common products, and each one's most common labels, are
        # chosen in SQL, so the history never loads whole.
        products: dict[str, dict[str, Any]] = {
            product: {"items": count, "labels": [], "named_by_owner": bool(by_user)}
            for product, count, by_user in self.session.execute(
                select(
                    ReceiptItem.product,
                    func.count(),
                    func.max(ReceiptItem.product_named_by_user),
                )
                .where(ReceiptItem.user_id == self.user_id)
                .group_by(ReceiptItem.product)
                .order_by(func.count().desc(), ReceiptItem.product)
                .limit(MERGE_PRODUCT_NAMES)
            )
        }
        if len(products) < 2:
            return 0
        pairs = (
            select(
                ReceiptItem.product,
                ReceiptItem.label,
                func.row_number()
                .over(
                    partition_by=ReceiptItem.product,
                    order_by=(func.count().desc(), ReceiptItem.label),
                )
                .label("rank"),
            )
            .where(
                ReceiptItem.user_id == self.user_id,
                ReceiptItem.product.in_(products),
            )
            .group_by(ReceiptItem.product, ReceiptItem.label)
            .subquery()
        )
        for product, label in self.session.execute(
            select(pairs.c.product, pairs.c.label)
            .where(pairs.c.rank <= MERGE_SAMPLE_LABELS)
            .order_by(pairs.c.product, pairs.c.rank)
        ):
            products[product]["labels"].append(label)
        payload = {"products": products}
        output, _ = await self._run_llm(
            feature="receipt_items",
            prompt_version=RECEIPT_PRODUCTS_PROMPT,
            payload=payload,
            output_type=ProductMergesOutput,
            entity_type="receipt_products",
        )
        renamed = 0
        for merge in output.merges:
            if not merge.names:
                continue
            result = self.session.execute(
                update(ReceiptItem)
                .where(
                    ReceiptItem.user_id == self.user_id,
                    ReceiptItem.product.in_(merge.names),
                    ReceiptItem.product_named_by_user.is_(False),
                )
                .values(product=merge.into)
            )
            renamed += int(result.rowcount or 0)
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "receipt_products_merged",
            merges=len(output.merges),
            items=renamed,
        )
        return renamed

    def _receipt_product_names(self) -> list[str]:
        return list(
            self.session.scalars(
                select(ReceiptItem.product)
                .where(ReceiptItem.user_id == self.user_id)
                .group_by(ReceiptItem.product)
                .order_by(func.count().desc(), ReceiptItem.product)
                .limit(RECEIPT_PRODUCT_NAMES)
            )
        )

    async def mine_rule_suggestions(
        self, *, since: date | None = None
    ) -> list[RuleSuggestionResult]:
        correction_clusters = self._correction_clusters(since=since)
        payload = {
            "since": (since or (local_today() - timedelta(days=90))).isoformat(),
            "categories": self._category_payload(),
            "tags": self._tag_payload(),
            "existing_rules": self._existing_rule_payload(),
            "correction_clusters": correction_clusters,
        }
        if not payload["correction_clusters"]:
            return []
        try:
            output, job_id = await self._run_llm(
                feature="rule_mining",
                prompt_version=RULE_MINING_PROMPT,
                payload=payload,
                output_type=RuleMiningOutput,
            )
        except LLMOutputError:
            return []
        suggestions: list[RuleSuggestionResult] = []
        for proposal in output.proposals:
            if proposal.set_category_id is None:
                proposal_ids = set(proposal.evidence_transaction_ids)
                matched_cluster = next(
                    (
                        cluster
                        for cluster in correction_clusters
                        if proposal_ids
                        and proposal_ids.issubset(
                            set(cluster["evidence_transaction_ids"])
                        )
                    ),
                    None,
                )
                if matched_cluster is not None:
                    proposal = proposal.model_copy(
                        update={"set_category_id": matched_cluster["to_category"]["id"]}
                    )
            if proposal.set_category_id is None and not proposal.add_tags:
                continue
            low, high = proposal.min_amount_cents, proposal.max_amount_cents
            # RuleIn refuses these on accept.
            if (low or 0) > MAX_AMOUNT_CENTS or (high or 0) > MAX_AMOUNT_CENTS:
                continue
            if low is not None and high is not None and low > high:
                continue
            if proposal.set_category_id is not None:
                category = self.session.get(Category, proposal.set_category_id)
                if category is not None and category.archived_at is not None:
                    continue
            stored = self._store_rule_suggestion(proposal, job_id=job_id)
            suggestions.append(
                RuleSuggestionResult(
                    id=stored.id,
                    preview_matches_count=stored.preview_matches_count,
                    **proposal.model_dump(),
                )
            )
        self.session.commit()
        return suggestions

    def pending_transaction_suggestions(
        self, *, transaction_id: int | None = None
    ) -> list[TransactionSuggestionOut]:
        stmt = (
            select(TransactionLLMSuggestion)
            .options(joinedload(TransactionLLMSuggestion.category))
            .where(
                TransactionLLMSuggestion.user_id == self.user_id,
                TransactionLLMSuggestion.status == "pending",
            )
            .order_by(TransactionLLMSuggestion.created_at.desc())
        )
        if transaction_id is not None:
            stmt = stmt.where(TransactionLLMSuggestion.transaction_id == transaction_id)
        suggestions = self.session.scalars(stmt).all()
        return [self._serialize_transaction_suggestion(row) for row in suggestions]

    def accept_transaction_suggestion(self, suggestion_id: int) -> int:
        suggestion = self.session.scalar(
            select(TransactionLLMSuggestion)
            .options(joinedload(TransactionLLMSuggestion.transaction))
            .where(
                TransactionLLMSuggestion.user_id == self.user_id,
                TransactionLLMSuggestion.id == suggestion_id,
                TransactionLLMSuggestion.status == "pending",
            )
        )
        if suggestion is None or suggestion.transaction is None:
            raise ValueError("Suggestion not found")
        txn = self._transaction_for_triage(suggestion.transaction_id)
        if txn is None:
            suggestion.status = "stale"
            self.session.commit()
            raise ValueError("Transaction is no longer Uncategorized")
        if self._transaction_fingerprint(txn) != suggestion.fingerprint_hash:
            suggestion.status = "stale"
            self.session.commit()
            raise ValueError("Transaction changed since suggestion was created")
        tags = sorted(
            set([tag.name for tag in txn.tags] + json.loads(suggestion.tags_json))
        )
        updated = TransactionService(self.session, self.user_id).update(
            txn.id,
            TransactionIn(
                date=txn.date,
                occurred_at=txn.occurred_at,
                type=txn.type,
                is_reimbursement=txn.is_reimbursement,
                amount_cents=txn.amount_cents,
                category_id=suggestion.category_id,
                title=suggestion.clean_title or txn.title or "",
                description=txn.description,
                latitude=txn.latitude,
                longitude=txn.longitude,
                tags=tags,
            ),
            source="llm_suggestion",
        )
        suggestion.status = "accepted"
        self.session.commit()
        return updated.id

    def reject_transaction_suggestion(self, suggestion_id: int) -> int:
        suggestion = self.session.scalar(
            select(TransactionLLMSuggestion).where(
                TransactionLLMSuggestion.user_id == self.user_id,
                TransactionLLMSuggestion.id == suggestion_id,
                TransactionLLMSuggestion.status == "pending",
            )
        )
        if suggestion is None:
            raise ValueError("Suggestion not found")
        suggestion.status = "rejected"
        self.session.commit()
        return suggestion.transaction_id

    def pending_rule_suggestions(self) -> list[RuleSuggestionOut]:
        rows = self.session.scalars(
            select(RuleLLMSuggestion)
            .options(joinedload(RuleLLMSuggestion.set_category))
            .where(
                RuleLLMSuggestion.user_id == self.user_id,
                RuleLLMSuggestion.status == "pending",
            )
            .order_by(RuleLLMSuggestion.created_at.desc(), RuleLLMSuggestion.id.desc())
        ).all()
        return [self._serialize_rule_suggestion(row) for row in rows]

    def accept_rule_suggestion(self, suggestion_id: int) -> int:
        suggestion = self.session.scalar(
            select(RuleLLMSuggestion).where(
                RuleLLMSuggestion.user_id == self.user_id,
                RuleLLMSuggestion.id == suggestion_id,
                RuleLLMSuggestion.status == "pending",
            )
        )
        if suggestion is None:
            raise ValueError("Suggestion not found")
        if (
            suggestion.set_category is not None
            and suggestion.set_category.archived_at is not None
        ):
            raise ValueError(
                f"{suggestion.set_category.name} is archived. Restore it or reject "
                "this suggestion."
            )
        rule = RuleService(self.session, self.user_id).create(
            RuleIn(
                name=suggestion.name,
                enabled=True,
                priority=100,
                match_type=RuleMatchType(suggestion.match_type),
                match_value=suggestion.match_value,
                transaction_type=TransactionType(suggestion.transaction_type)
                if suggestion.transaction_type
                else None,
                min_amount_cents=suggestion.min_amount_cents,
                max_amount_cents=suggestion.max_amount_cents,
                set_category_id=suggestion.set_category_id,
                add_tags=json.loads(suggestion.add_tags_json),
                budget_exclude_tag_id=None,
            )
        )
        suggestion.status = "accepted"
        self.session.commit()
        return rule.id

    def reject_rule_suggestion(self, suggestion_id: int) -> int:
        suggestion = self.session.scalar(
            select(RuleLLMSuggestion).where(
                RuleLLMSuggestion.user_id == self.user_id,
                RuleLLMSuggestion.id == suggestion_id,
                RuleLLMSuggestion.status == "pending",
            )
        )
        if suggestion is None:
            raise ValueError("Suggestion not found")
        suggestion.status = "rejected"
        self.session.commit()
        return suggestion.id

    def clear_old_traces(
        self,
        *,
        now: datetime | None = None,
        keep_recent: int = DEFAULT_TRACE_KEEP_RECENT,
        max_age_days: int = DEFAULT_TRACE_MAX_AGE_DAYS,
    ) -> int:
        """Fails runs cut off mid-call and clears older runs' prompts and outputs.

        Every run's usage stays.
        """
        reference = now or datetime.utcnow()
        self.session.execute(
            update(LLMJob)
            .where(
                LLMJob.user_id == self.user_id,
                LLMJob.status == "running",
                LLMJob.created_at < reference - ABANDONED_RUN_AGE,
            )
            .values(status="failed", error="interrupted")
        )
        old = LLMJob.created_at < reference - timedelta(days=max_age_days)
        if keep_recent > 0:
            recent_ids = self.session.scalars(
                select(LLMJob.id)
                .where(LLMJob.user_id == self.user_id)
                .order_by(LLMJob.created_at.desc(), LLMJob.id.desc())
                .limit(keep_recent)
            ).all()
            old = or_(old, LLMJob.id.not_in(recent_ids))
        result = self.session.execute(
            update(LLMJob)
            .where(
                LLMJob.user_id == self.user_id,
                old,
                or_(
                    LLMJob.input_json.is_not(None),
                    LLMJob.output_json.is_not(None),
                    LLMJob.provider_usage_json.is_not(None),
                ),
            )
            .values(input_json=None, output_json=None, provider_usage_json=None)
        )
        self.session.commit()
        return int(result.rowcount or 0)

    async def _run_llm(
        self,
        *,
        feature: Feature,
        prompt_version: str,
        payload: dict[str, Any],
        output_type: type,
        entity_type: str | None = None,
        entity_id: int | None = None,
        images: list[tuple[bytes, str]] | None = None,
    ) -> tuple[Any, int]:
        runner = self._runner_for_feature(feature)
        payload_json = _json_dumps(payload)
        job = LLMJob(
            user_id=self.user_id,
            feature=feature,
            status="running",
            prompt_version=prompt_version,
            model=getattr(runner, "model_name", "unknown"),
            # Set before the call so a failed run keeps its backend.
            backend=(
                runner.resolved.backend.name
                if isinstance(runner, PydanticAILLMRunner)
                else None
            ),
            input_hash=hashlib.sha256(payload_json.encode("utf-8")).hexdigest(),
            entity_type=entity_type,
            entity_id=entity_id,
            input_json=payload_json,
            created_at=datetime.utcnow(),
            started_at=datetime.utcnow(),
        )
        self.session.add(job)
        # Commit before the model call: a pending insert would hold SQLite's
        # write lock, and every other writer, for the whole round trip.
        self.session.commit()
        start = perf_counter()
        try:
            result = await runner.run(
                feature=feature,
                prompt_version=prompt_version,
                payload=payload,
                output_type=output_type,
                images=images,
            )
            if isinstance(result, LLMRunResult):
                output = result.output
                if result.usage_metadata is not None:
                    apply_usage_metadata(job, result.usage_metadata)
                else:
                    job.usage_input_tokens = result.input_tokens
                    job.usage_output_tokens = result.output_tokens
            else:
                output = result
        except LLMDisabledError:
            self.session.delete(job)
            self.session.commit()
            raise
        except asyncio.CancelledError:
            job.status = "failed"
            job.error = "cancelled"
            job.finished_at = datetime.utcnow()
            job.duration_ms = int((perf_counter() - start) * 1000)
            self.session.commit()
            log_event(
                logger,
                logging.WARNING,
                "llm_job_cancelled",
                job_id=job.id,
                feature=feature,
                model=job.model,
                duration_ms=job.duration_ms,
            )
            raise
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = datetime.utcnow()
            job.duration_ms = int((perf_counter() - start) * 1000)
            self.session.commit()
            log_event(
                logger,
                logging.ERROR,
                "llm_job_failed",
                job_id=job.id,
                feature=feature,
                model=job.model,
                duration_ms=job.duration_ms,
                error=str(exc),
            )
            raise
        job.status = "completed"
        job.output_json = output.model_dump_json()
        job.finished_at = datetime.utcnow()
        job.duration_ms = int((perf_counter() - start) * 1000)
        # The running row is already committed, so a caller that stores nothing
        # must not roll this back to running.
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "llm_job_completed",
            job_id=job.id,
            feature=feature,
            model=job.model,
            duration_ms=job.duration_ms,
            usage_input_tokens=job.usage_input_tokens,
            usage_output_tokens=job.usage_output_tokens,
        )
        return output, job.id

    def _runner_for_feature(self, feature: Feature) -> LLMRunner:
        if self.runner is not None:
            return self.runner
        return PydanticAILLMRunner(resolve(self.session, feature))

    def _transaction_for_triage(self, transaction_id: int) -> Transaction | None:
        # Reloads a row already in the session, so edits made during the model
        # call reach the stale check.
        txn = self.session.scalar(
            select(Transaction)
            .options(joinedload(Transaction.category), joinedload(Transaction.tags))
            .where(
                Transaction.user_id == self.user_id,
                Transaction.id == transaction_id,
                Transaction.deleted_at.is_(None),
            )
            .execution_options(populate_existing=True)
        )
        if txn is None or txn.category is None:
            return None
        if txn.category.name.lower() != CategoryService.UNCATEGORIZED_NAME.lower():
            return None
        return txn

    def _transaction_fingerprint(self, txn: Transaction) -> str:
        payload = {
            "id": txn.id,
            "updated_at": txn.updated_at.isoformat(),
            "category_id": txn.category_id,
            "title": txn.title,
            "amount_cents": txn.amount_cents,
            "tags": sorted(tag.name for tag in txn.tags),
        }
        return hashlib.sha256(_json_dumps(payload).encode("utf-8")).hexdigest()

    def _serialize_transaction(self, txn: Transaction) -> dict[str, Any]:
        return {
            "id": txn.id,
            "title": txn.title or "",
            "amount_cents": txn.amount_cents,
            "type": txn.type.value,
            "date": txn.date.isoformat(),
            "occurred_at": txn.occurred_at.isoformat(),
            "category": txn.category.name if txn.category else None,
            "tags": [tag.name for tag in txn.tags],
        }

    def _similar_confirmed_transactions(self, txn: Transaction) -> list[dict[str, Any]]:
        title_token = _merchant_token(txn.title or "")
        if not title_token:
            return []
        stmt = (
            select(Transaction)
            .options(joinedload(Transaction.category), joinedload(Transaction.tags))
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.id != txn.id,
                Transaction.auto_category_confidence.is_(None),
                Transaction.type == txn.type,
                func.upper(Transaction.title).like(f"%{title_token}%"),
            )
            .order_by(Transaction.date.desc(), Transaction.id.desc())
            .limit(10)
        )
        rows = self.session.scalars(stmt).unique().all()
        return [
            {
                "id": row.id,
                "title": row.title or "",
                "amount_cents": row.amount_cents,
                "category_id": row.category_id,
                "category": row.category.name if row.category else None,
                "tags": [tag.name for tag in row.tags],
            }
            for row in rows
            if row.category
            and row.category.name.lower() != CategoryService.UNCATEGORIZED_NAME.lower()
        ]

    def _category_payload(
        self, tx_type: TransactionType | None = None
    ) -> list[dict[str, Any]]:
        stmt = select(Category).where(
            Category.user_id == self.user_id,
            Category.archived_at.is_(None),
        )
        if tx_type is not None:
            stmt = stmt.where(Category.type == tx_type)
        categories = self.session.scalars(
            stmt.order_by(Category.type, Category.name)
        ).all()
        return [
            {
                "id": category.id,
                "name": category.name,
                "type": category.type.value,
            }
            for category in categories
        ]

    def _tag_payload(self) -> list[dict[str, Any]]:
        tags = self.session.scalars(
            select(Tag)
            .where(Tag.user_id == self.user_id, Tag.archived_at.is_(None))
            .order_by(Tag.name)
        ).all()
        return [{"id": tag.id, "name": tag.name} for tag in tags]

    def _existing_rule_payload(self) -> list[dict[str, Any]]:
        from expenses.db.models import Rule

        rules = self.session.scalars(
            select(Rule)
            .where(Rule.user_id == self.user_id)
            .order_by(Rule.priority.asc(), Rule.id.asc())
        ).all()
        return [
            {
                "id": rule.id,
                "name": rule.name,
                "match_type": rule.match_type.value,
                "match_value": rule.match_value,
                "transaction_type": rule.transaction_type.value
                if rule.transaction_type
                else None,
                "set_category_id": rule.set_category_id,
                "add_tags": json.loads(rule.add_tags_json or "[]"),
            }
            for rule in rules
        ]

    def _correction_clusters(self, *, since: date | None) -> list[dict[str, Any]]:
        since_dt = datetime.combine(
            since or (local_today() - timedelta(days=90)), datetime.min.time()
        )
        events = self.session.scalars(
            select(TransactionClassificationEvent)
            .join(Transaction)
            .options(joinedload(TransactionClassificationEvent.transaction))
            .where(
                TransactionClassificationEvent.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                TransactionClassificationEvent.event_type == "updated",
                TransactionClassificationEvent.before_category_id.is_not(None),
                TransactionClassificationEvent.after_category_id.is_not(None),
                TransactionClassificationEvent.before_category_id
                != TransactionClassificationEvent.after_category_id,
                TransactionClassificationEvent.created_at >= since_dt,
            )
            .order_by(TransactionClassificationEvent.created_at.desc())
            .limit(500)
        ).all()
        categories = {
            category.id: category
            for category in self.session.scalars(
                select(Category).where(Category.user_id == self.user_id)
            ).all()
        }
        clusters: dict[tuple[str, int], list[TransactionClassificationEvent]] = {}
        for event in events:
            txn = event.transaction
            if txn is None:
                continue
            token = _merchant_token(event.after_title or txn.title or "")
            if not token or event.after_category_id is None:
                continue
            clusters.setdefault((token, event.after_category_id), []).append(event)
        payload = []
        for (token, category_id), rows in clusters.items():
            if len(rows) < 2:
                continue
            category = categories.get(category_id)
            if category is None or category.archived_at is not None:
                continue
            txns = [row.transaction for row in rows if row.transaction is not None]
            payload.append(
                {
                    "merchant_token": token,
                    "transaction_count": len(txns),
                    "sample_titles": sorted({txn.title or "" for txn in txns})[:8],
                    "amount_range_cents": [
                        min(int(txn.amount_cents) for txn in txns),
                        max(int(txn.amount_cents) for txn in txns),
                    ],
                    "to_category": {
                        "id": category.id,
                        "name": category.name,
                        "type": category.type.value,
                    },
                    "to_tags": _most_common_tags(rows),
                    "evidence_transaction_ids": [txn.id for txn in txns[:20]],
                }
            )
        return payload[:20]

    def _store_rule_suggestion(
        self, proposal: RuleProposalOut, *, job_id: int
    ) -> RuleLLMSuggestion:
        if proposal.set_category_id is not None:
            category = self.session.get(Category, proposal.set_category_id)
            if category is None or category.user_id != self.user_id:
                raise ValueError("Suggested category not found")
            if (
                proposal.transaction_type is not None
                and category.type != TransactionType(proposal.transaction_type)
            ):
                raise ValueError("Suggested category type mismatch")
        preview_count = self._preview_rule_count(proposal)
        add_tags_json = _json_dumps(proposal.add_tags)
        evidence_transaction_ids_json = _json_dumps(proposal.evidence_transaction_ids)
        existing = self.session.scalar(
            select(RuleLLMSuggestion).where(
                RuleLLMSuggestion.user_id == self.user_id,
                RuleLLMSuggestion.status == "pending",
                RuleLLMSuggestion.match_type == proposal.match_type,
                RuleLLMSuggestion.match_value == proposal.match_value,
                RuleLLMSuggestion.transaction_type == proposal.transaction_type,
                RuleLLMSuggestion.min_amount_cents == proposal.min_amount_cents,
                RuleLLMSuggestion.max_amount_cents == proposal.max_amount_cents,
                RuleLLMSuggestion.set_category_id == proposal.set_category_id,
                RuleLLMSuggestion.add_tags_json == add_tags_json,
            )
        )
        if existing is not None:
            existing.job_id = job_id
            existing.name = proposal.name
            existing.confidence_bps = _confidence_bps(proposal.confidence)
            existing.reason = proposal.reason
            existing.evidence_transaction_ids_json = evidence_transaction_ids_json
            existing.preview_matches_count = preview_count
            self.session.flush()
            return existing
        stored = RuleLLMSuggestion(
            user_id=self.user_id,
            job_id=job_id,
            name=proposal.name,
            match_type=proposal.match_type,
            match_value=proposal.match_value,
            transaction_type=proposal.transaction_type,
            min_amount_cents=proposal.min_amount_cents,
            max_amount_cents=proposal.max_amount_cents,
            set_category_id=proposal.set_category_id,
            add_tags_json=add_tags_json,
            confidence_bps=_confidence_bps(proposal.confidence),
            reason=proposal.reason,
            evidence_transaction_ids_json=evidence_transaction_ids_json,
            preview_matches_count=preview_count,
        )
        self.session.add(stored)
        self.session.flush()
        return stored

    def _serialize_transaction_suggestion(
        self, row: TransactionLLMSuggestion
    ) -> TransactionSuggestionOut:
        return TransactionSuggestionOut(
            id=row.id,
            transaction_id=row.transaction_id,
            status=row.status,
            category_id=row.category_id,
            category_name=row.category.name if row.category else None,
            clean_title=row.clean_title,
            tags=json.loads(row.tags_json),
            confidence=row.confidence_bps / 10_000,
            reason=row.reason,
        )

    def _serialize_rule_suggestion(self, row: RuleLLMSuggestion) -> RuleSuggestionOut:
        return RuleSuggestionOut(
            id=row.id,
            status=row.status,
            name=row.name,
            match_type=row.match_type,
            match_value=row.match_value,
            transaction_type=row.transaction_type,
            min_amount_cents=row.min_amount_cents,
            max_amount_cents=row.max_amount_cents,
            set_category_id=row.set_category_id,
            set_category_name=row.set_category.name if row.set_category else None,
            add_tags=json.loads(row.add_tags_json),
            confidence=row.confidence_bps / 10_000,
            reason=row.reason,
            evidence_transaction_ids=json.loads(row.evidence_transaction_ids_json),
            preview_matches_count=row.preview_matches_count,
        )

    def _preview_rule_count(self, proposal: RuleProposalOut) -> int:
        stmt = select(func.count(Transaction.id)).where(
            Transaction.user_id == self.user_id,
            Transaction.deleted_at.is_(None),
        )
        if proposal.transaction_type:
            stmt = stmt.where(
                Transaction.type == TransactionType(proposal.transaction_type)
            )
        if proposal.min_amount_cents is not None:
            stmt = stmt.where(Transaction.amount_cents >= proposal.min_amount_cents)
        if proposal.max_amount_cents is not None:
            stmt = stmt.where(Transaction.amount_cents <= proposal.max_amount_cents)
        title = func.lower(func.coalesce(Transaction.title, ""))
        value = proposal.match_value.lower()
        if proposal.match_type == RuleMatchType.contains.value:
            stmt = stmt.where(title.like(f"%{value}%"))
        elif proposal.match_type == RuleMatchType.equals.value:
            stmt = stmt.where(title == value)
        elif proposal.match_type == RuleMatchType.starts_with.value:
            stmt = stmt.where(title.like(f"{value}%"))
        else:
            row_stmt = select(Transaction).where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
            )
            if proposal.transaction_type:
                row_stmt = row_stmt.where(
                    Transaction.type == TransactionType(proposal.transaction_type)
                )
            if proposal.min_amount_cents is not None:
                row_stmt = row_stmt.where(
                    Transaction.amount_cents >= proposal.min_amount_cents
                )
            if proposal.max_amount_cents is not None:
                row_stmt = row_stmt.where(
                    Transaction.amount_cents <= proposal.max_amount_cents
                )
            rows = self.session.scalars(row_stmt).all()
            try:
                return sum(
                    1
                    for row in rows
                    if safe_regex_search(proposal.match_value, row.title or "")
                )
            except RegexRejected:
                return 0
        return int(self.session.execute(stmt).scalar_one() or 0)


async def read_receipt_in_background(
    bind: Engine | Connection, user_id: int, attachment_id: int
) -> None:
    with Session(bind) as session:
        storage_key = session.scalar(
            select(ReceiptAttachment.storage_key).where(
                ReceiptAttachment.id == attachment_id
            )
        )
        try:
            await LLMAssistantService(session, user_id=user_id).read_receipt_items(
                attachment_id
            )
        except Exception:  # noqa: BLE001 - one failed receipt must not stop the rest
            # Left reading, it would stop the other receipts at startup and be
            # read, and billed, again on every restart.
            session.rollback()
            log_event(
                logger,
                logging.ERROR,
                "receipt_items_read_crashed",
                attachment_id=attachment_id,
                exc_info=True,
            )
            # The id may belong to a new upload by now, so the stored file must match.
            session.execute(
                update(ReceiptAttachment)
                .where(
                    ReceiptAttachment.id == attachment_id,
                    ReceiptAttachment.user_id == user_id,
                    ReceiptAttachment.storage_key == storage_key,
                    ReceiptAttachment.items_status == "reading",
                )
                .values(
                    items_status=case(
                        (ReceiptAttachment.items.any(), "read"), else_="failed"
                    ),
                    items_error="The receipt could not be read.",
                )
                .execution_options(synchronize_session=False)
            )
            session.commit()


def merge_products_for_users_with_new_readings(bind: Engine | Connection) -> None:
    """Runs the merge pass for each user with a receipt read since their last one."""
    with Session(bind) as session:
        merge_job = aliased(LLMJob)
        last_merge = (
            select(func.max(merge_job.created_at))
            .where(
                # Correlates with the reading job's query directly around it.
                merge_job.user_id == LLMJob.user_id,
                merge_job.prompt_version == RECEIPT_PRODUCTS_PROMPT,
                merge_job.status == "completed",
            )
            .scalar_subquery()
        )
        user_ids = session.scalars(
            select(ReceiptItem.user_id)
            .distinct()
            .where(
                select(LLMJob.id)
                .where(
                    LLMJob.user_id == ReceiptItem.user_id,
                    LLMJob.feature == "receipt_items",
                    LLMJob.prompt_version != RECEIPT_PRODUCTS_PROMPT,
                    LLMJob.status == "completed",
                    or_(last_merge.is_(None), LLMJob.created_at > last_merge),
                )
                .exists()
            )
        ).all()
        for user_id in user_ids:
            try:
                asyncio.run(
                    LLMAssistantService(
                        session, user_id=user_id
                    ).merge_receipt_products()
                )
            except LLMDisabledError:
                return
            except Exception:  # noqa: BLE001
                # _run_llm has logged a failed call; the next run tries again.
                session.rollback()


def retry_receipt_readings(bind: Engine | Connection, *, interrupted: bool) -> None:
    """Reads again the receipts whose reading could not reach the model.

    At startup, interrupted also takes the readings the restart cut off.
    """
    retried = ReceiptAttachment.items_error == RECEIPT_MODEL_UNREACHABLE
    if interrupted:
        retried = or_(retried, ReceiptAttachment.items_status == "reading")
    with Session(bind) as session:
        attachments = session.scalars(select(ReceiptAttachment).where(retried)).all()
        for attachment in attachments:
            attachment.items_status = "reading"
            attachment.items_error = None
        session.commit()
        targets = [(attachment.user_id, attachment.id) for attachment in attachments]
    for user_id, attachment_id in targets:
        asyncio.run(read_receipt_in_background(bind, user_id, attachment_id))


def run_nightly_receipt_jobs(bind: Engine | Connection) -> None:
    """Retries readings that could not reach the model, then merges product names.

    One after the other, so the merge sees the items the retries read.
    """
    retry_receipt_readings(bind, interrupted=False)
    merge_products_for_users_with_new_readings(bind)


def _receipt_image(path: Path) -> bytes:
    """The receipt as a JPEG no longer than RECEIPT_IMAGE_EDGE on either side."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(path) as image:
            pixels = image.width * image.height
            image.draft("RGB", (RECEIPT_IMAGE_EDGE, RECEIPT_IMAGE_EDGE))
            # Baseline JPEGs decode at the reduced draft size. Progressive JPEGs
            # still buffer every source pixel while decoding.
            if not image.info.get("progressive"):
                pixels = image.width * image.height
            if pixels > get_settings().receipt_thumbnail_max_pixels:
                raise ValueError("The image is too large to read.")
            rgb = ImageOps.exif_transpose(image).convert("RGB")
            rgb.thumbnail((RECEIPT_IMAGE_EDGE, RECEIPT_IMAGE_EDGE))
            out = BytesIO()
            rgb.save(out, format="JPEG", quality=85)
    except Image.DecompressionBombError as exc:
        raise ValueError("The image is too large to read.") from exc
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("The image could not be opened.") from exc
    return out.getvalue()


def _merchant_token(title: str) -> str:
    words = re.findall(r"[A-ZÄÖÜa-zäöüß]{3,}", title.upper())
    ignored = {"STORE", "DIENSTLEISTUNG", "SAGT", "DANKE"}
    for word in words:
        if word not in ignored:
            return word
    return words[0] if words else ""


def _most_common_tags(rows: list[TransactionClassificationEvent]) -> list[str]:
    counts: dict[str, int] = {}
    for row in rows:
        try:
            tags = json.loads(row.after_tags_json)
        except json.JSONDecodeError:
            tags = []
        if not isinstance(tags, list):
            continue
        for tag in tags:
            clean = str(tag).strip()
            if clean:
                counts[clean] = counts.get(clean, 0) + 1
    return [
        name
        for name, _count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ][:5]


def _confidence_bps(value: float) -> int:
    return max(0, min(10_000, int(round(value * 10_000))))


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
