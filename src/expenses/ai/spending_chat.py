from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from time import perf_counter
from typing import Any, Literal, Protocol, cast, get_args
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from pydantic_ai import RunContext
from sqlalchemy.orm import Session

from expenses.ai.client import (
    LLMDisabledError,
    _request_model_settings,
    _retrying_http_client,
)
from expenses.ai.usage import (
    LLMUsageMetadata,
    OpenAICompatibleUsageCapture,
    apply_captured_provider_usage,
    apply_usage_metadata,
    chat_output_trace,
    enrich_openrouter_generation_usage,
    usage_metadata_from_result,
)
from expenses.core.app_logging import get_logger, log_event
from expenses.core.config import get_settings
from expenses.core.periods import Period
from expenses.core.search import parse_advanced_search
from expenses.db.models import Category, LLMJob, Transaction, TransactionType
from expenses.services import (
    BudgetService,
    MetricsService,
    ReimbursementService,
    TransactionFilters,
    TransactionService,
)

SpendingToolName = Literal[
    "get_spending_overview",
    "compare_spending_periods",
    "breakdown_spending",
    "search_transactions",
    "get_budget_context",
    "get_transaction_detail",
]
logger = get_logger("expenses.ai.spending_chat")
SPENDING_TOOL_NAMES = cast(tuple[SpendingToolName, ...], get_args(SpendingToolName))

_SYSTEM_PROMPT = """
You are a read-only spending analysis assistant inside a personal expense tracker.
Answer questions about the user's spending by using the provided tools before making
specific claims about amounts, categories, budgets, or transactions. Prefer concrete
transaction-level evidence over broad category-only summaries when the user asks what
drove spending. Do not claim you changed data; there are no write tools.

Use category, tag, transaction, and budget ids only as internal references. Explain
findings in normal language with concise amounts and dates. If a tool returns ok:false,
explain the limitation and ask for the missing information instead of guessing.

The ledger currency is euro. Format every amount with the € symbol, do not write
amounts with an ISO currency code, and do not use dollars or $ unless the underlying
transaction data explicitly says the amount is in USD.

Output rules:
- Keep answers compact: use one short paragraph followed by a bullet list when useful.
- When listing transactions or category changes, use a bullet list, not a table.
- Never use markdown tables unless the user explicitly asks for a table.
- Never use emoji.
""".strip()


class SpendingChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8_000)


class SpendingChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[SpendingChatMessage] = Field(min_length=1, max_length=40)
    message_history: list[dict[str, Any]] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def require_current_user_message(self) -> "SpendingChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("The last spending chat message must be from the user")
        return self

    @property
    def current_message(self) -> str:
        return self.messages[-1].content


class SpendingAgentTurnResult(BaseModel):
    kind: Literal["message"] = "message"
    assistant_message: str
    message_history: list[dict[str, Any]] = Field(default_factory=list)
    usage_input_tokens: int | None = None
    usage_output_tokens: int | None = None
    usage_total_tokens: int | None = None
    usage_cached_input_tokens: int | None = None
    usage_cache_write_tokens: int | None = None
    usage_reasoning_tokens: int | None = None
    usage_request_count: int | None = None
    usage_tool_call_count: int | None = None
    usage_cost_decimal: str | None = None
    usage_cost_unit: str | None = None
    llm_provider: str | None = None
    provider_name: str | None = None
    provider_model: str | None = None
    provider_response_id: str | None = None
    provider_request_id: str | None = None
    provider_usage_json: dict[str, Any] | None = None


class SpendingChatError(RuntimeError):
    pass


@dataclass(frozen=True)
class SpendingAgentContext:
    analysis: "SpendingAnalysisService"
    user_id: int
    today: date
    now: datetime


class SpendingChatRunner(Protocol):
    async def stream_turn(
        self,
        *,
        request: SpendingChatRequest,
        analysis: "SpendingAnalysisService",
        context: SpendingAgentContext,
    ) -> AsyncIterator[dict[str, Any] | SpendingAgentTurnResult]:
        pass


