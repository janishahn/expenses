from decimal import Decimal

from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, UserPromptPart
from pydantic_ai.usage import RunUsage

from expenses.ai.client import model_settings
from expenses.ai.features import ResolvedFeature
from expenses.ai.usage import usage_metadata
from expenses.core.config import AIBackend

LOCAL = AIBackend(
    name="local", kind="openai-compatible", base_url="http://llm.local/v1", api_key=""
)


def test_usage_metadata_reads_run_usage_and_last_response() -> None:
    usage = RunUsage(
        input_tokens=12,
        output_tokens=5,
        cache_read_tokens=3,
        cache_write_tokens=2,
        details={"reasoning_tokens": 4},
        requests=1,
        tool_calls=2,
        cost=Decimal("0.0000215"),
    )
    messages = [
        ModelRequest(parts=[UserPromptPart("hi")]),
        ModelResponse(
            parts=[TextPart("hello")],
            model_name="qwen-local",
            provider_name="LocalProvider",
            provider_response_id="resp-123",
        ),
    ]

    metadata = usage_metadata(
        usage=usage,
        messages=messages,
        llm_provider="openai-compatible",
        model="configured-model",
    )

    assert metadata.input_tokens == 12
    assert metadata.output_tokens == 5
    assert metadata.total_tokens == 17
    assert metadata.cached_input_tokens == 3
    assert metadata.cache_write_tokens == 2
    assert metadata.reasoning_tokens == 4
    assert metadata.request_count == 1
    assert metadata.tool_call_count == 2
    assert metadata.cost_decimal == "0.0000215"
    assert metadata.cost_unit == "usd"
    assert metadata.llm_provider == "openai-compatible"
    assert metadata.provider_name == "LocalProvider"
    assert metadata.provider_model == "qwen-local"
    assert metadata.provider_response_id == "resp-123"


def test_usage_metadata_without_a_price_leaves_cost_empty() -> None:
    metadata = usage_metadata(
        usage=RunUsage(input_tokens=1),
        messages=[],
        llm_provider="openai-compatible",
        model="m",
    )

    assert metadata.cost_decimal is None
    assert metadata.cost_unit is None
    assert metadata.provider_model == "m"


def test_model_settings_map_thinking_levels() -> None:
    def settings(thinking: str, cache: bool = False):
        resolved = ResolvedFeature(
            feature="spending_chat", backend=LOCAL, model="m", thinking=thinking
        )
        return model_settings(resolved, cache=cache)

    assert settings("auto") == {}
    assert settings("off") == {"thinking": False}
    assert settings("high", cache=True) == {"thinking": "high", "cache": True}
