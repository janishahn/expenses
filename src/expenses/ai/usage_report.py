"""The server's AI usage over a period, split by feature and model, with Assistant chats."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import Row, func, select
from sqlalchemy.orm import Session

from expenses.ai.features import Feature
from expenses.core.config import get_settings
from expenses.db.models import AssistantChat, LLMJob, User

UsagePeriod = Literal["week", "month", "all"]
UsageBucket = Literal["day", "week", "month"]
RunStatus = Literal["running", "completed", "failed", "stopped"]
# own: the viewer's chat, with its title. private: another user's chat. deleted:
# the chat is gone, and its usage stays.
ChatAccess = Literal["own", "private", "deleted"]

PERIOD_DAYS = {"week": 7, "month": 30}

RUN_COLUMNS = (
    LLMJob.created_at,
    LLMJob.user_id,
    LLMJob.feature,
    LLMJob.status,
    LLMJob.backend,
    LLMJob.model,
    LLMJob.chat_id,
    LLMJob.usage_input_tokens,
    LLMJob.usage_output_tokens,
    LLMJob.usage_cached_input_tokens,
    LLMJob.usage_reasoning_tokens,
    LLMJob.usage_tool_call_count,
    LLMJob.usage_cost_decimal,
    LLMJob.duration_ms,
)


class AIUsageFigures(BaseModel):
    runs: int
    failed_runs: int
    stopped_runs: int
    # Runs whose backend reported a cost. cost_usd sums only these.
    priced_runs: int
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int
    reasoning_tokens: int
    total_tokens: int
    cost_usd: str


class AIUsageTotals(AIUsageFigures):
    chats: int
    turns: int
    p95_duration_ms: int | None


class AIUsageSlice(AIUsageFigures):
    feature: Feature
    backend: str | None
    model: str
    # One value per bucket, in the order of AIUsageOut.buckets.
    bucket_tokens: list[int]
    bucket_cost_usd: list[str]


class AIUsageChat(BaseModel):
    id: str
    access: ChatAccess
    title: str | None
    username: str | None
    started_at: datetime
    last_run_at: datetime
    turns: int
    priced_runs: int
    total_tokens: int
    cost_usd: str


class AIUsageOut(BaseModel):
    period: UsagePeriod
    started_at: datetime | None
    bucket: UsageBucket
    # The first local day of each bucket.
    buckets: list[date]
    totals: AIUsageTotals
    # Costliest first; a slice is one model serving one feature.
    slices: list[AIUsageSlice]
    chat_count: int
    # Costliest first, then most tokens.
    chats: list[AIUsageChat]


class AIUsageRun(BaseModel):
    created_at: datetime
    status: RunStatus
    backend: str | None
    model: str
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int
    reasoning_tokens: int
    total_tokens: int
    tool_calls: int
    duration_ms: int | None
    cost_usd: str | None


class AIUsageChatDetailOut(AIUsageChat):
    runs: list[AIUsageRun]


@dataclass
class _Tally:
    runs: int = 0
    failed_runs: int = 0
    stopped_runs: int = 0
    priced_runs: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    reasoning_tokens: int = 0
    cost: Decimal = Decimal(0)

    def add(self, run: Row) -> None:
        self.runs += 1
        self.failed_runs += run.status == "failed"
        self.stopped_runs += run.status == "stopped"
        self.input_tokens += run.usage_input_tokens or 0
        self.output_tokens += run.usage_output_tokens or 0
        self.cached_input_tokens += run.usage_cached_input_tokens or 0
        self.reasoning_tokens += run.usage_reasoning_tokens or 0
        if run.usage_cost_decimal is not None:
            self.priced_runs += 1
            self.cost += Decimal(run.usage_cost_decimal)

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def figures(self) -> dict[str, int | str]:
        return {
            "runs": self.runs,
            "failed_runs": self.failed_runs,
            "stopped_runs": self.stopped_runs,
            "priced_runs": self.priced_runs,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cached_input_tokens": self.cached_input_tokens,
            "reasoning_tokens": self.reasoning_tokens,
            "total_tokens": self.total_tokens,
            "cost_usd": format(self.cost, "f"),
        }


@dataclass
class _Slice:
    tally: _Tally
    bucket_tokens: list[int]
    bucket_cost: list[Decimal]


@dataclass
class _Chat:
    user_id: int
    started_at: datetime
    last_run_at: datetime
    tally: _Tally = field(default_factory=_Tally)


def _local_day(created_at: datetime, zone: ZoneInfo) -> date:
    return created_at.replace(tzinfo=timezone.utc).astimezone(zone).date()


def _buckets(first: date, today: date) -> tuple[UsageBucket, list[date]]:
    """Days for up to a month, weeks for up to half a year, then months."""
    span = (today - first).days
    if span < 31:
        return "day", [first + timedelta(days=index) for index in range(span + 1)]
    if span < 26 * 7:
        monday = first - timedelta(days=first.weekday())
        weeks = (today - monday).days // 7 + 1
        return "week", [monday + timedelta(weeks=index) for index in range(weeks)]
    months = (today.year - first.year) * 12 + today.month - first.month + 1
    return "month", [
        date(
            first.year + (first.month - 1 + index) // 12,
            (first.month - 1 + index) % 12 + 1,
            1,
        )
        for index in range(months)
    ]


def _bucket_index(bucket: UsageBucket, first: date, day: date) -> int:
    if bucket == "day":
        return (day - first).days
    if bucket == "week":
        return (day - first).days // 7
    return (day.year - first.year) * 12 + day.month - first.month


def _ranked(tally: _Tally) -> tuple[Decimal, int]:
    return (-tally.cost, -tally.total_tokens)


def _chat_rows(
    session: Session, viewer_id: int, chats: list[tuple[str, _Chat]]
) -> list[AIUsageChat]:
    ids = [chat_id for chat_id, _ in chats]
    existing = {
        row.id: row
        for row in session.execute(
            select(AssistantChat.id, AssistantChat.user_id, AssistantChat.title).where(
                AssistantChat.id.in_(ids)
            )
        )
    }
    usernames = dict(
        session.execute(
            select(User.id, User.username).where(
                User.id.in_([chat.user_id for _, chat in chats])
            )
        )
        .tuples()
        .all()
    )
    rows = []
    for chat_id, chat in chats:
        stored = existing.get(chat_id)
        access: ChatAccess = (
            "deleted"
            if stored is None
            else "own"
            if stored.user_id == viewer_id
            else "private"
        )
        rows.append(
            AIUsageChat(
                id=chat_id,
                access=access,
                title=stored.title if access == "own" else None,
                username=usernames.get(chat.user_id),
                started_at=chat.started_at,
                last_run_at=chat.last_run_at,
                turns=chat.tally.runs,
                priced_runs=chat.tally.priced_runs,
                total_tokens=chat.tally.total_tokens,
                cost_usd=format(chat.tally.cost, "f"),
            )
        )
    return rows


def usage_report(
    session: Session,
    *,
    viewer_id: int,
    period: UsagePeriod,
    feature: Feature | None,
    backend: str | None,
    model: str | None,
    chat_limit: int,
    now: datetime,
) -> AIUsageOut:
    zone = ZoneInfo(get_settings().timezone)
    today = _local_day(now, zone)
    conditions = []
    if feature is not None:
        conditions.append(LLMJob.feature == feature)
    if backend is not None:
        conditions.append(LLMJob.backend == backend)
    if model is not None:
        conditions.append(LLMJob.model == model)
    started_at = None
    if period == "all":
        first_run = session.scalar(
            select(func.min(LLMJob.created_at)).where(*conditions)
        )
        bucket, buckets = (
            _buckets(_local_day(first_run, zone), today)
            if first_run is not None
            else ("day", [])
        )
    else:
        bucket, buckets = _buckets(
            today - timedelta(days=PERIOD_DAYS[period] - 1), today
        )
        started_at = (
            datetime.combine(buckets[0], time(), zone)
            .astimezone(timezone.utc)
            .replace(tzinfo=None)
        )
        conditions.append(LLMJob.created_at >= started_at)

    totals = _Tally()
    slices: dict[tuple[Feature, str | None, str], _Slice] = {}
    chats: dict[str, _Chat] = {}
    durations: list[int] = []
    for run in session.execute(select(*RUN_COLUMNS).where(*conditions)):
        totals.add(run)
        if run.duration_ms is not None:
            durations.append(run.duration_ms)
        entry = slices.setdefault(
            (run.feature, run.backend, run.model),
            _Slice(_Tally(), [0] * len(buckets), [Decimal(0)] * len(buckets)),
        )
        entry.tally.add(run)
        index = _bucket_index(bucket, buckets[0], _local_day(run.created_at, zone))
        entry.bucket_tokens[index] += (run.usage_input_tokens or 0) + (
            run.usage_output_tokens or 0
        )
        if run.usage_cost_decimal is not None:
            entry.bucket_cost[index] += Decimal(run.usage_cost_decimal)
        if run.chat_id is not None:
            chat = chats.setdefault(
                run.chat_id, _Chat(run.user_id, run.created_at, run.created_at)
            )
            chat.started_at = min(chat.started_at, run.created_at)
            chat.last_run_at = max(chat.last_run_at, run.created_at)
            chat.tally.add(run)

    durations.sort()
    ranked_chats = sorted(
        chats.items(), key=lambda item: (*_ranked(item[1].tally), item[0])
    )
    return AIUsageOut(
        period=period,
        started_at=started_at,
        bucket=bucket,
        buckets=buckets,
        totals=AIUsageTotals(
            **totals.figures(),
            chats=len(chats),
            turns=sum(
                entry.tally.runs
                for (slice_feature, _, _), entry in slices.items()
                if slice_feature == "spending_chat"
            ),
            p95_duration_ms=(
                durations[max(0, -(-len(durations) * 95 // 100) - 1)]
                if durations
                else None
            ),
        ),
        slices=[
            AIUsageSlice(
                **entry.tally.figures(),
                feature=slice_feature,
                backend=slice_backend,
                model=slice_model,
                bucket_tokens=entry.bucket_tokens,
                bucket_cost_usd=[format(cost, "f") for cost in entry.bucket_cost],
            )
            for (slice_feature, slice_backend, slice_model), entry in sorted(
                slices.items(), key=lambda item: _ranked(item[1].tally)
            )
        ],
        chat_count=len(chats),
        chats=_chat_rows(session, viewer_id, ranked_chats[:chat_limit]),
    )


def chat_usage(
    session: Session, *, viewer_id: int, chat_id: str
) -> AIUsageChatDetailOut | None:
    runs = session.execute(
        select(*RUN_COLUMNS)
        .where(LLMJob.chat_id == chat_id)
        .order_by(LLMJob.created_at, LLMJob.id)
    ).all()
    if not runs:
        return None
    chat = _Chat(runs[0].user_id, runs[0].created_at, runs[-1].created_at)
    for run in runs:
        chat.tally.add(run)
    (summary,) = _chat_rows(session, viewer_id, [(chat_id, chat)])
    return AIUsageChatDetailOut(
        **summary.model_dump(),
        runs=[
            AIUsageRun(
                created_at=run.created_at,
                status=run.status,
                backend=run.backend,
                model=run.model,
                input_tokens=run.usage_input_tokens or 0,
                output_tokens=run.usage_output_tokens or 0,
                cached_input_tokens=run.usage_cached_input_tokens or 0,
                reasoning_tokens=run.usage_reasoning_tokens or 0,
                total_tokens=(run.usage_input_tokens or 0)
                + (run.usage_output_tokens or 0),
                tool_calls=run.usage_tool_call_count or 0,
                duration_ms=run.duration_ms,
                cost_usd=run.usage_cost_decimal,
            )
            for run in runs
        ],
    )
