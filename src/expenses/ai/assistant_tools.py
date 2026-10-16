"""Read tools the Assistant uses to answer questions about the user's money."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Literal

from pydantic_ai import RunContext
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased, joinedload, selectinload

from expenses.core.periods import Period, month_end
from expenses.db.models import (
    AssistantAction,
    Category,
    ReimbursementAllocation,
    Tag,
    Transaction,
    TransactionType,
    transaction_tags,
)
from expenses.services import (
    BalanceAnchorService,
    BudgetService,
    DurablePurchaseService,
    ForecastService,
    MetricsService,
    RecurringRuleService,
    ReimbursementService,
    TransactionFilters,
    TransactionService,
)

INSTRUCTIONS = """
You are the Assistant in Expenses, a personal finance app. You can read the user's
transactions, budgets, recurring payments, forecast, balance history,
reimbursements, and durable purchases. You can also propose changes: new
transactions, new categories, tags, or titles for existing ones, reimbursement
allocations, and monthly budgets.

Use the tools before you state amounts, categories, budgets, or transactions. When
the user asks what drove spending, prefer transaction-level evidence over category
totals. Use ids to call tools and in transaction links; never write an id as text.
If a tool returns ok: false, explain the limitation and ask for what is missing
instead of guessing.

Changing data:
- Propose a change only when the user asks for one. Find the exact transactions
  with the read tools first, and ask when the request is ambiguous.
- A proposal shows the user an approval card and ends your turn; nothing changes
  until they approve it. Do not describe the change as done or repeat the card.
- Propose one change at a time. The tool result tells you whether the user
  approved it (status applied), dismissed it, or the data changed meanwhile
  (status conflict). Confirm an applied change in one short sentence.
- To undo a change, call undo_action with its action_id. You cannot delete
  transactions, change the amount or date of existing ones, or change settings.

How the amounts work:
- Tool amounts are euro cents.
- Expenses are net: a reimbursement allocated to an expense lowers that expense.
  Reimbursements are not income.
- Write amounts the way the app does: a space between thousands, a comma before
  the cents, and the euro sign after the number, for example 1 234,56 €. Do not use
  dollars unless a transaction says it was in USD.

Output rules:
- Keep answers compact: one short paragraph, then a bullet list when useful.
- List transactions or changes as bullets, not tables. Use a markdown table only
  when the user asks for one.
- When you name a transaction a tool returned, link its title with its id so the
  user can open it: [Lunch](transaction:123). Link only ids a tool returned.
- Before calling tools you may say in one short sentence what you are checking.
  Start the final answer with the answer itself.
