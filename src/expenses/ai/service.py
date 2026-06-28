from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from time import perf_counter
from typing import Any

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, joinedload

from expenses.ai.client import (
    LLMDisabledError,
    LLMOutputError,
    LLMRunner,
    LLMRunResult,
    PydanticAILLMRunner,
    ReasoningEffort,
)
from expenses.ai.schemas import (
    RuleMiningOutput,
    RuleProposalOut,
    RuleSuggestionOut,
    RuleSuggestionResult,
    SearchTranslationOutput,
    SearchTranslationResult,
    TransactionSuggestionOut,
    TransactionTriageOutput,
)
from expenses.ai.search_validation import (
    SearchTranslationValidationError,
    validate_search_translation_output,
)
from expenses.ai.usage import apply_usage_metadata
from expenses.core.safe_regex import RegexRejected, safe_regex_search
from expenses.core.app_logging import get_logger, log_event
from expenses.core.config import get_settings
from expenses.core.search import parse_advanced_search
from expenses.db.models import (
    Category,
    LLMJob,
    RuleLLMSuggestion,
    RuleMatchType,
    Tag,
    Transaction,
    TransactionClassificationEvent,
    TransactionLLMSuggestion,
    TransactionType,
)
from expenses.services.main import (
    CategoryService,
    RuleService,
    TransactionService,
)
from expenses.schemas import RuleIn, TransactionIn


logger = get_logger("expenses.ai")

SEARCH_TRANSLATE_PROMPT = "search_translate_v2"
TRANSACTION_TRIAGE_PROMPT = "transaction_triage_v2"
RULE_MINING_PROMPT = "rule_mining_v2"
SEARCH_TRANSLATION_FALLBACK_QUESTION = "I could not translate that into search syntax."

DEFAULT_TRACE_KEEP_RECENT = 1_000
DEFAULT_TRACE_MAX_AGE_DAYS = 30


@dataclass(frozen=True)
class LLMFeatureSettings:
    temperature: float | None
    max_tokens: int
    reasoning_effort: ReasoningEffort