def _json_dumps(payload: dict[str, Any]) -> str:
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def validate_spending_chat_message_history(
    message_history: list[dict[str, Any]],
) -> None:
    try:
        from pydantic_ai import messages as pydantic_message
    except ImportError as exc:
        raise LLMDisabledError("Install pydantic-ai to enable LLM usage") from exc

    try:
        pydantic_message.ModelMessagesTypeAdapter.validate_python(message_history)
    except ValidationError as exc:
        raise ValueError("Invalid message_history") from exc


def _period(start: date, end: date) -> Period | dict[str, Any]:
    if start > end:
        return {
            "ok": False,
            "status": "invalid_period",
            "message": "start must be on or before end",
        }
    return Period("agent", start, end)


def _bounded_limit(limit: int, *, default: int = 20, max_value: int = 50) -> int:
    if limit <= 0:
        return default
    return min(limit, max_value)


def _category_payload(category: Category | None) -> dict[str, Any] | None:
    if category is None:
        return None
    return {
        "id": category.id,
        "name": category.name,
        "type": category.type.value,
        "icon": category.icon,
    }


def _transaction_payload(txn: Transaction) -> dict[str, Any]:
    gross = int(getattr(txn, "gross_amount_cents", txn.amount_cents))
    reimbursed = int(getattr(txn, "reimbursed_total_cents", 0))
    net = int(getattr(txn, "net_amount_cents", max(0, gross - reimbursed)))
    return {
        "id": txn.id,
        "date": txn.date.isoformat(),
        "occurred_at": txn.occurred_at.isoformat() if txn.occurred_at else None,
        "type": txn.type.value,
        "is_reimbursement": bool(txn.is_reimbursement),
        "title": txn.title,
        "description": txn.description,
        "amount_cents": int(txn.amount_cents),
        "gross_amount_cents": gross,
        "reimbursed_total_cents": reimbursed,
        "net_amount_cents": net,
        "category": _category_payload(txn.category),
        "tags": [{"id": tag.id, "name": tag.name} for tag in txn.tags],
    }