- Never use emoji.
""".strip()

# Prompt space for the category and tag lists stays bounded.
CATALOG_LIMIT = 200
RECENT_ACTIONS = 10

Kind = Literal["expense", "income", "reimbursement"]
GroupBy = Literal["none", "category", "tag", "month", "week", "weekday", "title"]
Sort = Literal["date_desc", "date_asc", "amount_desc", "amount_asc"]

WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
]
GROUP_NOUNS = {
    "category": ("category", "categories"),
    "tag": ("tag", "tags"),
    "month": ("month", "months"),
    "week": ("week", "weeks"),
    "weekday": ("weekday", "weekdays"),
    "title": ("merchant", "merchants"),
}


def _invalid(status: str, message: str) -> dict[str, Any]:
    return {"ok": False, "status": status, "message": message}


def _bounded(value: int, *, default: int, maximum: int) -> int:
    return default if value <= 0 else min(value, maximum)


def _kind(txn: Transaction) -> Kind:
    if txn.type == TransactionType.expense:
        return "expense"
    return "reimbursement" if txn.is_reimbursement else "income"


def _transaction_row(txn: Transaction) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": txn.id,
        "date": txn.date.isoformat(),
        "kind": _kind(txn),
        "title": txn.title,
        "net_cents": int(txn.net_amount_cents),
        "category": {"id": txn.category.id, "name": txn.category.name},
        "tags": [tag.name for tag in txn.tags],
    }
    if int(txn.reimbursed_total_cents):
        row["gross_cents"] = int(txn.gross_amount_cents)
        row["reimbursed_cents"] = int(txn.reimbursed_total_cents)
    if txn.description:
        row["description"] = txn.description[:200]
    return row


@dataclass(frozen=True)
class TransactionScope:
    kind: Kind
    category_ids: list[int] | None
    tag_ids: list[int] | None
    exclude_tag_ids: list[int] | None
    text: str | None
    min_amount_cents: int | None
    max_amount_cents: int | None


class AssistantReader:
    """Read-only queries over one user's data, shaped for the model."""

    def __init__(self, session: Session, *, user_id: int, now: datetime) -> None:
        self.session = session
        self.user_id = user_id
        self.now = now
        self.today = now.date()

    def reference(self) -> str:
        """The date, categories, and tags the model needs to call tools."""
        categories = self.session.scalars(
            select(Category)
            .where(Category.user_id == self.user_id)
            .order_by(Category.archived_at.is_not(None), Category.type, Category.order)
            .limit(CATALOG_LIMIT)
        ).all()
        tags = self.session.scalars(
            select(Tag)
            .where(Tag.user_id == self.user_id)
            .order_by(Tag.archived_at.is_not(None), Tag.name)
            .limit(CATALOG_LIMIT)
        ).all()
        lines = [
            f"Today is {self.today:%A}, {self.today.isoformat()}. Resolve relative "
            "periods such as this month or last week from this date.",
            "",
            "Categories (id: name, type):",
        ]
        lines += [
            f"- {category.id}: {category.name}, {category.type.value}"
            + (", archived" if category.archived_at else "")
            for category in categories
        ]
        lines += ["", "Tags (id: name):"]
        lines += [
            f"- {tag.id}: {tag.name}" + (", archived" if tag.archived_at else "")
            for tag in tags
        ] or ["- none"]
        actions = self.session.scalars(
            select(AssistantAction)
            .where(
                AssistantAction.user_id == self.user_id,
                AssistantAction.status.in_(("applied", "undone")),
            )
            .order_by(AssistantAction.decided_at.desc())
            .limit(RECENT_ACTIONS)
        ).all()
        if actions:
            lines += ["", "Changes you made recently (action_id: summary, date):"]
            lines += [
                f"- {action.id}: {action.summary}, {action.decided_at:%Y-%m-%d}"
                + (", undone" if action.status == "undone" else "")
                for action in actions
            ]
        return "\n".join(lines)

    def _reimbursed(self):
        """Cents allocated to each expense from active reimbursements."""
        reimbursement = aliased(Transaction)
        return (
            select(
                ReimbursementAllocation.expense_transaction_id.label("expense_id"),
                func.sum(ReimbursementAllocation.amount_cents).label("cents"),
            )
            .join(
                reimbursement,
                ReimbursementAllocation.reimbursement_transaction_id
                == reimbursement.id,
            )
            .where(
                ReimbursementAllocation.user_id == self.user_id,
                reimbursement.user_id == self.user_id,
                reimbursement.deleted_at.is_(None),
                reimbursement.type == TransactionType.income,
                reimbursement.is_reimbursement.is_(True),
            )
            .group_by(ReimbursementAllocation.expense_transaction_id)
            .subquery()
        )

    def _scoped(self, stmt, scope: TransactionScope, start: date, end: date):
        stmt = stmt.where(
            Transaction.user_id == self.user_id,
            Transaction.deleted_at.is_(None),
            Transaction.date.between(start, end),
        )
        match scope.kind:
            case "expense":
                stmt = stmt.where(Transaction.type == TransactionType.expense)
            case "income":
                stmt = stmt.where(
                    Transaction.type == TransactionType.income,
                    Transaction.is_reimbursement.is_(False),
                )
            case "reimbursement":
                stmt = stmt.where(
                    Transaction.type == TransactionType.income,
                    Transaction.is_reimbursement.is_(True),
                )
        if scope.min_amount_cents is not None:
            stmt = stmt.where(Transaction.amount_cents >= scope.min_amount_cents)
        if scope.max_amount_cents is not None:
            stmt = stmt.where(Transaction.amount_cents <= scope.max_amount_cents)
        # The app's own filters keep search and tag matching identical to the ledger.
        return TransactionService(self.session, self.user_id)._apply_filters(
            stmt,
            TransactionFilters(
                matched_category_ids=scope.category_ids or None,
                tag_ids=tuple(scope.tag_ids or ()),
                excluded_tag_ids=tuple(scope.exclude_tag_ids or ()),
                query=scope.text,
            ),
        )

    def _totals(
        self, scope: TransactionScope, start: date, end: date
    ) -> dict[str, int]:
        reimbursed = self._reimbursed()
        stmt = (
            select(
                func.count(Transaction.id),
                func.coalesce(func.sum(Transaction.amount_cents), 0),
                func.coalesce(func.sum(reimbursed.c.cents), 0),
            )
            .select_from(Transaction)
            .outerjoin(reimbursed, reimbursed.c.expense_id == Transaction.id)
        )
        count, gross, reimbursed_cents = self.session.execute(
            self._scoped(stmt, scope, start, end)
        ).one()
        return {
            "count": int(count),
            "net_cents": int(gross) - int(reimbursed_cents),
            "gross_cents": int(gross),
            "reimbursed_cents": int(reimbursed_cents),
        }

    def _groups(
        self, scope: TransactionScope, start: date, end: date, group_by: GroupBy
    ) -> dict[str | None, dict[str, Any]]:
        reimbursed = self._reimbursed()
        net = Transaction.amount_cents - func.coalesce(reimbursed.c.cents, 0)
        match group_by:
            case "category":
                key = Transaction.category_id
                label = func.max(Category.name)
            case "tag":
                key = Tag.id
                label = func.max(Tag.name)
            case "month":
                key = func.strftime("%Y-%m", Transaction.date)
                label = key
            case "week":
                # The Monday that starts the week.
                key = func.date(Transaction.date, "weekday 0", "-6 days")
                label = key
            case "weekday":
                key = func.strftime("%w", Transaction.date)
                label = key
            case "title":
                key = func.lower(func.trim(func.coalesce(Transaction.title, "")))
                label = func.max(Transaction.title)
            case "none":
                raise ValueError("group_by none has no groups")
        stmt = (
            select(
                key.label("key"),
                label.label("label"),
                func.count(Transaction.id),
                func.sum(net),
            )
            .select_from(Transaction)
            .outerjoin(reimbursed, reimbursed.c.expense_id == Transaction.id)
        )
        if group_by == "category":
            stmt = stmt.join(Category, Category.id == Transaction.category_id)
        elif group_by == "tag":
            stmt = stmt.outerjoin(
                transaction_tags, transaction_tags.c.transaction_id == Transaction.id
            ).outerjoin(Tag, Tag.id == transaction_tags.c.tag_id)
        stmt = self._scoped(stmt, scope, start, end).group_by(key)
        groups: dict[str | None, dict[str, Any]] = {}
        for group_key, group_label, count, net_cents in self.session.execute(stmt):
            if group_by == "weekday":
                group_label = WEEKDAYS[int(group_key)]
            elif group_by == "tag" and group_key is None:
                group_label = "No tag"
            elif group_by == "title" and not group_label:
                group_label = "Untitled"
            groups[None if group_key is None else str(group_key)] = {
                "key": None if group_key is None else str(group_key),
                "label": group_label,
                "count": int(count),
                "net_cents": int(net_cents or 0),
            }
        return groups

    def query_transactions(
        self,
        *,
        start: date,
        end: date,
        kind: Kind = "expense",
        category_ids: list[int] | None = None,
        tag_ids: list[int] | None = None,
        exclude_tag_ids: list[int] | None = None,
        text: str | None = None,
        min_amount_cents: int | None = None,
        max_amount_cents: int | None = None,
        group_by: GroupBy = "none",
        sort: Sort = "date_desc",
        limit: int = 25,
        offset: int = 0,
        compare_start: date | None = None,
        compare_end: date | None = None,
    ) -> dict[str, Any]:
        if start > end:
            return _invalid("invalid_period", "start must be on or before end")
        if (compare_start is None) != (compare_end is None):
            return _invalid(
                "invalid_comparison", "Give both compare_start and compare_end."
            )
        if compare_start is not None and compare_end is not None:
            if compare_start > compare_end:
                return _invalid(
                    "invalid_comparison",
                    "compare_start must be on or before compare_end",
                )
        limit = _bounded(limit, default=25, maximum=100)
        offset = max(0, offset)
        scope = TransactionScope(
            kind=kind,
            category_ids=category_ids,
            tag_ids=tag_ids,
            exclude_tag_ids=exclude_tag_ids,
            text=text,
            min_amount_cents=min_amount_cents,
            max_amount_cents=max_amount_cents,
        )
        totals = self._totals(scope, start, end)
        result: dict[str, Any] = {
            "ok": True,
            "period": {"start": start.isoformat(), "end": end.isoformat()},
            "kind": kind,
            "totals": totals,
        }
        baseline_totals = None
        if compare_start is not None and compare_end is not None:
            baseline_totals = self._totals(scope, compare_start, compare_end)
            result["baseline"] = {
                "period": {
                    "start": compare_start.isoformat(),
                    "end": compare_end.isoformat(),
                },
                "totals": baseline_totals,
                "net_delta_cents": totals["net_cents"] - baseline_totals["net_cents"],
            }

        if group_by == "none":
            reimbursed = self._reimbursed()
            net = Transaction.amount_cents - func.coalesce(reimbursed.c.cents, 0)
            order = {
                "date_desc": (
                    Transaction.date.desc(),
                    Transaction.occurred_at.desc(),
                    Transaction.id.desc(),
                ),
                "date_asc": (
                    Transaction.date,
                    Transaction.occurred_at,
                    Transaction.id,
                ),
                "amount_desc": (net.desc(), Transaction.id.desc()),
                "amount_asc": (net, Transaction.id),
            }[sort]
            stmt = (
                select(Transaction)
                .options(
                    joinedload(Transaction.category), selectinload(Transaction.tags)
                )
                .outerjoin(reimbursed, reimbursed.c.expense_id == Transaction.id)
            )
            stmt = self._scoped(stmt, scope, start, end).order_by(*order)
            transactions = list(
                self.session.scalars(stmt.offset(offset).limit(limit + 1)).unique()
            )
            has_more = len(transactions) > limit
            transactions = transactions[:limit]
            TransactionService(self.session, self.user_id).hydrate_reimbursement_totals(
                transactions
            )
            result["transactions"] = [_transaction_row(txn) for txn in transactions]
            if has_more:
                result["next_offset"] = offset + limit
            return result

        groups = self._groups(scope, start, end, group_by)
        rows = list(groups.values())
        chronological = group_by in ("month", "week", "weekday")
        if chronological:
            # Weeks start on Monday.
            rows.sort(
                key=lambda row: (row["key"] == "0", row["key"])
                if group_by == "weekday"
                else row["key"]
            )
        elif baseline_totals is not None and compare_start and compare_end:
            baseline_groups = self._groups(scope, compare_start, compare_end, group_by)
            for key, baseline in baseline_groups.items():
                if key not in groups:
                    rows.append({**baseline, "count": 0, "net_cents": 0})
            for row in rows:
                baseline_net = baseline_groups.get(row["key"], {}).get("net_cents", 0)
                row["baseline_net_cents"] = baseline_net
                row["delta_cents"] = row["net_cents"] - baseline_net
            rows.sort(key=lambda row: abs(row["delta_cents"]), reverse=True)
        else:
            rows.sort(key=lambda row: row["net_cents"], reverse=True)
        if totals["net_cents"] > 0:
            for row in rows:
                row["share_percent"] = round(
                    row["net_cents"] / totals["net_cents"] * 100, 1
                )
        shown = rows[-limit:] if chronological else rows[:limit]
        result["group_by"] = group_by
        result["groups"] = shown
        if len(rows) > len(shown):
            result["more_groups"] = len(rows) - len(shown)
        return result

    def get_period_summary(self, *, start: date, end: date) -> dict[str, Any]:
        if start > end:
            return _invalid("invalid_period", "start must be on or before end")
        metrics = MetricsService(self.session, self.user_id)
        current = metrics.kpis(Period("agent", start, end))
        days = (end - start).days + 1
        previous_end = start - timedelta(days=1)
        previous_start = previous_end - timedelta(days=days - 1)
        previous = metrics.kpis(Period("agent_previous", previous_start, previous_end))
        net = current["income"] - current["expenses"]
        return {
            "ok": True,
            "period": {"start": start.isoformat(), "end": end.isoformat()},
            "income_cents": current["income"],
            "expense_cents": current["expenses"],
            "net_cents": net,
            "savings_rate_percent": round(net / current["income"] * 100, 1)
            if current["income"] > 0
            else None,
            "balance_at_end_cents": current["balance"],
            "previous_period": {
                "start": previous_start.isoformat(),
                "end": previous_end.isoformat(),
                "income_cents": previous["income"],
                "expense_cents": previous["expenses"],
            },
        }

    def get_budgets(
        self, *, year: int, month: int, category_id: int | None = None
    ) -> dict[str, Any]:
        if month < 1 or month > 12:
            return _invalid("invalid_month", "month must be between 1 and 12")
        budget_service = BudgetService(self.session, self.user_id)
        progress = budget_service.progress_for_month(year, month, as_of=self.today)
        budgets = []
        for budget in budget_service.effective_budgets_for_month(year, month):
            if category_id is not None and budget.scope_category_id != category_id:
                continue
            budgets.append(
                {
                    "scope_category_id": budget.scope_category_id,
                    "scope_label": budget.scope_label,
                    "amount_cents": budget.amount_cents,
                    "source": budget.source,
                    **progress.get(budget.scope_category_id, {}),
                }
            )
        return {
            "ok": True,
            "year": year,
            "month": month,
            "as_of": self.today.isoformat(),
            "budgets": budgets,
        }

    def get_transaction(self, *, transaction_id: int) -> dict[str, Any]:
        try:
            txn = TransactionService(self.session, self.user_id).get(transaction_id)
        except ValueError as exc:
            return _invalid("not_found", str(exc))
        TransactionService(self.session, self.user_id).hydrate_reimbursement_totals(
            [txn]
        )
        row = _transaction_row(txn)
        if txn.source_currency_code is not None:
            row["source_currency"] = txn.source_currency_code.value
            row["source_amount_cents"] = txn.source_amount_cents
        if txn.origin_rule is not None:
            row["recurring_rule"] = {
                "id": txn.origin_rule.id,
                "name": txn.origin_rule.name,
            }
        reimbursements = ReimbursementService(self.session, self.user_id)
        if txn.type == TransactionType.expense:
            row["reimbursed_by"] = [
                {
                    "transaction_id": allocation.reimbursement_transaction_id,
                    "title": allocation.reimbursement_transaction.title,
                    "date": allocation.reimbursement_transaction.date.isoformat(),
                    "amount_cents": allocation.amount_cents,
                }
                for allocation in reimbursements.allocations_for_expense(txn.id)
            ]
        elif txn.is_reimbursement:
            row["allocated_to"] = [
                {
                    "transaction_id": allocation.expense_transaction_id,
                    "title": allocation.expense_transaction.title,
                    "date": allocation.expense_transaction.date.isoformat(),
                    "amount_cents": allocation.amount_cents,
                }
                for allocation in reimbursements.allocations_for_reimbursement(txn.id)
            ]
        return {"ok": True, "transaction": row}

    def list_recurring(self) -> dict[str, Any]:
        rules, totals = RecurringRuleService(self.session, self.user_id).overview()
        return {
            "ok": True,
            "monthly_income_cents": totals["total_monthly_income"],
            "monthly_expense_cents": totals["total_monthly_expenses"],
            "rules": [
                {
                    "id": item.rule.id,
                    "name": item.rule.name or item.rule.category.name,
                    "kind": item.rule.type.value,
                    "amount_cents": item.rule.amount_cents,
                    "currency": item.rule.currency_code.value,
                    "every": f"{item.rule.interval_count} {item.rule.interval_unit.value}",
                    "next_date": item.rule.next_occurrence.isoformat(),
                    "end_date": item.rule.end_date.isoformat()
                    if item.rule.end_date
                    else None,
                    "monthly_equivalent_cents": item.monthly_equivalent_cents,
                    "category": item.rule.category.name,
                    "posts_automatically": item.rule.auto_post,
                }
                for item in rules
            ],
        }

    def get_forecast(self, *, horizon_months: Literal[3, 6, 12]) -> dict[str, Any]:
        forecast = ForecastService(self.session, self.user_id).forecast(
            horizon=horizon_months, mode="full"
        )
        return {
            "ok": True,
            "start_balance_cents": forecast["start_balance_cents"],
            "method": forecast["model"]["method"],
            "summary": forecast["summary"],
            "months": [
                {
                    "month": month["month"],
                    "income_cents": month["projected_income_cents"],
                    "expense_cents": month["projected_expenses_cents"],
                    "net_cents": month["projected_net_cents"],
                    "end_balance_cents": month["end_balance_cents"],
                    "end_balance_p10_cents": month["end_balance_p10_cents"],
                    "end_balance_p90_cents": month["end_balance_p90_cents"],
                    "minimum_balance_cents": month["minimum_balance_cents"],
                }
                for month in forecast["months"]
            ],
        }

    def get_balance_history(self, *, months: int) -> dict[str, Any]:
        history = BalanceAnchorService(self.session, self.user_id).month_end_history(
            months=_bounded(months, default=12, maximum=60),
            now=self.now.replace(tzinfo=None),
        )
        return {
            "ok": True,
            "months": [
                {
                    "month": f"{start.year:04d}-{start.month:02d}",
                    "end_balance_cents": balance,
                }
                for start, balance in history
            ],
        }

    def list_reimbursements(
        self, *, start: date, end: date, only_open: bool = False
    ) -> dict[str, Any]:
        if start > end:
            return _invalid("invalid_period", "start must be on or before end")
        expense = aliased(Transaction)
        allocated = (
            select(
                ReimbursementAllocation.reimbursement_transaction_id.label("id"),
                func.sum(ReimbursementAllocation.amount_cents).label("cents"),
                func.count(ReimbursementAllocation.id).label("count"),
            )
            .join(expense, ReimbursementAllocation.expense_transaction_id == expense.id)
            .where(
                ReimbursementAllocation.user_id == self.user_id,
                expense.user_id == self.user_id,
                expense.deleted_at.is_(None),
                expense.type == TransactionType.expense,
            )
            .group_by(ReimbursementAllocation.reimbursement_transaction_id)
            .subquery()
        )
        stmt = (
            select(
                Transaction,
                func.coalesce(allocated.c.cents, 0),
                func.coalesce(allocated.c.count, 0),
            )
            .outerjoin(allocated, allocated.c.id == Transaction.id)
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.income,
                Transaction.is_reimbursement.is_(True),
                Transaction.date.between(start, end),
            )
            .order_by(Transaction.date.desc(), Transaction.id.desc())
            .limit(101)
        )
        if only_open:
            stmt = stmt.where(
                Transaction.amount_cents > func.coalesce(allocated.c.cents, 0)
            )
        rows = self.session.execute(stmt).all()
        result: dict[str, Any] = {
            "ok": True,
            "period": {"start": start.isoformat(), "end": end.isoformat()},
            "reimbursements": [
                {
                    "id": txn.id,
                    "date": txn.date.isoformat(),
                    "title": txn.title,
                    "amount_cents": txn.amount_cents,
                    "allocated_cents": int(allocated_cents),
                    "unallocated_cents": txn.amount_cents - int(allocated_cents),
                    "expense_count": int(count),
                }
                for txn, allocated_cents, count in rows[:100]
            ],
        }
        if len(rows) > 100:
            result["more"] = True
        return result

    def list_durable_purchases(self) -> dict[str, Any]:
        purchases = sorted(
            DurablePurchaseService(self.session, self.user_id).list_computed(
                today=self.today
            ),
            key=lambda item: str(item["acquired_on"]),
            reverse=True,
        )
        result: dict[str, Any] = {
            "ok": True,
            "purchases": [
                {
                    "transaction_id": item["transaction_id"],
                    "title": item["title"],
                    "amount_cents": item["original_amount_cents"],
                    "acquired_on": item["acquired_on"],
                    "expected_lifespan_days": item["expected_lifespan_days"],
                    "cost_per_day_cents": round(float(item["cost_per_day_cents"]), 2),
                    "remaining_value_cents": item["remaining_cents"],
                    "percent_used": round(float(item["percent_amortized"]), 1),
                }
                for item in purchases[:100]
            ],
        }
        if len(purchases) > 100:
            result["more"] = True
        return result


