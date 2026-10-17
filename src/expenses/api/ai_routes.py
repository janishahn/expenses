"""Admin settings and usage for the server's AI features."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from expenses.ai import backends, features
from expenses.ai.usage_report import (
    AIUsageChatDetailOut,
    AIUsageOut,
    UsagePeriod,
    chat_usage,
    usage_report,
)
from expenses.api.routes import (
    get_db,
    _require_csrf,
    _require_elevated_admin_context,
)
from expenses.core.config import get_settings


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/api/admin/ai", dependencies=[Depends(no_store)])


def elevated_admin(request: Request, db: Session = Depends(get_db)) -> None:
    _require_elevated_admin_context(request, db)
    if request.method != "GET":
        _require_csrf(request, db)


@router.get(
    "/settings",
    response_model=features.AISettingsOut,
    dependencies=[Depends(elevated_admin)],
)
def settings(db: Session = Depends(get_db)):
    return features.snapshot(db)


@router.put(
    "/settings",
    response_model=features.AISettingsOut,
    dependencies=[Depends(elevated_admin)],
)
def save_settings(data: features.AISettingsUpdate, db: Session = Depends(get_db)):
    try:
        features.update(db, data)
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc
    return features.snapshot(db)


@router.get(
    "/models",
    response_model=features.AIModelCatalogOut,
    dependencies=[Depends(elevated_admin)],
)
def models(backend: str):
    import anthropic
    import openai

    configured = get_settings().ai_backends.get(backend)
    if configured is None:
        raise HTTPException(404, detail="This backend is not configured.")
    try:
        return {"models": backends.list_models(configured)}
    except (anthropic.APIError, openai.APIError) as exc:
        raise HTTPException(
            502, detail=f"The {backend} backend did not list its models."
        ) from exc


@router.get("/usage", response_model=AIUsageOut)
def usage(
    request: Request,
    db: Session = Depends(get_db),
    period: UsagePeriod = "week",
    feature: features.Feature | None = None,
    backend: str | None = None,
    model: str | None = None,
    chats: int = Query(50, ge=1, le=500),
):
    context = _require_elevated_admin_context(request, db)
    return usage_report(
        db,
        viewer_id=context.user.id,
        period=period,
        feature=feature,
        backend=backend,
        model=model,
        chat_limit=chats,
        now=datetime.utcnow(),
    )


@router.get("/usage/chats/{chat_id}", response_model=AIUsageChatDetailOut)
def chat(chat_id: str, request: Request, db: Session = Depends(get_db)):
    context = _require_elevated_admin_context(request, db)
    detail = chat_usage(db, viewer_id=context.user.id, chat_id=chat_id)
    if detail is None:
        raise HTTPException(404, detail="This chat has no usage.")
    return detail
