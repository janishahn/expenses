from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation
from typing import Any, AsyncIterator
from urllib.parse import urlparse

from httpx import (
    AsyncBaseTransport,
    AsyncByteStream,
    AsyncClient,
    Headers,
    HTTPError,
    Request,
    Response,
)

from expenses.db.models import LLMJob


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


class OpenAICompatibleUsageCapture:
    def __init__(self) -> None:
        self.provider_response_id: str | None = None
        self.usage_json: dict[str, Any] | None = None
        self._buffer = ""

    def record_headers(self, headers: Headers) -> None:
        generation_id = headers.get("x-generation-id")
        if generation_id:
            self.provider_response_id = generation_id

    def feed(self, chunk: bytes) -> None:
        self._buffer += chunk.decode("utf-8", errors="ignore")
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            self._record_sse_line(line.strip())

    def _record_sse_line(self, line: str) -> None:
        if not line.startswith("data: "):
            return
        payload = line[6:]
        if payload == "[DONE]":
            return
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            return
        if not isinstance(data, dict):
            return
        response_id = data.get("id")
        if isinstance(response_id, str) and response_id:
            self.provider_response_id = response_id
        usage = data.get("usage")
        if isinstance(usage, dict):
            self.usage_json = usage


class UsageCaptureTransport(AsyncBaseTransport):
    def __init__(
        self,
        transport: AsyncBaseTransport,
        capture: OpenAICompatibleUsageCapture,
    ) -> None:
        self.transport = transport
        self.capture = capture

    async def handle_async_request(self, request: Request) -> Response:
        response = await self.transport.handle_async_request(request)
        self.capture.record_headers(response.headers)
        return Response(
            status_code=response.status_code,
            headers=response.headers,
            stream=UsageCaptureStream(response.stream, self.capture),
            extensions=response.extensions,
            request=response.request,
        )

    async def aclose(self) -> None:
        await self.transport.aclose()


class UsageCaptureStream(AsyncByteStream):
    def __init__(
        self,
        stream: AsyncByteStream,
        capture: OpenAICompatibleUsageCapture,
    ) -> None:
        self.stream = stream
        self.capture = capture

    async def __aiter__(self) -> AsyncIterator[bytes]:
        async for chunk in self.stream:
            self.capture.feed(chunk)
            yield chunk

    async def aclose(self) -> None:
        await self.stream.aclose()


def usage_metadata_from_result(
    *,
    usage: Any,
    messages: list[Any],
    base_url: str,
    configured_model: str,
) -> LLMUsageMetadata:
    response = _last_model_response(messages)
    details = getattr(usage, "details", None) or {}
    input_tokens = _positive_int(getattr(usage, "input_tokens", None))
    output_tokens = _positive_int(getattr(usage, "output_tokens", None))
    cached_input_tokens = _positive_int(getattr(usage, "cache_read_tokens", None))
    cache_write_tokens = _positive_int(getattr(usage, "cache_write_tokens", None))
    reasoning_tokens = _positive_int(details.get("reasoning_tokens"))
    return LLMUsageMetadata(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=_total_tokens(input_tokens, output_tokens),
        cached_input_tokens=cached_input_tokens,
        cache_write_tokens=cache_write_tokens,
        reasoning_tokens=reasoning_tokens,
        request_count=_positive_int(getattr(usage, "requests", None)),
        tool_call_count=_positive_int(getattr(usage, "tool_calls", None)),
        llm_provider=detect_llm_provider(base_url),
        provider_name=getattr(response, "provider_name", None) if response else None,
        provider_model=getattr(response, "model_name", None) or configured_model,
        provider_response_id=getattr(response, "provider_response_id", None)
        if response
        else None,
    )


def apply_captured_provider_usage(
    metadata: LLMUsageMetadata,
    capture: OpenAICompatibleUsageCapture,
) -> LLMUsageMetadata:
    usage = capture.usage_json
    if usage is None:
        return replace(
            metadata,
            provider_response_id=capture.provider_response_id
            or metadata.provider_response_id,
        )
    prompt_details = usage.get("prompt_tokens_details")
    completion_details = usage.get("completion_tokens_details")
    input_tokens = _positive_int(usage.get("prompt_tokens"))
    output_tokens = _positive_int(usage.get("completion_tokens"))
    total_tokens = _positive_int(usage.get("total_tokens")) or _total_tokens(
        input_tokens or metadata.input_tokens,
        output_tokens or metadata.output_tokens,
    )
    cost_decimal = _decimal_text(usage.get("cost"))
    return replace(
        metadata,
        input_tokens=input_tokens or metadata.input_tokens,
        output_tokens=output_tokens or metadata.output_tokens,
        total_tokens=total_tokens or metadata.total_tokens,
        cached_input_tokens=_positive_int(
            prompt_details.get("cached_tokens")
            if isinstance(prompt_details, dict)
            else None
        )
        or metadata.cached_input_tokens,
        cache_write_tokens=_positive_int(
            prompt_details.get("cache_write_tokens")
            if isinstance(prompt_details, dict)
            else None
        )
        or metadata.cache_write_tokens,
        reasoning_tokens=_positive_int(
            completion_details.get("reasoning_tokens")
            if isinstance(completion_details, dict)
            else None
        )
        or metadata.reasoning_tokens,
        cost_decimal=cost_decimal or metadata.cost_decimal,
        cost_unit="openrouter_credits"
        if metadata.llm_provider == "openrouter" and cost_decimal is not None
        else metadata.cost_unit,
        provider_response_id=capture.provider_response_id
        or metadata.provider_response_id,
        provider_usage_json=_compact_openrouter_usage(usage)
        if metadata.llm_provider == "openrouter"
        else usage,
    )