def query_transactions(
    ctx: RunContext[AssistantReader],
    start: date,
    end: date,
    kind: Kind = "expense",
    category_ids: list[int] | None = None,
    tag_ids: list[int] | None = None,
    exclude_tag_ids: list[int] | None = None,
    text: str | None = None,
    min_amount_cents: int | None = None,
    max_amount_cents: int | None = None,
    group_by: GroupBy = "none",
    sort: Sort = "date_desc",
    limit: int = 25,
    offset: int = 0,
    compare_start: date | None = None,
    compare_end: date | None = None,
) -> dict[str, Any]:
    """Find, total, and group transactions in a period. Totals cover every match.

    Args:
        start: First day of the period.
        end: Last day of the period.
        kind: expense, income (without reimbursements), or reimbursement.
        category_ids: Keep transactions in any of these categories.
        tag_ids: Keep transactions with any of these tags.
        exclude_tag_ids: Drop transactions with any of these tags.
        text: Fuzzy search in title and description, tolerant of typos.
        min_amount_cents: Smallest amount before reimbursements.
        max_amount_cents: Largest amount before reimbursements.
        group_by: none lists transactions. Otherwise returns one row per category,
            tag, month, week (keyed by its Monday), weekday, or title (merchant).
            A transaction with several tags counts under each tag.
        sort: Order of listed transactions. Grouped rows come largest first, or in
            time order for month, week, and weekday.
        limit: Transactions or groups to return, up to 100.
        offset: Transactions to skip, for the next page.
        compare_start: First day of a period to compare with.
        compare_end: Last day of the period to compare with. Category, tag, and
            title groups then include each group's amount in that period.
    """
    return ctx.deps.query_transactions(
        start=start,
        end=end,
        kind=kind,
        category_ids=category_ids,
        tag_ids=tag_ids,
        exclude_tag_ids=exclude_tag_ids,
        text=text,
        min_amount_cents=min_amount_cents,
        max_amount_cents=max_amount_cents,
        group_by=group_by,
        sort=sort,
        limit=limit,
        offset=offset,
        compare_start=compare_start,
        compare_end=compare_end,
    )


