"""AI settings and secure pairing for the local ChatGPT sign-in helper."""

from __future__ import annotations

from datetime import datetime, timedelta
import hashlib
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
import httpx
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from expenses.ai import chatgpt, credentials, preferences
from expenses.ai.client import LLMDisabledError
from expenses.api.routes import (
    get_db,
    _require_current_user_id,
    _require_csrf,
    require_llm_enabled,
)
from expenses.db.models import ChatGPTPairing


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/api/ai", dependencies=[Depends(no_store)])


def current_user(request: Request, db: Session = Depends(get_db)) -> int:
    user_id = _require_current_user_id(request, db)
    if request.method != "GET":
        _require_csrf(request, db)
    return user_id


def failure(exc: Exception) -> HTTPException:
    if isinstance(exc, LLMDisabledError):
        return HTTPException(409, detail=str(exc))
    return HTTPException(
        502, detail="The AI provider could not be reached. Try again later."
    )


@router.get("/settings", response_model=preferences.AISettingsResponse)
def settings(user_id: int = Depends(current_user), db: Session = Depends(get_db)):
    try:
        return preferences.snapshot(db, user_id)
    except LLMDisabledError as exc:
        raise failure(exc) from exc


@router.put(
    "/settings",
    response_model=preferences.AISettingsResponse,
    dependencies=[Depends(require_llm_enabled)],
)
async def save_settings(
    data: preferences.AISettingsUpdate,
    user_id: int = Depends(current_user),
    db: Session = Depends(get_db),
):
    try:
        await preferences.update(db, user_id, data)
        return preferences.snapshot(db, user_id)
    except (LLMDisabledError, httpx.HTTPError) as exc:
        raise failure(exc) from exc


@router.get(
    "/models",
    response_model=preferences.AIModelCatalog,
    dependencies=[Depends(require_llm_enabled)],
)
async def models(provider: preferences.Provider, user_id: int = Depends(current_user)):
    try:
        return {"models": await preferences.list_models(user_id, provider)}
    except (LLMDisabledError, httpx.HTTPError) as exc:
        raise failure(exc) from exc


@router.post("/chatgpt/pairing", dependencies=[Depends(require_llm_enabled)])
async def create_pairing(
    user_id: int = Depends(current_user), db: Session = Depends(get_db)
):
    code = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(minutes=10)
    async with credentials.locked(user_id):
        db.merge(
            ChatGPTPairing(
                user_id=user_id,
                secret_hash=hashlib.sha256(code.encode()).hexdigest(),
                expires_at=expires,
                encrypted_flow=None,
            )
        )
        db.commit()
    return {"pairing_code": code, "expires_at": expires.isoformat() + "Z"}


class PairingStart(BaseModel):
    port: int = Field(ge=1024, le=65535)


def pending(db: Session, secret: str) -> ChatGPTPairing:
    row = db.scalar(
        select(ChatGPTPairing).where(
            ChatGPTPairing.secret_hash == hashlib.sha256(secret.encode()).hexdigest()
        )
    )
    if row is None or row.expires_at < datetime.utcnow():
        raise HTTPException(
            401, "Pairing code is invalid or expired. Create a new code in AI settings."
        )
    return row


@router.post("/chatgpt/pairing/start", dependencies=[Depends(require_llm_enabled)])
async def start_pairing(
    data: PairingStart,
    x_chatgpt_pairing: str = Header(max_length=200),
    db: Session = Depends(get_db),
):
    row = pending(db, x_chatgpt_pairing)
    try:
        async with credentials.locked(row.user_id):
            db.expire_all()
            row = pending(db, x_chatgpt_pairing)
            if row.encrypted_flow:
                raise HTTPException(
                    409,
                    "This pairing attempt has already started. Create a new pairing code.",
                )
            flow = await chatgpt.authorization_flow(row.user_id, data.port)
            row.encrypted_flow = credentials.encrypt(
                {"nonce": flow["nonce"], "client_id": flow["client_id"]}
            )
            db.commit()
            return flow
    except (LLMDisabledError, httpx.HTTPError) as exc:
        raise failure(exc) from exc


@router.post("/chatgpt/pairing/complete", dependencies=[Depends(require_llm_enabled)])
async def complete_pairing(
    data: chatgpt.TokenGrant,
    x_chatgpt_pairing: str = Header(max_length=200),
    db: Session = Depends(get_db),
):
    row = pending(db, x_chatgpt_pairing)
    try:
        async with credentials.locked(row.user_id):
            db.expire_all()
            row = pending(db, x_chatgpt_pairing)
            if not row.encrypted_flow:
                raise HTTPException(409, "Start sign-in before completing pairing.")
            await chatgpt.accept_grant(
                row.user_id, data, credentials.decrypt(row.encrypted_flow)
            )
            db.delete(row)
            db.commit()
        return {"connected": True}
    except (LLMDisabledError, httpx.HTTPError) as exc:
        raise failure(exc) from exc


@router.delete("/chatgpt/connection")
async def disconnect(
    user_id: int = Depends(current_user), db: Session = Depends(get_db)
):
    try:

        def cancel_pairing():
            db.expire_all()
            row = db.get(ChatGPTPairing, user_id)
            if row:
                db.delete(row)
                db.commit()

        confirmed = await chatgpt.disconnect(user_id, cancel_pending=cancel_pairing)
        return {
            "revocation_confirmed": confirmed,
            "message": "ChatGPT disconnected."
            if confirmed
            else "Disconnected locally. Remote revocation was not confirmed; disconnect Expenses in ChatGPT settings too.",
        }
    except (LLMDisabledError, httpx.HTTPError) as exc:
        raise failure(exc) from exc
