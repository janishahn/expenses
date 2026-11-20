import asyncio
from datetime import date, datetime, timedelta

import pytest
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from expenses.ai import backends
from expenses.ai import service as ai_service
from expenses.ai.client import LLMOutputError, PydanticAILLMRunner
from expenses.ai.features import ResolvedFeature
from expenses.ai.schemas import (
    ProductMergeOut,
    ProductMergesOutput,
    ReceiptLineOut,
    ReceiptReadingOutput,
    RuleMiningOutput,
    RuleProposalOut,
    TransactionTriageOutput,
)
from expenses.ai.service import LLMAssistantService
from expenses.core.config import AIBackend, get_settings
from expenses.db.models import (
    LLMJob,
    ReceiptAttachment,
    ReceiptItem,
    RuleLLMSuggestion,
    TransactionClassificationEvent,
    TransactionType,
)
from expenses.db.session import Base
from expenses.schemas import CategoryIn, IngestTransactionIn, TransactionIn
from expenses.services import CategoryService, IngestService, TransactionService


class FakeLLMRunner:
    def __init__(self, output):
        self.output = output
        self.calls = []

    async def run(self, *, feature, prompt_version, payload, output_type, images=None):
        self.calls.append(
            {
                "feature": feature,
                "prompt_version": prompt_version,
                "payload": payload,
                "output_type": output_type,
            }
        )
        return self.output


class FailingLLMRunner:
    def __init__(self, exc: Exception):
        self.exc = exc
        self.calls = []

    async def run(self, *, feature, prompt_version, payload, output_type, images=None):
        self.calls.append(
            {
                "feature": feature,
                "prompt_version": prompt_version,
                "payload": payload,
                "output_type": output_type,
            }
        )
        raise self.exc


class WritingLLMRunner(FakeLLMRunner):
    """Writes through another connection while the model call is in flight."""

    def __init__(self, output, engine, sql="UPDATE llm_jobs SET error = error"):
        super().__init__(output)
        self.engine = engine
        self.sql = sql

    async def run(self, **kwargs):
        with self.engine.connect() as other:
            other.exec_driver_sql("PRAGMA busy_timeout=0")
            other.execute(text(self.sql))
            other.commit()
        return await super().run(**kwargs)


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def test_transaction_classification_events_track_ingest_create_and_user_update() -> (
    None
):
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        result = IngestService(session).ingest_expense(
            IngestTransactionIn(
                amount_cents=1299,
                title="Lidl",
                date=date(2026, 5, 1),
            )
        )

        txn = result.transaction
        TransactionService(session).update(
            txn.id,
            TransactionIn(
                date=txn.date,
                occurred_at=txn.occurred_at,
                type=txn.type,
                amount_cents=txn.amount_cents,
                category_id=groceries.id,
                title=txn.title or "Lidl",
                tags=["Food"],
            ),
        )

        events = session.scalars(
            select(TransactionClassificationEvent).order_by(
                TransactionClassificationEvent.id
            )
        ).all()

        assert [event.event_type for event in events] == ["created", "updated"]
        assert events[0].source == "ingest"
        assert events[0].after_category_id != groceries.id
        assert events[1].source == "user"
        assert events[1].before_category_id != groceries.id
        assert events[1].after_category_id == groceries.id
        assert events[1].after_tags_json == '["Food"]'


@pytest.mark.anyio
async def test_uncategorized_triage_stores_suggestion_without_applying_category() -> (
    None
):
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2026, 5, 1),
                occurred_at=datetime(2026, 5, 1, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=None,
                title="Lidl",
                tags=[],
            )
        )

        runner = FakeLLMRunner(
            TransactionTriageOutput(
                category_id=groceries.id,
                tags=["Food"],
                clean_title="Lidl",
                confidence=0.91,
                reason="Matches prior grocery rows.",
            )
        )
        suggestion = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).suggest_uncategorized_transaction(txn.id)

        session.refresh(txn)
        assert txn.category.name == "Uncategorized"
        assert suggestion is not None
        assert suggestion.transaction_id == txn.id
        assert suggestion.category_id == groceries.id
        assert suggestion.job_id is not None
        assert suggestion.tags_json == '["Food"]'
        assert runner.calls[0]["feature"] == "transaction_triage"


