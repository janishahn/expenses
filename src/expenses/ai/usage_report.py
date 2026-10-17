"""The server's AI usage over a period, split by feature and model, with Assistant chats.

SQLite adds the figures up, so a report's memory stays bounded however many runs
the server keeps.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import Float, Row, Select, case, cast, func, select
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
# As many turns as the Assistant shows of a chat.
CHAT_RUNS = 100

RUN_COLUMNS = (
    LLMJob.created_at,
    LLMJob.status,
    LLMJob.backend,
    LLMJob.model,
    LLMJob.usage_input_tokens,
    LLMJob.usage_output_tokens,
    LLMJob.usage_cached_input_tokens,
    LLMJob.usage_reasoning_tokens,
    LLMJob.usage_tool_call_count,
    LLMJob.usage_cost_decimal,
    LLMJob.duration_ms,
)


def _total(column):
    return func.coalesce(func.sum(column), 0)


TOKENS = func.coalesce(LLMJob.usage_input_tokens, 0) + func.coalesce(
    LLMJob.usage_output_tokens, 0
)
# Every aggregate row carries these, and _Tally adds them up.
FIGURES = (
    func.count().label("runs"),
    func.count().filter(LLMJob.status == "failed").label("failed_runs"),
    func.count().filter(LLMJob.status == "stopped").label("stopped_runs"),
    func.count(LLMJob.usage_cost_decimal).label("priced_runs"),
    _total(LLMJob.usage_input_tokens).label("input_tokens"),
    _total(LLMJob.usage_output_tokens).label("output_tokens"),
    _total(LLMJob.usage_cached_input_tokens).label("cached_input_tokens"),
    _total(LLMJob.usage_reasoning_tokens).label("reasoning_tokens"),
    func.expenses_decimal_sum(LLMJob.usage_cost_decimal).label("cost"),
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


class AIUsageModel(BaseModel):
    backend: str | None
    model: str


class AIUsageChatDetailOut(AIUsageChat):
    tool_calls: int
    # In the order the chat first used them.
    models: list[AIUsageModel]
    # The latest CHAT_RUNS turns, oldest first; turns counts them all.
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

    def add(self, row: Row) -> None:
        self.runs += row.runs
        self.failed_runs += row.failed_runs
        self.stopped_runs += row.stopped_runs
        self.priced_runs += row.priced_runs
        self.input_tokens += row.input_tokens
        self.output_tokens += row.output_tokens
        self.cached_input_tokens += row.cached_input_tokens
        self.reasoning_tokens += row.reasoning_tokens
        self.cost += Decimal(row.cost)

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


def _local_day(created_at: datetime, zone: ZoneInfo) -> date:
    return created_at.replace(tzinfo=timezone.utc).astimezone(zone).date()


def _utc_start(day: date, zone: ZoneInfo) -> datetime:
    return (
        datetime.combine(day, time(), zone)
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )


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


def _chat_figures(*conditions) -> Select:
    return (
        select(
            LLMJob.chat_id,
            func.min(LLMJob.user_id).label("user_id"),
            func.min(LLMJob.created_at).label("started_at"),
            func.max(LLMJob.created_at).label("last_run_at"),
            *FIGURES,
        )
        .where(*conditions, LLMJob.chat_id.is_not(None))
        .group_by(LLMJob.chat_id)
    )


def _chat_rows(session: Session, viewer_id: int, chats: list[Row]) -> list[AIUsageChat]:
    existing = {
        row.id: row
        for row in session.execute(
            select(AssistantChat.id, AssistantChat.user_id, AssistantChat.title).where(
                AssistantChat.id.in_([chat.chat_id for chat in chats])
            )
        )
    }
    usernames = dict(
        session.execute(
            select(User.id, User.username).where(
                User.id.in_([chat.user_id for chat in chats])
            )
        )
        .tuples()
        .all()
    )
    rows = []
    for chat in chats:
        stored = existing.get(chat.chat_id)
        access: ChatAccess = (
            "deleted"
            if stored is None
            else "own"
            if stored.user_id == viewer_id
            else "private"
        )
        rows.append(
            AIUsageChat(
                id=chat.chat_id,
                access=access,
                title=stored.title if access == "own" else None,
                username=usernames.get(chat.user_id),
                started_at=chat.started_at,
                last_run_at=chat.last_run_at,
                turns=chat.runs,
                priced_runs=chat.priced_runs,
                total_tokens=chat.input_tokens + chat.output_tokens,
                cost_usd=chat.cost,
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
    if model is not None:
        # A model's backend is part of its slice, so no backend selects the runs
        # that recorded none.
        conditions.append(LLMJob.model == model)
        conditions.append(
            LLMJob.backend.is_(None) if backend is None else LLMJob.backend == backend
        )
    elif backend is not None:
        conditions.append(LLMJob.backend == backend)
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
        started_at = _utc_start(buckets[0], zone)
        conditions.append(LLMJob.created_at >= started_at)

    totals = _Tally()
    slices: dict[tuple[Feature, str | None, str], _Slice] = {}
    if buckets:
        # The latest bucket that started by the run's time.
        bucket_index = case(
            *(
                (LLMJob.created_at >= _utc_start(day, zone), index)
                for index, day in reversed(list(enumerate(buckets)))
            ),
            else_=0,
        ).label("bucket")
        for row in session.execute(
            select(
                LLMJob.feature,
                LLMJob.backend,
                LLMJob.model,
                bucket_index,
                *FIGURES,
            )
            .where(*conditions)
            .group_by(LLMJob.feature, LLMJob.backend, LLMJob.model, bucket_index)
        ):
            totals.add(row)
            entry = slices.setdefault(
                (row.feature, row.backend, row.model),
                _Slice(_Tally(), [0] * len(buckets), [Decimal(0)] * len(buckets)),
            )
            entry.tally.add(row)
            entry.bucket_tokens[row.bucket] += row.input_tokens + row.output_tokens
            entry.bucket_cost[row.bucket] += Decimal(row.cost)

    timed_runs = session.scalar(
        select(func.count(LLMJob.duration_ms)).where(*conditions)
    )
    # Counted from the slowest, so SQLite's sort keeps only a twentieth of the runs.
    p95_rank = max(0, -(-timed_runs * 95 // 100) - 1)
    p95_duration_ms = (
        session.scalar(
            select(LLMJob.duration_ms)
            .where(*conditions, LLMJob.duration_ms.is_not(None))
            .order_by(LLMJob.duration_ms.desc())
            .offset(timed_runs - 1 - p95_rank)
            .limit(1)
        )
        if timed_runs
        else None
    )
    chat_count = session.scalar(
        select(func.count(func.distinct(LLMJob.chat_id))).where(*conditions)
    )
    ranked_chats = session.execute(
        _chat_figures(*conditions)
        # Ranks by the float sum of the cost text; the reported costs stay exact.
        .order_by(
            func.total(cast(LLMJob.usage_cost_decimal, Float)).desc(),
            func.sum(TOKENS).desc(),
            LLMJob.chat_id,
        )
        .limit(chat_limit)
    ).all()
    return AIUsageOut(
        period=period,
        started_at=started_at,
        bucket=bucket,
        buckets=buckets,
        totals=AIUsageTotals(
            **totals.figures(),
            chats=chat_count,
            turns=sum(
                entry.tally.runs
                for (slice_feature, _, _), entry in slices.items()
                if slice_feature == "spending_chat"
            ),
            p95_duration_ms=p95_duration_ms,
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
                slices.items(),
                key=lambda item: (-item[1].tally.cost, -item[1].tally.total_tokens),
            )
        ],
        chat_count=chat_count,
        chats=_chat_rows(session, viewer_id, ranked_chats),
    )


def chat_usage(
    session: Session, *, viewer_id: int, chat_id: str
) -> AIUsageChatDetailOut | None:
    in_chat = LLMJob.chat_id == chat_id
    figures = session.execute(
        _chat_figures(in_chat).add_columns(
            _total(LLMJob.usage_tool_call_count).label("tool_calls")
        )
    ).one_or_none()
    if figures is None:
        return None
    models = session.execute(
        select(LLMJob.backend, LLMJob.model)
        .where(in_chat)
        .group_by(LLMJob.backend, LLMJob.model)
        .order_by(func.min(LLMJob.created_at))
    )
    runs = session.execute(
        select(*RUN_COLUMNS)
        .where(in_chat)
        .order_by(LLMJob.created_at.desc(), LLMJob.id.desc())
        .limit(CHAT_RUNS)
    ).all()
    (summary,) = _chat_rows(session, viewer_id, [figures])
    return AIUsageChatDetailOut(
        **summary.model_dump(),
        tool_calls=figures.tool_calls,
        models=[AIUsageModel(backend=row.backend, model=row.model) for row in models],
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
            for run in reversed(runs)
        ],
    )