LLM_DEFAULT_FEATURE_SETTINGS = LLMFeatureSettings(
    temperature=0.7,
    max_tokens=1_024,
    reasoning_effort="low",
)
LLM_FEATURE_SETTINGS = {
    "search_translate": LLMFeatureSettings(
        temperature=0.0,
        max_tokens=512,
        reasoning_effort="none",
    ),
    "transaction_triage": LLMFeatureSettings(
        temperature=0.7,
        max_tokens=2_048,
        reasoning_effort="low",
    ),
    "rule_mining": LLMFeatureSettings(
        temperature=0.7,
        max_tokens=4_096,
        reasoning_effort="medium",
    ),
}


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

    async def translate_search_query(
        self, query: str, *, reference_date: date | None = None
    ) -> SearchTranslationResult:
        payload = {
            "query": query.strip(),
            "reference_date": (reference_date or date.today()).isoformat(),
            "allowed_syntax": [
                "type:expense",
                "type:income",
                "category:<name>",
                "tag:<name>",
                "amount>=20",
                "amount<=20",
                "date>=YYYY-MM-DD",
                "date<=YYYY-MM-DD",
                "is:reimbursement",
                "has:receipt",
            ],
            "categories": self._category_payload(),
            "tags": self._tag_payload(),
        }
        try:
            output, _job_id = await self._run_llm(
                feature="search_translate",
                prompt_version=SEARCH_TRANSLATE_PROMPT,
                payload=payload,
                output_type=SearchTranslationOutput,
            )
        except LLMOutputError:
            parsed = parse_advanced_search("")
            return SearchTranslationResult(
                query="",
                confidence=0,
                clarification_needed=True,
                clarification_question=SEARCH_TRANSLATION_FALLBACK_QUESTION,
                applied_tokens=parsed.applied_tokens,
                free_terms=parsed.free_terms,
            )
        try:
            validate_search_translation_output(output, payload)
            parsed = parse_advanced_search(output.query)
        except (SearchTranslationValidationError, ValueError):
            output.clarification_needed = True
            output.clarification_question = SEARCH_TRANSLATION_FALLBACK_QUESTION
            output.query = ""
            parsed = parse_advanced_search("")
        if parsed.free_terms and all(
            term.casefold() in {"date", "amount", "category", "tag", "type"}
            for term in parsed.free_terms
        ):
            output.query = " ".join(
                token
                for token in output.query.split()
                if token.casefold() not in {"date", "amount", "category", "tag", "type"}
            )
            parsed = parse_advanced_search(output.query)
        if output.clarification_needed and output.clarification_question:
            question = output.clarification_question.strip()
            if len(question.split()) < 4:
                output.clarification_question = (
                    "Which transaction details should I search for?"
                )
        self.session.commit()
        return SearchTranslationResult(
            **output.model_dump(),
            applied_tokens=parsed.applied_tokens,
            free_terms=parsed.free_terms,
        )

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

    async def mine_rule_suggestions(
        self, *, since: date | None = None
    ) -> list[RuleSuggestionResult]:
        correction_clusters = self._correction_clusters(since=since)
        payload = {
            "since": (since or (date.today() - timedelta(days=90))).isoformat(),
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

    def prune_trace_rows(
        self,
        *,
        now: datetime | None = None,
        keep_recent: int = DEFAULT_TRACE_KEEP_RECENT,
        max_age_days: int = DEFAULT_TRACE_MAX_AGE_DAYS,
    ) -> int:
        reference = now or datetime.utcnow()
        cutoff = reference - timedelta(days=max_age_days)
        if keep_recent > 0:
            recent_ids = self.session.scalars(
                select(LLMJob.id)
                .where(LLMJob.user_id == self.user_id)
                .order_by(LLMJob.created_at.desc(), LLMJob.id.desc())
                .limit(keep_recent)
            ).all()
            stmt = delete(LLMJob).where(
                LLMJob.user_id == self.user_id,
                or_(
                    LLMJob.created_at < cutoff,
                    LLMJob.id.not_in(recent_ids),
                ),
            )
        else:
            stmt = delete(LLMJob).where(
                LLMJob.user_id == self.user_id,
                LLMJob.created_at < cutoff,
            )
        result = self.session.execute(stmt)
        self.session.commit()
        return int(result.rowcount or 0)

    async def _run_llm(
        self,
        *,
        feature: str,
        prompt_version: str,
        payload: dict[str, Any],
        output_type: type,
        entity_type: str | None = None,
        entity_id: int | None = None,
    ) -> tuple[Any, int]:
        settings = get_settings()
        runner = self._runner_for_feature(feature)
        payload_json = _json_dumps(payload)
        job = LLMJob(
            user_id=self.user_id,
            feature=feature,
            status="running",
            prompt_version=prompt_version,
            model=settings.llm_model,
            input_hash=hashlib.sha256(payload_json.encode("utf-8")).hexdigest(),
            entity_type=entity_type,
            entity_id=entity_id,
            input_json=payload_json,
            created_at=datetime.utcnow(),
            started_at=datetime.utcnow(),
        )
        self.session.add(job)
        self.session.flush()
        start = perf_counter()
        try:
            result = await runner.run(
                feature=feature,
                prompt_version=prompt_version,
                payload=payload,
                output_type=output_type,
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
            self.session.rollback()
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
                api_key_configured=bool(settings.llm_api_key),
                error=str(exc),
            )
            raise
        job.status = "completed"
        job.output_json = output.model_dump_json()
        job.finished_at = datetime.utcnow()
        job.duration_ms = int((perf_counter() - start) * 1000)
        self.session.flush()
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

    def _runner_for_feature(self, feature: str) -> LLMRunner:
        if self.runner is not None:
            return self.runner
        settings = get_settings()
        feature_settings = LLM_FEATURE_SETTINGS.get(
            feature, LLM_DEFAULT_FEATURE_SETTINGS
        )
        return PydanticAILLMRunner(
            temperature=settings.llm_temperature
            if settings.llm_temperature is not None
            else feature_settings.temperature,
            max_tokens=settings.llm_max_output_tokens
            if settings.llm_max_output_tokens is not None
            else feature_settings.max_tokens,
            reasoning_effort=feature_settings.reasoning_effort,
        )

    def _transaction_for_triage(self, transaction_id: int) -> Transaction | None:
        txn = self.session.scalar(
            select(Transaction)
            .options(joinedload(Transaction.category), joinedload(Transaction.tags))
            .where(
                Transaction.user_id == self.user_id,
                Transaction.id == transaction_id,
                Transaction.deleted_at.is_(None),
            )
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
            select(Tag).where(Tag.user_id == self.user_id).order_by(Tag.name)
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
            since or (date.today() - timedelta(days=90)), datetime.min.time()
        )
        events = self.session.scalars(
            select(TransactionClassificationEvent)
            .join(Transaction)
            .options(joinedload(TransactionClassificationEvent.transaction))
            .where(
                TransactionClassificationEvent.user_id == self.user_id,
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
            if category is None:
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
