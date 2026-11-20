from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from expenses.db.session import Base
from expenses.db.models import (
    Category,
    CurrencyCode,
    IntervalUnit,
    MonthDayPolicy,
    RecurringRule,
    Transaction,
    TransactionType,
)
from expenses.recurrence.engine import RecurringEngine, calculate_next_date


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

    from expenses.infra.fx_rates import FxQuote

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
        "expenses.infra.fx_rates.FxRateService.convert_usd_cents_to_eur_cents",
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
        "expenses.infra.fx_rates.FxRateService.convert_usd_cents_to_eur_cents",
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

    from expenses.db.models import User
    from expenses.services import RecurringRuleService

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


def _schedule_rule(
    anchor: date,
    *,
    unit: IntervalUnit = IntervalUnit.month,
    count: int = 1,
    policy: MonthDayPolicy = MonthDayPolicy.snap_to_end,
    skip_weekends: bool = True,
) -> RecurringRule:
    return RecurringRule(
        user_id=1,
        name="Schedule",
        type=TransactionType.expense,
        currency_code=CurrencyCode.eur,
        amount_cents=1000,
        category_id=1,
        anchor_date=anchor,
        interval_unit=unit,
        interval_count=count,
        next_occurrence=anchor,
        auto_post=True,
        skip_weekends=skip_weekends,
        month_day_policy=policy,
    )


def _walk(rule: RecurringRule, start: date, steps: int) -> list[date]:
    dates = [start]
    for _ in range(steps):
        dates.append(calculate_next_date(rule, dates[-1]))
    return dates


def _month_index(day: date) -> int:
    return day.year * 12 + day.month - 1


def _moved_to_monday(day: date) -> date:
    return day + timedelta(days=7 - day.weekday()) if day.weekday() >= 5 else day


def _expected_nominal(
    anchor: date, months_step: int, count: int, policy: MonthDayPolicy
) -> list[date]:
    """Nominal dates built without the engine: whole intervals from the anchor."""
    out: list[date] = []
    index = _month_index(anchor)
    while len(out) < count:
        year, month = divmod(index, 12)
        last = monthrange(year, month + 1)[1]
        if anchor.day <= last:
            out.append(date(year, month + 1, anchor.day))
        elif policy == MonthDayPolicy.snap_to_end:
            out.append(date(year, month + 1, last))
        index += months_step
    return out


def test_weekend_shift_across_month_end_keeps_every_period():
    cases = [
        (anchor, policy, months_step)
        for anchor in (
            date(2025, 10, 30),
            date(2025, 12, 31),
            date(2024, 1, 31),
            date(2025, 5, 29),
            date(2025, 2, 28),
        )
        for policy in (MonthDayPolicy.snap_to_end, MonthDayPolicy.skip)
        for months_step in (1, 2, 3)
    ]
    cases += [
        (date(2022, 12, 31), MonthDayPolicy.snap_to_end, 12),
        (date(2024, 2, 29), MonthDayPolicy.snap_to_end, 12),
        (date(2024, 2, 29), MonthDayPolicy.skip, 12),
    ]
    for anchor, policy, months_step in cases:
        if months_step == 12:
            rule = _schedule_rule(anchor, unit=IntervalUnit.year, policy=policy)
        else:
            rule = _schedule_rule(anchor, count=months_step, policy=policy)
        expected = _expected_nominal(anchor, months_step, 26, policy)
        # The first occurrence posts as stored; later ones move off weekends.
        walked = _walk(rule, anchor, 25)
        assert walked == [anchor] + [_moved_to_monday(day) for day in expected[1:]], (
            anchor,
            policy,
            months_step,
        )
    # The cases include Saturday and Sunday month ends.
    assert date(2025, 11, 30).weekday() == 6
    assert date(2026, 2, 28).weekday() == 5


def _expected_carry_forward(anchor: date, count: int) -> list[date]:
    """Nominal "use previous month's day" dates: a day cut to a month end stays cut."""
    out: list[date] = []
    index = _month_index(anchor)
    day = anchor.day
    while len(out) < count:
        year, month = divmod(index, 12)
        day = min(day, monthrange(year, month + 1)[1])
        out.append(date(year, month + 1, day))
        index += 1
    return out


def test_weekend_shift_carry_forward_posts_once_per_month():
    for anchor in (
        date(2024, 1, 29),
        date(2024, 1, 30),
        date(2024, 1, 31),
        date(2025, 3, 31),
        date(2025, 6, 30),
    ):
        rule = _schedule_rule(anchor, policy=MonthDayPolicy.carry_forward)
        expected = _expected_carry_forward(anchor, 31)
        walked = _walk(rule, anchor, 30)
        assert walked == [anchor] + [_moved_to_monday(d) for d in expected[1:]], anchor


