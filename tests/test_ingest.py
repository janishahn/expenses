from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from expenses_web.db.session import Base
from expenses_web.db.models import Category, RuleMatchType, TransactionType
from expenses_web.schemas import CategoryIn, IngestTransactionIn, RuleIn
from expenses_web.services import (
    CategoryService,
    IngestCategoryAmbiguous,
    IngestService,
    RuleService,
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


def test_ingest_stores_location_when_both_coordinates_are_present() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        result = IngestService(session).ingest_expense(
            IngestTransactionIn(
                amount_cents=790,
                title="Train ticket",
                date=date(2025, 1, 7),
                latitude=Decimal("52.5200084"),
                longitude=Decimal("13.4049544"),
            )
        )

        txn = result.transaction
        assert result.location_status == "stored"
        assert txn.latitude == Decimal("52.520008")
        assert txn.longitude == Decimal("13.404954")


def test_ingest_ignores_partial_location_when_only_latitude_is_present() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        result = IngestService(session).ingest_expense(
            IngestTransactionIn(
                amount_cents=1100,
                title="Bakery",
                date=date(2025, 1, 8),
                latitude=Decimal("120.000000"),
            )
        )

        txn = result.transaction
        assert result.location_status == "ignored_partial"
        assert txn.latitude is None
        assert txn.longitude is None


def test_ingest_ignores_when_both_coordinates_are_present_and_out_of_range() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        result = IngestService(session).ingest_expense(
            IngestTransactionIn(
                amount_cents=1500,
                title="Groceries",
                date=date(2025, 1, 9),
                latitude=Decimal("91"),
                longitude=Decimal("13.4"),
            )
        )

        txn = result.transaction
        assert result.location_status == "ignored_partial"
        assert txn.latitude is None
        assert txn.longitude is None


def test_ingest_ignores_location_when_latitude_is_a_string() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        payload = IngestTransactionIn.model_validate(
            {
                "amount_cents": 900,
                "title": "Snack",
                "date": "2025-01-09",
                "latitude": "north",
                "longitude": 13.4,
            }
        )
        result = IngestService(session).ingest_expense(payload)

        txn = result.transaction
        assert result.location_status == "ignored_partial"
        assert txn.latitude is None
        assert txn.longitude is None


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


def test_ingest_stores_location_when_coordinates_are_numeric_strings() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        payload = IngestTransactionIn.model_validate(
            {
                "amount_cents": 900,
                "title": "Snack",
                "date": "2025-01-09",
                "latitude": "52.520008",
                "longitude": "13.404954",
            }
        )
        result = IngestService(session).ingest_expense(payload)

        txn = result.transaction
        assert result.location_status == "stored"
        assert txn.latitude == Decimal("52.520008")
        assert txn.longitude == Decimal("13.404954")
