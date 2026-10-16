"""Changes the Assistant proposes, and how an approved change is applied and undone.

A write tool never writes. It checks the request and builds an exact plan, which the
user sees as an approval card, and the run ends there. Approving applies the stored
plan in one commit and keeps the plan that undoes it.
"""

from __future__ import annotations

import datetime as dt
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, TypeAdapter
from pydantic_ai import RunContext
from pydantic_ai.exceptions import ApprovalRequired
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from expenses.ai.assistant_tools import AssistantReader, _eur, _invalid
from expenses.db.models import (
    AssistantAction,
    BudgetFrequency,
    BudgetOverride,
    BudgetTemplate,
    Category,
    ReimbursementAllocation,
    Tag,
    Transaction,
    TransactionType,
)
from expenses.schemas import BudgetOverrideIn, BudgetTemplateApplyFromIn, TransactionIn
from expenses.services import (
    BudgetService,
    ReimbursementService,
    TagService,
    TransactionService,
)
from expenses.services.rollups import recompute_monthly_rollup_for_date

MAX_NEW = 20
MAX_EDITED = 200
MAX_ALLOCATED = 50
MAX_BUDGETS = 20


class InvalidProposal(Exception):
    """The request can't become a plan; the model hears why and can ask or retry."""

    def __init__(self, status: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class ActionConflict(Exception):
    """The data changed after the proposal, so the plan no longer applies as shown."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


# ───────── Cards ─────────


class ApprovalCategory(BaseModel):
    id: int
    name: str
    icon: str | None


class ApprovalRow(BaseModel):
    title: str
    detail: str | None = None
    category: ApprovalCategory | None = None
    date: dt.date | None = None
    amount_cents: int | None = None
    # Shown as "amount of of_cents", such as an allocation of an expense.
    of_cents: int | None = None
    income: bool = False


class ApprovalCard(BaseModel):
    title: str
    meta: str | None = None
    # The approve button, such as Add, and the state after it, such as Added.
    verb: str
    done: str
    # Every row the plan changes, so the user can check each one before approving.
    rows: list[ApprovalRow]
    # Shown as "total_cents of total_of_cents" beside the buttons.
    total_cents: int | None = None
    total_of_cents: int | None = None


# ───────── Plans ─────────


class NewTransactionPlan(BaseModel):
    date: date
    type: TransactionType
    amount_cents: int
    title: str
    category_id: int | None
    tags: list[str]


class CreatePlan(BaseModel):
    kind: Literal["create_transactions"] = "create_transactions"
    transactions: list[NewTransactionPlan]


class TrashRow(BaseModel):
    transaction_id: int
    # As the card showed it; approval refuses once any of these changed.
    title: str
    date: date
    amount_cents: int


class TrashPlan(BaseModel):
    """Moves transactions to Trash; undoes created transactions."""

    kind: Literal["trash_transactions"] = "trash_transactions"
    rows: list[TrashRow]


class Classification(BaseModel):
    category_id: int
    # Sorted case-insensitively, so equal tag sets compare equal.
    tags: list[str]
    title: str


class EditRow(BaseModel):
    transaction_id: int
    # As the card showed them; approval refuses once either changed.
    date: date
    amount_cents: int
    before: Classification
    after: Classification


class EditPlan(BaseModel):
    kind: Literal["edit_transactions"] = "edit_transactions"
    rows: list[EditRow]


class AllocationRow(BaseModel):
    expense_id: int
    # None means no allocation from this reimbursement to the expense.
    previous_cents: int | None
    cents: int | None


class AllocationShown(BaseModel):
    """The amounts a proposal's card showed; approval refuses once any changed."""

    reimbursement_cents: int
    expense_cents: dict[int, int]
    # Every allocation from the reimbursement, by expense.
    allocated: dict[int, int]


class AllocatePlan(BaseModel):
    kind: Literal["allocate_reimbursement"] = "allocate_reimbursement"
    reimbursement_id: int
    # True marks the income as a reimbursement, False clears the mark once nothing
    # is allocated from it, None leaves it.
    set_reimbursement: bool | None
    allocations: list[AllocationRow]
    # None for an undo, which checks only the allocations it puts back.
    shown: AllocationShown | None = None


class TemplateRow(BaseModel):
    id: int
    amount_cents: int
    starts_on: date
    ends_on: date | None


class OverrideRow(BaseModel):
    id: int
    year: int
    month: int
    amount_cents: int


class BudgetScopeState(BaseModel):
    """Every monthly budget row of one category, or of the overall budget."""

    templates: list[TemplateRow]
    overrides: list[OverrideRow]


class BudgetChange(BaseModel):
    category_id: int | None
    year: int
    month: int
    amount_cents: int
    # From this month on, or this month only.
    onward: bool
    # The budget as the card showed it; approval refuses one that changed since.
    before: BudgetScopeState


class BudgetsPlan(BaseModel):
    kind: Literal["set_budgets"] = "set_budgets"
    changes: list[BudgetChange]


class BudgetRestore(BaseModel):
    category_id: int | None
    current: BudgetScopeState
    target: BudgetScopeState


class RestoreBudgetsPlan(BaseModel):
    """Puts budget rows back as they were; undoes set_budgets."""

    kind: Literal["restore_budgets"] = "restore_budgets"
    scopes: list[BudgetRestore]


InversePlan = Annotated[
    TrashPlan | EditPlan | AllocatePlan | RestoreBudgetsPlan,
    Field(discriminator="kind"),
]


class UndoPlan(BaseModel):
    kind: Literal["undo"] = "undo"
    action_id: int
    plan: InversePlan


Plan = Annotated[
    CreatePlan | EditPlan | AllocatePlan | BudgetsPlan | UndoPlan,
    Field(discriminator="kind"),
]
PLAN = TypeAdapter(Plan)
INVERSE_PLAN = TypeAdapter(InversePlan)


class Proposal(BaseModel):
    """What a write tool hands to the approval card and the action log."""

    summary: str
    card: ApprovalCard
    plan: Plan


# ───────── Shared lookups ─────────


def _category_card(category: Category | None) -> ApprovalCategory | None:
    if category is None:
        return None
    return ApprovalCategory(id=category.id, name=category.name, icon=category.icon)


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _categories(session: Session, user_id: int) -> dict[int, Category]:
    return {
        category.id: category
        for category in session.scalars(
            select(Category).where(Category.user_id == user_id)
        )
    }


def _usable_category(
    categories: dict[int, Category], category_id: int, kind: TransactionType
) -> Category:
    category = categories.get(category_id)
    if category is None:
        raise InvalidProposal(
            "unknown_category", f"Category {category_id} doesn't exist."
        )
    if category.archived_at is not None:
        raise InvalidProposal("archived_category", f"{category.name} is archived.")
    if category.type != kind:
        raise InvalidProposal(
            "category_type", f"{category.name} is a {category.type.value} category."
        )
    return category


def _transactions(
    session: Session, user_id: int, ids: list[int]
) -> dict[int, Transaction]:
    rows = session.scalars(
        select(Transaction)
        .options(joinedload(Transaction.category), selectinload(Transaction.tags))
        .where(
            Transaction.user_id == user_id,
            Transaction.id.in_(ids),
            Transaction.deleted_at.is_(None),
        )
    ).unique()
    return {txn.id: txn for txn in rows}


def _existing(session: Session, user_id: int, ids: list[int]) -> list[Transaction]:
    found = _transactions(session, user_id, ids)
    if missing := [txn_id for txn_id in ids if txn_id not in found]:
        raise InvalidProposal(
            "not_found", f"Transactions {missing[:10]} don't exist or are in Trash."
        )
    return [found[txn_id] for txn_id in ids]


def _unique(values: list[int]) -> list[int]:
    return list(dict.fromkeys(values))


def _tag_names(session: Session, user_id: int, names: list[str]) -> list[str]:
    """Unique names, spelled like the existing tag when there is one."""
    existing = {
        name.lower(): name
        for name in session.scalars(select(Tag.name).where(Tag.user_id == user_id))
    }
    seen: dict[str, str] = {}
    for name in names:
        clean = name.strip()
        if not clean:
            continue
        if len(clean) > 50:
            raise InvalidProposal("invalid_tag", f"The tag {clean[:20]}… is too long.")
        seen.setdefault(clean.lower(), existing.get(clean.lower(), clean))
    return list(seen.values())


def _sorted_tags(names: list[str]) -> list[str]:
    return sorted(names, key=str.lower)


def _trash_row(txn: Transaction) -> TrashRow:
    return TrashRow(
        transaction_id=txn.id,
        title=txn.title,
        date=txn.date,
        amount_cents=txn.amount_cents,
    )


def _classification(txn: Transaction) -> Classification:
    return Classification(
        category_id=txn.category_id,
        tags=_sorted_tags([tag.name for tag in txn.tags]),
        title=txn.title,
    )


def _month(value: str) -> tuple[int, int]:
    try:
        parsed = date.fromisoformat(f"{value}-01")
    except ValueError:
        raise InvalidProposal("invalid_month", f"{value} is not a month like 2026-10.")
    return parsed.year, parsed.month


# ───────── Proposals ─────────


class NewTransaction(BaseModel):
    date: date
    kind: Literal["expense", "income"]
    amount_cents: int = Field(gt=0)
    title: str
    category_id: int | None = None
    tags: list[str] = Field(default_factory=list)


def propose_create(
    reader: AssistantReader, transactions: list[NewTransaction]
) -> Proposal:
    if not transactions:
        raise InvalidProposal("empty", "Describe at least one transaction.")
    if len(transactions) > MAX_NEW:
        raise InvalidProposal(
            "too_many", f"Propose at most {MAX_NEW} transactions at once."
        )
    categories = _categories(reader.session, reader.user_id)
    plans: list[NewTransactionPlan] = []
    rows: list[ApprovalRow] = []
    for new in transactions:
        kind = TransactionType(new.kind)
        title = new.title.strip()
        if not title or len(title) > 200:
            raise InvalidProposal(
                "invalid_title", "Each title needs 1 to 200 characters."
            )
        if not date(1970, 1, 1) <= new.date <= reader.today + timedelta(days=366):
            raise InvalidProposal("invalid_date", f"{new.date} is out of range.")
        category = (
            _usable_category(categories, new.category_id, kind)
            if new.category_id is not None
            else None
        )
        tags = _tag_names(reader.session, reader.user_id, new.tags)
        plans.append(
            NewTransactionPlan(
                date=new.date,
                type=kind,
                amount_cents=new.amount_cents,
                title=title,
                category_id=category.id if category else None,
                tags=tags,
            )
        )
        rows.append(
            ApprovalRow(
                title=title,
                detail=" · ".join(
                    [category.name if category else "Uncategorized", *tags]
                ),
                category=_category_card(category),
                date=new.date,
                amount_cents=new.amount_cents,
                income=kind == TransactionType.income,
            )
        )
    count = len(plans)
    return Proposal(
        summary=f"Added {_plural(count, 'transaction')}",
        card=ApprovalCard(
            title=f"{count} new transaction"
            if count == 1
            else f"{count} new transactions",
            verb="Add",
            done="Added",
            rows=rows,
        ),
        plan=CreatePlan(transactions=plans),
    )


def _edit_detail(
    categories: dict[int, Category], before: Classification, after: Classification
) -> str:
    parts: list[str] = []
    if before.category_id != after.category_id:
        parts.append(
            f"{categories[before.category_id].name} → {categories[after.category_id].name}"
        )
    before_tags = {tag.lower() for tag in before.tags}
    after_tags = {tag.lower() for tag in after.tags}
    parts += [f"+{tag}" for tag in after.tags if tag.lower() not in before_tags]
    parts += [f"−{tag}" for tag in before.tags if tag.lower() not in after_tags]
    if before.title != after.title:
        parts.append(f"Renamed to {after.title}")
    return " · ".join(parts)


def _edit_rows(
    categories: dict[int, Category],
    transactions: dict[int, Transaction],
    rows: list[EditRow],
) -> list[ApprovalRow]:
    return [
        ApprovalRow(
            title=transactions[row.transaction_id].title,
            detail=_edit_detail(categories, row.before, row.after),
            category=_category_card(categories[row.after.category_id]),
            date=transactions[row.transaction_id].date,
            amount_cents=transactions[row.transaction_id].amount_cents,
            income=transactions[row.transaction_id].type == TransactionType.income,
        )
        for row in rows
    ]


def propose_edit(
    reader: AssistantReader,
    *,
    transaction_ids: list[int],
    category_id: int | None,
    add_tags: list[str],
    remove_tags: list[str],
    title: str | None,
) -> Proposal:
    ids = _unique(transaction_ids)
    if not ids:
        raise InvalidProposal("empty", "Name at least one transaction to edit.")
    if len(ids) > MAX_EDITED:
        raise InvalidProposal(
            "too_many", f"Edit at most {MAX_EDITED} transactions at once."
        )
    new_title = title.strip() if title is not None else None
    if new_title is not None and not 1 <= len(new_title) <= 200:
        raise InvalidProposal("invalid_title", "A title needs 1 to 200 characters.")
    added = _tag_names(reader.session, reader.user_id, add_tags)
    removing = _tag_names(reader.session, reader.user_id, remove_tags)
    removed = {tag.lower() for tag in removing}
    if category_id is None and not added and not removed and new_title is None:
        raise InvalidProposal(
            "no_change", "Say what to change: category, tags, or title."
        )
    categories = _categories(reader.session, reader.user_id)
    transactions = _existing(reader.session, reader.user_id, ids)
    rows: list[EditRow] = []
    for txn in sorted(transactions, key=lambda txn: (txn.date, txn.id), reverse=True):
        before = _classification(txn)
        target = before.category_id
        if category_id is not None:
            target = _usable_category(categories, category_id, txn.type).id
        kept = [tag for tag in before.tags if tag.lower() not in removed]
        kept_lower = {tag.lower() for tag in kept}
        after = Classification(
            category_id=target,
            tags=_sorted_tags(
                kept + [tag for tag in added if tag.lower() not in kept_lower]
            ),
            title=new_title if new_title is not None else before.title,
        )
        if after != before:
            rows.append(
                EditRow(
                    transaction_id=txn.id,
                    date=txn.date,
                    amount_cents=txn.amount_cents,
                    before=before,
                    after=after,
                )
            )
    if not rows:
        raise InvalidProposal("no_change", "These transactions already look like that.")
    changes: list[str] = []
    if category_id is not None:
        changes.append(f"Category {categories[category_id].name}")
    changes += [f"Add {tag}" for tag in added]
    changes += [f"Remove {tag}" for tag in removing]
    if new_title is not None:
        changes.append(f"Title {new_title}")
    count = len(rows)
    return Proposal(
        summary=f"Edited {_plural(count, 'transaction')}",
        card=ApprovalCard(
            title=f"Edit {_plural(count, 'transaction')}",
            meta=" · ".join(changes),
            verb="Apply",
            done="Applied",
            rows=_edit_rows(categories, {txn.id: txn for txn in transactions}, rows),
        ),
        plan=EditPlan(rows=rows),
    )


def _allocation_rows(
    session: Session, user_id: int, reimbursement_id: int
) -> dict[int, int]:
    return {
        allocation.expense_transaction_id: allocation.amount_cents
        for allocation in session.scalars(
            select(ReimbursementAllocation).where(
                ReimbursementAllocation.user_id == user_id,
                ReimbursementAllocation.reimbursement_transaction_id
                == reimbursement_id,
            )
        )
    }


def propose_allocate(
    reader: AssistantReader,
    *,
    reimbursement_id: int,
    expense_ids: list[int],
    split: Literal["share", "even", "amounts"],
    share_percent: float,
    amounts_cents: list[int] | None,
) -> Proposal:
    session, user_id = reader.session, reader.user_id
    [reimbursement] = _existing(session, user_id, [reimbursement_id])
    if reimbursement.type != TransactionType.income:
        raise InvalidProposal("not_income", "Only income can reimburse expenses.")
    ids = _unique(expense_ids)
    if not ids:
        raise InvalidProposal("empty", "Name at least one expense.")
    if len(ids) > MAX_ALLOCATED:
        raise InvalidProposal(
            "too_many", f"Allocate to at most {MAX_ALLOCATED} expenses at once."
        )
    expenses = _existing(session, user_id, ids)
    if income := next(
        (txn for txn in expenses if txn.type != TransactionType.expense), None
    ):
        raise InvalidProposal("not_expense", f"{income.title} is not an expense.")

    service = ReimbursementService(session, user_id)
    existing = _allocation_rows(session, user_id, reimbursement.id)
    replaced = sum(existing.get(txn.id, 0) for txn in expenses)
    allocated_elsewhere = (
        service.allocated_total_for_reimbursement(reimbursement.id) - replaced
    )
    available = reimbursement.amount_cents - allocated_elsewhere
    # The same cap upsert_allocation enforces: what other incomes don't already cover.
    reimbursed_other = dict(
        session.execute(
            select(
                ReimbursementAllocation.expense_transaction_id,
                func.sum(ReimbursementAllocation.amount_cents),
            )
            .where(
                ReimbursementAllocation.user_id == user_id,
                ReimbursementAllocation.expense_transaction_id.in_(ids),
                ReimbursementAllocation.reimbursement_transaction_id
                != reimbursement.id,
            )
            .group_by(ReimbursementAllocation.expense_transaction_id)
        ).all()
    )
    remaining = {
        txn.id: txn.amount_cents - reimbursed_other.get(txn.id, 0) for txn in expenses
    }

    match split:
        case "share":
            if not 0 < share_percent <= 100:
                raise InvalidProposal(
                    "invalid_share", "share_percent must be above 0 and at most 100."
                )
            cents = [
                min(
                    remaining[txn.id],
                    int(
                        (
                            Decimal(txn.amount_cents)
                            * Decimal(str(share_percent))
                            / 100
                        ).quantize(Decimal(1), rounding=ROUND_HALF_UP)
                    ),
                )
                for txn in expenses
            ]
        case "even":
            base, extra = divmod(max(0, available), len(expenses))
            cents = [
                min(remaining[txn.id], base + (1 if index < extra else 0))
                for index, txn in enumerate(expenses)
            ]
        case "amounts":
            if amounts_cents is None or len(amounts_cents) != len(expense_ids):
                raise InvalidProposal(
                    "invalid_amounts",
                    "Give one amount for each expense, in the same order.",
                )
            by_id = dict(zip(expense_ids, amounts_cents, strict=True))
            cents = [by_id[txn.id] for txn in expenses]
            for txn, amount in zip(expenses, cents, strict=True):
                if amount > remaining[txn.id]:
                    raise InvalidProposal(
                        "exceeds_expense",
                        f"{txn.title} has only {_eur(remaining[txn.id])} left to reimburse.",
                    )
    for txn, amount in zip(expenses, cents, strict=True):
        if amount <= 0:
            raise InvalidProposal(
                "nothing_left", f"Nothing of {txn.title} is left to allocate."
            )
    total = sum(cents)
    if total > available:
        raise InvalidProposal(
            "exceeds_reimbursement",
            f"These allocations add up to {_eur(total)}, but only {_eur(max(0, available))} "
            f"of {reimbursement.title} is unallocated.",
        )
    return Proposal(
        summary=f"Allocated {_eur(total)} from {reimbursement.title}",
        card=ApprovalCard(
            title=f"Allocate {_eur(total)} from {reimbursement.title}",
            meta=None
            if reimbursement.is_reimbursement
            else "Marks it as a reimbursement",
            verb="Allocate",
            done="Allocated",
            rows=[
                ApprovalRow(
                    title=txn.title,
                    category=_category_card(txn.category),
                    date=txn.date,
                    amount_cents=amount,
                    of_cents=txn.amount_cents,
                )
                for txn, amount in zip(expenses, cents, strict=True)
            ],
            total_cents=allocated_elsewhere + total,
            total_of_cents=reimbursement.amount_cents,
        ),
        plan=AllocatePlan(
            reimbursement_id=reimbursement.id,
            set_reimbursement=None if reimbursement.is_reimbursement else True,
            allocations=[
                AllocationRow(
                    expense_id=txn.id, previous_cents=existing.get(txn.id), cents=amount
                )
                for txn, amount in zip(expenses, cents, strict=True)
            ],
            shown=AllocationShown(
                reimbursement_cents=reimbursement.amount_cents,
                expense_cents={txn.id: txn.amount_cents for txn in expenses},
                allocated=existing,
            ),
        ),
    )


class BudgetRequest(BaseModel):
    category_id: int | None = None
    month: str
    amount_cents: int = Field(ge=0)
    applies: Literal["month", "onward"]


def propose_budgets(reader: AssistantReader, budgets: list[BudgetRequest]) -> Proposal:
    if not budgets:
        raise InvalidProposal("empty", "Name at least one budget.")
    if len(budgets) > MAX_BUDGETS:
        raise InvalidProposal("too_many", f"Set at most {MAX_BUDGETS} budgets at once.")
    scopes = [budget.category_id for budget in budgets]
    if len(set(scopes)) != len(scopes):
        raise InvalidProposal(
            "duplicate_scope", "Set each category's budget once per change."
        )
    categories = _categories(reader.session, reader.user_id)
    service = BudgetService(reader.session, reader.user_id)
    changes: list[BudgetChange] = []
    rows: list[ApprovalRow] = []
    for budget in budgets:
        year, month = _month(budget.month)
        category = (
            _usable_category(categories, budget.category_id, TransactionType.expense)
            if budget.category_id is not None
            else None
        )
        previous = next(
            (
                effective.amount_cents
                for effective in service.effective_budgets_for_month(year, month)
                if effective.scope_category_id == budget.category_id
            ),
            None,
        )
        when = f"{date(year, month, 1):%b %Y}"
        changes.append(
            BudgetChange(
                category_id=budget.category_id,
                year=year,
                month=month,
                amount_cents=budget.amount_cents,
                onward=budget.applies == "onward",
                before=_budget_state(
                    reader.session, reader.user_id, budget.category_id
                ),
            )
        )
        rows.append(
            ApprovalRow(
                title=category.name if category else "Overall budget",
                detail=(
                    f"From {when}" if budget.applies == "onward" else f"{when} only"
                )
                + (f" · was {_eur(previous)}" if previous is not None else " · new"),
                category=_category_card(category),
                amount_cents=budget.amount_cents,
            )
        )
    count = len(changes)
    return Proposal(
        summary=f"Set the {rows[0].title} budget"
        if count == 1
        else f"Set {count} budgets",
        card=ApprovalCard(
            title=f"Set {_plural(count, 'budget')}",
            verb="Save",
            done="Saved",
            rows=rows,
        ),
        plan=BudgetsPlan(changes=changes),
    )


def _span(row: TemplateRow) -> str:
    if row.ends_on is None:
        return f"From {row.starts_on:%b %Y}"
    return f"{row.starts_on:%b %Y} – {row.ends_on:%b %Y}"


def _restore_rows(
    categories: dict[int, Category], scope: BudgetRestore
) -> list[ApprovalRow]:
    """Each budget amount undoing puts back or removes, so the card shows them all."""
    category = (
        categories.get(scope.category_id) if scope.category_id is not None else None
    )

    def row(detail: str, amount_cents: int) -> ApprovalRow:
        return ApprovalRow(
            title=category.name if category else "Overall budget",
            detail=detail,
            category=_category_card(category),
            amount_cents=amount_cents,
        )

    rows: list[ApprovalRow] = []
    # A budget change never deletes a template, so each earlier one is still there.
    current = {template.id: template for template in scope.current.templates}
    for target in scope.target.templates:
        was: list[str] = []
        if current[target.id].ends_on != target.ends_on:
            was.append(_span(current[target.id]))
        if current[target.id].amount_cents != target.amount_cents:
            was.append(_eur(current[target.id].amount_cents))
        if was:
            rows.append(
                row(f"{_span(target)} · was {', '.join(was)}", target.amount_cents)
            )
    kept = {template.id for template in scope.target.templates}
    rows += [
        row(f"{_span(template)} · removed", template.amount_cents)
        for template in scope.current.templates
        if template.id not in kept
    ]
    # An undone override may come back under a new id, so months identify them.
    now = {(o.year, o.month): o for o in scope.current.overrides}
    before = {(o.year, o.month): o for o in scope.target.overrides}
    for (year, month), target in before.items():
        when = f"{date(year, month, 1):%b %Y} only"
        if (year, month) not in now:
            rows.append(row(f"{when} · restored", target.amount_cents))
        elif now[year, month].amount_cents != target.amount_cents:
            rows.append(
                row(
                    f"{when} · was {_eur(now[year, month].amount_cents)}",
                    target.amount_cents,
                )
            )
    rows += [
        row(f"{date(year, month, 1):%b %Y} only · removed", override.amount_cents)
        for (year, month), override in now.items()
        if (year, month) not in before
    ]
    return rows


def propose_undo(reader: AssistantReader, action_id: int) -> Proposal:
    session, user_id = reader.session, reader.user_id
    action = session.get(AssistantAction, action_id)
    if (
        action is None
        or action.user_id != user_id
        or action.status not in ("applied", "undone")
    ):
        raise InvalidProposal("not_found", f"There is no applied change {action_id}.")
    if action.status == "undone":
        raise InvalidProposal("already_undone", "That change was already undone.")
    if action.undo_json is None:
        raise InvalidProposal("not_undoable", "That change can't be undone.")
    inverse = INVERSE_PLAN.validate_json(action.undo_json)
    categories = _categories(session, user_id)
    meta: str | None = None
    match inverse:
        case TrashPlan():
            alive = _transactions(
                session, user_id, [row.transaction_id for row in inverse.rows]
            )
            ids = [
                row.transaction_id
                for row in inverse.rows
                if row.transaction_id in alive
            ]
            if not ids:
                raise InvalidProposal(
                    "nothing_to_undo", "Those transactions are already in Trash."
                )
            plan: InversePlan = TrashPlan(
                rows=[_trash_row(alive[txn_id]) for txn_id in ids]
            )
            rows = [
                ApprovalRow(
                    title=alive[txn_id].title,
                    detail="Moves to Trash",
                    category=_category_card(alive[txn_id].category),
                    date=alive[txn_id].date,
                    amount_cents=alive[txn_id].amount_cents,
                    income=alive[txn_id].type == TransactionType.income,
                )
                for txn_id in ids
            ]
        case EditPlan():
            transactions = _transactions(
                session, user_id, [row.transaction_id for row in inverse.rows]
            )
            safe: list[EditRow] = []
            for row in inverse.rows:
                txn = transactions.get(row.transaction_id)
                if txn is not None and _classification(txn) == row.before:
                    # The card shows the date and amount as they are now.
                    safe.append(
                        row.model_copy(
                            update={"date": txn.date, "amount_cents": txn.amount_cents}
                        )
                    )
            if not safe:
                raise InvalidProposal(
                    "changed",
                    "Those transactions changed since, so there is nothing to undo safely.",
                )
            if skipped := len(inverse.rows) - len(safe):
                meta = f"{_plural(skipped, 'transaction')} changed since and stay as they are"
            plan = EditPlan(rows=safe)
            rows = _edit_rows(categories, transactions, safe)
        case AllocatePlan():
            current = _allocation_rows(session, user_id, inverse.reimbursement_id)
            if any(
                current.get(row.expense_id) != row.previous_cents
                for row in inverse.allocations
            ):
                raise InvalidProposal(
                    "changed",
                    "Those allocations changed since, so undoing would lose that change.",
                )
            expenses = _transactions(
                session, user_id, [row.expense_id for row in inverse.allocations]
            )
            shown = [row for row in inverse.allocations if row.expense_id in expenses]
            if not shown:
                raise InvalidProposal("nothing_to_undo", "Those expenses are in Trash.")
            if skipped := len(inverse.allocations) - len(shown):
                meta = f"Skips {_plural(skipped, 'expense')} in Trash"
            plan = inverse.model_copy(update={"allocations": shown})
            rows = [
                ApprovalRow(
                    title=expenses[row.expense_id].title,
                    detail="Removes the allocation"
                    if row.cents is None
                    else f"Back to {_eur(row.cents)}",
                    category=_category_card(expenses[row.expense_id].category),
                    date=expenses[row.expense_id].date,
                    amount_cents=row.previous_cents,
                    of_cents=expenses[row.expense_id].amount_cents,
                )
                for row in shown
            ]
        case RestoreBudgetsPlan():
            if any(
                _budget_state(session, user_id, scope.category_id) != scope.current
                for scope in inverse.scopes
            ):
                raise InvalidProposal(
                    "changed",
                    "Those budgets changed since, so undoing would lose that change.",
                )
            plan = inverse
            rows = [
                row
                for scope in inverse.scopes
                for row in _restore_rows(categories, scope)
            ]
    return Proposal(
        summary=f"Undid: {action.summary}"[:200],
        card=ApprovalCard(
            title=f"Undo: {action.summary}",
            meta=meta,
            verb="Undo",
            done="Undone",
            rows=rows,
        ),
        plan=UndoPlan(action_id=action.id, plan=plan),
    )


# ───────── Write tools ─────────


def _propose(proposal: Proposal) -> dict[str, Any]:
    raise ApprovalRequired(metadata=proposal.model_dump(mode="json"))


def _checked(build) -> dict[str, Any]:
    try:
        proposal = build()
    except InvalidProposal as exc:
        return _invalid(exc.status, exc.message)
    return _propose(proposal)


def create_transactions(
    ctx: RunContext[AssistantReader], transactions: list[NewTransaction]
) -> dict[str, Any]:
    """Propose new transactions. The user approves them on a card before anything is saved.

    Args:
        transactions: Up to 20. Leave category_id empty when no category fits; tags
            are names, and new names become new tags.
    """
    return _checked(lambda: propose_create(ctx.deps, transactions))


def edit_transactions(
    ctx: RunContext[AssistantReader],
    transaction_ids: list[int],
    category_id: int | None = None,
    add_tags: list[str] | None = None,
    remove_tags: list[str] | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """Propose changing the category, tags, or title of up to 200 transactions.
    The user approves the change on a card first.

    Args:
        transaction_ids: Transactions to change, from earlier tool results.
        category_id: New category for all of them.
        add_tags: Tag names to add; new names become new tags.
        remove_tags: Tag names to remove.
        title: New title for all of them.
    """
    return _checked(
        lambda: propose_edit(
            ctx.deps,
            transaction_ids=transaction_ids,
            category_id=category_id,
            add_tags=add_tags or [],
            remove_tags=remove_tags or [],
            title=title,
        )
    )


def allocate_reimbursement(
    ctx: RunContext[AssistantReader],
    reimbursement_id: int,
    expense_ids: list[int],
    split: Literal["share", "even", "amounts"],
    share_percent: float = 50,
    amounts_cents: list[int] | None = None,
) -> dict[str, Any]:
    """Propose allocating an income transaction to expenses as their reimbursement.
    The server computes the cents; the user approves them on a card first.

    Args:
        reimbursement_id: The income that pays back the expenses. It becomes a
            reimbursement if it isn't one yet.
        expense_ids: Expenses it pays back.
        split: share takes share_percent of each expense, even splits what is left of
            the reimbursement evenly, amounts uses amounts_cents.
        share_percent: For share, such as 50 for half of each expense.
        amounts_cents: For amounts, one per expense in the same order.
    """
    return _checked(
        lambda: propose_allocate(
            ctx.deps,
            reimbursement_id=reimbursement_id,
            expense_ids=expense_ids,
            split=split,
            share_percent=share_percent,
            amounts_cents=amounts_cents,
        )
    )


def set_budgets(
    ctx: RunContext[AssistantReader], budgets: list[BudgetRequest]
) -> dict[str, Any]:
    """Propose monthly budgets. The user approves them on a card first.

    Args:
        budgets: Up to 20, one per category. Leave category_id empty for the overall
            budget. month is like 2026-10; applies is month for that month only or
            onward for that month and later.
    """
    return _checked(lambda: propose_budgets(ctx.deps, budgets))


def undo_action(ctx: RunContext[AssistantReader], action_id: int) -> dict[str, Any]:
    """Propose undoing a change you made earlier. The user approves it on a card first.

    Args:
        action_id: The action_id from the change's result or the recent changes list.
    """
    return _checked(lambda: propose_undo(ctx.deps, action_id))


WRITE_TOOLS = [
    create_transactions,
    edit_transactions,
    allocate_reimbursement,
    set_budgets,
    undo_action,
]


# ───────── Applying ─────────


def _budget_state(
    session: Session, user_id: int, category_id: int | None
) -> BudgetScopeState:
    template_scope = (
        BudgetTemplate.category_id.is_(None)
        if category_id is None
        else BudgetTemplate.category_id == category_id
    )
    override_scope = (
        BudgetOverride.category_id.is_(None)
        if category_id is None
        else BudgetOverride.category_id == category_id
    )
    return BudgetScopeState(
        templates=[
            TemplateRow(
                id=row.id,
                amount_cents=row.amount_cents,
                starts_on=row.starts_on,
                ends_on=row.ends_on,
            )
            for row in session.scalars(
                select(BudgetTemplate)
                .where(
                    BudgetTemplate.user_id == user_id,
                    BudgetTemplate.frequency == BudgetFrequency.monthly,
                    template_scope,
                )
                .order_by(BudgetTemplate.id)
            )
        ],
        overrides=[
            OverrideRow(
                id=row.id, year=row.year, month=row.month, amount_cents=row.amount_cents
            )
            for row in session.scalars(
                select(BudgetOverride)
                .where(BudgetOverride.user_id == user_id, override_scope)
                .order_by(BudgetOverride.id)
            )
        ],
    )


def _apply_create(
    session: Session, user_id: int, plan: CreatePlan
) -> tuple[dict[str, Any], InversePlan]:
    service = TransactionService(session, user_id)
    created: list[Transaction] = []
    for row in plan.transactions:
        try:
            created.append(
                service.create(
                    TransactionIn(
                        date=row.date,
                        occurred_at=datetime.combine(row.date, time(12, 0)),
                        type=row.type,
                        amount_cents=row.amount_cents,
                        category_id=row.category_id,
                        title=row.title,
                        tags=row.tags,
                    ),
                    source="assistant",
                    commit=False,
                    auto_classify=False,
                )
            )
        except ValueError as exc:
            raise ActionConflict(f"{row.title}: {exc}") from exc
    return (
        {
            "created": [
                {
                    "id": txn.id,
                    "date": txn.date.isoformat(),
                    "title": txn.title,
                    "amount_cents": txn.amount_cents,
                    "category": session.get(Category, txn.category_id).name,
                }
                for txn in created
            ]
        },
        TrashPlan(rows=[_trash_row(txn) for txn in created]),
    )


def _apply_trash(session: Session, user_id: int, plan: TrashPlan) -> dict[str, Any]:
    alive = _transactions(session, user_id, [row.transaction_id for row in plan.rows])
    if len(alive) != len(plan.rows):
        raise ActionConflict("A transaction this would remove is already in Trash.")
    for row in plan.rows:
        if _trash_row(alive[row.transaction_id]) != row:
            raise ActionConflict(f"{row.title} changed since this was proposed.")
    service = TransactionService(session, user_id)
    for row in plan.rows:
        service.soft_delete(row.transaction_id, commit=False)
    return {"moved_to_trash": len(plan.rows)}


def _apply_edit(
    session: Session, user_id: int, plan: EditPlan
) -> tuple[dict[str, Any], InversePlan]:
    transactions = _transactions(
        session, user_id, [row.transaction_id for row in plan.rows]
    )
    categories = _categories(session, user_id)
    tags = TagService(session, user_id)
    for row in plan.rows:
        txn = transactions.get(row.transaction_id)
        if txn is None:
            raise ActionConflict("A transaction in this change is in Trash now.")
        if (
            _classification(txn) != row.before
            or txn.date != row.date
            or txn.amount_cents != row.amount_cents
        ):
            raise ActionConflict(f"{txn.title} changed since this was proposed.")
        if row.after.category_id != txn.category_id:
            category = categories.get(row.after.category_id)
            if (
                category is None
                or category.archived_at is not None
                or category.type != txn.type
            ):
                raise ActionConflict(
                    f"{txn.title} can't move to that category anymore."
                )
            txn.category_id = category.id
            txn.auto_category_confidence = None
        if row.after.tags != row.before.tags:
            txn.tags = [tags.get_or_create(name) for name in row.after.tags]
        txn.title = row.after.title
    session.flush()
    return (
        {"edited": len(plan.rows)},
        EditPlan(
            rows=[
                row.model_copy(update={"before": row.after, "after": row.before})
                for row in plan.rows
            ]
        ),
    )


def _apply_allocate(
    session: Session, user_id: int, plan: AllocatePlan
) -> tuple[dict[str, Any], InversePlan]:
    alive = _transactions(session, user_id, [plan.reimbursement_id])
    reimbursement = alive.get(plan.reimbursement_id)
    if reimbursement is None or reimbursement.type != TransactionType.income:
        raise ActionConflict("The reimbursement is in Trash or no longer income.")
    service = ReimbursementService(session, user_id)
    marked = plan.set_reimbursement is True and not reimbursement.is_reimbursement
    if marked:
        service.set_reimbursement(reimbursement.id, True, commit=False)
    current = _allocation_rows(session, user_id, reimbursement.id)
    if any(
        current.get(row.expense_id) != row.previous_cents for row in plan.allocations
    ):
        raise ActionConflict("An allocation changed since this was proposed.")
    if plan.shown is not None and (
        reimbursement.amount_cents != plan.shown.reimbursement_cents
        or current != plan.shown.allocated
        or {
            txn_id: txn.amount_cents
            for txn_id, txn in _transactions(
                session, user_id, list(plan.shown.expense_cents)
            ).items()
        }
        != plan.shown.expense_cents
    ):
        raise ActionConflict("An amount changed since this was proposed.")
    # Shrinking first keeps every step within the reimbursement's amount.
    for row in sorted(
        plan.allocations, key=lambda row: (row.cents or 0) - (row.previous_cents or 0)
    ):
        if row.cents is not None:
            try:
                service.upsert_allocation(
                    reimbursement.id, row.expense_id, row.cents, commit=False
                )
            except ValueError as exc:
                raise ActionConflict(str(exc)) from exc
            continue
        allocation = session.scalar(
            select(ReimbursementAllocation).where(
                ReimbursementAllocation.user_id == user_id,
                ReimbursementAllocation.reimbursement_transaction_id
                == reimbursement.id,
                ReimbursementAllocation.expense_transaction_id == row.expense_id,
            )
        )
        expense = session.get(Transaction, row.expense_id)
        session.delete(allocation)
        session.flush()
        if expense is not None:
            recompute_monthly_rollup_for_date(session, user_id, expense.date)
    if plan.set_reimbursement is False and not _allocation_rows(
        session, user_id, reimbursement.id
    ):
        service.set_reimbursement(reimbursement.id, False, commit=False)
    session.flush()
    return (
        {
            "allocated_cents": sum(row.cents or 0 for row in plan.allocations),
            "reimbursement_id": reimbursement.id,
        },
        AllocatePlan(
            reimbursement_id=reimbursement.id,
            set_reimbursement=False if marked else None,
            allocations=[
                AllocationRow(
                    expense_id=row.expense_id,
                    previous_cents=row.cents,
                    cents=row.previous_cents,
                )
                for row in plan.allocations
            ],
        ),
    )


def _apply_budgets(
    session: Session, user_id: int, plan: BudgetsPlan
) -> tuple[dict[str, Any], InversePlan]:
    service = BudgetService(session, user_id)
    scopes: list[BudgetRestore] = []
    for change in plan.changes:
        before = _budget_state(session, user_id, change.category_id)
        if before != change.before:
            raise ActionConflict("That budget changed since this was proposed.")
        try:
            if change.onward:
                service.apply_template_from(
                    BudgetTemplateApplyFromIn(
                        frequency=BudgetFrequency.monthly,
                        category_id=change.category_id,
                        amount_cents=change.amount_cents,
                        starts_on=date(change.year, change.month, 1),
                    ),
                    commit=False,
                )
            else:
                service.upsert_override(
                    BudgetOverrideIn(
                        year=change.year,
                        month=change.month,
                        category_id=change.category_id,
                        amount_cents=change.amount_cents,
                    ),
                    commit=False,
                )
        except ValueError as exc:
            raise ActionConflict(str(exc)) from exc
        scopes.append(
            BudgetRestore(
                category_id=change.category_id,
                current=_budget_state(session, user_id, change.category_id),
                target=before,
            )
        )
    return {"budgets_set": len(plan.changes)}, RestoreBudgetsPlan(scopes=scopes)


def _apply_restore_budgets(
    session: Session, user_id: int, plan: RestoreBudgetsPlan
) -> dict[str, Any]:
    for scope in plan.scopes:
        if _budget_state(session, user_id, scope.category_id) != scope.current:
            raise ActionConflict("Those budgets changed since this was proposed.")
        keep_templates = {row.id for row in scope.target.templates}
        keep_overrides = {row.id for row in scope.target.overrides}
        session.execute(
            delete(BudgetTemplate).where(
                BudgetTemplate.id.in_(
                    [
                        row.id
                        for row in scope.current.templates
                        if row.id not in keep_templates
                    ]
                )
            )
        )
        session.execute(
            delete(BudgetOverride).where(
                BudgetOverride.id.in_(
                    [
                        row.id
                        for row in scope.current.overrides
                        if row.id not in keep_overrides
                    ]
                )
            )
        )
        session.flush()
        # A budget change never deletes a template, and the check above found this
        # budget unchanged since, so every earlier template is still the user's own.
        for row in scope.target.templates:
            template = session.get_one(BudgetTemplate, row.id)
            template.amount_cents = row.amount_cents
            template.starts_on = row.starts_on
            template.ends_on = row.ends_on
        # An onward budget deletes that month's override; it comes back as a new row.
        kept_overrides = {row.id for row in scope.current.overrides}
        for row in scope.target.overrides:
            override = (
                session.get_one(BudgetOverride, row.id)
                if row.id in kept_overrides
                else BudgetOverride(user_id=user_id, category_id=scope.category_id)
            )
            override.year = row.year
            override.month = row.month
            override.amount_cents = row.amount_cents
            session.add(override)
        session.flush()
    return {"budgets_restored": len(plan.scopes)}


def _apply_inverse(session: Session, user_id: int, plan: InversePlan) -> dict[str, Any]:
    match plan:
        case TrashPlan():
            return _apply_trash(session, user_id, plan)
        case EditPlan():
            return _apply_edit(session, user_id, plan)[0]
        case AllocatePlan():
            return _apply_allocate(session, user_id, plan)[0]
        case RestoreBudgetsPlan():
            return _apply_restore_budgets(session, user_id, plan)


def apply_action(session: Session, action: AssistantAction) -> dict[str, Any]:
    """Applies an approved action without committing and keeps what undoes it.

    Returns what the model hears. Raises ActionConflict when the data changed so the
    plan no longer applies as the card showed it; the caller rolls back.
    """
    plan = PLAN.validate_json(action.plan_json)
    inverse: InversePlan | None = None
    match plan:
        case CreatePlan():
            details, inverse = _apply_create(session, action.user_id, plan)
        case EditPlan():
            details, inverse = _apply_edit(session, action.user_id, plan)
        case AllocatePlan():
            details, inverse = _apply_allocate(session, action.user_id, plan)
        case BudgetsPlan():
            details, inverse = _apply_budgets(session, action.user_id, plan)
        case UndoPlan():
            original = session.get(AssistantAction, plan.action_id)
            if original is None or original.status != "applied":
                raise ActionConflict("That change was already undone.")
            details = _apply_inverse(session, action.user_id, plan.plan)
            original.status = "undone"
    action.undo_json = INVERSE_PLAN.dump_json(inverse).decode() if inverse else None
    return {
        "ok": True,
        "status": "applied",
        "action_id": action.id,
        "summary": action.summary,
        **details,
    }
