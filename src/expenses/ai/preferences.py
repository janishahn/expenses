from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import httpx
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from expenses.ai import chatgpt
from expenses.core.config import get_settings
from expenses.db.models import AIFeaturePreference

Feature = Literal["transaction_triage", "rule_mining", "spending_chat"]
Provider = Literal["configured", "chatgpt"]
Effort = Literal["auto", "none", "minimal", "low", "medium", "high", "xhigh"]
FEATURES = {
    "transaction_triage": "Categorization",
    "rule_mining": "Rule suggestions",
    "spending_chat": "Spending analysis",
}


class FeatureChoice(BaseModel):
    provider: Provider = "configured"
    model: str = Field(default="", max_length=200)
    reasoning_effort: Effort = "auto"


class AISettingsUpdate(BaseModel):
    features: dict[Feature, FeatureChoice]


class AIModelOption(BaseModel):
    id: str
    name: str
    reasoning_efforts: list[str]


class AIModelCatalog(BaseModel):
    models: list[AIModelOption]


class AIConnectionStatus(BaseModel):
    status: str
    email: str | None
    plan_authorized: bool
    usage_url: str


class AIFeatureSettings(FeatureChoice):
    id: str
    name: str


class AISettingsResponse(BaseModel):
    enabled: bool
    configured_available: bool
    configured_model: str
    connection: AIConnectionStatus
    features: list[AIFeatureSettings]


@dataclass(frozen=True)
class ResolvedAI:
    user_id: int
    provider: str
    model: str
    reasoning_effort: str


def choice(session: Session, user_id: int, feature: str) -> FeatureChoice:
    row = session.get(AIFeaturePreference, (user_id, feature))
    if row:
        return FeatureChoice(
            provider=row.provider,
            model=row.model,
            reasoning_effort=row.reasoning_effort,
        )
    return FeatureChoice()


def resolve(session: Session, user_id: int, feature: str) -> ResolvedAI:
    settings = get_settings()
    selected = choice(session, user_id, feature)
    if not settings.llm_enabled:
        raise chatgpt.ChatGPTError(
            "AI features are disabled by the server administrator."
        )
    if selected.provider == "chatgpt":
        if not selected.model:
            raise chatgpt.ChatGPTError(
                "Choose a ChatGPT model for this feature in AI settings."
            )
        return ResolvedAI(
            user_id, selected.provider, selected.model, selected.reasoning_effort
        )
    if not settings.llm_base_url:
        raise chatgpt.ChatGPTError(
            "Choose ChatGPT or configure an API provider in AI settings."
        )
    default_effort = {
        "transaction_triage": "low",
        "rule_mining": "medium",
        "spending_chat": "medium",
    }[feature]
    return ResolvedAI(
        user_id,
        "configured",
        selected.model or settings.llm_model,
        default_effort
        if selected.reasoning_effort == "auto"
        else selected.reasoning_effort,
    )


def snapshot(session: Session, user_id: int) -> dict:
    settings = get_settings()
    return {
        "enabled": settings.llm_enabled,
        "configured_available": bool(settings.llm_base_url),
        "configured_model": settings.llm_model,
        "connection": chatgpt.connection_status(user_id),
        "features": [
            {"id": key, "name": name, **choice(session, user_id, key).model_dump()}
            for key, name in FEATURES.items()
        ],
    }


async def list_models(user_id: int, provider: Provider) -> list[dict]:
    if provider == "chatgpt":
        return await chatgpt.models(user_id)
    settings = get_settings()
    if not settings.llm_base_url:
        return []
    headers = (
        {"Authorization": f"Bearer {settings.llm_api_key}"}
        if settings.llm_api_key
        else {}
    )
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            settings.llm_base_url.rstrip("/") + "/models", headers=headers
        )
    return chatgpt.parse_models(chatgpt.checked_json(response), chatgpt=False)


async def update(session: Session, user_id: int, data: AISettingsUpdate) -> None:
    # Validate every requested change before committing any of them.
    catalogs = {}
    for feature, selected in data.features.items():
        if selected.model:
            if selected.provider not in catalogs:
                catalogs[selected.provider] = {
                    m["id"]: m for m in await list_models(user_id, selected.provider)
                }
            model = catalogs[selected.provider].get(selected.model)
            if model is None:
                raise chatgpt.ChatGPTError(
                    f"The selected model for {FEATURES[feature]} is no longer available. Refresh the model list."
                )
            if (
                model["reasoning_efforts"]
                and selected.reasoning_effort != "auto"
                and selected.reasoning_effort not in model["reasoning_efforts"]
            ):
                raise chatgpt.ChatGPTError(
                    f"The selected thinking level is unavailable for {model['name']}."
                )
        elif selected.provider == "chatgpt":
            raise chatgpt.ChatGPTError(f"Choose a model for {FEATURES[feature]}.")
    for feature, selected in data.features.items():
        session.merge(
            AIFeaturePreference(
                user_id=user_id, feature=feature, **selected.model_dump()
            )
        )
    session.commit()