@pytest.mark.anyio
async def test_llm_job_leaves_database_writable_during_model_call(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'expenses.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2026, 5, 1),
                occurred_at=datetime(2026, 5, 1, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=None,
                title="Lidl",
                tags=[],
            )
        )
        runner = WritingLLMRunner(
            TransactionTriageOutput(
                category_id=None,
                tags=[],
                clean_title="Lidl",
                confidence=0.5,
                reason="No match.",
            ),
            engine,
        )
        await LLMAssistantService(
            session, user_id=1, runner=runner
        ).suggest_uncategorized_transaction(txn.id)

        # A no-op suggestion commits nothing else; request teardown rolls back.
        session.rollback()
        assert session.scalar(select(LLMJob)).status == "completed"


@pytest.mark.anyio
async def test_uncategorized_triage_drops_result_when_transaction_changes_during_call(
    tmp_path,
) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'expenses.db'}")
    Base.metadata.create_all(engine)
    # Like the app's sessions, this one keeps loaded rows across commits.
    with Session(engine, expire_on_commit=False) as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2026, 5, 1),
                occurred_at=datetime(2026, 5, 1, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=None,
                title="Lidl",
                tags=[],
            )
        )
        runner = WritingLLMRunner(
            TransactionTriageOutput(
                category_id=groceries.id,
                tags=[],
                clean_title="Lidl",
                confidence=0.9,
                reason="Groceries.",
            ),
            engine,
            f"UPDATE transactions SET title = 'Lidl Berlin' WHERE id = {txn.id}",
        )
        suggestion = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).suggest_uncategorized_transaction(txn.id)

        assert suggestion is None


@pytest.mark.anyio
async def test_uncategorized_triage_rejects_pending_suggestion() -> None:
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2026, 5, 1),
                occurred_at=datetime(2026, 5, 1, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=None,
                title="Lidl",
                tags=[],
            )
        )

        runner = FakeLLMRunner(
            TransactionTriageOutput(
                category_id=groceries.id,
                tags=["Food"],
                confidence=0.91,
                reason="Matches prior grocery rows.",
            )
        )
        service = LLMAssistantService(session, user_id=1, runner=runner)
        suggestion = await service.suggest_uncategorized_transaction(txn.id)

        assert suggestion is not None
        assert service.reject_transaction_suggestion(suggestion.id) == txn.id
        assert service.pending_transaction_suggestions() == []


@pytest.mark.anyio
async def test_uncategorized_triage_can_retry_rejected_unchanged_suggestion() -> None:
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2026, 5, 1),
                occurred_at=datetime(2026, 5, 1, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=None,
                title="Lidl",
                tags=[],
            )
        )

        service = LLMAssistantService(
            session,
            user_id=1,
            runner=FakeLLMRunner(
                TransactionTriageOutput(
                    category_id=groceries.id,
                    tags=["Food"],
                    confidence=0.91,
                    reason="Matches prior grocery rows.",
                )
            ),
        )
        suggestion = await service.suggest_uncategorized_transaction(txn.id)

        assert suggestion is not None
        service.reject_transaction_suggestion(suggestion.id)
        retried = await service.suggest_uncategorized_transaction(txn.id)

        assert retried is not None
        assert retried.id == suggestion.id
        assert retried.status == "pending"
        assert len(service.pending_transaction_suggestions()) == 1


@pytest.mark.anyio
async def test_uncategorized_triage_skips_when_user_already_categorized_transaction() -> (
    None
):
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2026, 5, 1),
                occurred_at=datetime(2026, 5, 1, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=groceries.id,
                title="Lidl",
                tags=[],
            )
        )

        runner = FakeLLMRunner(
            TransactionTriageOutput(
                category_id=groceries.id,
                tags=[],
                confidence=0.9,
                reason="Would match groceries.",
            )
        )
        suggestion = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).suggest_uncategorized_transaction(txn.id)

        assert suggestion is None
        assert runner.calls == []