async def enrich_openrouter_generation_usage(
    metadata: LLMUsageMetadata,
    *,
    http_client: AsyncClient,
    api_key: str,
    base_url: str,
) -> LLMUsageMetadata:
    if (
        metadata.llm_provider != "openrouter"
        or not metadata.provider_response_id
        or not api_key
    ):
        return metadata
    generation_url = _openrouter_generation_url(base_url)
    if generation_url is None:
        return metadata
    try:
        response = await http_client.get(
            generation_url,
            params={"id": metadata.provider_response_id},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=8,
        )
        response.raise_for_status()
        payload = response.json()
    except (HTTPError, ValueError):
        return metadata
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return metadata
    input_tokens = _positive_int(data.get("tokens_prompt")) or _positive_int(
        data.get("native_tokens_prompt")
    )
    output_tokens = _positive_int(data.get("tokens_completion")) or _positive_int(
        data.get("native_tokens_completion")
    )
    cost_value = data.get("total_cost")
    if cost_value is None:
        cost_value = data.get("usage")
    return replace(
        metadata,
        input_tokens=input_tokens or metadata.input_tokens,
        output_tokens=output_tokens or metadata.output_tokens,
        total_tokens=_total_tokens(
            input_tokens or metadata.input_tokens,
            output_tokens or metadata.output_tokens,
        ),
        cached_input_tokens=_positive_int(data.get("native_tokens_cached"))
        or metadata.cached_input_tokens,
        reasoning_tokens=_positive_int(data.get("native_tokens_reasoning"))
        or metadata.reasoning_tokens,
        cost_decimal=_decimal_text(cost_value) or metadata.cost_decimal,
        cost_unit="openrouter_credits"
        if data.get("total_cost") is not None or data.get("usage") is not None
        else metadata.cost_unit,
        provider_name=str(data.get("provider_name") or metadata.provider_name)
        if data.get("provider_name") or metadata.provider_name
        else None,
        provider_model=str(data.get("model") or metadata.provider_model)
        if data.get("model") or metadata.provider_model
        else None,
        provider_request_id=str(data.get("request_id") or metadata.provider_request_id)
        if data.get("request_id") or metadata.provider_request_id
        else None,
        provider_usage_json=_compact_openrouter_generation(data),
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


def chat_output_trace(
    assistant_message: str, message_history: list[dict[str, Any]]
) -> str:
    payload = {
        "kind": "message",
        "assistant_message_sha256": hashlib.sha256(
            assistant_message.encode("utf-8")
        ).hexdigest(),
        "assistant_message_chars": len(assistant_message),
        "message_history_entries": len(message_history),
    }
    return json.dumps(payload, ensure_ascii=True, sort_keys=True)


def detect_llm_provider(base_url: str) -> str:
    host = urlparse(base_url).netloc.lower()
    if host.endswith("openrouter.ai"):
        return "openrouter"
    return "openai_compatible"


def _last_model_response(messages: list[Any]) -> Any | None:
    for message in reversed(messages):
        if getattr(message, "kind", None) == "response":
            return message
    return None


def _positive_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return parsed


def _total_tokens(input_tokens: int | None, output_tokens: int | None) -> int | None:
    if input_tokens is None and output_tokens is None:
        return None
    return (input_tokens or 0) + (output_tokens or 0)


def _decimal_text(value: Any) -> str | None:
    if value is None:
        return None
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return format(decimal, "f")


def _openrouter_generation_url(base_url: str) -> str | None:
    parsed = urlparse(base_url)
    if not parsed.scheme or not parsed.netloc:
        return None
    if not parsed.netloc.lower().endswith("openrouter.ai"):
        return None
    return f"{parsed.scheme}://{parsed.netloc}/api/v1/generation"


def _compact_openrouter_generation(data: dict[str, Any]) -> dict[str, Any]:
    keys = {
        "id",
        "is_byok",
        "latency",
        "model",
        "native_finish_reason",
        "native_tokens_cached",
        "native_tokens_completion",
        "native_tokens_prompt",
        "native_tokens_reasoning",
        "provider_name",
        "request_id",
        "router",
        "service_tier",
        "streamed",
        "tokens_completion",
        "tokens_prompt",
        "total_cost",
        "upstream_id",
        "upstream_inference_cost",
        "usage",
    }
    return {key: data[key] for key in sorted(keys) if key in data}


def _compact_openrouter_usage(usage: dict[str, Any]) -> dict[str, Any]:
    keys = {
        "completion_tokens",
        "completion_tokens_details",
        "cost",
        "cost_details",
        "is_byok",
        "prompt_tokens",
        "prompt_tokens_details",
        "server_tool_use",
        "total_tokens",
    }
    return {key: usage[key] for key in sorted(keys) if key in usage}