class SpendingAnalysisService:
    def __init__(self, session: Session, *, user_id: int, today: date) -> None:
        self.session = session
        self.user_id = user_id
        self.today = today

    def get_spending_overview(self, *, start: date, end: date) -> dict[str, Any]:
        period = _period(start, end)
        if isinstance(period, dict):
            return period

        metrics = MetricsService(self.session, self.user_id)
        current = metrics.kpis(period)
        days = (end - start).days + 1
        previous_end = start - timedelta(days=1)
        previous_start = previous_end - timedelta(days=days - 1)
        previous_period = Period("agent_previous", previous_start, previous_end)
        previous = metrics.kpis(previous_period)

        return {
            "ok": True,
            "status": "ok",
            "period": {"start": start.isoformat(), "end": end.isoformat()},
            "totals": {
                "income_cents": current["income"],
                "expense_cents": current["expenses"],
                "net_cents": current["income"] - current["expenses"],
                "balance_cents": current["balance"],
            },
            "previous_period": {
                "start": previous_start.isoformat(),
                "end": previous_end.isoformat(),
                "expense_cents": previous["expenses"],
                "expense_delta_cents": current["expenses"] - previous["expenses"],
            },
            "category_breakdown": metrics.category_breakdown(
                period, TransactionType.expense
            ),
        }

    def compare_spending_periods(
        self,
        *,
        current_start: date,
        current_end: date,
        baseline_start: date,
        baseline_end: date,
    ) -> dict[str, Any]:
        current_period = _period(current_start, current_end)
        baseline_period = _period(baseline_start, baseline_end)
        if isinstance(current_period, dict):
            return current_period
        if isinstance(baseline_period, dict):
            return baseline_period

        metrics = MetricsService(self.session, self.user_id)
        current = metrics.kpis(current_period)
        baseline = metrics.kpis(baseline_period)
        current_categories = {
            str(row["name"]): int(row["amount_cents"])
            for row in metrics.category_breakdown(
                current_period, TransactionType.expense, limit=None
            )
        }
        baseline_categories = {
            str(row["name"]): int(row["amount_cents"])
            for row in metrics.category_breakdown(
                baseline_period, TransactionType.expense, limit=None
            )
        }
        category_deltas = []
        for name in sorted(set(current_categories) | set(baseline_categories)):
            current_amount = current_categories.get(name, 0)
            baseline_amount = baseline_categories.get(name, 0)
            category_deltas.append(
                {
                    "name": name,
                    "current_amount_cents": current_amount,
                    "baseline_amount_cents": baseline_amount,
                    "delta_cents": current_amount - baseline_amount,
                }
            )
        category_deltas.sort(key=lambda row: int(row["delta_cents"]), reverse=True)

        return {
            "ok": True,
            "status": "ok",
            "current_period": {
                "start": current_start.isoformat(),
                "end": current_end.isoformat(),
            },
            "baseline_period": {
                "start": baseline_start.isoformat(),
                "end": baseline_end.isoformat(),
            },
            "totals": {
                "current_expense_cents": current["expenses"],
                "baseline_expense_cents": baseline["expenses"],
                "expense_delta_cents": current["expenses"] - baseline["expenses"],
                "current_income_cents": current["income"],
                "baseline_income_cents": baseline["income"],
                "income_delta_cents": current["income"] - baseline["income"],
            },
            "category_deltas": category_deltas,
        }

    def breakdown_spending(
        self,
        *,
        start: date,
        end: date,
        group_by: Literal["category", "tag", "month"] = "category",
        category_id: int | None = None,
        tag_id: int | None = None,
        limit: int = 12,
    ) -> dict[str, Any]:
        period = _period(start, end)
        if isinstance(period, dict):
            return period

        limit = _bounded_limit(limit, default=12)
        filters = TransactionFilters(
            type=TransactionType.expense,
            category_id=category_id,
            tag_id=tag_id,
        )
        transaction_service = TransactionService(self.session, self.user_id)
        total_count = transaction_service.count_for_period(period, filters)
        transactions = transaction_service.list_for_period(period, filters, limit=5_000)
        transaction_rows = [_transaction_payload(txn) for txn in transactions]

        if group_by == "category":
            totals: dict[int, dict[str, Any]] = {}
            for txn in transaction_rows:
                category = txn["category"]
                if not category:
                    continue
                row = totals.setdefault(
                    int(category["id"]),
                    {
                        "id": category["id"],
                        "name": category["name"],
                        "amount_cents": 0,
                        "percent": 0.0,
                    },
                )
                row["amount_cents"] += int(txn["net_amount_cents"])
            total_amount = sum(int(row["amount_cents"]) for row in totals.values())
            rows = sorted(
                totals.values(), key=lambda row: int(row["amount_cents"]), reverse=True
            )
            for row in rows:
                amount = int(row["amount_cents"])
                row["percent"] = (amount / total_amount * 100) if total_amount else 0.0
            return {
                "ok": True,
                "status": "ok",
                "group_by": group_by,
                "period": {"start": start.isoformat(), "end": end.isoformat()},
                "transaction_count": total_count,
                "candidate_truncated": total_count > len(transaction_rows),
                "rows": rows[:limit],
            }

        if group_by == "tag":
            totals: dict[int, dict[str, Any]] = {}
            for txn in transaction_rows:
                for tag in txn["tags"]:
                    row = totals.setdefault(
                        int(tag["id"]),
                        {"id": tag["id"], "name": tag["name"], "amount_cents": 0},
                    )
                    row["amount_cents"] += int(txn["net_amount_cents"])
            rows = sorted(
                totals.values(), key=lambda row: int(row["amount_cents"]), reverse=True
            )
            return {
                "ok": True,
                "status": "ok",
                "group_by": group_by,
                "period": {"start": start.isoformat(), "end": end.isoformat()},
                "transaction_count": total_count,
                "candidate_truncated": total_count > len(transaction_rows),
                "rows": rows[:limit],
            }

        totals_by_month: dict[str, int] = {}
        for txn in transaction_rows:
            month = str(txn["date"])[:7]
            totals_by_month[month] = totals_by_month.get(month, 0) + int(
                txn["net_amount_cents"]
            )
        rows = [
            {"month": month, "amount_cents": amount}
            for month, amount in sorted(totals_by_month.items())
        ]
        return {
            "ok": True,
            "status": "ok",
            "group_by": group_by,
            "period": {"start": start.isoformat(), "end": end.isoformat()},
            "transaction_count": total_count,
            "candidate_truncated": total_count > len(transaction_rows),
            "rows": rows[-limit:],
        }

    def search_transactions(
        self,
        *,
        query: str | None = None,
        start: date | None = None,
        end: date | None = None,
        category_id: int | None = None,
        tag_id: int | None = None,
        transaction_type: Literal["expense", "income"] | None = None,
        sort: Literal["date_desc", "amount_desc"] = "date_desc",
        limit: int = 20,
    ) -> dict[str, Any]:
        start = start or date(1970, 1, 1)
        end = end or self.today
        period = _period(start, end)
        if isinstance(period, dict):
            return period

        try:
            search = parse_advanced_search(query) if query else None
        except ValueError as exc:
            return {"ok": False, "status": "invalid_query", "message": str(exc)}

        filters = TransactionFilters(
            type=TransactionType(transaction_type) if transaction_type else None,
            category_id=category_id,
            tag_id=tag_id,
            search=search,
        )
        transaction_service = TransactionService(self.session, self.user_id)
        count = transaction_service.count_for_period(period, filters)
        limit = _bounded_limit(limit)
        candidate_limit = (
            limit if sort == "date_desc" else min(max(limit * 20, 250), 5_000)
        )
        transactions = transaction_service.list_for_period(
            period, filters, limit=candidate_limit
        )
        if sort == "amount_desc":
            transactions.sort(
                key=lambda txn: int(getattr(txn, "net_amount_cents", txn.amount_cents)),
                reverse=True,
            )
        transactions = transactions[:limit]
        return {
            "ok": True,
            "status": "ok",
            "period": {"start": start.isoformat(), "end": end.isoformat()},
            "sort": sort,
            "count": count,
            "truncated": count > len(transactions),
            "candidate_truncated": count > candidate_limit,
            "transactions": [_transaction_payload(txn) for txn in transactions],
        }

    def get_budget_context(
        self, *, year: int, month: int, category_id: int | None = None
    ) -> dict[str, Any]:
        if month < 1 or month > 12:
            return {
                "ok": False,
                "status": "invalid_month",
                "message": "month must be between 1 and 12",
            }
        budget_service = BudgetService(self.session, self.user_id)
        progress = budget_service.progress_for_month(year, month, as_of=self.today)
        budgets = []
        for budget in budget_service.effective_budgets_for_month(year, month):
            if category_id is not None and budget.scope_category_id != category_id:
                continue
            row_progress = progress.get(budget.scope_category_id, {})
            budgets.append(
                {
                    "scope_category_id": budget.scope_category_id,
                    "scope_label": budget.scope_label,
                    "amount_cents": budget.amount_cents,
                    "source": budget.source,
                    "source_id": budget.source_id,
                    **row_progress,
                }
            )
        return {
            "ok": True,
            "status": "ok",
            "year": year,
            "month": month,
            "as_of": self.today.isoformat(),
            "budgets": budgets,
        }

    def get_transaction_detail(self, *, transaction_id: int) -> dict[str, Any]:
        try:
            txn = TransactionService(self.session, self.user_id).get(transaction_id)
        except ValueError as exc:
            return {"ok": False, "status": "not_found", "message": str(exc)}

        reimbursement_service = ReimbursementService(self.session, self.user_id)
        if txn.type == TransactionType.expense:
            reimbursed = reimbursement_service.reimbursed_total_for_expense(txn.id)
            setattr(txn, "gross_amount_cents", int(txn.amount_cents))
            setattr(txn, "reimbursed_total_cents", reimbursed)
            setattr(txn, "net_amount_cents", max(0, int(txn.amount_cents) - reimbursed))
            allocations = [
                {
                    "id": allocation.id,
                    "amount_cents": allocation.amount_cents,
                    "reimbursement_transaction_id": allocation.reimbursement_transaction_id,
                    "reimbursement_title": allocation.reimbursement_transaction.title,
                    "reimbursement_date": allocation.reimbursement_transaction.date.isoformat(),
                }
                for allocation in reimbursement_service.allocations_for_expense(txn.id)
            ]
        elif txn.is_reimbursement:
            allocations = [
                {
                    "id": allocation.id,
                    "amount_cents": allocation.amount_cents,
                    "expense_transaction_id": allocation.expense_transaction_id,
                    "expense_title": allocation.expense_transaction.title,
                    "expense_date": allocation.expense_transaction.date.isoformat(),
                }
                for allocation in reimbursement_service.allocations_for_reimbursement(
                    txn.id
                )
            ]
        else:
            allocations = []

        return {
            "ok": True,
            "status": "ok",
            "transaction": _transaction_payload(txn),
            "reimbursement_allocations": allocations,
        }


