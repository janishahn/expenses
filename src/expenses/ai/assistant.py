"""The Assistant: chats stored on the server, agent turns, and the stream clients render.

A turn runs in a background task that feeds a queue. The HTTP response reads the
queue, so a client that disconnects (Stop) only cancels the run through
pydantic-ai, which keeps the partial messages, and the turn is still saved.

A write tool ends the run with an approval card. Deciding it applies the stored plan
and records the tool result in one commit, and only then does the same turn continue.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from time import perf_counter
from typing import Annotated, Any, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter
from pydantic_ai import Agent, AgentRunEvents, RunContext, Tool, UsageLimits
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded
from pydantic_ai.messages import (
    DeferredToolRequestsEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    PartEndEvent,
    RetryPromptPart,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    ToolReturnPart,
)
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings
from pydantic_ai.tools import DeferredToolRequests
from pydantic_ai.ui import UIEventStream
from pydantic_ai.usage import RunUsage
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from expenses.ai.assistant_actions import (
    WRITE_TOOLS,
    ActionConflict,
    ApprovalCard,
    Proposal,
    apply_action,
)
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
from expenses.db.models import (
    AssistantAction,
    AssistantChat,
    AssistantTurn,
    LLMJob,
    User,
)

logger = get_logger("expenses.ai.assistant")

# Text that grows past this or breaks a line is the answer, not a note about the next step.
PROMOTE_AT = 160
HISTORY_TURNS = 20
# Turns an opened chat shows, newest last, so a long-running chat stays light.
CHAT_TURNS = 100
# Lines a turn holds for a slow client before the run waits for it to catch up.
STREAM_BUFFER_LINES = 64
# Caps a turn's model output, reasoning included. It is checked here rather than
# sent to the backend, so models with a smaller output limit still accept requests.
TURN_OUTPUT_TOKENS = 100_000
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


class ApprovalItem(BaseModel):
    """A change the model proposed. Nothing changes until the user approves it."""

    kind: Literal["approval"] = "approval"
    # approval-<tool call id>
    id: str
    card: ApprovalCard
    state: Literal["pending", "applied", "dismissed", "failed"]
    # Why an approved change couldn't be applied.
    message: str | None = None


AssistantItem = Annotated[
    ThinkingItem | NoteItem | ToolItem | TextItem | ApprovalItem,
    Field(discriminator="kind"),
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


class AssistantConflictError(Exception):
    pass


class AssistantDecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: str = Field(pattern=r"^approval-", max_length=120)
    approve: bool


ChatDays = Literal[7, 14, 30, 90]


class AssistantSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chat_days: ChatDays


class AssistantSettingsOut(BaseModel):
    chat_days: int


@dataclass(frozen=True)
class AssistantModel:
    model: Model
    settings: ModelSettings
    llm_provider: str


def _item_id() -> str:
    return uuid4().hex[:12]


def _approval_id(tool_call_id: str) -> str:
    return f"approval-{tool_call_id}"


@dataclass
class AssistantEventStream(
    UIEventStream[None, dict[str, Any], AssistantReader, str | DeferredToolRequests]
):
    """Turns pydantic-ai events into item upserts and text deltas."""

    items: list[AssistantItem] = field(default_factory=list)
    error: Exception | None = None
    # Write tool calls waiting for the user, by tool call id, with the tool's name.
    proposals: dict[str, tuple[str, Proposal]] = field(default_factory=dict)
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
        return {"type": "item", "item": item.model_dump(mode="json")}

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

    async def handle_deferred_tool_requests(
        self, event: DeferredToolRequestsEvent
    ) -> AsyncIterator[dict[str, Any]]:
        for part in event.requests.approvals:
            proposal = Proposal.model_validate(
                event.requests.metadata[part.tool_call_id]
            )
            self.proposals[part.tool_call_id] = (part.tool_name, proposal)
            tool = self._tools.pop(part.tool_call_id, None)
            if tool is not None:
                tool.state = "done"
                yield self._upsert(tool)
            yield self._upsert(
                ApprovalItem(
                    id=_approval_id(part.tool_call_id),
                    card=proposal.card,
                    state="pending",
                )
            )

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
                case ApprovalItem(state="pending") if status != "completed":
                    item.state = "dismissed"
                case _:
                    continue
            events.append({"type": "item", "item": item.model_dump(mode="json")})
        return events

    @property
    def answer(self) -> str:
        return "\n\n".join(item.text for item in self.items if item.kind == "text")


def _agent(model: AssistantModel) -> Agent[AssistantReader, str | DeferredToolRequests]:
    agent = Agent(
        model.model,
        model_settings=model.settings,
        deps_type=AssistantReader,
        output_type=[str, DeferredToolRequests],
        # Anthropic rejects requests whose strict schemas together are too complex,
        # so only the write tools, whose arguments become a card, are strict.
        tools=[
            *(Tool(tool, takes_ctx=True, sequential=True) for tool in TOOLS),
            *(
                Tool(tool, takes_ctx=True, strict=True, sequential=True)
                for tool in WRITE_TOOLS
            ),
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
    # Continues this turn after the user decided its approval cards.
    continue_seq: int | None = None
    # Starts the chat. Any other turn whose chat is gone was deleted while it ran.
    new_chat: bool = False


class AssistantService:
    def __init__(self, session: Session, *, user_id: int) -> None:
        self.session = session
        self.user_id = user_id

    def settings(self) -> AssistantSettingsOut:
        user = self.session.get_one(User, self.user_id)
        return AssistantSettingsOut(chat_days=user.assistant_chat_days)

    def update_settings(self, data: AssistantSettingsIn) -> AssistantSettingsOut:
        user = self.session.get_one(User, self.user_id)
        user.assistant_chat_days = data.chat_days
        self.session.commit()
        return AssistantSettingsOut(chat_days=user.assistant_chat_days)

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
            .order_by(AssistantTurn.seq.desc())
            .limit(CHAT_TURNS)
        ).all()
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
                for turn in reversed(turns)
            ],
        )

    def _last_turn(self, chat_id: str) -> AssistantTurn | None:
        return self.session.scalars(
            select(AssistantTurn)
            .where(AssistantTurn.chat_id == chat_id)
            .order_by(AssistantTurn.seq.desc())
            .limit(1)
        ).first()

    def delete_chat(self, chat_id: str) -> None:
        chat = self.chat(chat_id)
        self.session.execute(
            delete(AssistantTurn).where(AssistantTurn.chat_id == chat.id)
        )
        self.session.execute(
            update(AssistantAction)
            .where(
                AssistantAction.chat_id == chat.id,
                AssistantAction.status == "proposed",
            )
            .values(status="dismissed", decided_at=datetime.utcnow())
        )
        self.session.delete(chat)
        self.session.commit()

    def _claim(self, action: AssistantAction, status: str) -> bool:
        """Moves a proposed action on; False when another request decided it first."""
        result = self.session.execute(
            update(AssistantAction)
            .where(
                AssistantAction.id == action.id,
                AssistantAction.status == "proposed",
            )
            .values(status=status, decided_at=datetime.utcnow())
        )
        return result.rowcount == 1

    def _dismiss_pending(self, chat_id: str) -> None:
        """Closes cards the user left undecided, so the model hears nothing changed."""
        turn = self._last_turn(chat_id)
        if turn is None:
            return
        items = ITEMS.validate_json(turn.items_json)
        pending = [
            item
            for item in items
            if isinstance(item, ApprovalItem) and item.state == "pending"
        ]
        if not pending:
            return
        actions = self.session.scalars(
            select(AssistantAction).where(
                AssistantAction.chat_id == chat_id,
                AssistantAction.tool_call_id.in_(
                    [item.id.removeprefix("approval-") for item in pending]
                ),
            )
        ).all()
        messages_json = turn.messages_json
        for action in actions:
            if not self._claim(action, "dismissed"):
                continue
            for item in pending:
                if item.id == _approval_id(action.tool_call_id):
                    item.state = "dismissed"
            messages_json = _with_tool_return(
                messages_json,
                ToolReturnPart(
                    tool_name=action.kind,
                    content={
                        "ok": False,
                        "status": "dismissed",
                        "message": "The user moved on without approving this. "
                        "Nothing changed.",
                    },
                    tool_call_id=action.tool_call_id,
                ),
            )
        turn.items_json = ITEMS.dump_json(items).decode()
        turn.messages_json = messages_json
        self.session.commit()

    def new_turn(self, *, chat_id: str | None, text: str) -> TurnRequest:
        if chat_id is None:
            return TurnRequest(
                user_id=self.user_id,
                chat_id=uuid4().hex,
                title=_title(text),
                user_text=text,
                new_chat=True,
            )
        chat = self.chat(chat_id)
        self._dismiss_pending(chat.id)
        return TurnRequest(
            user_id=self.user_id, chat_id=chat.id, title=chat.title, user_text=text
        )

    def retry_turn(self, chat_id: str) -> TurnRequest:
        chat = self.chat(chat_id)
        last = self._last_turn(chat.id)
        if last is None:
            raise AssistantNotFoundError("This chat has nothing to retry")
        if any(
            isinstance(item, ApprovalItem) and item.state == "applied"
            for item in ITEMS.validate_json(last.items_json)
        ):
            raise AssistantConflictError(
                "This answer changed your data, so it can't run again. "
                "Ask the Assistant to undo the change instead."
            )
        return TurnRequest(
            user_id=self.user_id,
            chat_id=chat.id,
            title=chat.title,
            user_text=last.user_text,
            replace_seq=last.seq,
        )

    def decide(self, chat_id: str, item_id: str, *, approve: bool) -> TurnRequest:
        """Applies or dismisses a proposed change and records what the model hears.

        The change, the card's state, and the tool result commit together, so the
        turn can continue, or fail to, without the change applying twice.
        """
        chat = self.chat(chat_id)
        turn = self._last_turn(chat.id)
        items = ITEMS.validate_json(turn.items_json) if turn else []
        item = next(
            (
                item
                for item in items
                if isinstance(item, ApprovalItem) and item.id == item_id
            ),
            None,
        )
        # A reused tool call id belongs to the latest action, the one this turn proposed.
        action = self.session.scalar(
            select(AssistantAction)
            .where(
                AssistantAction.chat_id == chat.id,
                AssistantAction.tool_call_id == item_id.removeprefix("approval-"),
            )
            .order_by(AssistantAction.id.desc())
            .limit(1)
        )
        if turn is None or item is None or action is None:
            raise AssistantNotFoundError("This change is no longer waiting for you")
        if item.state != "pending" or not self._claim(
            action, "applied" if approve else "dismissed"
        ):
            self.session.rollback()
            raise AssistantConflictError("This change was already decided")
        content: dict[str, Any]
        if approve:
            try:
                with self.session.begin_nested():
                    content = apply_action(self.session, action)
                item.state = "applied"
            except ActionConflict as exc:
                action.status = "failed"
                item.state = "failed"
                item.message = exc.message
                content = {"ok": False, "status": "conflict", "message": exc.message}
        else:
            item.state = "dismissed"
            content = {
                "ok": False,
                "status": "dismissed",
                "message": "The user dismissed this. Nothing changed.",
            }
        turn.items_json = ITEMS.dump_json(items).decode()
        turn.messages_json = _with_tool_return(
            turn.messages_json,
            ToolReturnPart(
                tool_name=action.kind,
                content=content,
                tool_call_id=action.tool_call_id,
            ),
        )
        chat.updated_at = datetime.utcnow()
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "assistant_action_decided",
            chat_id=chat.id,
            action_id=action.id,
            kind=action.kind,
            state=item.state,
        )
        return TurnRequest(
            user_id=self.user_id,
            chat_id=chat.id,
            title=chat.title,
            user_text=turn.user_text,
            continue_seq=turn.seq,
        )


def prune_chats(session: Session, now: datetime) -> int:
    """Deletes each user's chats and change records older than they keep chats."""
    deleted = 0
    for user_id, days in session.execute(select(User.id, User.assistant_chat_days)):
        cutoff = now - timedelta(days=days)
        stale = select(AssistantChat.id).where(
            AssistantChat.user_id == user_id, AssistantChat.updated_at < cutoff
        )
        session.execute(delete(AssistantTurn).where(AssistantTurn.chat_id.in_(stale)))
        deleted += session.execute(
            delete(AssistantChat).where(
                AssistantChat.user_id == user_id, AssistantChat.updated_at < cutoff
            )
        ).rowcount
        # A change stays undoable while its chat is kept.
        session.execute(
            delete(AssistantAction).where(
                AssistantAction.user_id == user_id,
                AssistantAction.created_at < cutoff,
                AssistantAction.chat_id.not_in(
                    select(AssistantChat.id).where(AssistantChat.user_id == user_id)
                ),
            )
        )
    session.commit()
    return deleted