@pytest.mark.anyio
async def test_uncategorized_triage_output_failure_returns_none() -> None:
    with make_session() as session:
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2026, 5, 1),
                occurred_at=datetime(2026, 5, 1, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=None,
                title="Unclear PayPal",
                tags=[],
            )
        )

        runner = FailingLLMRunner(LLMOutputError("Exceeded maximum output retries (2)"))
        suggestion = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).suggest_uncategorized_transaction(txn.id)

        job = session.scalar(select(LLMJob))
        assert suggestion is None
        assert job is not None
        assert job.status == "failed"
        assert job.error == "Exceeded maximum output retries (2)"


@pytest.mark.anyio
async def test_cancelled_model_call_marks_job_failed() -> None:
    with make_session() as session:
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2026, 5, 1),
                occurred_at=datetime(2026, 5, 1, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=None,
                title="Unclear PayPal",
                tags=[],
            )
        )

        runner = FailingLLMRunner(asyncio.CancelledError())
        with pytest.raises(asyncio.CancelledError):
            await LLMAssistantService(
                session, user_id=1, runner=runner
            ).suggest_uncategorized_transaction(txn.id)

        session.rollback()
        job = session.scalar(select(LLMJob))
        assert job.status == "failed"
        assert job.error == "cancelled"


@pytest.mark.anyio
async def test_rule_mining_uses_confirmed_events_and_stores_previewed_proposals() -> (
    None
):
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        uncategorized = CategoryService(session).get_or_create_uncategorized(
            TransactionType.expense
        )
        for index in range(3):
            txn = TransactionService(session).create(
                TransactionIn(
                    date=date(2026, 5, index + 1),
                    occurred_at=datetime(2026, 5, index + 1, 12, 0),
                    type=TransactionType.expense,
                    amount_cents=1000 + index,
                    category_id=uncategorized.id,
                    title=f"LIDL STORE {index}",
                    tags=[],
                )
            )
            TransactionService(session).update(
                txn.id,
                TransactionIn(
                    date=txn.date,
                    occurred_at=txn.occurred_at,
                    type=txn.type,
                    amount_cents=txn.amount_cents,
                    category_id=groceries.id,
                    title=txn.title or "LIDL",
                    tags=["Food"],
                ),
            )

        runner = FakeLLMRunner(
            RuleMiningOutput(
                proposals=[
                    RuleProposalOut(
                        name="Lidl groceries",
                        match_type="contains",
                        match_value="LIDL",
                        transaction_type="expense",
                        set_category_id=None,
                        add_tags=["Food"],
                        confidence=0.92,
                        reason="Three recent corrections converged on Groceries.",
                        evidence_transaction_ids=[1, 2, 3],
                    )
                ]
            )
        )
        proposals = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).mine_rule_suggestions(since=date(2026, 4, 25))

        assert len(proposals) == 1
        assert proposals[0].preview_matches_count == 3
        assert proposals[0].set_category_id == groceries.id
        stored = session.scalar(select(RuleLLMSuggestion))
        assert stored is not None
        assert stored.job_id is not None
        assert (
            runner.calls[0]["payload"]["correction_clusters"][0]["to_category"]["name"]
            == "Groceries"
        )


