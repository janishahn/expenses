import logging
from datetime import date, datetime, time, timedelta
from typing import Optional, Protocol
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from expenses.core.app_logging import get_logger, log_event
from expenses.core.config import get_settings
from expenses.db.models import (
    CurrencyCode,
    IntervalUnit,
    MonthDayPolicy,
    RecurringRule,
    Transaction,
)
from expenses.infra.fx_rates import FxRateService
from expenses.services.rollups import recompute_monthly_rollup_for_date

logger = get_logger("expenses.recurrence")


def local_now() -> datetime:
    return datetime.now(ZoneInfo(get_settings().timezone))


def local_today() -> date:
    return local_now().date()


def days_in_month(year: int, month: int) -> int:
    next_month = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return (next_month - date(year, month, 1)).days


def _add_months(
    base: date,
    months: int,
    *,
    desired_day: int,
    policy: MonthDayPolicy,
) -> date:
    total_months = base.month - 1 + months
    year = base.year + total_months // 12
    month = total_months % 12 + 1

    dim = days_in_month(year, month)
    if policy == MonthDayPolicy.skip and desired_day > dim:
        # Skip whole intervals so the rule stays on its months. 48 steps cover
        # every month of the cycle across a leap cycle; a rule whose months never
        # have the day (one moved off its anchor month) falls back to month end.
        for _ in range(48):
            total_months += months
            candidate_year = base.year + total_months // 12
            candidate_month = total_months % 12 + 1
            if desired_day <= days_in_month(candidate_year, candidate_month):
                return date(candidate_year, candidate_month, desired_day)

    day = dim if desired_day > dim else desired_day
    return date(year, month, day)


# A century of monthly occurrences.
_MAX_CARRY_FORWARD_REPLAY = 1200


class RecurrenceRuleLike(Protocol):
    interval_unit: IntervalUnit
    interval_count: int
    anchor_date: date
    skip_weekends: bool
    month_day_policy: MonthDayPolicy


def _fits_rule_day(rule: RecurrenceRuleLike, day: date) -> bool:
    anchor_day = rule.anchor_date.day
    if rule.month_day_policy == MonthDayPolicy.skip:
        return day.day == anchor_day
    if day.day == min(anchor_day, days_in_month(day.year, day.month)):
        return True
    # "Use previous month's day" keeps a month end it was cut to (31 -> 30 -> 28).
    return (
        rule.month_day_policy == MonthDayPolicy.carry_forward
        and rule.interval_unit == IntervalUnit.month
        and 28 <= day.day < anchor_day
    )


def _unshifted_date(rule: RecurrenceRuleLike, stored: date) -> date:
    """The scheduled date a stored occurrence stands for before "Skip weekends"
    moved it to Monday, so the next date follows the rule's own months."""
    if not rule.skip_weekends or stored.weekday() != 0:
        return stored
    for days_back in (2, 1):
        candidate = stored - timedelta(days=days_back)
        if _fits_rule_day(rule, candidate):
            break
    else:
        return stored
    if (
        rule.month_day_policy == MonthDayPolicy.carry_forward
        and rule.interval_unit == IntervalUnit.month
    ):
        # The carried day lives only in the dates, so a Monday can be the
        # scheduled day itself (the 30th) or a moved weekend (the 28th). Replay
        # the schedule from the anchor; a date set by hand off it keeps the guess.
        scheduled = rule.anchor_date
        for _ in range(_MAX_CARRY_FORWARD_REPLAY):
            if scheduled > stored:
                break
            if scheduled >= stored - timedelta(days=2):
                return scheduled
            scheduled = _add_months(
                scheduled,
                rule.interval_count,
                desired_day=scheduled.day,
                policy=MonthDayPolicy.carry_forward,
            )
    return candidate


def calculate_next_date(rule: RecurrenceRuleLike, from_date: date) -> date:
    if rule.interval_unit in (IntervalUnit.month, IntervalUnit.year):
        from_date = _unshifted_date(rule, from_date)
    if rule.interval_unit == IntervalUnit.day:
        next_date = from_date + timedelta(days=rule.interval_count)
    elif rule.interval_unit == IntervalUnit.week:
        next_date = from_date + timedelta(weeks=rule.interval_count)
    elif rule.interval_unit == IntervalUnit.month:
        anchor_day = (
            from_date.day
            if rule.month_day_policy == MonthDayPolicy.carry_forward
            else rule.anchor_date.day
        )
        next_date = _add_months(
            from_date,
            rule.interval_count,
            desired_day=anchor_day,
            policy=rule.month_day_policy,
        )
    else:
        next_date = _add_months(
            from_date,
            12 * rule.interval_count,
            desired_day=rule.anchor_date.day,
            policy=rule.month_day_policy,
        )

    if rule.skip_weekends:
        while next_date.weekday() >= 5:
            next_date += timedelta(days=1)
    return next_date


