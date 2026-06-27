from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from expenses.ai.client import (
    LLMOutputError,
    LLMRunResult,
    _request_model_settings,
)
from expenses.ai.schemas import (
    RuleMiningOutput,
    RuleProposalOut,
    SearchTranslationOutput,
    TransactionTriageOutput,
)
from expenses.ai.service import LLMAssistantService
from expenses.core.config import get_settings
from expenses.db.models import (
    LLMJob,
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


class FailingLLMRunner:
    def __init__(self, exc: Exception):
        self.exc = exc
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
        raise self.exc


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def _configure_enabled_llm(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    *,
    temperature: str | None = None,
    max_output_tokens: str | None = None,
) -> None:
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_LLM_ENABLED", "true")
    monkeypatch.setenv("EXPENSES_LLM_BASE_URL", "http://llm.local/v1")
    if temperature is not None:
        monkeypatch.setenv("EXPENSES_LLM_TEMPERATURE", temperature)
    if max_output_tokens is not None:
        monkeypatch.setenv("EXPENSES_LLM_MAX_OUTPUT_TOKENS", max_output_tokens)
    get_settings.cache_clear()


@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"


def test_llm_feature_defaults_include_reasoning_token_headroom(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    _configure_enabled_llm(monkeypatch, tmp_path)
    try:
        with make_session() as session:
            service = LLMAssistantService(session, user_id=1)

            search = service._runner_for_feature("search_translate")
            triage = service._runner_for_feature("transaction_triage")
            rule_mining = service._runner_for_feature("rule_mining")

            assert search.temperature == 0.0
            assert search.max_tokens == 512
            assert search.reasoning_effort == "none"

            assert triage.temperature == 0.7
            assert triage.max_tokens == 2_048
            assert triage.reasoning_effort == "low"

            assert rule_mining.temperature == 0.7
            assert rule_mining.max_tokens == 4_096
            assert rule_mining.reasoning_effort == "medium"
    finally:
        get_settings.cache_clear()


def test_llm_generation_overrides_do_not_change_reasoning_effort(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    _configure_enabled_llm(
        monkeypatch,
        tmp_path,
        temperature="0.9",
        max_output_tokens="2048",
    )
    try:
        with make_session() as session:
            service = LLMAssistantService(session, user_id=1)

            search = service._runner_for_feature("search_translate")
            rule_mining = service._runner_for_feature("rule_mining")

            assert search.temperature == 0.9
            assert search.max_tokens == 2_048
            assert search.reasoning_effort == "none"

            assert rule_mining.temperature == 0.9
            assert rule_mining.max_tokens == 2_048
            assert rule_mining.reasoning_effort == "medium"
    finally:
        get_settings.cache_clear()


def test_llm_request_settings_use_openrouter_reasoning_shape() -> None:
    settings = _request_model_settings(
        temperature=0.7,
        max_tokens=512,
        api_key="",
        reasoning_effort="none",
        omit_authorization=object(),
    )

    assert settings["extra_body"] == {"reasoning": {"effort": "none"}}
    assert "reasoning_effort" not in settings["extra_body"]


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
async def test_natural_language_search_translation_rejects_invalid_category_output() -> (
    None
):
    with make_session() as session:
        CategoryService(session).create(
            CategoryIn(name="Food & Groceries", type=TransactionType.expense, order=0)
        )
        runner = FakeLLMRunner(
            SearchTranslationOutput(
                query="type:expense category:Food & Groceries amount>=20",
                confidence=0.82,
                clarification_needed=False,
            )
        )

        result = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).translate_search_query(
            "grocery spending over 20 euros",
            reference_date=date(2026, 5, 25),
        )

        assert result.query == ""
        assert result.clarification_needed is True
        assert result.clarification_question == (
            "I could not translate that into search syntax."
        )
        assert result.applied_tokens == []
        assert result.free_terms == []


@pytest.mark.anyio
async def test_natural_language_search_translation_accepts_case_insensitive_names() -> (
    None
):
    with make_session() as session:
        groceries = CategoryService(session).create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        TransactionService(session).create(
            TransactionIn(
                date=date(2026, 5, 1),
                occurred_at=datetime(2026, 5, 1, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=groceries.id,
                title="Lidl",
                tags=["Essential"],
            )
        )
        runner = FakeLLMRunner(
            SearchTranslationOutput(
                query="category:groceries tag:essential",
                confidence=0.82,
                clarification_needed=False,
            )
        )

        result = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).translate_search_query(
            "essential groceries",
            reference_date=date(2026, 5, 25),
        )

        assert result.query == "category:groceries tag:essential"
        assert result.clarification_needed is False
        assert result.free_terms == []


@pytest.mark.anyio
async def test_natural_language_search_translation_requires_clarification_question() -> (
    None
):
    with make_session() as session:
        runner = FakeLLMRunner(
            SearchTranslationOutput(
                query="",
                confidence=0.2,
                clarification_needed=True,
            )
        )

        result = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).translate_search_query(
            "not enough context",
            reference_date=date(2026, 5, 25),
        )

        assert result.query == ""
        assert result.clarification_needed is True
        assert result.clarification_question == (
            "I could not translate that into search syntax."
        )


@pytest.mark.anyio
async def test_natural_language_search_translation_allows_parenthesized_free_text() -> (
    None
):
    with make_session() as session:
        runner = FakeLLMRunner(
            SearchTranslationOutput(
                query='"Trader Joe\'s (SF)"',
                confidence=0.78,
                clarification_needed=False,
            )
        )

        result = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).translate_search_query(
            "trader joe's sf",
            reference_date=date(2026, 5, 25),
        )

        assert result.query == '"Trader Joe\'s (SF)"'
        assert result.clarification_needed is False
        assert result.free_terms == ["Trader Joe's (SF)"]


@pytest.mark.anyio
async def test_natural_language_search_translation_rejects_boolean_connector_output() -> (
    None
):
    with make_session() as session:
        CategoryService(session).create(
            CategoryIn(name="Food & Groceries", type=TransactionType.expense, order=0)
        )
        CategoryService(session).create(
            CategoryIn(name="Restaurants", type=TransactionType.expense, order=1)
        )
        runner = FakeLLMRunner(
            SearchTranslationOutput(
                query=(
                    'category:"Food & Groceries" OR category:Restaurants '
                    "date>=2026-01-01"
                ),
                confidence=0.82,
                clarification_needed=False,
            )
        )

        result = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).translate_search_query(
            "compare groceries and restaurants this year",
            reference_date=date(2026, 5, 25),
        )

        assert result.query == ""
        assert result.clarification_needed is True
        assert result.clarification_question == (
            "I could not translate that into search syntax."
        )
        assert result.applied_tokens == []
        assert result.free_terms == []


@pytest.mark.anyio
async def test_natural_language_search_translation_output_failure_returns_clarification() -> (
    None
):
    with make_session() as session:
        runner = FailingLLMRunner(LLMOutputError("Exceeded maximum output retries (2)"))

        result = await LLMAssistantService(
            session, user_id=1, runner=runner
        ).translate_search_query(
            "restaurants or travel under 80 euros last month",
            reference_date=date(2026, 5, 25),
        )

        job = session.scalar(select(LLMJob))
        assert result.query == ""
        assert result.clarification_needed is True
        assert result.clarification_question == (
            "I could not translate that into search syntax."
        )
        assert result.applied_tokens == []
        assert result.free_terms == []
        assert job is not None
        assert job.status == "failed"
        assert job.error == "Exceeded maximum output retries (2)"


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