@pytest.mark.anyio
async def test_rule_mining_skips_trash_and_archived_categories() -> None:
    with make_session() as session:
        categories = CategoryService(session)
        coffee, dining, shoes, groceries = (
            categories.create(
                CategoryIn(name=name, type=TransactionType.expense, order=0)
            )
            for name in ["Coffee", "Dining", "Shoes", "Groceries"]
        )
        uncategorized = categories.get_or_create_uncategorized(TransactionType.expense)
        corrected: dict[str, list[int]] = {}
        for merchant, category in (
            ("STARBUCKS", coffee),
            ("ZALANDO", shoes),
            ("LIDL", groceries),
        ):
            for index in range(2):
                txn = TransactionService(session).create(
                    TransactionIn(
                        date=date(2026, 5, index + 1),
                        occurred_at=datetime(2026, 5, index + 1, 12, 0),
                        type=TransactionType.expense,
                        amount_cents=1000 + index,
                        category_id=uncategorized.id,
                        title=f"{merchant} {index}",
                        tags=[],
                    )
                )
                TransactionService(session).update(
                    txn.id,
                    TransactionIn(
                        date=txn.date,
                        occurred_at=txn.occurred_at,
                        type=txn.type,
                        amount_cents=txn.amount_cents,
                        category_id=category.id,
                        title=txn.title or "",
                        tags=[],
                    ),
                )
                corrected.setdefault(merchant, []).append(txn.id)
        for txn_id in corrected["ZALANDO"]:
            TransactionService(session).soft_delete(txn_id)
        categories.merge(coffee.id, dining.id)

        runner = FakeLLMRunner(
            RuleMiningOutput(
                proposals=[
                    RuleProposalOut(
                        name="Starbucks coffee",
                        match_type="contains",
                        match_value="STARBUCKS",
                        transaction_type="expense",
                        set_category_id=coffee.id,
                        add_tags=[],
                        confidence=0.9,
                        reason="Earlier corrections.",
                        evidence_transaction_ids=corrected["STARBUCKS"],
                    )
                ]
            )
        )
        proposals = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).mine_rule_suggestions()

        clusters = runner.calls[0]["payload"]["correction_clusters"]
        assert [cluster["merchant_token"] for cluster in clusters] == ["LIDL"]
        assert proposals == []
        assert session.scalar(select(RuleLLMSuggestion)) is None

        archived = RuleLLMSuggestion(
            user_id=1,
            name="Lidl",
            match_type="contains",
            match_value="LIDL",
            set_category_id=groceries.id,
            reason="Earlier corrections.",
        )
        session.add(archived)
        session.commit()
        categories.archive(groceries.id)
        with pytest.raises(ValueError, match="Groceries is archived"):
            LLMAssistantService(session, user_id=1).accept_rule_suggestion(archived.id)


@pytest.mark.anyio
async def test_rule_mining_output_failure_returns_empty_list() -> None:
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        uncategorized = CategoryService(session).get_or_create_uncategorized(
            TransactionType.expense
        )
        for index in range(2):
            txn = TransactionService(session).create(
                TransactionIn(
                    date=date(2026, 5, index + 1),
                    occurred_at=datetime(2026, 5, index + 1, 12, 0),
                    type=TransactionType.expense,
                    amount_cents=1000 + index,
                    category_id=uncategorized.id,
                    title=f"LIDL STORE {index}",
                    tags=[],
                )
            )
            TransactionService(session).update(
                txn.id,
                TransactionIn(
                    date=txn.date,
                    occurred_at=txn.occurred_at,
                    type=txn.type,
                    amount_cents=txn.amount_cents,
                    category_id=groceries.id,
                    title=txn.title or "LIDL",
                    tags=[],
                ),
            )

        runner = FailingLLMRunner(LLMOutputError("Exceeded maximum output retries (2)"))
        suggestions = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).mine_rule_suggestions(since=date(2026, 4, 25))

        job = session.scalar(select(LLMJob))
        assert suggestions == []
        assert job is not None
        assert job.status == "failed"
        assert job.error == "Exceeded maximum output retries (2)"


@pytest.mark.anyio
async def test_rule_mining_rejects_pending_suggestion() -> None:
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        uncategorized = CategoryService(session).get_or_create_uncategorized(
            TransactionType.expense
        )
        for index in range(2):
            txn = TransactionService(session).create(
                TransactionIn(
                    date=date(2026, 5, index + 1),
                    occurred_at=datetime(2026, 5, index + 1, 12, 0),
                    type=TransactionType.expense,
                    amount_cents=1000 + index,
                    category_id=uncategorized.id,
                    title=f"LIDL STORE {index}",
                    tags=[],
                )
            )
            TransactionService(session).update(
                txn.id,
                TransactionIn(
                    date=txn.date,
                    occurred_at=txn.occurred_at,
                    type=txn.type,
                    amount_cents=txn.amount_cents,
                    category_id=groceries.id,
                    title=txn.title or "LIDL",
                    tags=[],
                ),
            )

        runner = FakeLLMRunner(
            RuleMiningOutput(
                proposals=[
                    RuleProposalOut(
                        name="Lidl groceries",
                        match_type="contains",
                        match_value="LIDL",
                        transaction_type="expense",
                        set_category_id=groceries.id,
                        confidence=0.88,
                        reason="Repeated corrections.",
                        evidence_transaction_ids=[1, 2],
                    )
                ]
            )
        )
        service = LLMAssistantService(session, user_id=1, runner=runner)
        suggestions = await service.mine_rule_suggestions(since=date(2026, 4, 25))

        assert len(suggestions) == 1
        assert service.reject_rule_suggestion(suggestions[0].id) == suggestions[0].id
        assert service.pending_rule_suggestions() == []


