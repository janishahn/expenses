"""The Assistant's chats and streamed turns."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from expenses.ai.assistant import (
    AssistantChatOut,
    AssistantChatSummaryOut,
    AssistantConflictError,
    AssistantDecisionIn,
    AssistantMessageIn,
    AssistantModel,
    AssistantNotFoundError,
    AssistantService,
    stream_turn,
)
from expenses.ai.backends import build_model
from expenses.ai.client import LLMDisabledError, model_settings
from expenses.ai.features import resolve
from expenses.api.ai_routes import no_store
from expenses.api.routes import (
    _require_csrf,
    _require_current_user_id,
    get_db,
    require_ai_feature,
)
from expenses.db.session import SessionLocal

router = APIRouter(
    prefix="/api/assistant",
    dependencies=[Depends(require_ai_feature("spending_chat")), Depends(no_store)],
)


def get_assistant_model(db: Session = Depends(get_db)) -> AssistantModel:
    try:
        resolved = resolve(db, "spending_chat")
    except LLMDisabledError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return AssistantModel(
        model=build_model(resolved.backend, resolved.model),
        settings=model_settings(resolved, cache=True),
        llm_provider=resolved.backend.kind,
    )


def get_stream_session_factory() -> Callable[[], Session]:
    return SessionLocal


def _service(request: Request, db: Session) -> AssistantService:
    return AssistantService(db, user_id=_require_current_user_id(request, db))


def _stream(lines: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        lines,
        media_type="application/x-ndjson",
        # GZipMiddleware's deflate buffer withholds every NDJSON line until the
        # response closes. Marking the body as already encoded streams each line.
        headers={"Cache-Control": "no-cache", "Content-Encoding": "identity"},
    )


@router.get("/chats", response_model=list[AssistantChatSummaryOut])
def chats(request: Request, db: Session = Depends(get_db)):
    return _service(request, db).chats()


@router.get("/chats/{chat_id}", response_model=AssistantChatOut)
def chat(chat_id: str, request: Request, db: Session = Depends(get_db)):
    try:
        return _service(request, db).chat_out(chat_id)
    except AssistantNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/chats/{chat_id}", status_code=204)
def delete_chat(chat_id: str, request: Request, db: Session = Depends(get_db)):
    service = _service(request, db)
    _require_csrf(request, db)
    try:
        service.delete_chat(chat_id)
    except AssistantNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)


@router.post("/messages/stream", response_class=StreamingResponse)
def send_message(
    data: AssistantMessageIn,
    request: Request,
    db: Session = Depends(get_db),
    model: AssistantModel = Depends(get_assistant_model),
    session_factory: Callable[[], Session] = Depends(get_stream_session_factory),
):
    service = _service(request, db)
    _require_csrf(request, db)
    try:
        turn = service.new_turn(chat_id=data.chat_id, text=data.message)
    except AssistantNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _stream(stream_turn(turn, model=model, session_factory=session_factory))


@router.post("/chats/{chat_id}/retry/stream", response_class=StreamingResponse)
def retry(
    chat_id: str,
    request: Request,
    db: Session = Depends(get_db),
    model: AssistantModel = Depends(get_assistant_model),
    session_factory: Callable[[], Session] = Depends(get_stream_session_factory),
):
    service = _service(request, db)
    _require_csrf(request, db)
    try:
        turn = service.retry_turn(chat_id)
    except AssistantNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AssistantConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _stream(stream_turn(turn, model=model, session_factory=session_factory))


@router.post("/chats/{chat_id}/approvals/stream", response_class=StreamingResponse)
def decide(
    chat_id: str,
    data: AssistantDecisionIn,
    request: Request,
    db: Session = Depends(get_db),
    model: AssistantModel = Depends(get_assistant_model),
    session_factory: Callable[[], Session] = Depends(get_stream_session_factory),
):
    service = _service(request, db)
    _require_csrf(request, db)
    try:
        turn = service.decide(chat_id, data.item_id, approve=data.approve)
    except AssistantNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AssistantConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _stream(stream_turn(turn, model=model, session_factory=session_factory))