def test_weekend_shift_carry_forward_keeps_a_scheduled_monday():
    # Monday 2025-03-31 is the scheduled day itself, not a moved Saturday.
    rule = _schedule_rule(date(2025, 3, 31), policy=MonthDayPolicy.carry_forward)
    assert _walk(rule, date(2025, 3, 31), 15) == [
        date(2025, 3, 31),
        date(2025, 4, 30),
        date(2025, 5, 30),
        date(2025, 6, 30),  # scheduled Monday
        date(2025, 7, 30),
        date(2025, 9, 1),  # Saturday 30 August moved
        date(2025, 9, 30),
        date(2025, 10, 30),
        date(2025, 12, 1),  # Sunday 30 November moved
        date(2025, 12, 30),
        date(2026, 1, 30),
        date(2026, 3, 2),  # Saturday 28 February moved
        date(2026, 3, 30),  # Saturday 28 March moved
        date(2026, 4, 28),
        date(2026, 5, 28),
        date(2026, 6, 29),  # Sunday 28 June moved
    ]
    # A Monday set by hand off the schedule still reads as a moved Sunday 28th.
    assert calculate_next_date(rule, date(2025, 9, 29)) == date(2025, 10, 28)


def test_stored_monday_after_weekend_shift_resumes_on_rule_day():
    # Stored before the fix: Sunday 2025-11-30 was moved to Monday 2025-12-01.
    rule = _schedule_rule(date(2025, 10, 30))
    assert calculate_next_date(rule, date(2025, 12, 1)) == date(2025, 12, 30)
    # Saturday 2026-02-28 moved to Monday 2026-03-02.
    assert calculate_next_date(rule, date(2026, 3, 2)) == date(2026, 3, 30)


def test_weekend_shift_keeps_off_anchor_cadence():
    # Every two months on the 31st, set by the user to the months after the anchor's.
    rule = _schedule_rule(date(2025, 1, 31), count=2)
    # Saturday 2026-02-28 moved to Monday; the stored Monday stands for February.
    assert calculate_next_date(rule, date(2026, 3, 2)) == date(2026, 4, 30)
    assert calculate_next_date(rule, date(2026, 4, 30)) == date(2026, 6, 30)
    # A yearly rule stored in a month other than its anchor's stays there.
    yearly = _schedule_rule(date(2024, 1, 31), unit=IntervalUnit.year)
    assert calculate_next_date(yearly, date(2025, 4, 30)) == date(2026, 4, 30)
    # A weekly rule keeps the weekday it is stored on.
    weekly = _schedule_rule(date(2025, 1, 4), unit=IntervalUnit.week)
    assert calculate_next_date(weekly, date(2025, 1, 7)) == date(2025, 1, 14)


def test_catch_up_with_weekend_shift_posts_each_month():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        category = Category(
            user_id=1, name="Rent", type=TransactionType.expense, color="#ffffff"
        )
        session.add(category)
        session.flush()
        rule = _schedule_rule(date(2024, 1, 31))
        rule.category_id = category.id
        session.add(rule)
        session.commit()
        RecurringEngine(session).catch_up_rule(rule, today=date(2026, 2, 2))
        session.commit()
        posted = sorted(
            session.scalars(
                select(Transaction.date).where(Transaction.origin_rule_id == rule.id)
            ).all()
        )
    expected = _expected_nominal(date(2024, 1, 31), 1, 25, MonthDayPolicy.snap_to_end)
    assert posted == [date(2024, 1, 31)] + [_moved_to_monday(d) for d in expected[1:]]


def test_skip_policy_skips_whole_intervals():
    leap = _schedule_rule(
        date(2024, 2, 29),
        unit=IntervalUnit.year,
        policy=MonthDayPolicy.skip,
        skip_weekends=False,
    )
    assert _walk(leap, leap.anchor_date, 3) == [
        date(2024, 2, 29),
        date(2028, 2, 29),
        date(2032, 2, 29),
        date(2036, 2, 29),
    ]
    every_two = _schedule_rule(
        date(2025, 1, 31), count=2, policy=MonthDayPolicy.skip, skip_weekends=False
    )
    assert _walk(every_two, every_two.anchor_date, 5) == [
        date(2025, 1, 31),
        date(2025, 3, 31),
        date(2025, 5, 31),
        date(2025, 7, 31),
        date(2026, 1, 31),
        date(2026, 3, 31),
    ]


def test_skip_policy_in_a_month_without_the_day_uses_its_last_day():
    # A yearly rule on the 31st stored in April, which never has a 31st.
    rule = _schedule_rule(
        date(2024, 1, 31),
        unit=IntervalUnit.year,
        policy=MonthDayPolicy.skip,
        skip_weekends=False,
    )
    assert calculate_next_date(rule, date(2025, 4, 15)) == date(2026, 4, 30)