@pytest.mark.anyio
async def test_rule_mining_skips_proposals_a_rule_cannot_hold() -> None:
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        uncategorized = CategoryService(session).get_or_create_uncategorized(
            TransactionType.expense
        )
        for index in range(2):
            txn = TransactionService(session).create(
                TransactionIn(
                    date=date(2026, 5, index + 1),
                    occurred_at=datetime(2026, 5, index + 1, 12, 0),
                    type=TransactionType.expense,
                    amount_cents=1000 + index,
                    category_id=uncategorized.id,
                    title=f"LIDL STORE {index}",
                    tags=[],
                )
            )
            TransactionService(session).update(
                txn.id,
                TransactionIn(
                    date=txn.date,
                    occurred_at=txn.occurred_at,
                    type=txn.type,
                    amount_cents=txn.amount_cents,
                    category_id=groceries.id,
                    title=txn.title or "LIDL",
                    tags=[],
                ),
            )

        def proposal(match_value: str, low: int | None, high: int | None):
            return RuleProposalOut(
                name=match_value,
                match_type="contains",
                match_value=match_value,
                transaction_type="expense",
                min_amount_cents=low,
                max_amount_cents=high,
                set_category_id=groceries.id,
                confidence=0.88,
                reason="Repeated corrections.",
                evidence_transaction_ids=[1, 2],
            )

        runner = FakeLLMRunner(
            RuleMiningOutput(
                proposals=[
                    proposal("LIDL", 500, 5_000),
                    proposal("ALDI", 5_000, 1_000),
                    proposal("REWE", None, 1_000_000_000_001),
                ]
            )
        )
        service = LLMAssistantService(session, user_id=1, runner=runner)
        suggestions = await service.mine_rule_suggestions(since=date(2026, 4, 25))

        assert [suggestion.match_value for suggestion in suggestions] == ["LIDL"]
        assert [row.match_value for row in service.pending_rule_suggestions()] == [
            "LIDL"
        ]


@pytest.mark.anyio
async def test_rule_mining_refreshes_duplicate_pending_suggestion() -> None:
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        uncategorized = CategoryService(session).get_or_create_uncategorized(
            TransactionType.expense
        )
        for index in range(2):
            txn = TransactionService(session).create(
                TransactionIn(
                    date=date(2026, 5, index + 1),
                    occurred_at=datetime(2026, 5, index + 1, 12, 0),
                    type=TransactionType.expense,
                    amount_cents=1000 + index,
                    category_id=uncategorized.id,
                    title=f"LIDL STORE {index}",
                    tags=[],
                )
            )
            TransactionService(session).update(
                txn.id,
                TransactionIn(
                    date=txn.date,
                    occurred_at=txn.occurred_at,
                    type=txn.type,
                    amount_cents=txn.amount_cents,
                    category_id=groceries.id,
                    title=txn.title or "LIDL",
                    tags=[],
                ),
            )

        service = LLMAssistantService(
            session,
            user_id=1,
            runner=FakeLLMRunner(
                RuleMiningOutput(
                    proposals=[
                        RuleProposalOut(
                            name="Lidl groceries",
                            match_type="contains",
                            match_value="LIDL",
                            transaction_type="expense",
                            set_category_id=groceries.id,
                            confidence=0.88,
                            reason="Repeated corrections.",
                            evidence_transaction_ids=[1, 2],
                        )
                    ]
                )
            ),
        )

        first = await service.mine_rule_suggestions(since=date(2026, 4, 25))
        second = await service.mine_rule_suggestions(since=date(2026, 4, 25))

        assert first[0].id == second[0].id
        assert len(service.pending_rule_suggestions()) == 1


