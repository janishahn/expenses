from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from expenses_web.db.session import Base
from expenses_web.db.models import (
    Category,
    CurrencyCode,
    IntervalUnit,
    MonthDayPolicy,
    RecurringRule,
    Transaction,
    TransactionType,
)
from expenses_web.recurrence.engine import RecurringEngine, calculate_next_date


def _rule(policy: MonthDayPolicy, skip_weekends: bool = False) -> RecurringRule:
    return RecurringRule(
        id=1,
        user_id=1,
        name="Test",
        type=TransactionType.expense,
        currency_code=CurrencyCode.eur,
        amount_cents=1000,
        category_id=1,
        anchor_date=date(2024, 1, 31),
        interval_unit=IntervalUnit.month,
        interval_count=1,
        next_occurrence=date(2024, 1, 31),
        end_date=None,
        auto_post=True,
        skip_weekends=skip_weekends,
        month_day_policy=policy,
    )


def test_calculate_next_date_snap_to_end():
    rule = _rule(MonthDayPolicy.snap_to_end)
    assert calculate_next_date(rule, date(2024, 1, 31)) == date(2024, 2, 29)


def test_calculate_next_date_skip_policy():
    rule = _rule(MonthDayPolicy.skip)
    assert calculate_next_date(rule, date(2024, 1, 31)) == date(2024, 3, 31)


def test_calculate_next_date_weekend_shift():
    rule = _rule(MonthDayPolicy.snap_to_end, skip_weekends=True)
    # Skip weekends ensures we nudge forward if result lands on Saturday/Sunday.
    next_date = calculate_next_date(rule, date(2024, 3, 29))
    assert next_date == date(2024, 4, 30)


def test_recurring_engine_idempotent_posts():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        category = Category(
            user_id=1,
            name="Rent",
            type=TransactionType.expense,
            color="#ffffff",
        )
        session.add(category)
        session.flush()
        rule = RecurringRule(
            user_id=1,
            name="Rent",
            type=TransactionType.expense,
            currency_code=CurrencyCode.eur,
            amount_cents=10000,
            category_id=category.id,
            anchor_date=date(2024, 1, 1),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=date(2024, 1, 1),
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        )
        session.add(rule)
        session.commit()

    with Session(engine) as session:
        rule = session.query(RecurringRule).first()
        recurring = RecurringEngine(session)
        recurring.catch_up_rule(rule, today=date(2024, 3, 1))
        session.commit()

    with Session(engine) as session:
        rule = session.query(RecurringRule).first()
        assert rule.next_occurrence > date(2024, 3, 1)
        recurring = RecurringEngine(session)
        recurring.catch_up_rule(rule, today=date(2024, 3, 1))
        session.commit()
        txn_count = (
            session.query(Transaction)
            .filter(Transaction.origin_rule_id == rule.id)
            .count()
        )
        assert txn_count == 3