def get_period_summary(
    ctx: RunContext[AssistantReader], start: date, end: date
) -> dict[str, Any]:
    """Income, expenses, net, savings rate, and end balance for a period, with the
    previous period of the same length."""
    return ctx.deps.get_period_summary(start=start, end=end)


def get_budgets(
    ctx: RunContext[AssistantReader],
    year: int,
    month: int,
    category_id: int | None = None,
) -> dict[str, Any]:
    """Monthly budgets with spent, remaining, and projected spending for a month."""
    return ctx.deps.get_budgets(year=year, month=month, category_id=category_id)


def get_transaction(
    ctx: RunContext[AssistantReader], transaction_id: int
) -> dict[str, Any]:
    """One transaction with its reimbursements, recurring rule, and original currency."""
    return ctx.deps.get_transaction(transaction_id=transaction_id)


def list_recurring(ctx: RunContext[AssistantReader]) -> dict[str, Any]:
    """Recurring payments and income: amount, interval, next date, monthly cost."""
    return ctx.deps.list_recurring()


def get_forecast(
    ctx: RunContext[AssistantReader], horizon_months: Literal[3, 6, 12] = 6
) -> dict[str, Any]:
    """Projected income, expenses, and balance for the coming months."""
    return ctx.deps.get_forecast(horizon_months=horizon_months)


