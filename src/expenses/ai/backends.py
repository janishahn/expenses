"""Server-wide AI backends from EXPENSES_AI_* and the pydantic-ai models they serve."""

from __future__ import annotations

from typing import TYPE_CHECKING

from expenses.core.config import AIBackend

if TYPE_CHECKING:
    from pydantic_ai.models import Model


def build_model(backend: AIBackend, model_name: str) -> Model:
    match backend.kind:
        case "anthropic":
            from pydantic_ai.models.anthropic import AnthropicModel
            from pydantic_ai.providers.anthropic import AnthropicProvider

            return AnthropicModel(
                model_name,
                provider=AnthropicProvider(
                    api_key=backend.api_key, base_url=backend.base_url
                ),
            )
        case "openai":
            from pydantic_ai.models.openai import OpenAIResponsesModel
            from pydantic_ai.providers.openai import OpenAIProvider

            return OpenAIResponsesModel(
                model_name,
                provider=OpenAIProvider(
                    base_url=backend.base_url, api_key=backend.api_key
                ),
            )
        case "openrouter":
            from pydantic_ai.models.openrouter import OpenRouterModel
            from pydantic_ai.providers.openrouter import OpenRouterProvider

            return OpenRouterModel(
                model_name, provider=OpenRouterProvider(api_key=backend.api_key)
            )
        case "openai-compatible":
            from pydantic_ai.models.openai import OpenAIChatModel
            from pydantic_ai.providers.openai import OpenAIProvider

            return OpenAIChatModel(
                model_name,
                provider=OpenAIProvider(
                    base_url=backend.base_url, api_key=backend.api_key or None
                ),
            )


async def list_models(backend: AIBackend) -> list[dict[str, str]]:
    if backend.kind == "anthropic":
        from anthropic import AsyncAnthropic

        async with AsyncAnthropic(
            api_key=backend.api_key, base_url=backend.base_url, timeout=20
        ) as client:
            return [
                {"id": model.id, "name": model.display_name or model.id}
                async for model in client.models.list(limit=100)
            ]

    from openai import AsyncOpenAI

    base_url = (
        "https://openrouter.ai/api/v1"
        if backend.kind == "openrouter"
        else backend.base_url
    )
    async with AsyncOpenAI(
        base_url=base_url, api_key=backend.api_key or "api-key-not-set", timeout=20
    ) as client:
        models = [model async for model in client.models.list()]
    return sorted(
        ({"id": model.id, "name": model.id} for model in models),
        key=lambda model: model["id"],
    )
