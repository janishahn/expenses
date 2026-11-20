from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from expenses.db.session import Base
from expenses.db.models import Tag, TransactionType
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


def test_existing_non_ascii_tag_is_reused_in_any_case() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        tag_service = TagService(session)
        tag = tag_service.create("ÖPNV")

        assert tag_service.get_or_create("ÖPNV").id == tag.id
        assert tag_service.get_or_create("öpnv").id == tag.id
        try:
            tag_service.create("öpnv")
        except ValueError as exc:
            assert str(exc) == "Tag already exists"
        else:
            raise AssertionError("duplicate tag was created")
        other = tag_service.create("Ärzte")
        try:
            tag_service.update(other.id, "öpnv", is_hidden_from_budget=False)
        except ValueError as exc:
            assert str(exc) == "Tag with this name already exists"
        else:
            raise AssertionError("tag was renamed onto an existing name")


def test_typing_an_archived_tag_name_is_refused() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        category = CategoryService(session).create(
            CategoryIn(name="Travel", type=TransactionType.expense, order=0)
        )
        tag_service = TagService(session)
        holiday = tag_service.create("Holiday")
        travel = tag_service.create("Trips")
        tag_service.merge(holiday.id, travel.id)

        def create(tags: list[str]):
            return TransactionService(session).create(
                TransactionIn(
                    date=date(2025, 1, 5),
                    occurred_at=datetime(2025, 1, 5, 12, 0),
                    type=TransactionType.expense,
                    amount_cents=1299,
                    category_id=category.id,
                    title="Museum",
                    tags=tags,
                )
            )

        try:
            create(["holiday"])
        except ValueError as exc:
            assert "archived" in str(exc)
            assert '"Holiday"' in str(exc)
        else:
            raise AssertionError("archived tag was attached")
        session.rollback()
        assert [tag.name for tag in create(["Trips"]).tags] == ["Trips"]


def test_tags_differing_only_in_case_stay_editable() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        # Earlier versions could store both spellings.
        session.add_all([Tag(user_id=1, name="ÖPNV"), Tag(user_id=1, name="öpnv")])
        session.commit()
        tag_service = TagService(session)
        lower = next(tag for tag in tag_service.list_all() if tag.name == "öpnv")

        updated = tag_service.update(lower.id, "öpnv", is_hidden_from_budget=True)

        assert updated.is_hidden_from_budget is True
        assert tag_service.get_or_create("öpnv").id == lower.id
