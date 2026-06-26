from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Generic, Literal, TypeVar

from httpx import AsyncClient, HTTPStatusError, Response
from pydantic import BaseModel
from tenacity import retry_if_exception_type, stop_after_attempt, wait_exponential

from expenses.ai.schemas import (
    RuleMiningOutput,
    SearchTranslationOutput,
    TransactionTriageOutput,
)
from expenses.core.config import get_settings


OutputT = TypeVar("OutputT", bound=BaseModel)
ReasoningEffort = Literal["none", "low", "medium", "high"]


class LLMDisabledError(RuntimeError):
    pass


@dataclass(frozen=True)
class LLMRunResult(Generic[OutputT]):
    output: OutputT
    input_tokens: int | None = None
    output_tokens: int | None = None


class LLMRunner:
    async def run(
        self,
        *,
        feature: str,
        prompt_version: str,
        payload: dict[str, Any],
        output_type: type[OutputT],
    ) -> OutputT | LLMRunResult[OutputT]:
        raise NotImplementedError


class PydanticAILLMRunner(LLMRunner):
    def __init__(
        self,
        *,
        max_tokens: int,
        temperature: float | None,
        reasoning_effort: ReasoningEffort,
    ) -> None:
        settings = get_settings()
        if not settings.llm_enabled:
            raise LLMDisabledError("LLM usage is disabled")
        if not settings.llm_base_url:
            raise LLMDisabledError("EXPENSES_LLM_BASE_URL is not configured")
        self.model_name = settings.llm_model
        self.base_url = settings.llm_base_url
        self.api_key = settings.llm_api_key
        self.reasoning_effort = reasoning_effort
        self.max_tokens = max_tokens
        self.temperature = temperature

    async def run(
        self,
        *,
        feature: str,
        prompt_version: str,
        payload: dict[str, Any],
        output_type: type[OutputT],
    ) -> LLMRunResult[OutputT]:
        try:
            from pydantic_ai import Agent, ModelRetry, ModelSettings, RunContext
            from pydantic_ai.models.openai import OpenAIChatModel
            from pydantic_ai.providers.openai import OpenAIProvider
            from pydantic_ai.retries import (
                AsyncTenacityTransport,
                RetryConfig,
                wait_retry_after,
            )
            from openai import omit
        except ImportError as exc:
            raise LLMDisabledError("Install pydantic-ai to enable LLM usage") from exc

        http_client = _retrying_http_client(
            AsyncTenacityTransport=AsyncTenacityTransport,
            RetryConfig=RetryConfig,
            wait_retry_after=wait_retry_after,
        )
        model = OpenAIChatModel(
            self.model_name,
            provider=OpenAIProvider(
                base_url=self.base_url,
                api_key=self.api_key or None,
                http_client=http_client,
            ),
        )
        model_settings = ModelSettings(
            **_request_model_settings(
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                api_key=self.api_key,
                reasoning_effort=self.reasoning_effort,
                omit_authorization=omit,
            )
        )
        agent = Agent(
            model,
            deps_type=dict[str, Any],
            output_type=output_type,
            instructions=_instructions_for_feature(feature),
            retries=2,
            model_settings=model_settings,
        )

        @agent.output_validator
        async def validate_output(
            ctx: RunContext[dict[str, Any]], output: OutputT
        ) -> OutputT:
            if isinstance(output, SearchTranslationOutput):
                query = output.query.strip()
                if not query and not output.clarification_needed:
                    raise ModelRetry(
                        "Return clarification_needed=true when query is empty."
                    )
                if output.clarification_needed and not output.clarification_question:
                    raise ModelRetry(
                        "Return a clarification_question when clarification is needed."
                    )
            if isinstance(output, TransactionTriageOutput):
                if output.clean_title is None:
                    raise ModelRetry(
                        "Return clean_title by preserving the current title unless a "
                        "clearer merchant title is obvious."
                    )
                category_ids = {
                    int(category["id"]) for category in ctx.deps.get("categories", [])
                }
                if (
                    output.category_id is not None
                    and output.category_id not in category_ids
                ):
                    raise ModelRetry("Use only category_id values from the payload.")
                if (
                    output.category_id is None
                    and not output.tags
                    and output.confidence >= 0.6
                ):
                    raise ModelRetry(
                        "Choose a category or tags for confident transaction triage; "
                        "use lower confidence for genuinely ambiguous transactions."
                    )
            if isinstance(output, RuleMiningOutput):
                category_ids = {
                    int(category["id"]) for category in ctx.deps.get("categories", [])
                }
                tag_names = {str(tag["name"]) for tag in ctx.deps.get("tags", [])}
                evidence_ids = {
                    int(txn_id)
                    for cluster in ctx.deps.get("correction_clusters", [])
                    for txn_id in cluster.get("evidence_transaction_ids", [])
                }
                for proposal in output.proposals:
                    if not proposal.evidence_transaction_ids:
                        raise ModelRetry(
                            "Every rule proposal needs evidence_transaction_ids from "
                            "the payload."
                        )
                    if any(
                        txn_id not in evidence_ids
                        for txn_id in proposal.evidence_transaction_ids
                    ):
                        raise ModelRetry(
                            "Use only evidence_transaction_ids from the payload."
                        )
                    if (
                        proposal.set_category_id is not None
                        and proposal.set_category_id not in category_ids
                    ):
                        raise ModelRetry(
                            "Use only set_category_id values from the payload."
                        )
                    if any(tag not in tag_names for tag in proposal.add_tags):
                        raise ModelRetry("Use only add_tags values from the payload.")
                    if proposal.set_category_id is None and not proposal.add_tags:
                        raise ModelRetry(
                            "Every rule proposal needs set_category_id or add_tags."
                        )
            return output

        try:
            result = await agent.run(
                json.dumps(
                    {
                        "prompt_version": prompt_version,
                        "payload": payload,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
                deps=payload,
            )
        finally:
            await http_client.aclose()
        return LLMRunResult(
            output=result.output,
            input_tokens=result.usage.input_tokens or None,
            output_tokens=result.usage.output_tokens or None,
        )


def _request_model_settings(
    *,
    temperature: float | None,
    max_tokens: int,
    api_key: str,
    reasoning_effort: ReasoningEffort,
    omit_authorization: object,
) -> dict[str, Any]:
    settings: dict[str, Any] = {
        "max_tokens": max_tokens,
        "extra_body": {"reasoning_effort": reasoning_effort},
    }
    if temperature is not None:
        settings["temperature"] = temperature
    if not api_key:
        settings["extra_headers"] = {"Authorization": omit_authorization}
    return settings


def _retrying_http_client(
    *,
    AsyncTenacityTransport: type,
    RetryConfig: type,
    wait_retry_after: Any,
) -> AsyncClient:
    def should_retry_status(response: Response) -> None:
        if response.status_code in {429, 502, 503, 504}:
            response.raise_for_status()

    transport = AsyncTenacityTransport(
        config=RetryConfig(
            retry=retry_if_exception_type((HTTPStatusError, ConnectionError)),
            wait=wait_retry_after(
                fallback_strategy=wait_exponential(multiplier=0.5, max=4),
                max_wait=8,
            ),
            stop=stop_after_attempt(3),
            reraise=True,
        ),
        validate_response=should_retry_status,
    )
    return AsyncClient(transport=transport)


def _instructions_for_feature(feature: str) -> str:
    common = (
        "Return only data matching the requested schema. Do not invent categories, "
        "tags, ids, dates, or amounts. Use only ids and labels present in the payload. "
        "Keep the answer concise."
    )
    if feature == "search_translate":
        return (
            common
            + " Translate the natural-language request into the allowed transaction "
            "search syntax. If a safe search cannot be represented, return an empty "
            "query with clarification_needed true and a concise clarification_question. "
            "Never return an empty query with clarification_needed false."
        )
    if feature == "transaction_triage":
        return (
            common
            + " Suggest a category, tags, and optional title cleanup for the single "
            "Uncategorized transaction. Keep clean_title non-empty by preserving the "
            "current title unless a clearer merchant title is obvious. Choose the best "
            "category when the evidence is sufficient; use null only for genuinely "
            "ambiguous transactions and explain the uncertainty in reason. Do not "
            "request writes."
        )
    if feature == "rule_mining":
        return (
            common
            + " Propose deterministic title-based rules only when the supplied evidence "
            "shows repeated user-confirmed classification behavior. Return proposals [] "
            "when there is no actionable repeated pattern. Every proposal must include "
            "evidence_transaction_ids from the payload, a title match_value derived from "
            "the repeated merchant token, and either set_category_id or add_tags."
        )
    return common
