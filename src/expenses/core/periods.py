from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional


@dataclass(frozen=True)
class Period:
    slug: str
    start: date
    end: date


def month_start(year: int, month: int) -> date:
    return date(year, month, 1)


def month_end(year: int, month: int) -> date:
    return date(year, month, monthrange(year, month)[1])


def add_months(base: date, count: int) -> date:
    month_index = (base.year * 12) + (base.month - 1) + count
    year = month_index // 12
    month = (month_index % 12) + 1
    return date(year, month, 1)


def previous_period(period: Period) -> Period:
    """The comparison window just before `period`.

    A run of whole calendar months compares with the same number of whole
    months before it; any other range with the same number of days before it.
    """
    prev_end = period.start - timedelta(days=1)
    if period.start.day == 1 and period.end == month_end(
        period.end.year, period.end.month
    ):
        months = (
            (period.end.year - period.start.year) * 12
            + period.end.month
            - period.start.month
            + 1
        )
        return Period("prev", add_months(period.start, -months), prev_end)
    days = (period.end - period.start).days + 1
    return Period("prev", prev_end - timedelta(days=days - 1), prev_end)


def resolve_period(
    period: Optional[str],
    start: Optional[str],
    end: Optional[str],
    *,
    today: date,
) -> Period:
    if not period or period == "all":
        return Period("all", date(1970, 1, 1), today)
    if period == "last_month":
        first_this = month_start(today.year, today.month)
        last_month_end = first_this - date.resolution
        last_month_start = month_start(last_month_end.year, last_month_end.month)
        return Period("last_month", last_month_start, last_month_end)
    if period == "custom":
        if not start or not end:
            raise ValueError("Custom period requires start and end dates")
        start_date = date.fromisoformat(start)
        end_date = date.fromisoformat(end)
        if start_date > end_date:
            raise ValueError("Start date must be before end date")
        return Period("custom", start_date, end_date)

    first = month_start(today.year, today.month)
    end_this = month_end(today.year, today.month)
    return Period("this_month", first, end_this)
