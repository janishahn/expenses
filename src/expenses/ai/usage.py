from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from expenses.db.models import LLMJob

if TYPE_CHECKING:
    from pydantic_ai.messages import ModelMessage
    from pydantic_ai.usage import RunUsage


@dataclass(frozen=True)
class LLMUsageMetadata:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    cached_input_tokens: int | None = None
    cache_write_tokens: int | None = None
    reasoning_tokens: int | None = None
    request_count: int | None = None
    tool_call_count: int | None = None
    cost_decimal: str | None = None
    cost_unit: str | None = None
    llm_provider: str | None = None
    provider_name: str | None = None
    provider_model: str | None = None
    provider_response_id: str | None = None
    provider_request_id: str | None = None
    provider_usage_json: dict[str, Any] | None = None


def usage_metadata(
    *,
    usage: RunUsage,
    messages: list[ModelMessage],
    llm_provider: str,
    model: str,
) -> LLMUsageMetadata:
    from pydantic_ai.messages import ModelResponse

    response = next(
        (
            message
            for message in reversed(messages)
            if isinstance(message, ModelResponse)
        ),
        None,
    )
    input_tokens = usage.input_tokens or None
    output_tokens = usage.output_tokens or None
    return LLMUsageMetadata(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=(input_tokens or 0) + (output_tokens or 0) or None,
        cached_input_tokens=usage.cache_read_tokens or None,
        cache_write_tokens=usage.cache_write_tokens or None,
        reasoning_tokens=usage.details.get("reasoning_tokens") or None,
        request_count=usage.requests or None,
        tool_call_count=usage.tool_calls or None,
        cost_decimal=format(usage.cost, "f") if usage.cost is not None else None,
        cost_unit="usd" if usage.cost is not None else None,
        llm_provider=llm_provider,
        provider_name=response.provider_name if response else None,
        provider_model=(response.model_name if response else None) or model,
        provider_response_id=response.provider_response_id if response else None,
    )


def apply_usage_metadata(job: LLMJob, metadata: LLMUsageMetadata) -> None:
    job.usage_input_tokens = metadata.input_tokens
    job.usage_output_tokens = metadata.output_tokens
    job.usage_total_tokens = metadata.total_tokens
    job.usage_cached_input_tokens = metadata.cached_input_tokens
    job.usage_cache_write_tokens = metadata.cache_write_tokens
    job.usage_reasoning_tokens = metadata.reasoning_tokens
    job.usage_request_count = metadata.request_count
    job.usage_tool_call_count = metadata.tool_call_count
    job.usage_cost_decimal = metadata.cost_decimal
    job.usage_cost_unit = metadata.cost_unit
    job.llm_provider = metadata.llm_provider
    job.provider_name = metadata.provider_name
    job.provider_model = metadata.provider_model
    job.provider_response_id = metadata.provider_response_id
    job.provider_request_id = metadata.provider_request_id
    if metadata.provider_usage_json is not None:
        job.provider_usage_json = json.dumps(
            metadata.provider_usage_json,
            ensure_ascii=True,
            sort_keys=True,
            default=str,
        )


def chat_input_trace(current_message: str, history_messages: int) -> str:
    payload = {
        "kind": "request",
        "current_message_sha256": hashlib.sha256(
            current_message.encode("utf-8")
        ).hexdigest(),
        "current_message_chars": len(current_message),
        "message_history_entries": history_messages,
    }
    return json.dumps(payload, ensure_ascii=True, sort_keys=True)


def chat_output_trace(answer: str, new_messages: int) -> str:
    payload = {
        "kind": "message",
        "assistant_message_sha256": hashlib.sha256(answer.encode("utf-8")).hexdigest(),
        "assistant_message_chars": len(answer),
        "new_message_entries": new_messages,
    }
    return json.dumps(payload, ensure_ascii=True, sort_keys=True)