def _with_tool_return(messages_json: str, part: ToolReturnPart) -> str:
    """Adds a tool result to the request that answers the model's tool calls."""
    messages = ModelMessagesTypeAdapter.validate_json(messages_json)
    last = messages[-1]
    if isinstance(last, ModelRequest):
        messages[-1] = replace(last, parts=[*last.parts, part])
    else:
        messages.append(ModelRequest(parts=[part]))
    return ModelMessagesTypeAdapter.dump_json(messages).decode()


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

    events: AgentRunEvents[str | DeferredToolRequests] | None = None
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
    queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=STREAM_BUFFER_LINES)
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
        # Nobody reads the queue now, so free a run waiting for room in it.
        while not queue.empty():
            queue.get_nowait()


async def _run_turn(
    request: TurnRequest,
    model: AssistantModel,
    session_factory: Callable[[], Session],
    queue: asyncio.Queue[str | None],
    handle: _TurnHandle,
) -> None:
    async def put(event: dict[str, Any] | None) -> None:
        # Once the response stops reading, the run finishes and saves without it.
        if not handle.stop_requested:
            await queue.put(
                None if event is None else json.dumps(event, ensure_ascii=False) + "\n"
            )

    session = session_factory()
    try:
        await put({"type": "start", "chat_id": request.chat_id, "title": request.title})
        prompt: str | None = request.user_text
        items: list[AssistantItem] = []
        if request.continue_seq is None:
            history = _history(session, request.chat_id, request.replace_seq)
        else:
            turn = _turn(session, request.chat_id, request.continue_seq)
            items = ITEMS.validate_json(turn.items_json)
            approvals = [item for item in items if isinstance(item, ApprovalItem)]
            for item in approvals:
                await put({"type": "item", "item": item.model_dump(mode="json")})
            if any(item.state == "pending" for item in approvals):
                await put({"type": "end", "status": "completed"})
                return
            prompt = None
            history = [
                *_history(session, request.chat_id, request.continue_seq),
                *ModelMessagesTypeAdapter.validate_json(turn.messages_json),
            ]
        now = datetime.now(ZoneInfo(get_settings().timezone))
        deps = AssistantReader(session, user_id=request.user_id, now=now)
        stream = AssistantEventStream(items=items)
        started_at = datetime.utcnow()
        started = perf_counter()
        async with _agent(model).run_stream_events(
            prompt,
            deps=deps,
            message_history=history,
            usage_limits=UsageLimits(
                request_limit=24,
                tool_calls_limit=24,
                output_tokens_limit=TURN_OUTPUT_TOKENS,
            ),
        ) as events:
            handle.events = events
            if handle.stop_requested:
                events.cancel()
            async for event in stream.transform_stream(events):
                await put(event)
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
            await put(event)
        _save_turn(
            session,
            request,
            model=model,
            items=stream.items,
            proposals=stream.proposals,
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
        await put(end)
    except Exception as exc:
        session.rollback()
        log_event(
            logger,
            logging.ERROR,
            "assistant_turn_crashed",
            chat_id=request.chat_id,
            error=repr(exc),
        )
        await put(
            {
                "type": "end",
                "status": "failed",
                "message": "The Assistant couldn't finish this answer. Try again.",
            }
        )
    finally:
        session.close()
        await put(None)


def _turn(session: Session, chat_id: str, seq: int) -> AssistantTurn:
    return session.scalars(
        select(AssistantTurn).where(
            AssistantTurn.chat_id == chat_id, AssistantTurn.seq == seq
        )
    ).one()


def _save_turn(
    session: Session,
    request: TurnRequest,
    *,
    model: AssistantModel,
    items: list[AssistantItem],
    proposals: dict[str, tuple[str, Proposal]],
    messages: list[ModelMessage],
    status: TurnStatus,
    usage: RunUsage,
    answer: str,
    history_size: int,
    error: str | None,
    started_at: datetime,
    duration_ms: int,
) -> None:
    """Saves the turn, its chat, its proposed changes, and its usage in one commit."""
    now = datetime.utcnow()
    chat = session.get(AssistantChat, request.chat_id)
    if chat is None and request.new_chat:
        chat = AssistantChat(
            id=request.chat_id,
            user_id=request.user_id,
            title=request.title,
            created_at=now,
            updated_at=now,
        )
        session.add(chat)
    if chat is not None:
        chat.updated_at = now
        # Writing the chat first takes the write lock, so the reads below stay
        # current until this commits, even when another turn on it finishes now.
        session.flush()
        # A change approved while a retry ran keeps the turn that shows it.
        if request.replace_seq is not None and any(
            isinstance(item, ApprovalItem) and item.state == "applied"
            for items_json in session.scalars(
                select(AssistantTurn.items_json).where(
                    AssistantTurn.chat_id == chat.id,
                    AssistantTurn.seq >= request.replace_seq,
                )
            ).all()
            for item in ITEMS.validate_json(items_json)
        ):
            chat = None
    # A chat deleted while the turn ran stays deleted, and a retry that lost to an
    # approval replaces nothing; only the usage is kept.
    if chat is not None:
        if request.continue_seq is not None:
            turn = _turn(session, chat.id, request.continue_seq)
            turn.items_json = ITEMS.dump_json(items).decode()
            turn.messages_json = ModelMessagesTypeAdapter.dump_json(
                [*ModelMessagesTypeAdapter.validate_json(turn.messages_json), *messages]
            ).decode()
            turn.status = status
        else:
            if request.replace_seq is not None:
                session.execute(
                    delete(AssistantTurn).where(
                        AssistantTurn.chat_id == chat.id,
                        AssistantTurn.seq >= request.replace_seq,
                    )
                )
                session.execute(
                    update(AssistantAction)
                    .where(
                        AssistantAction.chat_id == chat.id,
                        AssistantAction.status == "proposed",
                    )
                    .values(status="dismissed", decided_at=now)
                )
                seq = request.replace_seq
            else:
                last_seq = session.scalar(
                    select(func.max(AssistantTurn.seq)).where(
                        AssistantTurn.chat_id == chat.id
                    )
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
        pending = {
            item.id
            for item in items
            if isinstance(item, ApprovalItem) and item.state == "pending"
        }
        for tool_call_id, (tool_name, proposal) in proposals.items():
            if _approval_id(tool_call_id) not in pending:
                continue
            session.add(
                AssistantAction(
                    user_id=request.user_id,
                    chat_id=chat.id,
                    tool_call_id=tool_call_id,
                    kind=tool_name,
                    summary=proposal.summary[:200],
                    plan_json=proposal.plan.model_dump_json(),
                    status="proposed",
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
        chat_id=request.chat_id,
        status=status,
        model=model_name,
        duration_ms=duration_ms,
        usage_input_tokens=job.usage_input_tokens,
        usage_output_tokens=job.usage_output_tokens,
        usage_tool_call_count=job.usage_tool_call_count,
        error=error,
    )
