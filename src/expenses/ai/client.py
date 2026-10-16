from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Generic, TypeVar

from pydantic import BaseModel

from expenses.ai.schemas import (
    RuleMiningOutput,
    TransactionTriageOutput,
)
from expenses.ai.usage import LLMUsageMetadata, usage_metadata

if TYPE_CHECKING:
    from pydantic_ai import ModelSettings

    from expenses.ai.features import ResolvedFeature


OutputT = TypeVar("OutputT", bound=BaseModel)


class LLMDisabledError(RuntimeError):
    pass


class LLMOutputError(RuntimeError):
    pass


# Caps a suggestion run's output, reasoning and retries included. It sits above
# Anthropic's largest thinking budget (32,768 tokens), so one attempt fits at any
# thinking level, and is checked here rather than sent to the backend.
OUTPUT_TOKENS_LIMIT = 40_000


@dataclass(frozen=True)
class LLMRunResult(Generic[OutputT]):
    output: OutputT
    input_tokens: int | None = None
    output_tokens: int | None = None
    usage_metadata: LLMUsageMetadata | None = None


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


def model_settings(resolved: ResolvedFeature, *, cache: bool = False) -> ModelSettings:
    settings: ModelSettings = {}
    if resolved.thinking == "off":
        settings["thinking"] = False
    elif resolved.thinking != "auto":
        settings["thinking"] = resolved.thinking
    if cache:
        settings["cache"] = True
    return settings


class PydanticAILLMRunner(LLMRunner):
    def __init__(self, resolved: ResolvedFeature) -> None:
        self.resolved = resolved
        self.model_name = resolved.model

    async def run(
        self,
        *,
        feature: str,
        prompt_version: str,
        payload: dict[str, Any],
        output_type: type[OutputT],
    ) -> LLMRunResult[OutputT]:
        from pydantic_ai import Agent, ModelRetry, PromptedOutput, RunContext
        from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded
        from pydantic_ai.usage import UsageLimits

        from expenses.ai.backends import build_model

        # The first build imports the backend's SDK, which takes seconds on a Pi.
        model = await asyncio.to_thread(
            build_model, self.resolved.backend, self.resolved.model
        )
        agent = Agent(
            model,
            deps_type=dict[str, Any],
            output_type=PromptedOutput(output_type),
            instructions=_instructions_for_feature(feature),
            retries=2,
            model_settings=model_settings(self.resolved),
        )

        @agent.output_validator
        async def validate_output(
            ctx: RunContext[dict[str, Any]], output: OutputT
        ) -> OutputT:
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
                usage_limits=UsageLimits(output_tokens_limit=OUTPUT_TOKENS_LIMIT),
            )
        except (UnexpectedModelBehavior, UsageLimitExceeded) as exc:
            raise LLMOutputError(str(exc)) from exc
        metadata = usage_metadata(
            usage=result.usage,
            messages=result.all_messages(),
            llm_provider=self.resolved.backend.kind,
            model=self.resolved.model,
        )
        return LLMRunResult(
            output=result.output,
            input_tokens=metadata.input_tokens,
            output_tokens=metadata.output_tokens,
            usage_metadata=metadata,
        )


def _instructions_for_feature(feature: str) -> str:
    common = (
        "Return only data matching the requested schema. Do not invent categories, "
        "tags, ids, dates, or amounts. Use only ids and labels present in the payload. "
        "Keep the answer concise."
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
