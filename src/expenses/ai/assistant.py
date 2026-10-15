"""The Assistant: chats stored on the server, agent turns, and the stream clients render.

A turn runs in a background task that feeds a queue. The HTTP response reads the
queue, so a client that disconnects (Stop) only cancels the run through
pydantic-ai, which keeps the partial messages, and the turn is still saved.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from datetime import datetime
from time import perf_counter
from typing import Annotated, Any, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from pydantic_ai import Agent, AgentRunEvents, RunContext, Tool, UsageLimits
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    ModelMessagesTypeAdapter,
    PartEndEvent,
    RetryPromptPart,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
)
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings
from pydantic_ai.ui import UIEventStream
from pydantic_ai.usage import RunUsage
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from expenses.ai.assistant_tools import (
    INSTRUCTIONS,
    TOOLS,
    AssistantReader,
    tool_detail,
    tool_label,
)
from expenses.ai.usage import (
    apply_usage_metadata,
    chat_input_trace,
    chat_output_trace,
    usage_metadata,
)
from expenses.core.app_logging import get_logger, log_event
from expenses.core.config import get_settings
from expenses.db.models import AssistantChat, AssistantTurn, LLMJob

logger = get_logger("expenses.ai.assistant")

# Text that grows past this or breaks a line is the answer, not a note about the next step.
PROMOTE_AT = 160
HISTORY_TURNS = 20
TurnStatus = Literal["completed", "stopped", "failed"]


class ThinkingItem(BaseModel):
    kind: Literal["thinking"] = "thinking"
    id: str
    # Empty when the provider keeps its reasoning hidden.
    text: str
    seconds: int | None = None
    state: Literal["active", "done"]


class NoteItem(BaseModel):
    """What the model says about its next step before it calls a tool."""

    kind: Literal["note"] = "note"
    id: str
    text: str
    state: Literal["active", "done"]


class ToolItem(BaseModel):
    kind: Literal["tool"] = "tool"
    id: str
    name: str
    label: str
    detail: str | None = None
    state: Literal["running", "done", "failed", "stopped"]


class TextItem(BaseModel):
    kind: Literal["text"] = "text"
    id: str
    text: str
    state: Literal["streaming", "done"]


AssistantItem = Annotated[
    ThinkingItem | NoteItem | ToolItem | TextItem, Field(discriminator="kind")
]
ITEMS = TypeAdapter(list[AssistantItem])


class AssistantMessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    chat_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    message: str = Field(min_length=1, max_length=8_000)


class AssistantChatSummaryOut(BaseModel):
    id: str
    title: str
    updated_at: datetime


class AssistantTurnOut(BaseModel):
    id: int
    user_text: str
    items: list[AssistantItem]
    status: TurnStatus
    created_at: datetime


class AssistantChatOut(AssistantChatSummaryOut):
    turns: list[AssistantTurnOut]


class AssistantNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class AssistantModel:
    model: Model
    settings: ModelSettings
    llm_provider: str


def _item_id() -> str:
    return uuid4().hex[:12]


@dataclass
class AssistantEventStream(UIEventStream[None, dict[str, Any], AssistantReader, str]):
    """Turns pydantic-ai events into item upserts and text deltas."""

    items: list[AssistantItem] = field(default_factory=list)
    error: Exception | None = None
    _text: NoteItem | TextItem | None = None
    _thinking: ThinkingItem | None = None
    _thinking_started: float = 0.0
    _tools: dict[str, ToolItem] = field(default_factory=dict)

    @property
    def content_type(self) -> str:
        return "application/x-ndjson"

    def encode_event(self, event: dict[str, Any]) -> str:
        return json.dumps(event, ensure_ascii=False) + "\n"

    def _upsert(self, item: AssistantItem) -> dict[str, Any]:
        for index, existing in enumerate(self.items):
            if existing.id == item.id:
                self.items[index] = item
                break
        else:
            self.items.append(item)
        return {"type": "item", "item": item.model_dump()}

    def _promote_if_ready(self) -> bool:
        text = self._text
        if isinstance(text, NoteItem) and (
            "\n" in text.text.strip() or len(text.text) >= PROMOTE_AT
        ):
            self._text = TextItem(id=text.id, text=text.text, state="streaming")
            return True
        return False

    def _append_text(self, content: str) -> list[dict[str, Any]]:
        if self._text is None:
            content = content.lstrip()
            if not content:
                return []
            self._text = NoteItem(id=_item_id(), text=content, state="active")
            self._promote_if_ready()
            return [self._upsert(self._text)]
        self._text.text += content
        if self._promote_if_ready():
            return [self._upsert(self._text)]
        return [{"type": "delta", "id": self._text.id, "text": content}]

    async def handle_text_start(
        self, part: TextPart, follows_text: bool = False
    ) -> AsyncIterator[dict[str, Any]]:
        if not follows_text:
            self._text = None
        for event in self._append_text(part.content):
            yield event

    async def handle_text_delta(
        self, delta: TextPartDelta
    ) -> AsyncIterator[dict[str, Any]]:
        for event in self._append_text(delta.content_delta):
            yield event

    async def handle_part_end(
        self, event: PartEndEvent
    ) -> AsyncIterator[dict[str, Any]]:
        if not isinstance(event.part, TextPart):
            async for item_event in super().handle_part_end(event):
                yield item_event
            return
        if event.next_part_kind == "text" or self._text is None:
            return
        # Text right before a tool call stays a note; any other text is the answer.
        if isinstance(self._text, NoteItem) and event.next_part_kind not in (
            "tool-call",
            "builtin-tool-call",
        ):
            self._text = TextItem(
                id=self._text.id, text=self._text.text, state="streaming"
            )
        self._text.text = self._text.text.rstrip()
        self._text.state = "done"
        yield self._upsert(self._text)
        self._text = None

    async def handle_thinking_start(
        self, part: ThinkingPart, follows_thinking: bool = False
    ) -> AsyncIterator[dict[str, Any]]:
        if follows_thinking and self._thinking is not None:
            if part.content:
                self._thinking.text += part.content
                yield {"type": "delta", "id": self._thinking.id, "text": part.content}
            return
        self._thinking = ThinkingItem(id=_item_id(), text=part.content, state="active")
        self._thinking_started = perf_counter()
        yield self._upsert(self._thinking)

    async def handle_thinking_delta(
        self, delta: ThinkingPartDelta
    ) -> AsyncIterator[dict[str, Any]]:
        if self._thinking is not None and delta.content_delta:
            self._thinking.text += delta.content_delta
            yield {
                "type": "delta",
                "id": self._thinking.id,
                "text": delta.content_delta,
            }

    def _end_thinking(self, thinking: ThinkingItem) -> None:
        thinking.seconds = max(1, round(perf_counter() - self._thinking_started))
        thinking.state = "done"

    async def handle_thinking_end(
        self, part: ThinkingPart, followed_by_thinking: bool = False
    ) -> AsyncIterator[dict[str, Any]]:
        if followed_by_thinking or self._thinking is None:
            return
        self._end_thinking(self._thinking)
        yield self._upsert(self._thinking)
        self._thinking = None

    async def handle_function_tool_call(
        self, event: FunctionToolCallEvent
    ) -> AsyncIterator[dict[str, Any]]:
        part = event.part
        try:
            args = part.args_as_dict()
        except ValueError:
            args = {}
        item = ToolItem(
            id=f"tool-{part.tool_call_id}",
            name=part.tool_name,
            label=tool_label(part.tool_name, args),
            state="running",
        )
        self._tools[part.tool_call_id] = item
        yield self._upsert(item)

    async def handle_function_tool_result(
        self, event: FunctionToolResultEvent
    ) -> AsyncIterator[dict[str, Any]]:
        part = event.part
        item = self._tools.pop(part.tool_call_id, None)
        if item is None:
            return
        if isinstance(part, RetryPromptPart):
            item.state = "failed"
        elif part.outcome == "interrupted":
            item.state = "stopped"
        elif part.outcome == "success" and isinstance(part.content, dict):
            if part.content.get("ok") is False:
                item.state = "failed"
            else:
                item.state = "done"
                item.detail = tool_detail(item.name, part.content)
        else:
            item.state = "done" if part.outcome == "success" else "failed"
        yield self._upsert(item)

    async def on_error(self, error: Exception) -> AsyncIterator[dict[str, Any]]:
        self.error = error
        return
        yield

    def finish(self, status: TurnStatus) -> list[dict[str, Any]]:
        """Settles items a stopped or failed run left open."""
        events = []
        for item in self.items:
            match item:
                case ThinkingItem(state="active"):
                    self._end_thinking(item)
                case NoteItem(state="active") | TextItem(state="streaming"):
                    item.state = "done"
                case ToolItem(state="running"):
                    item.state = "stopped" if status == "stopped" else "failed"
                case _:
                    continue
            events.append({"type": "item", "item": item.model_dump()})
        return events

    @property
    def answer(self) -> str:
        return "\n\n".join(item.text for item in self.items if item.kind == "text")


def _agent(model: AssistantModel) -> Agent[AssistantReader, str]:
    agent = Agent(
        model.model,
        model_settings=model.settings,
        deps_type=AssistantReader,
        output_type=str,
        tools=[
            Tool(tool, takes_ctx=True, strict=True, sequential=True) for tool in TOOLS
        ],
        instructions=INSTRUCTIONS,
    )

    @agent.instructions
    def reference(ctx: RunContext[AssistantReader]) -> str:
        return ctx.deps.reference()

    return agent


def _failure_message(error: Exception) -> str:
    if isinstance(error, UsageLimitExceeded):
        return "This question needed too many steps. Try asking for less at once."
    if isinstance(error, ModelHTTPError) and error.status_code in (401, 403):
        return "The AI backend rejected the server's credentials."
    if isinstance(error, ModelHTTPError) and error.status_code == 429:
        return "The AI backend is busy or over its limit. Try again in a moment."
    return "The Assistant couldn't finish this answer. Try again."


def _title(text: str) -> str:
    first_line = text.strip().splitlines()[0]
    return first_line if len(first_line) <= 80 else first_line[:79].rstrip() + "…"


@dataclass(frozen=True)
class TurnRequest:
    user_id: int
    chat_id: str
    title: str
    user_text: str
    # Retry replaces this turn and every later one.
    replace_seq: int | None = None


class AssistantService:
    def __init__(self, session: Session, *, user_id: int) -> None:
        self.session = session
        self.user_id = user_id

    def chats(self, limit: int = 50) -> list[AssistantChat]:
        return list(
            self.session.scalars(
                select(AssistantChat)
                .where(AssistantChat.user_id == self.user_id)
                .order_by(AssistantChat.updated_at.desc())
                .limit(limit)
            )
        )

    def chat(self, chat_id: str) -> AssistantChat:
        chat = self.session.get(AssistantChat, chat_id)
        if chat is None or chat.user_id != self.user_id:
            raise AssistantNotFoundError("Chat not found")
        return chat

    def chat_out(self, chat_id: str) -> AssistantChatOut:
        chat = self.chat(chat_id)
        turns = self.session.scalars(
            select(AssistantTurn)
            .where(AssistantTurn.chat_id == chat.id)
            .order_by(AssistantTurn.seq)
        )
        return AssistantChatOut(
            id=chat.id,
            title=chat.title,
            updated_at=chat.updated_at,
            turns=[
                AssistantTurnOut(
                    id=turn.id,
                    user_text=turn.user_text,
                    items=ITEMS.validate_json(turn.items_json),
                    status=turn.status,
                    created_at=turn.created_at,
                )
                for turn in turns
            ],
        )

    def delete_chat(self, chat_id: str) -> None:
        chat = self.chat(chat_id)
        self.session.execute(
            delete(AssistantTurn).where(AssistantTurn.chat_id == chat.id)
        )
        self.session.delete(chat)
        self.session.commit()

    def new_turn(self, *, chat_id: str | None, text: str) -> TurnRequest:
        if chat_id is None:
            return TurnRequest(
                user_id=self.user_id,
                chat_id=uuid4().hex,
                title=_title(text),
                user_text=text,
            )
        chat = self.chat(chat_id)
        return TurnRequest(
            user_id=self.user_id, chat_id=chat.id, title=chat.title, user_text=text
        )

    def retry_turn(self, chat_id: str) -> TurnRequest:
        chat = self.chat(chat_id)
        last = self.session.scalars(
            select(AssistantTurn)
            .where(AssistantTurn.chat_id == chat.id)
            .order_by(AssistantTurn.seq.desc())
            .limit(1)
        ).first()
        if last is None:
            raise AssistantNotFoundError("This chat has nothing to retry")
        return TurnRequest(
            user_id=self.user_id,
            chat_id=chat.id,
            title=chat.title,
            user_text=last.user_text,
            replace_seq=last.seq,
        )


def _history(
    session: Session, chat_id: str, before_seq: int | None
) -> list[ModelMessage]:
    query = select(AssistantTurn.messages_json).where(AssistantTurn.chat_id == chat_id)
    if before_seq is not None:
        query = query.where(AssistantTurn.seq < before_seq)
    rows = session.scalars(
        query.order_by(AssistantTurn.seq.desc()).limit(HISTORY_TURNS)
    ).all()
    messages: list[ModelMessage] = []
    for messages_json in reversed(rows):
        messages.extend(ModelMessagesTypeAdapter.validate_json(messages_json))
    return messages


@dataclass
class _TurnHandle:
    """Lets the HTTP response stop the run it streams."""

    events: AgentRunEvents[str] | None = None
    stop_requested: bool = False

    def stop(self) -> None:
        self.stop_requested = True
        if self.events is not None:
            self.events.cancel()


# Running turns, kept referenced so the event loop does not drop them mid-run.
_RUNNING: set[asyncio.Task[None]] = set()


async def stream_turn(
    request: TurnRequest,
    *,
    model: AssistantModel,
    session_factory: Callable[[], Session],
) -> AsyncIterator[str]:
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    handle = _TurnHandle()
    task = asyncio.create_task(
        _run_turn(request, model, session_factory, queue, handle)
    )
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)
    try:
        while (line := await queue.get()) is not None:
            yield line
    finally:
        handle.stop()


async def _run_turn(
    request: TurnRequest,
    model: AssistantModel,
    session_factory: Callable[[], Session],
    queue: asyncio.Queue[str | None],
    handle: _TurnHandle,
) -> None:
    def put(event: dict[str, Any]) -> None:
        queue.put_nowait(json.dumps(event, ensure_ascii=False) + "\n")

    session = session_factory()
    try:
        put({"type": "start", "chat_id": request.chat_id, "title": request.title})
        history = _history(session, request.chat_id, request.replace_seq)
        now = datetime.now(ZoneInfo(get_settings().timezone))
        deps = AssistantReader(session, user_id=request.user_id, now=now)
        stream = AssistantEventStream()
        started_at = datetime.utcnow()
        started = perf_counter()
        async with _agent(model).run_stream_events(
            request.user_text,
            deps=deps,
            message_history=history,
            usage_limits=UsageLimits(request_limit=24, tool_calls_limit=24),
        ) as events:
            handle.events = events
            if handle.stop_requested:
                events.cancel()
            async for event in stream.transform_stream(events):
                put(event)
            messages: list[ModelMessage]
            usage: RunUsage
            if stream.cancelled is not None:
                status: TurnStatus = "stopped"
                messages = stream.cancelled.new_messages()
                usage = stream.cancelled.usage
            elif stream.error is not None:
                status = "failed"
                # A failed turn stays visible but adds nothing to the model's history.
                messages = []
                usage = events.usage
            else:
                status = "completed"
                result = events.result
                assert result is not None
                messages = result.new_messages()
                usage = result.usage
        for event in stream.finish(status):
            put(event)
        _save_turn(
            session,
            request,
            model=model,
            items=stream.items,
            messages=messages,
            status=status,
            usage=usage,
            answer=stream.answer,
            history_size=len(history),
            error=repr(stream.error) if stream.error is not None else None,
            started_at=started_at,
            duration_ms=int((perf_counter() - started) * 1000),
        )
        end: dict[str, Any] = {"type": "end", "status": status}
        if stream.error is not None:
            end["message"] = _failure_message(stream.error)
        put(end)
    except Exception as exc:
        session.rollback()
        log_event(
            logger,
            logging.ERROR,
            "assistant_turn_crashed",
            chat_id=request.chat_id,
            error=repr(exc),
        )
        put(
            {
                "type": "end",
                "status": "failed",
                "message": "The Assistant couldn't finish this answer. Try again.",
            }
        )
    finally:
        session.close()
        queue.put_nowait(None)


def _save_turn(
    session: Session,
    request: TurnRequest,
    *,
    model: AssistantModel,
    items: list[AssistantItem],
    messages: list[ModelMessage],
    status: TurnStatus,
    usage: RunUsage,
    answer: str,
    history_size: int,
    error: str | None,
    started_at: datetime,
    duration_ms: int,
) -> None:
    """Saves the turn, its chat, and its usage in one commit."""
    now = datetime.utcnow()
    chat = session.get(AssistantChat, request.chat_id)
    if chat is None:
        chat = AssistantChat(
            id=request.chat_id,
            user_id=request.user_id,
            title=request.title,
            created_at=now,
            updated_at=now,
        )
        session.add(chat)
    chat.updated_at = now
    if request.replace_seq is not None:
        session.execute(
            delete(AssistantTurn).where(
                AssistantTurn.chat_id == chat.id,
                AssistantTurn.seq >= request.replace_seq,
            )
        )
        seq = request.replace_seq
    else:
        last_seq = session.scalar(
            select(func.max(AssistantTurn.seq)).where(AssistantTurn.chat_id == chat.id)
        )
        seq = (last_seq or 0) + 1
    session.add(
        AssistantTurn(
            chat_id=chat.id,
            seq=seq,
            user_text=request.user_text,
            items_json=ITEMS.dump_json(items).decode(),
            messages_json=ModelMessagesTypeAdapter.dump_json(messages).decode(),
            status=status,
            created_at=now,
        )
    )
    model_name = model.model.model_name
    job = LLMJob(
        user_id=request.user_id,
        feature="spending_chat",
        status=status,
        prompt_version="assistant",
        model=model_name[:80],
        input_hash=hashlib.sha256(request.user_text.encode("utf-8")).hexdigest(),
        input_json=chat_input_trace(request.user_text, history_size),
        output_json=chat_output_trace(answer, len(messages)),
        error=error,
        duration_ms=duration_ms,
        created_at=started_at,
        started_at=started_at,
        finished_at=now,
    )
    apply_usage_metadata(
        job,
        usage_metadata(
            usage=usage,
            messages=messages,
            llm_provider=model.llm_provider,
            model=model_name,
        ),
    )
    session.add(job)
    session.commit()
    log_event(
        logger,
        logging.INFO if status != "failed" else logging.ERROR,
        "assistant_turn_finished",
        chat_id=chat.id,
        status=status,
        model=model_name,
        duration_ms=duration_ms,
        usage_input_tokens=job.usage_input_tokens,
        usage_output_tokens=job.usage_output_tokens,
        usage_tool_call_count=job.usage_tool_call_count,
        error=error,
    )
