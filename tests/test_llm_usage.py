from types import SimpleNamespace

import pytest
from httpx import AsyncClient, MockTransport, Response

from expenses.ai.usage import (
    LLMUsageMetadata,
    OpenAICompatibleUsageCapture,
    apply_captured_provider_usage,
    enrich_openrouter_generation_usage,
    usage_metadata_from_result,
)


@pytest.fixture()
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_openrouter_generation_enrichment_preserves_tiny_costs() -> None:
    async def handler(request):
        assert request.url.path == "/api/v1/generation"
        assert request.url.params["id"] == "gen-test"
        assert request.headers["authorization"] == "Bearer sk-test"
        return Response(
            200,
            json={
                "data": {
                    "model": "openai/gpt-test",
                    "native_tokens_cached": 3,
                    "native_tokens_completion": 7,
                    "native_tokens_prompt": 11,
                    "native_tokens_reasoning": 4,
                    "provider_name": "TestProvider",
                    "request_id": "req-test",
                    "total_cost": 0.000000125,
                    "tokens_completion": 7,
                    "tokens_prompt": 11,
                }
            },
        )

    async with AsyncClient(transport=MockTransport(handler)) as client:
        metadata = await enrich_openrouter_generation_usage(
            LLMUsageMetadata(
                input_tokens=10,
                output_tokens=6,
                llm_provider="openrouter",
                provider_response_id="gen-test",
            ),
            http_client=client,
            api_key="sk-test",
            base_url="https://openrouter.ai/api/v1",
        )

    assert metadata.input_tokens == 11
    assert metadata.output_tokens == 7
    assert metadata.total_tokens == 18
    assert metadata.cached_input_tokens == 3
    assert metadata.reasoning_tokens == 4
    assert metadata.cost_decimal == "0.000000125"
    assert metadata.cost_unit == "openrouter_credits"
    assert metadata.provider_name == "TestProvider"
    assert metadata.provider_model == "openai/gpt-test"
    assert metadata.provider_request_id == "req-test"
    assert metadata.provider_usage_json == {
        "model": "openai/gpt-test",
        "native_tokens_cached": 3,
        "native_tokens_completion": 7,
        "native_tokens_prompt": 11,
        "native_tokens_reasoning": 4,
        "provider_name": "TestProvider",
        "request_id": "req-test",
        "tokens_completion": 7,
        "tokens_prompt": 11,
        "total_cost": 1.25e-07,
    }


def test_captured_openrouter_stream_usage_preserves_cost_and_cache_details() -> None:
    capture = OpenAICompatibleUsageCapture()
    capture.feed(
        b'data: {"id":"gen-test","usage":{"prompt_tokens":9,'
        b'"completion_tokens":13,"total_tokens":22,"cost":4.9e-06,'
        b'"is_byok":false,"prompt_tokens_details":{"cached_tokens":2,'
        b'"cache_write_tokens":1},"completion_tokens_details":'
        b'{"reasoning_tokens":10}}}\n\n'
    )

    metadata = apply_captured_provider_usage(
        LLMUsageMetadata(
            llm_provider="openrouter",
            provider_model="deepseek/deepseek-v4-flash",
        ),
        capture,
    )

    assert metadata.provider_response_id == "gen-test"
    assert metadata.input_tokens == 9
    assert metadata.output_tokens == 13
    assert metadata.total_tokens == 22
    assert metadata.cached_input_tokens == 2
    assert metadata.cache_write_tokens == 1
    assert metadata.reasoning_tokens == 10
    assert metadata.cost_decimal == "0.0000049"
    assert metadata.cost_unit == "openrouter_credits"
    assert metadata.provider_usage_json == {
        "completion_tokens": 13,
        "completion_tokens_details": {"reasoning_tokens": 10},
        "cost": 4.9e-06,
        "is_byok": False,
        "prompt_tokens": 9,
        "prompt_tokens_details": {"cache_write_tokens": 1, "cached_tokens": 2},
        "total_tokens": 22,
    }


def test_usage_metadata_from_result_captures_openai_compatible_metadata() -> None:
    usage = SimpleNamespace(
        input_tokens=12,
        output_tokens=5,
        cache_read_tokens=3,
        cache_write_tokens=2,
        details={"reasoning_tokens": 4},
        requests=1,
        tool_calls=2,
    )
    response = SimpleNamespace(
        kind="response",
        provider_name="LocalProvider",
        model_name="qwen-local",
        provider_response_id="resp-123",
    )

    metadata = usage_metadata_from_result(
        usage=usage,
        messages=[SimpleNamespace(kind="request"), response],
        base_url="http://llm.local/v1",
        configured_model="configured-model",
    )

    assert metadata.input_tokens == 12
    assert metadata.output_tokens == 5
    assert metadata.total_tokens == 17
    assert metadata.cached_input_tokens == 3
    assert metadata.cache_write_tokens == 2
    assert metadata.reasoning_tokens == 4
    assert metadata.request_count == 1
    assert metadata.tool_call_count == 2
    assert metadata.llm_provider == "openai_compatible"
    assert metadata.provider_name == "LocalProvider"
    assert metadata.provider_model == "qwen-local"
    assert metadata.provider_response_id == "resp-123"
