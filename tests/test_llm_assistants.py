from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from expenses_web.ai.client import LLMRunResult
from expenses_web.ai.schemas import (
    RuleMiningOutput,
    RuleProposalOut,
    SearchTranslationOutput,
    TransactionTriageOutput,
)
from expenses_web.ai.service import LLMAssistantService
from expenses_web.db.models import (
    LLMJob,
    RuleLLMSuggestion,
    TransactionClassificationEvent,
    TransactionType,
)
from expenses_web.db.session import Base
from expenses_web.schemas import CategoryIn, IngestTransactionIn, TransactionIn
from expenses_web.services import CategoryService, IngestService, TransactionService


class FakeLLMRunner:
    def __init__(self, output):
        self.output = output
        self.calls = []

    async def run(self, *, feature, prompt_version, payload, output_type):
        self.calls.append(
            {
                "feature": feature,
                "prompt_version": prompt_version,
                "payload": payload,
                "output_type": output_type,
            }
        )
        return self.output


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


@pytest.fixture()
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
async def test_natural_language_search_translation_records_usage() -> None:
    with make_session() as session:
        CategoryService(session).create(
            CategoryIn(name="Restaurants", type=TransactionType.expense, order=0)
        )
        runner = FakeLLMRunner(
            LLMRunResult(
                output=SearchTranslationOutput(
                    query=(
                        "type:expense category:Restaurants amount>30 "
                        "date>=2026-04-01 date<=2026-04-30 has:receipt"
                    ),
                    confidence=0.94,
                    clarification_needed=False,
                ),
                input_tokens=120,
                output_tokens=24,
            )
        )

        result = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).translate_search_query(
            "restaurant expenses over 30 euros last month with receipts",
            reference_date=date(2026, 5, 25),
        )

        job = session.scalar(select(LLMJob))
        assert job is not None
        assert job.usage_input_tokens == 120
        assert job.usage_output_tokens == 24
        assert result.query == (
            "type:expense category:Restaurants amount>30 "
            "date>=2026-04-01 date<=2026-04-30 has:receipt"
        )
        assert result.applied_tokens[0]["key"] == "type"
        assert runner.calls[0]["payload"]["reference_date"] == "2026-05-25"


@pytest.mark.anyio
async def test_natural_language_search_translation_validates_existing_syntax() -> None:
    with make_session() as session:
        CategoryService(session).create(
            CategoryIn(name="Restaurants", type=TransactionType.expense, order=0)
        )
        runner = FakeLLMRunner(
            SearchTranslationOutput(
                query=(
                    "type:expense category:Restaurants amount>30 "
                    "date>=2026-04-01 date<=2026-04-30 has:receipt"
                ),
                confidence=0.94,
                clarification_needed=False,
            )
        )

        result = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).translate_search_query(
            "restaurant expenses over 30 euros last month with receipts",
            reference_date=date(2026, 5, 25),
        )

        assert result.query == (
            "type:expense category:Restaurants amount>30 "
            "date>=2026-04-01 date<=2026-04-30 has:receipt"
        )
        assert result.applied_tokens[0]["key"] == "type"
        assert runner.calls[0]["payload"]["reference_date"] == "2026-05-25"


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


def test_llm_job_rotation_keeps_recent_trace_rows() -> None:
    with make_session() as session:
        now = datetime(2026, 5, 25, 12, 0)
        for index in range(12):
            session.add(
                LLMJob(
                    user_id=1,
                    feature="search_translate",
                    status="completed",
                    prompt_version="test",
                    model="qwen",
                    input_hash=f"hash-{index}",
                    created_at=now - timedelta(days=index),
                    finished_at=now - timedelta(days=index),
                )
            )
        session.commit()

        deleted = LLMAssistantService(session, user_id=1).prune_trace_rows(
            now=now, keep_recent=5, max_age_days=365
        )

        remaining = session.scalars(
            select(LLMJob).order_by(LLMJob.created_at.desc())
        ).all()
        assert deleted == 7
        assert len(remaining) == 5
        assert remaining[0].input_hash == "hash-0"


def test_llm_job_rotation_removes_rows_past_max_age() -> None:
    with make_session() as session:
        now = datetime(2026, 5, 25, 12, 0)
        for index in range(3):
            session.add(
                LLMJob(
                    user_id=1,
                    feature="search_translate",
                    status="completed",
                    prompt_version="test",
                    model="qwen",
                    input_hash=f"recent-{index}",
                    created_at=now - timedelta(days=index),
                )
            )
        session.add(
            LLMJob(
                user_id=1,
                feature="search_translate",
                status="completed",
                prompt_version="test",
                model="qwen",
                input_hash="old",
                created_at=now - timedelta(days=45),
            )
        )
        session.commit()

        deleted = LLMAssistantService(session, user_id=1).prune_trace_rows(
            now=now, keep_recent=10, max_age_days=30
        )

        remaining_hashes = set(session.scalars(select(LLMJob.input_hash)).all())
        assert deleted == 1
        assert remaining_hashes == {"recent-0", "recent-1", "recent-2"}