def next_date_in_range(rule: RecurrenceRuleLike, from_date: date) -> Optional[date]:
    """The next occurrence, or None when it lies beyond the dates Python can hold."""
    try:
        return calculate_next_date(rule, from_date)
    except (ValueError, OverflowError):
        return None


class RecurringEngine:
    def __init__(self, session: Session) -> None:
        self.session = session

    def catch_up_rule(self, rule: RecurringRule, today: Optional[date] = None) -> None:
        today = today or local_today()
        iterations = 0
        max_iterations = 365
        while rule.next_occurrence <= today and iterations < max_iterations:
            if rule.end_date and rule.next_occurrence > rule.end_date:
                break
            occurrence_date = rule.next_occurrence
            try:
                with self.session.begin_nested():
                    posted = self._post_occurrence(rule, occurrence_date)
            except (SQLAlchemyError, RuntimeError, ValueError):
                break
            next_date = next_date_in_range(rule, occurrence_date)
            if next_date is None:
                log_event(
                    logger,
                    logging.WARNING,
                    "recurring_rule_cannot_advance",
                    rule_id=rule.id,
                    occurrence_date=occurrence_date.isoformat(),
                )
                break
            rule.next_occurrence = next_date
            if not posted and occurrence_date == next_date:
                break
            iterations += 1

    def post_due_rules(self, today: Optional[date] = None) -> int:
        today = today or local_today()
        stmt = (
            select(RecurringRule)
            .where(
                RecurringRule.auto_post.is_(True),
                RecurringRule.next_occurrence <= today,
            )
            .order_by(RecurringRule.next_occurrence)
        )
        rules = self.session.scalars(stmt).all()
        count = 0
        for rule in rules:
            prev = rule.next_occurrence
            self.catch_up_rule(rule, today)
            if rule.next_occurrence != prev:
                count += 1
        return count

    def _post_occurrence(self, rule: RecurringRule, occurrence_date: date) -> bool:
        exists_stmt = (
            select(Transaction.id)
            .where(
                Transaction.user_id == rule.user_id,
                Transaction.origin_rule_id == rule.id,
                Transaction.occurrence_date == occurrence_date,
            )
            .limit(1)
        )
        existing = self.session.execute(exists_stmt).scalar_one_or_none()
        if existing:
            return False

        amount_eur_cents = rule.amount_cents
        source_currency_code = None
        source_amount_cents = None
        fx_rate_micros = None
        fx_rate_date = None
        fx_provider = None
        fx_fetched_at = None

        if rule.currency_code == CurrencyCode.usd:
            fx = FxRateService(self.session, cache_in_session=True)
            amount_eur_cents, quote = fx.convert_usd_cents_to_eur_cents(
                rule.amount_cents, occurrence_date
            )
            source_currency_code = CurrencyCode.usd
            source_amount_cents = rule.amount_cents
            fx_rate_micros = FxRateService.rate_to_micros(quote.rate)
            fx_rate_date = quote.rate_date
            fx_provider = quote.provider
            fx_fetched_at = quote.fetched_at

        txn = Transaction(
            user_id=rule.user_id,
            date=occurrence_date,
            occurred_at=datetime.combine(occurrence_date, time(12, 0)),
            type=rule.type,
            amount_cents=amount_eur_cents,
            source_currency_code=source_currency_code,
            source_amount_cents=source_amount_cents,
            fx_rate_micros=fx_rate_micros,
            fx_rate_date=fx_rate_date,
            fx_provider=fx_provider,
            fx_fetched_at=fx_fetched_at,
            category_id=rule.category_id,
            origin_rule_id=rule.id,
            occurrence_date=occurrence_date,
            # Rules saved before names were required post under their category.
            title=(rule.name or "").strip() or rule.category.name,
        )
        self.session.add(txn)
        self.session.flush()
        recompute_monthly_rollup_for_date(self.session, rule.user_id, occurrence_date)
        return True