def test_trace_clearing_keeps_recent_payloads_and_every_runs_usage() -> None:
    with make_session() as session:
        now = datetime(2026, 5, 25, 12, 0)
        for index in range(6):
            session.add(
                LLMJob(
                    user_id=1,
                    feature="transaction_triage",
                    status="completed",
                    prompt_version="test",
                    model="qwen",
                    input_hash=f"hash-{index}",
                    input_json='{"title": "Corner bakery"}',
                    output_json='{"category_id": 1}',
                    usage_total_tokens=100,
                    # One run past the age limit, two beyond the newest three.
                    created_at=now - timedelta(days=45 if index == 5 else index),
                )
            )
        session.commit()

        service = LLMAssistantService(session, user_id=1)
        cleared = service.clear_old_traces(now=now, keep_recent=3, max_age_days=30)
        again = service.clear_old_traces(now=now, keep_recent=3, max_age_days=30)

        rows = session.execute(
            select(
                LLMJob.input_hash, LLMJob.input_json, LLMJob.usage_total_tokens
            ).order_by(LLMJob.created_at.desc())
        ).all()
        assert (cleared, again) == (3, 0)
        assert [row.input_json is not None for row in rows] == [
            True,
            True,
            True,
            False,
            False,
            False,
        ]
        assert [row.usage_total_tokens for row in rows] == [100] * 6


def test_trace_clearing_fails_runs_cut_off_mid_call() -> None:
    with make_session() as session:
        now = datetime(2026, 5, 25, 12, 0)
        session.add_all(
            LLMJob(
                user_id=1,
                feature="transaction_triage",
                status="running",
                prompt_version="test",
                model="qwen",
                input_hash=f"hash-{age}",
                created_at=now - age,
            )
            for age in [timedelta(minutes=5), timedelta(days=2)]
        )
        session.commit()

        LLMAssistantService(session, user_id=1).clear_old_traces(now=now)

        rows = session.execute(
            select(LLMJob.status, LLMJob.error).order_by(LLMJob.created_at.desc())
        ).all()
        assert [tuple(row) for row in rows] == [
            ("running", None),
            ("failed", "interrupted"),
        ]


@pytest.mark.anyio
async def test_receipt_total_mismatch_is_retried_once_then_kept(monkeypatch) -> None:
    requests = []

    def misread(messages, info):
        requests.append(messages)
        return ModelResponse(
            parts=[
                TextPart(
                    '{"is_receipt": true, "total_cents": 500, "items": ['
                    '{"label": "EIER", "product": "Eier", "kind": "item", '
                    '"amount_cents": 299}]}'
                )
            ]
        )

    monkeypatch.setattr(
        backends, "build_model", lambda backend, name: FunctionModel(misread)
    )
    runner = PydanticAILLMRunner(
        ResolvedFeature(
            feature="receipt_items",
            backend=AIBackend(
                name="local", kind="openai-compatible", base_url=None, api_key=""
            ),
            model="vision",
            thinking="auto",
        )
    )

    result = await runner.run(
        feature="receipt_items",
        prompt_version="receipt_items_v1",
        payload={"products": []},
        output_type=ReceiptReadingOutput,
        images=[(b"\xff\xd8", "image/jpeg")],
    )

    assert len(requests) == 2
    assert "add up to 299 cents" in str(requests[1][-1])
    assert [item.amount_cents for item in result.output.items] == [299]


