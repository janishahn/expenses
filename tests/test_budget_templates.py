from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from expenses.db.session import Base
from expenses.db.models import BudgetFrequency, TransactionType
from expenses.schemas import (
    BudgetOverrideIn,
    BudgetTemplateApplyFromIn,
    BudgetTemplateIn,
    CategoryIn,
    TransactionIn,
)
from expenses.services import (
    BudgetService,
    CategoryService,
    TagService,
    TransactionService,
)


def test_effective_budget_prefers_override_over_template() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        groceries = categories.create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )

        budgets = BudgetService(session)
        budgets.upsert_template(
            BudgetTemplateIn(
                frequency=BudgetFrequency.monthly,
                category_id=groceries.id,
                amount_cents=10_000,
                starts_on=date(2025, 1, 1),
                ends_on=None,
            )
        )

        effective = budgets.effective_budgets_for_month(2025, 2)
        by_scope = {b.scope_category_id: b for b in effective}
        assert by_scope[groceries.id].amount_cents == 10_000
        assert by_scope[groceries.id].source == "template"

        budgets.upsert_override(
            BudgetOverrideIn(
                year=2025, month=2, category_id=groceries.id, amount_cents=15_000
            )
        )
        effective2 = budgets.effective_budgets_for_month(2025, 2)
        by_scope2 = {b.scope_category_id: b for b in effective2}
        assert by_scope2[groceries.id].amount_cents == 15_000
        assert by_scope2[groceries.id].source == "override"


def test_apply_template_from_preserves_history_and_clears_month_override() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        groceries = categories.create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        budgets = BudgetService(session)
        original = budgets.upsert_template(
            BudgetTemplateIn(
                frequency=BudgetFrequency.monthly,
                category_id=groceries.id,
                amount_cents=10_000,
                starts_on=date(2025, 1, 1),
                ends_on=None,
            )
        )
        budgets.upsert_override(
            BudgetOverrideIn(
                year=2025,
                month=7,
                category_id=groceries.id,
                amount_cents=15_000,
            )
        )

        changed = budgets.apply_template_from(
            BudgetTemplateApplyFromIn(
                frequency=BudgetFrequency.monthly,
                category_id=groceries.id,
                amount_cents=12_000,
                starts_on=date(2025, 7, 1),
            )
        )

        session.refresh(original)
        assert original.ends_on == date(2025, 6, 30)
        assert changed.starts_on == date(2025, 7, 1)
        assert changed.ends_on is None
        assert budgets.effective_budgets_for_month(2025, 6)[0].amount_cents == 10_000
        july = budgets.effective_budgets_for_month(2025, 7)[0]
        assert july.amount_cents == 12_000
        assert july.source == "template"


def test_apply_template_from_keeps_a_scheduled_future_budget() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        travel = categories.create(
            CategoryIn(name="Travel", type=TransactionType.expense, order=0)
        )
        budgets = BudgetService(session)
        budgets.upsert_template(
            BudgetTemplateIn(
                frequency=BudgetFrequency.yearly,
                category_id=travel.id,
                amount_cents=100_000,
                starts_on=date(2025, 1, 1),
                ends_on=None,
            )
        )
        future = budgets.upsert_template(
            BudgetTemplateIn(
                frequency=BudgetFrequency.yearly,
                category_id=travel.id,
                amount_cents=300_000,
                starts_on=date(2027, 1, 1),
                ends_on=None,
            )
        )

        changed = budgets.apply_template_from(
            BudgetTemplateApplyFromIn(
                frequency=BudgetFrequency.yearly,
                category_id=travel.id,
                amount_cents=200_000,
                starts_on=date(2026, 1, 1),
            )
        )

        assert changed.ends_on == date(2026, 12, 31)
        assert budgets.yearly_budgets_for_year(2026)[0].amount_cents == 200_000
        assert budgets.yearly_budgets_for_year(2027)[0].source_id == future.id


def test_budget_progress_excludes_hidden_from_budget_tags() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        groceries = categories.create(
            CategoryIn(name="Groceries", type=TransactionType.expense, order=0)
        )
        income = categories.create(
            CategoryIn(name="Salary", type=TransactionType.income, order=0)
        )

        TagService(session).create("Reimbursed", is_hidden_from_budget=True)

        budgets = BudgetService(session)
        budgets.upsert_override(
            BudgetOverrideIn(
                year=2025, month=1, category_id=groceries.id, amount_cents=10_000
            )
        )

        txns = TransactionService(session)
        txns.create(
            TransactionIn(
                date=date(2025, 1, 10),
                occurred_at=datetime(2025, 1, 10, 12, 0),
                type=TransactionType.expense,
                amount_cents=3_000,
                category_id=groceries.id,
                title="Groceries",
                tags=[],
            )
        )
        txns.create(
            TransactionIn(
                date=date(2025, 1, 11),
                occurred_at=datetime(2025, 1, 11, 12, 0),
                type=TransactionType.expense,
                amount_cents=4_000,
                category_id=groceries.id,
                title="Reimbursed groceries",
                tags=["Reimbursed"],
            )
        )
        txns.create(
            TransactionIn(
                date=date(2025, 1, 1),
                occurred_at=datetime(2025, 1, 1, 9, 0),
                type=TransactionType.income,
                amount_cents=100_000,
                category_id=income.id,
                title="Salary",
                tags=[],
            )
        )

        progress = budgets.progress_for_month(2025, 1)
        assert progress[groceries.id]["spent_cents"] == 3_000
        assert progress[groceries.id]["remaining_cents"] == 7_000
