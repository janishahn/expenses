from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal

from pydantic_ai import RunContext
from sqlalchemy.orm import Session

from expenses.core.periods import Period
from expenses.db.models import Category, Transaction, TransactionType
from expenses.services import (
    BudgetService,
    MetricsService,
    ReimbursementService,
    TransactionFilters,
    TransactionService,
)

INSTRUCTIONS = """
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
- Before calling tools you may say in one short sentence what you are checking.
  Start the final answer with the answer itself.
- Never use emoji.
""".strip()


@dataclass(frozen=True)
class SpendingAgentContext:
    analysis: "SpendingAnalysisService"
    user_id: int
    today: date
    now: datetime


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
    gross = int(txn.gross_amount_cents)
    reimbursed = int(txn.reimbursed_total_cents)
    net = int(txn.net_amount_cents)
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


def _eur(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}€{abs(cents) / 100:,.2f}"


TOOL_LABELS = {
    "get_spending_overview": "Spending overview",
    "compare_spending_periods": "Period comparison",
    "breakdown_spending": "Spending breakdown",
    "search_transactions": "Transaction search",
    "get_budget_context": "Budgets",
    "get_transaction_detail": "Transaction details",
}


def tool_detail(tool_name: str, content: dict[str, Any]) -> str | None:
    match tool_name:
        case "get_spending_overview":
            totals = content["totals"]
            return (
                f"{_eur(int(totals['expense_cents']))} spent · "
                f"{_eur(int(totals['income_cents']))} income"
            )
        case "compare_spending_periods":
            totals = content["totals"]
            delta = int(totals["expense_delta_cents"])
            if delta == 0:
                delta_text = "unchanged"
            elif delta > 0:
                delta_text = f"+{_eur(delta)}"
            else:
                delta_text = _eur(delta)
            return (
                f"{_eur(int(totals['current_expense_cents']))} vs "
                f"{_eur(int(totals['baseline_expense_cents']))} · {delta_text}"
            )
        case "breakdown_spending":
            singular, plural = {
                "category": ("category", "categories"),
                "tag": ("tag", "tags"),
                "month": ("month", "months"),
            }[content["group_by"]]
            group_count = len(content["rows"])
            txn_count = int(content["transaction_count"])
            group_text = f"{group_count} {singular if group_count == 1 else plural}"
            txn_text = f"{txn_count} transaction{'' if txn_count == 1 else 's'}"
            return f"{group_text} · {txn_text}"
        case "search_transactions":
            count = int(content["count"])
            if count == 0:
                return "No matches"
            label = "1 match" if count == 1 else f"{count} matches"
            if not content["truncated"]:
                total = sum(
                    int(txn["net_amount_cents"]) for txn in content["transactions"]
                )
                label += f" · {_eur(total)} total"
            return label
        case "get_budget_context":
            budgets = content["budgets"]
            if not budgets:
                return "No budgets set"
            label = "1 budget" if len(budgets) == 1 else f"{len(budgets)} budgets"
            over = sum(1 for row in budgets if int(row["remaining_cents"]) < 0)
            if over:
                label += f" · {over} over limit"
            return label
        case "get_transaction_detail":
            txn = content["transaction"]
            return (
                f"{txn['title'] or 'Untitled'} · {_eur(int(txn['net_amount_cents']))}"
            )
        case _:
            return None


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

        if group_by == "category":
            rows = MetricsService(self.session, self.user_id).category_breakdown(
                period,
                TransactionType.expense,
                category_ids=[category_id] if category_id is not None else None,
                tag_ids=[tag_id] if tag_id is not None else None,
                limit=limit,
            )
            return {
                "ok": True,
                "status": "ok",
                "group_by": group_by,
                "period": {"start": start.isoformat(), "end": end.isoformat()},
                "transaction_count": total_count,
                "candidate_truncated": False,
                "rows": rows,
            }

        transactions = transaction_service.list_for_period(period, filters, limit=5_000)
        transaction_rows = [_transaction_payload(txn) for txn in transactions]

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

        filters = TransactionFilters(
            type=TransactionType(transaction_type) if transaction_type else None,
            category_id=category_id,
            tag_id=tag_id,
            query=query,
        )
        transaction_service = TransactionService(self.session, self.user_id)
        count = transaction_service.count_for_period(period, filters)
        limit = _bounded_limit(limit)
        candidate_limit = (
            limit if sort == "date_desc" else min(max(limit * 20, 250), 5_000)
        )
        transactions = transaction_service.list_for_period(
            period,
            filters,
            limit=candidate_limit,
            order_by_amount=sort == "amount_desc",
        )
        if sort == "amount_desc":
            transactions.sort(
                key=lambda txn: int(txn.net_amount_cents),
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
        gross = int(txn.amount_cents)
        reimbursed = 0
        if txn.type == TransactionType.expense:
            reimbursed = reimbursement_service.reimbursed_total_for_expense(txn.id)
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

        setattr(txn, "gross_amount_cents", gross)
        setattr(txn, "reimbursed_total_cents", reimbursed)
        setattr(
            txn,
            "net_amount_cents",
            max(0, gross - reimbursed)
            if txn.type == TransactionType.expense
            else gross,
        )

        return {
            "ok": True,
            "status": "ok",
            "transaction": _transaction_payload(txn),
            "reimbursement_allocations": allocations,
        }


def get_spending_overview(
    ctx: RunContext[SpendingAgentContext], start: date, end: date
) -> dict[str, Any]:
    """Summarize net income, net expenses, and category spending for a period."""
    return ctx.deps.analysis.get_spending_overview(start=start, end=end)


def compare_spending_periods(
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
    ctx: RunContext[SpendingAgentContext], transaction_id: int
) -> dict[str, Any]:
    """Return one transaction with category, tags, net amount, and reimbursements."""
    return ctx.deps.analysis.get_transaction_detail(transaction_id=transaction_id)


SPENDING_TOOLS = [
    get_spending_overview,
    compare_spending_periods,
    breakdown_spending,
    search_transactions,
    get_budget_context,
    get_transaction_detail,
]