@pytest.mark.anyio
async def test_receipt_products_follow_known_labels_and_merges(
    monkeypatch, tmp_path
) -> None:
    monkeypatch.setattr(ai_service, "_receipt_image", lambda path: b"jpeg")
    engine = create_engine(f"sqlite:///{tmp_path / 'receipts.db'}")
    Base.metadata.create_all(engine)
    nightly = ai_service.merge_products_for_users_with_new_readings
    with Session(engine) as session:
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2026, 5, 1),
                occurred_at=datetime(2026, 5, 1, 12, 0),
                type=TransactionType.expense,
                amount_cents=600,
                category_id=None,
                title="REWE",
                tags=[],
            )
        )

        def receipt(name: str) -> ReceiptAttachment:
            attachment = ReceiptAttachment(
                transaction_id=txn.id,
                storage_key=name,
                original_filename=name,
                mime_type="image/jpeg",
                size_bytes=4,
                sha256_hex="0" * 64,
                items_status="reading",
            )
            session.add(attachment)
            session.commit()
            return attachment

        def line(label: str, product: str) -> ReceiptLineOut:
            return ReceiptLineOut(
                label=label, product=product, kind="item", amount_cents=200
            )

        first = receipt("first.jpg")
        await LLMAssistantService(
            session,
            user_id=1,
            runner=FakeLLMRunner(
                ReceiptReadingOutput(
                    is_receipt=True,
                    total_cents=400,
                    items=[line("BASMATI", "Basmatireis"), line("JASMIN", "Reis")],
                )
            ),
        ).read_receipt_items(first.id)

        # The same printed label keeps the product it was read as before.
        second = receipt("second.jpg")
        await LLMAssistantService(
            session,
            user_id=1,
            runner=FakeLLMRunner(
                ReceiptReadingOutput(
                    is_receipt=True,
                    total_cents=400,
                    items=[line("BASMATI", "Reis"), line("HAFERDR", "Haferdrink")],
                )
            ),
        ).read_receipt_items(second.id)
        assert [item.product for item in second.items] == ["Basmatireis", "Haferdrink"]

        # A name the owner typed is never merged away.
        second.items[1].product_named_by_user = True
        session.commit()
        runner = FakeLLMRunner(
            ProductMergesOutput(
                merges=[
                    ProductMergeOut(names=["Basmatireis", "Reis"], into="Reis"),
                    ProductMergeOut(names=["Haferdrink"], into="Milch"),
                ]
            )
        )
        renamed = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).merge_receipt_products()

        assert runner.calls[0]["payload"]["products"]["Basmatireis"] == {
            "items": 2,
            "labels": ["BASMATI"],
            "named_by_owner": False,
        }
        assert runner.calls[0]["payload"]["products"]["Haferdrink"]["named_by_owner"]
        assert renamed == 2
        assert session.scalars(
            select(ReceiptItem.product).order_by(ReceiptItem.id)
        ).all() == ["Reis", "Reis", "Reis", "Haferdrink"]

        # The nightly pass skips users with no reading since their last merge.
        merged_users = []

        async def record(self):
            merged_users.append(self.user_id)

        monkeypatch.setattr(LLMAssistantService, "merge_receipt_products", record)
        await asyncio.to_thread(nightly, engine)
        assert merged_users == []
        third = receipt("third.jpg")
        await LLMAssistantService(
            session,
            user_id=1,
            runner=FakeLLMRunner(
                ReceiptReadingOutput(is_receipt=True, items=[line("TOFU", "Tofu")])
            ),
        ).read_receipt_items(third.id)
        await asyncio.to_thread(nightly, engine)
        assert merged_users == [1]

        # A reading whose receipt was replaced by another upload during the call,
        # as when SQLite gives a deleted receipt's id to a new one, is dropped.
        replaced = receipt("replaced.jpg")

        class ReplacingRunner(FakeLLMRunner):
            async def run(self, **kwargs):
                replaced.storage_key = "new-upload.jpg"
                session.commit()
                return await super().run(**kwargs)

        await LLMAssistantService(
            session,
            user_id=1,
            runner=ReplacingRunner(
                ReceiptReadingOutput(is_receipt=True, items=[line("TOFU", "Tofu")])
            ),
        ).read_receipt_items(replaced.id)
        session.refresh(replaced)
        assert replaced.items_status == "reading"
        assert replaced.items == []


def test_receipt_image_limit_counts_progressive_jpegs_at_full_size(
    monkeypatch, tmp_path
) -> None:
    from PIL import Image

    # A 4000 px square is over the limit, but a baseline JPEG of it decodes at 2000 px.
    monkeypatch.setenv("EXPENSES_RECEIPT_THUMBNAIL_MAX_PIXELS", "5000000")
    get_settings.cache_clear()
    for name, progressive in (("baseline.jpg", False), ("progressive.jpg", True)):
        Image.new("RGB", (4000, 4000), color="white").save(
            tmp_path / name, format="JPEG", progressive=progressive
        )
    assert ai_service._receipt_image(tmp_path / "baseline.jpg")
    with pytest.raises(ValueError, match="too large"):
        ai_service._receipt_image(tmp_path / "progressive.jpg")
    get_settings.cache_clear()