class PydanticAISpendingRunner:
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.llm_enabled:
            raise LLMDisabledError("LLM usage is disabled")
        if not settings.llm_base_url:
            raise LLMDisabledError("EXPENSES_LLM_BASE_URL is not configured")
        self.model_name = settings.llm_model
        self.base_url = settings.llm_base_url
        self.api_key = settings.llm_api_key
        self.temperature = (
            settings.llm_temperature if settings.llm_temperature is not None else 0.2
        )
        self.max_tokens = settings.llm_max_output_tokens or 4_096

    async def stream_turn(
        self,
        *,
        request: SpendingChatRequest,
        analysis: SpendingAnalysisService,
        context: SpendingAgentContext,
    ) -> AsyncIterator[dict[str, Any] | SpendingAgentTurnResult]:
        try:
            from openai import omit
            from pydantic_ai import Agent, AgentRunResultEvent, Tool
            from pydantic_ai import UsageLimits, messages as pydantic_message
            from pydantic_ai.exceptions import AgentRunError, ModelAPIError
            from pydantic_ai.models.openai import OpenAIChatModel
            from pydantic_ai.providers.openai import OpenAIProvider
            from pydantic_ai.retries import (
                AsyncTenacityTransport,
                RetryConfig,
                wait_retry_after,
            )
            from pydantic_ai.settings import ModelSettings
        except ImportError as exc:
            raise LLMDisabledError("Install pydantic-ai to enable LLM usage") from exc

        usage_capture = OpenAICompatibleUsageCapture()
        http_client = _retrying_http_client(
            AsyncTenacityTransport=AsyncTenacityTransport,
            RetryConfig=RetryConfig,
            wait_retry_after=wait_retry_after,
            usage_capture=usage_capture,
        )
        model_settings = _request_model_settings(
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            api_key=self.api_key,
            reasoning_effort="medium",
            omit_authorization=omit,
        )
        model_settings["parallel_tool_calls"] = False
        model = OpenAIChatModel(
            self.model_name,
            provider=OpenAIProvider(
                base_url=self.base_url,
                api_key=self.api_key or None,
                http_client=http_client,
            ),
        )
        agent: Agent[SpendingAgentContext, str] = Agent(
            model=model,
            model_settings=ModelSettings(**model_settings),
            deps_type=SpendingAgentContext,
            output_type=str,
            tools=[
                Tool(
                    getattr(self, tool_name),
                    takes_ctx=True,
                    strict=True,
                    sequential=True,
                )
                for tool_name in SPENDING_TOOL_NAMES
            ],
            system_prompt=_SYSTEM_PROMPT,
        )

        @agent.instructions
        def runtime_instructions(ctx: RunContext[SpendingAgentContext]) -> str:
            return (
                f"Current date: {ctx.deps.today.isoformat()}.\n"
                f"Current timestamp: {ctx.deps.now.isoformat()}.\n"
                "Use these values to resolve relative periods such as this month, "
                "last month, last week, or today."
            )

        tool_names_by_call_id: dict[str, str] = {}
        streamed_text = ""
        try:
            history = pydantic_message.ModelMessagesTypeAdapter.validate_python(
                request.message_history
            )
            yield {"type": "turn_started", "turn_id": uuid4().hex}
            async for event in agent.run_stream_events(
                request.current_message,
                deps=context,
                message_history=history,
                usage_limits=UsageLimits(request_limit=16, tool_calls_limit=16),
            ):
                match event:
                    case pydantic_message.FunctionToolCallEvent(part=part):
                        tool_names_by_call_id[part.tool_call_id] = part.tool_name
                        yield {
                            "type": "tool_call_start",
                            "tool_call_id": part.tool_call_id,
                            "tool_name": part.tool_name,
                            "arguments": part.args_as_dict(),
                        }
                    case pydantic_message.FunctionToolResultEvent(part=part):
                        tool_name = part.tool_name or tool_names_by_call_id.get(
                            part.tool_call_id
                        )
                        if tool_name is None:
                            raise SpendingChatError("Tool result without tool name")
                        if isinstance(part, pydantic_message.RetryPromptPart):
                            result_preview = part.model_response()
                            success = False
                        else:
                            result_preview = part.model_response_str()
                            success = part.outcome == "success" and not (
                                isinstance(part.content, dict)
                                and part.content.get("ok") is False
                            )
                        yield {
                            "type": "tool_call_end",
                            "tool_call_id": part.tool_call_id,
                            "tool_name": tool_name,
                            "result_preview": result_preview[:500],
                            "success": success,
                        }
                    case pydantic_message.PartStartEvent(
                        part=pydantic_message.TextPart(content=content)
                    ):
                        if content:
                            streamed_text += content
                            yield {"type": "text_chunk", "content": content}
                    case pydantic_message.PartDeltaEvent(
                        delta=pydantic_message.TextPartDelta(
                            content_delta=content_delta
                        )
                    ):
                        if content_delta:
                            streamed_text += content_delta
                            yield {"type": "text_chunk", "content": content_delta}
                    case AgentRunResultEvent(result=result):
                        if streamed_text:
                            yield {"type": "text_commit"}
                        messages = result.all_messages()
                        usage_metadata = usage_metadata_from_result(
                            usage=result.usage,
                            messages=messages,
                            base_url=self.base_url,
                            configured_model=self.model_name,
                        )
                        usage_metadata = apply_captured_provider_usage(
                            usage_metadata, usage_capture
                        )
                        usage_metadata = await enrich_openrouter_generation_usage(
                            usage_metadata,
                            http_client=http_client,
                            api_key=self.api_key,
                            base_url=self.base_url,
                        )
                        yield SpendingAgentTurnResult(
                            assistant_message=result.output.strip(),
                            message_history=json.loads(
                                pydantic_message.ModelMessagesTypeAdapter.dump_json(
                                    messages
                                )
                            ),
                            usage_input_tokens=usage_metadata.input_tokens,
                            usage_output_tokens=usage_metadata.output_tokens,
                            usage_total_tokens=usage_metadata.total_tokens,
                            usage_cached_input_tokens=usage_metadata.cached_input_tokens,
                            usage_cache_write_tokens=usage_metadata.cache_write_tokens,
                            usage_reasoning_tokens=usage_metadata.reasoning_tokens,
                            usage_request_count=usage_metadata.request_count,
                            usage_tool_call_count=usage_metadata.tool_call_count,
                            usage_cost_decimal=usage_metadata.cost_decimal,
                            usage_cost_unit=usage_metadata.cost_unit,
                            llm_provider=usage_metadata.llm_provider,
                            provider_name=usage_metadata.provider_name,
                            provider_model=usage_metadata.provider_model,
                            provider_response_id=usage_metadata.provider_response_id,
                            provider_request_id=usage_metadata.provider_request_id,
                            provider_usage_json=usage_metadata.provider_usage_json,
                        )
                        return
        except (AgentRunError, ModelAPIError) as exc:
            raise SpendingChatError(
                "The spending assistant is temporarily unavailable"
            ) from exc
        finally:
            await http_client.aclose()

        raise SpendingChatError("LLM response could not be completed")

    def get_spending_overview(
        self, ctx: RunContext[SpendingAgentContext], start: date, end: date
    ) -> dict[str, Any]:
        """Summarize net income, net expenses, and category spending for a period."""
        return ctx.deps.analysis.get_spending_overview(start=start, end=end)

    def compare_spending_periods(
        self,
        ctx: RunContext[SpendingAgentContext],
        current_start: date,
        current_end: date,
        baseline_start: date,
        baseline_end: date,
    ) -> dict[str, Any]:
        """Compare net spending totals and category deltas between two periods."""
        return ctx.deps.analysis.compare_spending_periods(
            current_start=current_start,
            current_end=current_end,
            baseline_start=baseline_start,
            baseline_end=baseline_end,
        )

    def breakdown_spending(
        self,
        ctx: RunContext[SpendingAgentContext],
        start: date,
        end: date,
        group_by: Literal["category", "tag", "month"] = "category",
        category_id: int | None = None,
        tag_id: int | None = None,
        limit: int = 12,
    ) -> dict[str, Any]:
        """Break spending down by category, tag, or month for a period."""
        return ctx.deps.analysis.breakdown_spending(
            start=start,
            end=end,
            group_by=group_by,
            category_id=category_id,
            tag_id=tag_id,
            limit=limit,
        )

    def search_transactions(
        self,
        ctx: RunContext[SpendingAgentContext],
        query: str | None = None,
        start: date | None = None,
        end: date | None = None,
        category_id: int | None = None,
        tag_id: int | None = None,
        transaction_type: Literal["expense", "income"] | None = None,
        sort: Literal["date_desc", "amount_desc"] = "date_desc",
        limit: int = 20,
    ) -> dict[str, Any]:
        """Find transactions by period, query, category, tag, type, and sort order."""
        return ctx.deps.analysis.search_transactions(
            query=query,
            start=start,
            end=end,
            category_id=category_id,
            tag_id=tag_id,
            transaction_type=transaction_type,
            sort=sort,
            limit=limit,
        )

    def get_budget_context(
        self,
        ctx: RunContext[SpendingAgentContext],
        year: int,
        month: int,
        category_id: int | None = None,
    ) -> dict[str, Any]:
        """Return effective monthly budgets and progress for a month."""
        return ctx.deps.analysis.get_budget_context(
            year=year, month=month, category_id=category_id
        )

    def get_transaction_detail(
        self, ctx: RunContext[SpendingAgentContext], transaction_id: int
    ) -> dict[str, Any]:
        """Return one transaction with category, tags, net amount, and reimbursements."""
        return ctx.deps.analysis.get_transaction_detail(transaction_id=transaction_id)


