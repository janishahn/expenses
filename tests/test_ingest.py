from datetime import date, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from expenses.db.session import Base
from expenses.db.models import Category, RuleMatchType, TransactionType
from expenses.schemas import CategoryIn, IngestTransactionIn, RuleIn
from expenses.services import (
    CategoryService,
    IngestCategoryAmbiguous,
    IngestService,
    RuleService,
    TagService,
)


def test_ingest_creates_and_uses_uncategorized_default() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        result = IngestService(session).ingest_expense(
            IngestTransactionIn(
                amount_cents=1234, title="Coffee", date=date(2025, 1, 1)
            )
        )
        txn = result.transaction
        assert txn.type == TransactionType.expense
        assert txn.category.name == "Uncategorized"
        assert result.location_status == "not_provided"
        assert txn.latitude is None
        assert txn.longitude is None

        categories = session.scalars(
            select(Category).where(Category.type == txn.type)
        ).all()
        assert [c.name for c in categories] == ["Uncategorized"]


def test_ingest_matches_existing_category_case_insensitive() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        food = CategoryService(session).create(
            CategoryIn(name="Food", type=TransactionType.expense, order=0)
        )
        result = IngestService(session).ingest_expense(
            IngestTransactionIn(
                amount_cents=500,
                title="Lunch",
                date=date(2025, 1, 2),
                category="food",
            )
        )
        txn = result.transaction
        assert txn.category_id == food.id
        assert txn.category.name == "Food"
        assert result.location_status == "not_provided"


def test_ingest_fuzzy_matches_within_one_edit() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        subs = CategoryService(session).create(
            CategoryIn(name="Subscriptions", type=TransactionType.expense, order=0)
        )
        result = IngestService(session).ingest_expense(
            IngestTransactionIn(
                amount_cents=1299,
                title="Netflix",
                date=date(2025, 1, 3),
                category="Subscriptioms",
            )
        )
        txn = result.transaction
        assert txn.category_id == subs.id


def test_ingest_creates_category_when_not_found() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        result = IngestService(session).ingest_expense(
            IngestTransactionIn(
                amount_cents=2500,
                title="Gym",
                date=date(2025, 1, 4),
                category="Health & Fitness",
            )
        )
        txn = result.transaction
        assert txn.category.name == "Health & Fitness"


def test_ingest_raises_on_ambiguous_fuzzy_match() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        CategoryService(session).create(
            CategoryIn(name="Food", type=TransactionType.expense, order=0)
        )
        CategoryService(session).create(
            CategoryIn(name="Fool", type=TransactionType.expense, order=0)
        )
        with pytest.raises(IngestCategoryAmbiguous):
            IngestService(session).ingest_expense(
                IngestTransactionIn(
                    amount_cents=100,
                    title="Test",
                    date=date(2025, 1, 5),
                    category="Foob",
                )
            )


def test_ingest_can_be_recategorized_by_rules() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
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
                add_tags=[],
                budget_exclude_tag_id=None,
            )
        )

        result = IngestService(session).ingest_expense(
            IngestTransactionIn(
                amount_cents=1299,
                title="Netflix January",
                date=date(2025, 1, 6),
            )
        )
        txn = result.transaction
        assert txn.category_id == subs.id


def test_ingest_applies_only_active_auto_attach_tags() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        tags = TagService(session)
        tags.create(
            "Vacation",
            auto_attach_start_date=date(2026, 8, 10),
            auto_attach_end_date=date(2026, 8, 17),
        )
        tags.create(
            "Future",
            auto_attach_start_date=date(2026, 8, 20),
            auto_attach_end_date=date(2026, 8, 25),
        )
        archived = tags.create(
            "Archived",
            auto_attach_start_date=date(2026, 8, 10),
            auto_attach_end_date=date(2026, 8, 17),
        )
        tags.archive(archived.id)

        in_range = (
            IngestService(session)
            .ingest_expense(
                IngestTransactionIn(
                    amount_cents=900,
                    title="Museum",
                    date=date(2026, 8, 17),
                )
            )
            .transaction
        )
        assert [tag.name for tag in in_range.tags] == ["Vacation"]

        out_of_range = (
            IngestService(session)
            .ingest_expense(
                IngestTransactionIn(
                    amount_cents=500,
                    title="Coffee",
                    date=date(2026, 8, 18),
                )
            )
            .transaction
        )
        assert out_of_range.tags == []


def test_ingest_ignores_location_when_latitude_is_false() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        payload = IngestTransactionIn.model_validate(
            {
                "amount_cents": 900,
                "title": "Snack",
                "date": "2025-01-09",
                "latitude": False,
            }
        )
        result = IngestService(session).ingest_expense(payload)

        txn = result.transaction
        assert result.location_status == "ignored_partial"
        assert txn.latitude is None
        assert txn.longitude is None


def test_ingest_with_a_date_stores_a_time_on_that_date() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        txn = (
            IngestService(session)
            .ingest_expense(
                IngestTransactionIn(
                    amount_cents=1299, title="Coffee", date=date(2025, 3, 20)
                )
            )
            .transaction
        )
        assert txn.date == date(2025, 3, 20)
        assert txn.occurred_at == datetime(2025, 3, 20, 12, 0)


def test_ingest_matches_non_ascii_and_archived_category_names_exactly() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        categories = CategoryService(session)
        doctors = categories.create(
            CategoryIn(name="Ärzte", type=TransactionType.expense, order=0)
        )
        stay = categories.create(
            CategoryIn(name="Übernachtung", type=TransactionType.expense, order=0)
        )
        food = categories.create(
            CategoryIn(name="Food", type=TransactionType.expense, order=0)
        )
        food2 = categories.create(
            CategoryIn(name="Food2", type=TransactionType.expense, order=0)
        )
        for category in (doctors, stay, food2):
            categories.archive(category.id)

        def ingest(name: str):
            return (
                IngestService(session)
                .ingest_expense(
                    IngestTransactionIn(
                        amount_cents=100,
                        title="Item",
                        date=date(2025, 1, 2),
                        category=name,
                    )
                )
                .transaction
            )

        assert ingest("Ärzte").category_id == doctors.id
        assert ingest("übernachtung").category_id == stay.id
        # A merged-away name keeps going to the active category one edit away.
        assert ingest("food2").category_id == food.id
        names = session.scalars(
            select(Category.name).where(
                Category.type == TransactionType.expense,
                Category.archived_at.is_(None),
            )
        ).all()
        assert sorted(names) == ["Food", "Ärzte", "Übernachtung"]


def test_ingest_uses_a_category_another_request_created_meanwhile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        create = CategoryService.create

        def created_elsewhere_first(self, data: CategoryIn):
            session.add(
                Category(user_id=self.user_id, name="Travel", type=data.type, order=0)
            )
            session.commit()
            return create(self, data)

        monkeypatch.setattr(CategoryService, "create", created_elsewhere_first)
        txn = (
            IngestService(session)
            .ingest_expense(
                IngestTransactionIn(
                    amount_cents=100,
                    title="Train",
                    date=date(2025, 1, 2),
                    category="Travel",
                )
            )
            .transaction
        )
        assert txn.category.name == "Travel"