def test_post_due_rules_skips_rule_that_cannot_advance():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        category = Category(
            user_id=1, name="Subs", type=TransactionType.expense, color="#ffffff"
        )
        session.add(category)
        session.flush()
        for user_id, name, unit, count, start in [
            (1, "Huge month", IntervalUnit.month, 120000, date(2026, 1, 1)),
            (1, "Huge day", IntervalUnit.day, 5000000, date(2026, 1, 1)),
            (1, "Huge year", IntervalUnit.year, 10000, date(2026, 1, 1)),
            (2, "Normal", IntervalUnit.month, 1, date(2026, 2, 1)),
        ]:
            session.add(
                RecurringRule(
                    user_id=user_id,
                    name=name,
                    type=TransactionType.expense,
                    currency_code=CurrencyCode.eur,
                    amount_cents=1000,
                    category_id=category.id,
                    anchor_date=start,
                    interval_unit=unit,
                    interval_count=count,
                    next_occurrence=start,
                    auto_post=True,
                    skip_weekends=False,
                    month_day_policy=MonthDayPolicy.snap_to_end,
                )
            )
        session.commit()

    for _ in range(2):
        with Session(engine) as session:
            RecurringEngine(session).post_due_rules(today=date(2026, 11, 19))
            session.commit()

    with Session(engine) as session:
        counts = dict(
            session.execute(
                select(Transaction.title, func.count(Transaction.id)).group_by(
                    Transaction.title
                )
            ).all()
        )
    assert counts == {"Normal": 10, "Huge month": 1, "Huge day": 1, "Huge year": 1}


def _start_app_with_rules(monkeypatch, tmp_path, rules: list[dict]) -> Session:
    """Start the app as the API tests do, with the scheduler's startup catch-up
    reading a temporary database instead of the configured one."""
    from contextlib import contextmanager

    from fastapi.testclient import TestClient
    from sqlalchemy import event
    from sqlalchemy.orm import sessionmaker

    import expenses.app as app_main
    import expenses.recurrence.scheduling as scheduling
    from expenses.core.config import get_settings
    from expenses.db.session import _enable_sqlite_pragmas

    data_dir = tmp_path / "expenses_data"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(data_dir))
    monkeypatch.setenv("EXPENSES_RECEIPTS_DIR", str(data_dir / "receipts"))
    get_settings.cache_clear()
    data_dir.mkdir(parents=True)
    engine = create_engine(
        f"sqlite:///{data_dir / 'expenses.db'}",
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", _enable_sqlite_pragmas)
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with session_local() as session:
        category = Category(
            user_id=1, name="Subs", type=TransactionType.expense, color="#ffffff"
        )
        session.add(category)
        session.flush()
        for values in rules:
            session.add(
                RecurringRule(
                    user_id=1,
                    type=TransactionType.expense,
                    currency_code=CurrencyCode.eur,
                    amount_cents=1000,
                    category_id=category.id,
                    auto_post=True,
                    skip_weekends=False,
                    month_day_policy=MonthDayPolicy.snap_to_end,
                    **values,
                )
            )
        session.commit()

    @contextmanager
    def temp_session_scope():
        session = session_local()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr(scheduling, "session_scope", temp_session_scope)
    # The other startup jobs use the configured database; keep them from running.
    monkeypatch.setattr(app_main.scheduler_manager.scheduler, "start", lambda: None)
    monkeypatch.setattr(app_main.scheduler_manager, "stop", lambda: None)
    app_main.scheduler_manager.scheduler.remove_all_jobs()
    try:
        with TestClient(app_main.app):
            pass
    finally:
        get_settings.cache_clear()
    return session_local()


def test_app_starts_and_posts_other_rules_with_huge_interval_rule(
    monkeypatch, tmp_path
):
    today = date.today()
    start = date(today.year - 1, today.month, 1)
    session = _start_app_with_rules(
        monkeypatch,
        tmp_path,
        [
            {
                "name": "Huge",
                "anchor_date": start,
                "next_occurrence": start,
                "interval_unit": IntervalUnit.month,
                "interval_count": 120000,
            },
            {
                "name": "Normal",
                "anchor_date": start,
                "next_occurrence": start,
                "interval_unit": IntervalUnit.month,
                "interval_count": 1,
            },
        ],
    )
    with session:
        titles = session.scalars(select(Transaction.title)).all()
    assert titles.count("Normal") >= 12
    assert titles.count("Huge") == 1


def test_app_starts_when_startup_catch_up_fails(monkeypatch, tmp_path):
    from sqlalchemy.exc import OperationalError

    import expenses.app as app_main
    from expenses.services import RecurringRuleService

    def fail(self):
        raise OperationalError("select", {}, Exception("disk I/O error"))

    monkeypatch.setattr(RecurringRuleService, "catch_up_all", fail)
    _start_app_with_rules(monkeypatch, tmp_path, []).close()
    # The scheduler still registered the regular runs that retry the catch-up.
    assert app_main.scheduler_manager.scheduler.get_job("recurring_hourly_safety")