class SpendingChatService:
    def __init__(
        self,
        session: Session,
        *,
        user_id: int,
        runner: SpendingChatRunner | None = None,
        today: date | None = None,
        now: datetime | None = None,
    ) -> None:
        self.session = session
        self.user_id = user_id
        self.runner = runner or PydanticAISpendingRunner()
        self.today = today or date.today()
        self.now = now or datetime.now(UTC)

    async def stream_turn(
        self, *, request: SpendingChatRequest
    ) -> AsyncIterator[dict[str, Any]]:
        payload = request.model_dump(mode="json")
        input_json = _json_dumps(payload)
        settings = get_settings()
        job = LLMJob(
            user_id=self.user_id,
            feature="spending_chat",
            status="running",
            prompt_version="spending_chat",
            model=settings.llm_model,
            input_hash=hashlib.sha256(input_json.encode("utf-8")).hexdigest(),
            input_json=input_json,
            created_at=datetime.utcnow(),
            started_at=datetime.utcnow(),
        )
        self.session.add(job)
        self.session.flush()
        log_event(
            logger,
            logging.INFO,
            "llm_chat_started",
            job_id=job.id,
            feature=job.feature,
            model=job.model,
            message_count=len(request.messages),
            message_history_count=len(request.message_history),
        )
        start = perf_counter()
        analysis = SpendingAnalysisService(
            self.session, user_id=self.user_id, today=self.today
        )
        context = SpendingAgentContext(
            analysis=analysis, user_id=self.user_id, today=self.today, now=self.now
        )
        result_seen = False
        streamed_tool_call_count = 0
        try:
            async for event in self.runner.stream_turn(
                request=request, analysis=analysis, context=context
            ):
                if isinstance(event, SpendingAgentTurnResult):
                    result_seen = True
                    job.status = "completed"
                    job.output_json = chat_output_trace(
                        event.assistant_message, event.message_history
                    )
                    usage_metadata = LLMUsageMetadata(
                        input_tokens=event.usage_input_tokens,
                        output_tokens=event.usage_output_tokens,
                        total_tokens=event.usage_total_tokens,
                        cached_input_tokens=event.usage_cached_input_tokens,
                        cache_write_tokens=event.usage_cache_write_tokens,
                        reasoning_tokens=event.usage_reasoning_tokens,
                        request_count=event.usage_request_count,
                        tool_call_count=event.usage_tool_call_count
                        or streamed_tool_call_count
                        or None,
                        cost_decimal=event.usage_cost_decimal,
                        cost_unit=event.usage_cost_unit,
                        llm_provider=event.llm_provider,
                        provider_name=event.provider_name,
                        provider_model=event.provider_model,
                        provider_response_id=event.provider_response_id,
                        provider_request_id=event.provider_request_id,
                        provider_usage_json=event.provider_usage_json,
                    )
                    apply_usage_metadata(job, usage_metadata)
                    job.finished_at = datetime.utcnow()
                    job.duration_ms = int((perf_counter() - start) * 1000)
                    self.session.commit()
                    log_event(
                        logger,
                        logging.INFO,
                        "llm_chat_completed",
                        job_id=job.id,
                        feature=job.feature,
                        model=job.model,
                        duration_ms=job.duration_ms,
                        usage_input_tokens=job.usage_input_tokens,
                        usage_output_tokens=job.usage_output_tokens,
                        usage_total_tokens=job.usage_total_tokens,
                        usage_cached_input_tokens=job.usage_cached_input_tokens,
                        usage_reasoning_tokens=job.usage_reasoning_tokens,
                        usage_cost_decimal=job.usage_cost_decimal,
                        usage_cost_unit=job.usage_cost_unit,
                        usage_tool_call_count=job.usage_tool_call_count,
                        provider_response_id=job.provider_response_id,
                        provider_request_id=job.provider_request_id,
                    )
                    yield {
                        "type": "result",
                        "assistant_message": event.assistant_message,
                        "message_history": event.message_history,
                    }
                    continue
                if isinstance(event, dict) and event.get("type") == "tool_call_start":
                    streamed_tool_call_count += 1
                yield event
        except asyncio.CancelledError:
            job.status = "failed"
            job.error = "stream_cancelled"
            job.finished_at = datetime.utcnow()
            job.duration_ms = int((perf_counter() - start) * 1000)
            self.session.commit()
            log_event(
                logger,
                logging.WARNING,
                "llm_chat_cancelled",
                job_id=job.id,
                feature=job.feature,
                model=job.model,
                duration_ms=job.duration_ms,
                usage_tool_call_count=streamed_tool_call_count or None,
            )
            raise
        except LLMDisabledError:
            self.session.rollback()
            raise
        except SpendingChatError as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = datetime.utcnow()
            job.duration_ms = int((perf_counter() - start) * 1000)
            self.session.commit()
            log_event(
                logger,
                logging.ERROR,
                "llm_chat_failed",
                job_id=job.id,
                feature=job.feature,
                model=job.model,
                duration_ms=job.duration_ms,
                usage_tool_call_count=streamed_tool_call_count or None,
                error=str(exc),
            )
            raise
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = datetime.utcnow()
            job.duration_ms = int((perf_counter() - start) * 1000)
            self.session.commit()
            log_event(
                logger,
                logging.ERROR,
                "llm_chat_failed",
                job_id=job.id,
                feature=job.feature,
                model=job.model,
                duration_ms=job.duration_ms,
                usage_tool_call_count=streamed_tool_call_count or None,
                error=str(exc),
            )
            raise SpendingChatError(
                "The spending assistant is temporarily unavailable"
            ) from exc

        if not result_seen:
            job.status = "failed"
            job.error = "missing_result"
            job.finished_at = datetime.utcnow()
            job.duration_ms = int((perf_counter() - start) * 1000)
            self.session.commit()
            log_event(
                logger,
                logging.ERROR,
                "llm_chat_failed",
                job_id=job.id,
                feature=job.feature,
                model=job.model,
                duration_ms=job.duration_ms,
                usage_tool_call_count=streamed_tool_call_count or None,
                error="missing_result",
            )
            raise SpendingChatError("LLM response could not be completed")