def get_balance_history(
    ctx: RunContext[AssistantReader], months: int = 12
) -> dict[str, Any]:
    """Account balance at the end of each recent month, up to 60 months."""
    return ctx.deps.get_balance_history(months=months)


def list_reimbursements(
    ctx: RunContext[AssistantReader], start: date, end: date, only_open: bool = False
) -> dict[str, Any]:
    """Reimbursements received in a period and how much of each is allocated.

    Lists the newest 100. `more` means the period has others; narrow it to see them.

    Args:
        start: First day of the period.
        end: Last day of the period.
        only_open: Keep only reimbursements with an unallocated amount.
    """
    return ctx.deps.list_reimbursements(start=start, end=end, only_open=only_open)


def list_durable_purchases(ctx: RunContext[AssistantReader]) -> dict[str, Any]:
    """Purchases spread over their expected lifespan, with cost per day.

    Lists the newest 100. `more` means there are older ones.
    """
    return ctx.deps.list_durable_purchases()


TOOLS = [
    query_transactions,
    get_period_summary,
    get_budgets,
    get_transaction,
    list_recurring,
    get_forecast,
    get_balance_history,
    list_reimbursements,
    list_durable_purchases,
]

TOOL_LABELS = {
    "query_transactions": "Transactions",
    "get_period_summary": "Summary",
    "get_budgets": "Budgets",
    "get_transaction": "Transaction",
    "list_recurring": "Recurring payments",
    "get_forecast": "Forecast",
    "get_balance_history": "Balance history",
    "list_reimbursements": "Reimbursements",
    "list_durable_purchases": "Durable purchases",
    "create_transactions": "New transactions",
    "edit_transactions": "Transaction changes",
    "allocate_reimbursement": "Reimbursement allocation",
    "set_budgets": "Budget changes",
    "undo_action": "Undo",
}