def test_recurring_engine_posts_usd_rule_with_historical_rate(monkeypatch):
    from decimal import Decimal
    from datetime import datetime, timezone

    from expenses_web.infra.fx_rates import FxQuote

    def fake_convert(self, usd_cents: int, on_date: date):
        assert usd_cents == 12345
        assert on_date == date(2024, 1, 1)
        quote = FxQuote(
            provider="ecb",
            base="USD",
            quote="EUR",
            rate=Decimal("0.85"),
            rate_date=date(2023, 12, 29),
            fetched_at=datetime(2024, 1, 2, tzinfo=timezone.utc),
            source="live",
        )
        # 12345 * 0.85 = 10493.25 -> 10493 (half-up)
        return 10493, quote

    monkeypatch.setattr(
        "expenses_web.infra.fx_rates.FxRateService.convert_usd_cents_to_eur_cents",
        fake_convert,
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        category = Category(
            user_id=1,
            name="USD Expense",
            type=TransactionType.expense,
            color="#ffffff",
        )
        session.add(category)
        session.flush()
        rule = RecurringRule(
            user_id=1,
            name="USD Rule",
            type=TransactionType.expense,
            currency_code=CurrencyCode.usd,
            amount_cents=12345,
            category_id=category.id,
            anchor_date=date(2024, 1, 1),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=date(2024, 1, 1),
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        )
        session.add(rule)
        session.commit()

    with Session(engine) as session:
        rule = session.query(RecurringRule).first()
        recurring = RecurringEngine(session)
        recurring.catch_up_rule(rule, today=date(2024, 1, 1))
        session.commit()

        txn = (
            session.query(Transaction)
            .filter(Transaction.origin_rule_id == rule.id)
            .one()
        )
        assert txn.amount_cents == 10493
        assert txn.source_currency_code == CurrencyCode.usd
        assert txn.source_amount_cents == 12345
        assert txn.fx_provider == "ecb"
        assert txn.fx_rate_micros is not None
        assert txn.fx_rate_date == date(2023, 12, 29)


def test_recurring_engine_does_not_advance_on_fx_failure(monkeypatch):
    def fake_convert(self, usd_cents: int, on_date: date):
        raise RuntimeError("FX down")

    monkeypatch.setattr(
        "expenses_web.infra.fx_rates.FxRateService.convert_usd_cents_to_eur_cents",
        fake_convert,
    )

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        category = Category(
            user_id=1,
            name="USD Expense",
            type=TransactionType.expense,
            color="#ffffff",
        )
        session.add(category)
        session.flush()
        rule = RecurringRule(
            user_id=1,
            name="USD Rule",
            type=TransactionType.expense,
            currency_code=CurrencyCode.usd,
            amount_cents=1000,
            category_id=category.id,
            anchor_date=date(2024, 1, 1),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=date(2024, 1, 1),
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        )
        session.add(rule)
        session.commit()

    with Session(engine) as session:
        rule = session.query(RecurringRule).first()
        recurring = RecurringEngine(session)
        recurring.catch_up_rule(rule, today=date(2024, 1, 1))
        session.commit()

        assert rule.next_occurrence == date(2024, 1, 1)
        txn_count = session.query(Transaction).count()
        assert txn_count == 0


def test_post_due_rules_continues_when_one_rule_hits_db_error(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        category = Category(
            user_id=1,
            name="Subscriptions",
            type=TransactionType.expense,
            color="#ffffff",
        )
        session.add(category)
        session.flush()
        broken_rule = RecurringRule(
            user_id=1,
            name="Broken",
            type=TransactionType.expense,
            currency_code=CurrencyCode.eur,
            amount_cents=1000,
            category_id=category.id,
            anchor_date=date(2024, 1, 1),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=date(2024, 1, 1),
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        )
        healthy_rule = RecurringRule(
            user_id=1,
            name="Healthy",
            type=TransactionType.expense,
            currency_code=CurrencyCode.eur,
            amount_cents=1000,
            category_id=category.id,
            anchor_date=date(2024, 1, 1),
            interval_unit=IntervalUnit.month,
            interval_count=1,
            next_occurrence=date(2024, 1, 1),
            auto_post=True,
            skip_weekends=False,
            month_day_policy=MonthDayPolicy.snap_to_end,
        )
        session.add_all([broken_rule, healthy_rule])
        session.commit()

    def fake_post(self, rule, occurrence_date):
        if rule.name == "Broken":
            raise SQLAlchemyError("database is locked")
        return True

    monkeypatch.setattr(RecurringEngine, "_post_occurrence", fake_post)

    with Session(engine) as session:
        recurring = RecurringEngine(session)
        advanced = recurring.post_due_rules(today=date(2024, 1, 1))
        session.commit()
        broken = (
            session.query(RecurringRule).filter(RecurringRule.name == "Broken").one()
        )
        healthy = (
            session.query(RecurringRule).filter(RecurringRule.name == "Healthy").one()
        )
        assert advanced == 1
        assert broken.next_occurrence == date(2024, 1, 1)
        assert healthy.next_occurrence == date(2024, 2, 1)


def test_scheduler_style_catch_up_posts_for_multiple_users():
    from sqlalchemy import select

    from expenses_web.db.models import User
    from expenses_web.services import RecurringRuleService

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        session.add_all(
            [
                User(id=1, username="bootstrap", password_hash="x", is_admin=True),
                User(id=2, username="member", password_hash="x", is_admin=False),
            ]
        )
        session.flush()

        category_admin = Category(
            user_id=1,
            name="Admin recurring",
            type=TransactionType.expense,
            color="#ffffff",
        )
        category_member = Category(
            user_id=2,
            name="Member recurring",
            type=TransactionType.expense,
            color="#ffffff",
        )
        session.add_all([category_admin, category_member])
        session.flush()

        session.add_all(
            [
                RecurringRule(
                    user_id=1,
                    name="Admin overdue",
                    type=TransactionType.expense,
                    currency_code=CurrencyCode.eur,
                    amount_cents=1000,
                    category_id=category_admin.id,
                    anchor_date=date(2024, 1, 1),
                    interval_unit=IntervalUnit.month,
                    interval_count=1,
                    next_occurrence=date(2024, 1, 1),
                    auto_post=True,
                    skip_weekends=False,
                    month_day_policy=MonthDayPolicy.snap_to_end,
                ),
                RecurringRule(
                    user_id=2,
                    name="Member overdue",
                    type=TransactionType.expense,
                    currency_code=CurrencyCode.eur,
                    amount_cents=2000,
                    category_id=category_member.id,
                    anchor_date=date(2024, 1, 1),
                    interval_unit=IntervalUnit.month,
                    interval_count=1,
                    next_occurrence=date(2024, 1, 1),
                    auto_post=True,
                    skip_weekends=False,
                    month_day_policy=MonthDayPolicy.snap_to_end,
                ),
            ]
        )
        session.commit()

    with Session(engine) as session:
        posted_rules = RecurringRuleService(session).catch_up_all()
        session.commit()

        rows = session.execute(
            select(Transaction.user_id, Transaction.title).where(
                Transaction.title.in_(["Admin overdue", "Member overdue"])
            )
        ).all()

        assert posted_rules >= 2
        assert {(int(row.user_id), str(row.title)) for row in rows} == {
            (1, "Admin overdue"),
            (2, "Member overdue"),
        }
