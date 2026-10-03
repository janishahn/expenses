"""Responses adapter for the narrower ChatGPT-plan request contract.

The rest of Expenses keeps its existing agent, tools, history, and streaming
interface. This adapter owns the SIWC-only wire differences.
"""

from __future__ import annotations

from dataclasses import replace

import httpx
from openai import AsyncOpenAI, APIStatusError, APIConnectionError
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.profiles.openai import OpenAIModelProfile

from expenses.ai import chatgpt
from expenses.ai.preferences import ResolvedAI


class CompletedStream:
    def __init__(self, stream):
        self.stream = stream

    async def __aenter__(self):
        await self.stream.__aenter__()
        return self

    async def __aexit__(self, *args):
        return await self.stream.__aexit__(*args)

    async def close(self):
        await self.stream.close()

    async def __aiter__(self):
        completed = False
        async for event in self.stream:
            if event.type == "response.failed":
                error = event.response.error
                raise chatgpt.provider_error(
                    400, {"error": error.model_dump() if error else {}}
                )
            if event.type in {"response.incomplete", "error"}:
                raise chatgpt.ChatGPTError(
                    "ChatGPT did not finish the response. Try again."
                )
            if event.type == "response.completed":
                completed = True
            yield event
        if not completed:
            raise chatgpt.ChatGPTError(
                "The ChatGPT connection ended before the response completed. Try again."
            )


class ChatGPTResponsesModel(OpenAIResponsesModel):
    def __init__(self, configuration: ResolvedAI, client: AsyncOpenAI):
        super().__init__(
            configuration.model,
            provider=OpenAIProvider(openai_client=client),
            profile=OpenAIModelProfile(
                openai_system_prompt_role="developer",
                openai_supports_encrypted_reasoning_content=True,
            ),
        )
        self.expenses_user_id = configuration.user_id

    async def request(self, messages, model_settings, model_request_parameters):
        # Suggestions use Agent.run, but SIWC requires streaming on the wire.
        async with self.request_stream(
            messages, model_settings, model_request_parameters
        ) as stream:
            async for _event in stream:
                pass
            return stream.get()

    async def _build_responses_request_params(self, *args, **kwargs):
        params = await super()._build_responses_request_params(*args, **kwargs)
        tools = params.tools
        if isinstance(tools, list) and tools:
            if any(tool["type"] != "function" for tool in tools):
                raise chatgpt.ChatGPTError(
                    "This tool is not supported with ChatGPT plan usage."
                )
            tools = [
                {
                    "type": "namespace",
                    "name": "expenses",
                    "description": "Read the user's expense data.",
                    "tools": tools,
                }
            ]
        inputs = []
        for item in params.input:
            item = dict(item)
            if item.get("role") == "system":
                item["role"] = "developer"
            if item.get("type") == "function_call":
                item["namespace"] = "expenses"
            inputs.append(item)
        return replace(params, tools=tools, input=inputs)

    async def _responses_create(
        self, messages, stream, model_settings, model_request_parameters
    ):
        self.client.api_key = await chatgpt.access_token(self.expenses_user_id)
        try:
            response = await super()._responses_create(
                messages, True, model_settings, model_request_parameters
            )
        except APIStatusError as exc:
            raise chatgpt.provider_error(exc.status_code, exc.body) from exc
        except APIConnectionError as exc:
            raise chatgpt.ChatGPTError(
                "ChatGPT could not be reached. Try again later."
            ) from exc
        return CompletedStream(response)


async def build_model(configuration: ResolvedAI):
    token = await chatgpt.access_token(configuration.user_id)
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15))
    client = AsyncOpenAI(
        api_key=token,
        base_url=chatgpt.API_ORIGIN,
        http_client=http_client,
        max_retries=0,
    )
    settings = {"openai_store": False, "parallel_tool_calls": False}
    if configuration.reasoning_effort != "auto":
        settings["openai_reasoning_effort"] = configuration.reasoning_effort
    return ChatGPTResponsesModel(configuration, client), http_client, settings