def _eur(cents: int) -> str:
    """Formats cents like the app: 1 234,56 €."""
    sign = "-" if cents < 0 else ""
    euros = f"{abs(cents) // 100:,}".replace(",", "\u00a0")
    return f"{sign}{euros},{abs(cents) % 100:02d}\u00a0€"


def _period_label(start: date, end: date) -> str:
    if start == date(start.year, 1, 1) and end == date(start.year, 12, 31):
        return str(start.year)
    if start.day == 1 and end == month_end(start.year, start.month):
        return f"{start:%b %Y}"
    if start == end:
        return f"{start.day} {start:%b %Y}"
    if start.year == end.year:
        return f"{start.day} {start:%b} – {end.day} {end:%b %Y}"
    return f"{start.day} {start:%b %Y} – {end.day} {end:%b %Y}"


def _arg_period(args: dict[str, Any], start_key: str, end_key: str) -> str | None:
    try:
        return _period_label(
            date.fromisoformat(args[start_key]), date.fromisoformat(args[end_key])
        )
    except (KeyError, TypeError, ValueError):
        return None


def tool_label(tool_name: str, args: dict[str, Any]) -> str:
    """What a tool step says it looks at, from the model's arguments."""
    label = TOOL_LABELS.get(tool_name, tool_name)
    period = _arg_period(args, "start", "end")
    match tool_name:
        case "query_transactions":
            label = {"income": "Income", "reimbursement": "Reimbursements"}.get(
                args.get("kind"), "Spending"
            )
            if args.get("text"):
                label += f" matching “{str(args['text'])[:40]}”"
            if args.get("group_by") in GROUP_NOUNS:
                label += f" by {GROUP_NOUNS[args['group_by']][0]}"
            if compared := _arg_period(args, "compare_start", "compare_end"):
                period = f"{period} vs {compared}"
        case "get_budgets":
            try:
                period = f"{date(int(args['year']), int(args['month']), 1):%b %Y}"
            except (KeyError, TypeError, ValueError):
                period = None
        case "get_forecast":
            period = f"{args.get('horizon_months', 6)} months"
        case "get_balance_history":
            period = f"{args.get('months', 12)} months"
    return f"{label}, {period}" if period else label


