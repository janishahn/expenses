from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from expenses.db.session import Base
from expenses.db.models import TransactionType
from expenses.schemas import CategoryIn, TransactionIn
from expenses.services import CategoryService, TagService, TransactionService


def test_deleting_used_tag_clears_associations() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        category = CategoryService(session).create(
            CategoryIn(name="Food", type=TransactionType.expense, order=0)
        )
        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2025, 1, 5),
                occurred_at=datetime(2025, 1, 5, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=category.id,
                title="Lunch",
                tags=["Dining"],
            )
        )
        tag = TagService(session).list_all()[0]

        TagService(session).delete(tag.id)

        txn_after = TransactionService(session).get(txn.id)
        assert txn_after.tags == []


def test_transaction_tag_inputs_are_deduplicated_case_insensitive() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        category = CategoryService(session).create(
            CategoryIn(name="Food", type=TransactionType.expense, order=0)
        )

        txn = TransactionService(session).create(
            TransactionIn(
                date=date(2025, 1, 5),
                occurred_at=datetime(2025, 1, 5, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=category.id,
                title="Lunch",
                tags=["Dining", "dining", " DINING "],
            )
        )

        assert len(txn.tags) == 1
        assert txn.tags[0].name == "Dining"


def test_archived_tag_round_trips_through_transaction_edit_without_restoring() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        category = CategoryService(session).create(
            CategoryIn(name="Travel", type=TransactionType.expense, order=0)
        )
        txn_service = TransactionService(session)
        txn = txn_service.create(
            TransactionIn(
                date=date(2025, 1, 5),
                occurred_at=datetime(2025, 1, 5, 12, 0),
                type=TransactionType.expense,
                amount_cents=1299,
                category_id=category.id,
                title="Museum",
                tags=["Vacation"],
            )
        )
        tag_service = TagService(session)
        tag = tag_service.list_all()[0]
        tag_service.archive(tag.id)

        resolved = tag_service.get_or_create("Vacation")
        assert resolved.archived_at is not None

        updated = txn_service.update(
            txn.id,
            TransactionIn(
                date=txn.date,
                occurred_at=txn.occurred_at,
                type=txn.type,
                amount_cents=txn.amount_cents,
                category_id=txn.category_id,
                title="Museum tickets",
                tags=["Vacation"],
            ),
        )

        assert [item.name for item in updated.tags] == ["Vacation"]
        assert tag_service.list_all() == []
        assert tag_service.list_all(include_archived=True)[0].archived_at is not None
