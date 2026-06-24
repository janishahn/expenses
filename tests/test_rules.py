from datetime import date, datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import pytest

from expenses.db.models import RuleMatchType, Transaction, TransactionType
from expenses.db.session import Base
from expenses.core.config import get_settings
from expenses.schemas import CategoryIn, RuleIn, TransactionIn
from expenses.services import (
    CSVService,
    CategoryService,
    RuleService,
    TagService,
    TransactionService,
)


def test_rule_applies_category_and_tags_when_uncategorized() -> None:
    """Rules should apply when transaction has 'Uncategorized' category."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        categories.create(
            CategoryIn(name="Uncategorized", type=TransactionType.expense, order=0)
        )
        subs = categories.create(
            CategoryIn(name="Subscriptions", type=TransactionType.expense, order=0)
        )
        hidden = TagService(session).create("Reimbursed", is_hidden_from_budget=True)

        RuleService(session).create(
            RuleIn(
                name="Netflix → Subscriptions",
                enabled=True,
                priority=10,
                match_type=RuleMatchType.contains,
                match_value="netflix",
                transaction_type=TransactionType.expense,
                min_amount_cents=None,
                max_amount_cents=None,
                set_category_id=subs.id,
                add_tags=["Streaming"],
                budget_exclude_tag_id=hidden.id,
            )
        )

        # When category_id is None, it resolves to "Uncategorized" and rules apply
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2025, 1, 5),
                occurred_at=datetime(2025, 1, 5, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=None,
                title="Netflix January",
                tags=[],
            )
        )

        assert txn.category_id == subs.id
        tag_names = {t.name for t in txn.tags}
        assert "Streaming" in tag_names
        assert "Reimbursed" in tag_names


def test_rule_applies_when_user_explicitly_selects_uncategorized() -> None:
    """Even when user explicitly selects 'Uncategorized', rules should apply."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        uncategorized = categories.create(
            CategoryIn(name="Uncategorized", type=TransactionType.expense, order=0)
        )
        subs = categories.create(
            CategoryIn(name="Subscriptions", type=TransactionType.expense, order=0)
        )

        RuleService(session).create(
            RuleIn(
                name="Netflix → Subscriptions",
                enabled=True,
                priority=10,
                match_type=RuleMatchType.contains,
                match_value="netflix",
                transaction_type=TransactionType.expense,
                min_amount_cents=None,
                max_amount_cents=None,
                set_category_id=subs.id,
                add_tags=["Streaming"],
                budget_exclude_tag_id=None,
            )
        )

        # Even when user explicitly picks "Uncategorized", rules still apply
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2025, 1, 5),
                occurred_at=datetime(2025, 1, 5, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=uncategorized.id,
                title="Netflix January",
                tags=[],
            )
        )

        # Rule should have changed the category from Uncategorized to Subscriptions
        assert txn.category_id == subs.id
        tag_names = {t.name for t in txn.tags}
        assert "Streaming" in tag_names