def tool_detail(tool_name: str, content: dict[str, Any]) -> str | None:
    """One line on what a tool found."""
    match tool_name:
        case "query_transactions":
            totals = content["totals"]
            if totals["count"] == 0:
                detail = "No matches"
            elif "groups" in content:
                singular, plural = GROUP_NOUNS[content["group_by"]]
                count = len(content["groups"]) + content.get("more_groups", 0)
                detail = f"{count} {singular if count == 1 else plural} · {_eur(totals['net_cents'])}"
            else:
                count = totals["count"]
                detail = f"{count} transaction{'' if count == 1 else 's'} · {_eur(totals['net_cents'])}"
            if "baseline" in content:
                detail += f" vs {_eur(content['baseline']['totals']['net_cents'])}"
            return detail
        case "get_period_summary":
            return (
                f"{_eur(content['expense_cents'])} spent · "
                f"{_eur(content['income_cents'])} income"
            )
        case "get_budgets":
            budgets = content["budgets"]
            if not budgets:
                return "No budgets set"
            detail = "1 budget" if len(budgets) == 1 else f"{len(budgets)} budgets"
            over = sum(1 for row in budgets if int(row["remaining_cents"]) < 0)
            return f"{detail} · {over} over" if over else detail
        case "get_transaction":
            txn = content["transaction"]
            return f"{txn['title'] or 'Untitled'} · {_eur(txn['net_cents'])}"
        case "list_recurring":
            count = len(content["rules"])
            return (
                f"{count} rule{'' if count == 1 else 's'} · "
                f"{_eur(content['monthly_expense_cents'])} a month"
            )
        case "get_forecast":
            months = content["months"]
            if not months:
                return None
            return f"{_eur(months[-1]['end_balance_cents'])} by {months[-1]['month']}"
        case "get_balance_history":
            months = content["months"]
            if not months:
                return "No balance yet"
            return f"Now {_eur(months[-1]['end_balance_cents'])}"
        case "list_reimbursements":
            rows = content["reimbursements"]
            if content.get("more"):
                return f"{len(rows)}+ reimbursements"
            open_cents = sum(row["unallocated_cents"] for row in rows)
            count = f"{len(rows)} reimbursement{'' if len(rows) == 1 else 's'}"
            return f"{count} · {_eur(open_cents)} open" if open_cents else count
        case "list_durable_purchases":
            count = len(content["purchases"])
            if content.get("more"):
                return f"{count}+ purchases"
            return f"{count} purchase{'' if count == 1 else 's'}"
        case _:
            return None
