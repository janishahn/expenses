"""Instance-wide settings for each AI feature: on/off, backend, model, and thinking level."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Literal, get_args

from pydantic import BaseModel, StringConstraints
from sqlalchemy.orm import Session

from expenses.ai.client import LLMDisabledError
from expenses.core.config import AIBackend, AIBackendKind, get_settings
from expenses.db.models import AIFeatureSetting

Feature = Literal["spending_chat", "transaction_triage", "rule_mining"]
FEATURE_NAMES: dict[Feature, str] = {
    "spending_chat": "Assistant",
    "transaction_triage": "Categorization suggestions",
    "rule_mining": "Rule suggestions",
}
Thinking = Literal["auto", "off", "low", "medium", "high"]
THINKING_LEVELS: tuple[Thinking, ...] = get_args(Thinking)


class FeatureSettings(BaseModel):
    enabled: bool = False
    backend: Annotated[str, StringConstraints(max_length=32)] = ""
    model: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    thinking: Thinking = "auto"


class AISettingsUpdate(BaseModel):
    features: dict[Feature, FeatureSettings]


class AIBackendOut(BaseModel):
    name: str
    kind: AIBackendKind


class AIFeatureOut(FeatureSettings):
    id: Feature
    name: str


class AISettingsOut(BaseModel):
    backends: list[AIBackendOut]
    features: list[AIFeatureOut]


class AIModelOut(BaseModel):
    id: str
    name: str


class AIModelCatalogOut(BaseModel):
    models: list[AIModelOut]


@dataclass(frozen=True)
class ResolvedFeature:
    feature: Feature
    backend: AIBackend
    model: str
    thinking: Thinking


def load(session: Session, feature: Feature) -> FeatureSettings:
    row = session.get(AIFeatureSetting, feature)
    if row is None:
        return FeatureSettings()
    return FeatureSettings(
        enabled=row.enabled, backend=row.backend, model=row.model, thinking=row.thinking
    )


def _usable(settings: FeatureSettings) -> bool:
    return (
        settings.enabled
        and bool(settings.model)
        and settings.backend in get_settings().ai_backends
    )


def enabled_features(session: Session) -> list[Feature]:
    return [feature for feature in FEATURE_NAMES if _usable(load(session, feature))]


def resolve(session: Session, feature: Feature) -> ResolvedFeature:
    settings = load(session, feature)
    if not _usable(settings):
        raise LLMDisabledError(
            f"{FEATURE_NAMES[feature]} is turned off on this server."
        )
    return ResolvedFeature(
        feature=feature,
        backend=get_settings().ai_backends[settings.backend],
        model=settings.model,
        thinking=settings.thinking,
    )


def snapshot(session: Session) -> AISettingsOut:
    return AISettingsOut(
        backends=[
            AIBackendOut(name=backend.name, kind=backend.kind)
            for backend in get_settings().ai_backends.values()
        ],
        features=[
            AIFeatureOut(id=feature, name=name, **load(session, feature).model_dump())
            for feature, name in FEATURE_NAMES.items()
        ],
    )


def update(session: Session, data: AISettingsUpdate) -> None:
    backends = get_settings().ai_backends
    for feature, settings in data.features.items():
        if not settings.enabled:
            continue
        if settings.backend not in backends:
            raise ValueError(f"Choose a backend for {FEATURE_NAMES[feature]}.")
        if not settings.model:
            raise ValueError(f"Choose a model for {FEATURE_NAMES[feature]}.")
    for feature, settings in data.features.items():
        session.merge(AIFeatureSetting(feature=feature, **settings.model_dump()))
    session.commit()