def test_rule_does_not_override_non_uncategorized_category() -> None:
    """Rules should NOT apply when transaction has a category other than Uncategorized."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        food = categories.create(
            CategoryIn(name="Food", type=TransactionType.expense, order=0)
        )
        subs = categories.create(
            CategoryIn(name="Subscriptions", type=TransactionType.expense, order=0)
        )

        RuleService(session).create(
            RuleIn(
                name="Netflix → Subscriptions",
                enabled=True,
                priority=10,
                match_type=RuleMatchType.contains,
                match_value="netflix",
                transaction_type=TransactionType.expense,
                min_amount_cents=None,
                max_amount_cents=None,
                set_category_id=subs.id,
                add_tags=["Streaming"],
                budget_exclude_tag_id=None,
            )
        )

        # When user picks a specific non-Uncategorized category, rules should NOT change it
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2025, 1, 5),
                occurred_at=datetime(2025, 1, 5, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=food.id,
                title="Netflix January",
                tags=[],
            )
        )

        # Rule should NOT have changed the category - user explicitly chose Food
        assert txn.category_id == food.id
        # But tags should still be added (tags are always safe to add)
        tag_names = {t.name for t in txn.tags}
        assert "Streaming" in tag_names


def test_deleting_tag_removes_rule_add_tags_reference() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        uncategorized = categories.create(
            CategoryIn(name="Uncategorized", type=TransactionType.expense, order=0)
        )
        tag = TagService(session).create("AutoTag")

        RuleService(session).create(
            RuleIn(
                name="Netflix auto-tag",
                enabled=True,
                priority=10,
                match_type=RuleMatchType.contains,
                match_value="netflix",
                transaction_type=TransactionType.expense,
                min_amount_cents=None,
                max_amount_cents=None,
                set_category_id=uncategorized.id,
                add_tags=["AutoTag"],
                budget_exclude_tag_id=None,
            )
        )

        TagService(session).delete(tag.id)
        assert TagService(session).list_all() == []

        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2025, 1, 5),
                occurred_at=datetime(2025, 1, 5, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=uncategorized.id,
                title="Netflix January",
                tags=[],
            )
        )

        assert txn.tags == []
        assert TagService(session).list_all() == []


def test_rule_does_not_set_category_across_types() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        expense_cat = categories.create(
            CategoryIn(name="Food", type=TransactionType.expense, order=0)
        )
        income_cat = categories.create(
            CategoryIn(name="Salary", type=TransactionType.income, order=0)
        )

        with pytest.raises(ValueError, match="Category type mismatch"):
            RuleService(session).create(
                RuleIn(
                    name="Salary keyword sets income category (should not apply)",
                    enabled=True,
                    priority=10,
                    match_type=RuleMatchType.contains,
                    match_value="salary",
                    transaction_type=TransactionType.expense,
                    min_amount_cents=None,
                    max_amount_cents=None,
                    set_category_id=income_cat.id,
                    add_tags=[],
                    budget_exclude_tag_id=None,
                )
            )

        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2025, 1, 1),
                occurred_at=datetime(2025, 1, 1, 9, 0),
                type=TransactionType.expense,
                amount_cents=500,
                category_id=expense_cat.id,
                title="salary test",
                tags=[],
            )
        )
        assert txn.category_id == expense_cat.id


def test_rule_applies_when_update_clears_category_to_uncategorized() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        categories.create(
            CategoryIn(name="Uncategorized", type=TransactionType.expense, order=0)
        )
        food = categories.create(
            CategoryIn(name="Food", type=TransactionType.expense, order=0)
        )
        subs = categories.create(
            CategoryIn(name="Subscriptions", type=TransactionType.expense, order=0)
        )

        RuleService(session).create(
            RuleIn(
                name="Netflix → Subscriptions",
                enabled=True,
                priority=10,
                match_type=RuleMatchType.contains,
                match_value="netflix",
                transaction_type=TransactionType.expense,
                min_amount_cents=None,
                max_amount_cents=None,
                set_category_id=subs.id,
                add_tags=["Streaming"],
                budget_exclude_tag_id=None,
            )
        )

        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2025, 1, 5),
                occurred_at=datetime(2025, 1, 5, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=food.id,
                title="Netflix January",
                tags=[],
            )
        )

        txn = TransactionService(session).update(
            txn.id,
            TransactionIn(
                date=date(2025, 1, 5),
                occurred_at=datetime(2025, 1, 5, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=None,
                title="Netflix January",
                tags=[],
            ),
        )

        assert txn.category_id == subs.id
        assert {tag.name for tag in txn.tags} == {"Streaming"}


def test_rule_applies_during_csv_import_when_category_is_uncategorized() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        categories.create(
            CategoryIn(name="Uncategorized", type=TransactionType.expense, order=0)
        )
        subs = categories.create(
            CategoryIn(name="Subscriptions", type=TransactionType.expense, order=0)
        )

        RuleService(session).create(
            RuleIn(
                name="Netflix → Subscriptions",
                enabled=True,
                priority=10,
                match_type=RuleMatchType.contains,
                match_value="netflix",
                transaction_type=TransactionType.expense,
                min_amount_cents=None,
                max_amount_cents=None,
                set_category_id=subs.id,
                add_tags=["Streaming"],
                budget_exclude_tag_id=None,
            )
        )

        imported_count = CSVService(session).commit(
            "Date,Type,IsReimbursement,Amount,Category,Title\n"
            "2025-01-05,expense,0,12.99,Uncategorized,Netflix January\n"
        )

        txn = session.scalar(select(Transaction))

        assert imported_count == 1
        assert txn is not None
        assert txn.category_id == subs.id
        assert {tag.name for tag in txn.tags} == {"Streaming"}


def test_rule_service_rejects_regex_over_configured_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EXPENSES_RULE_REGEX_MAX_LENGTH", "3")
    get_settings.cache_clear()
    try:
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)

        with Session(engine) as session:
            with pytest.raises(ValueError, match="Regex pattern is too long"):
                RuleService(session).create(
                    RuleIn(
                        name="Unsafe regex",
                        enabled=True,
                        priority=10,
                        match_type=RuleMatchType.regex,
                        match_value="abcd",
                    )
                )
    finally:
        get_settings.cache_clear()
