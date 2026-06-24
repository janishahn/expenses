from datetime import date

from expenses.core.periods import (
    Period,
    add_months,
    month_end,
    month_start,
    resolve_period,
)


def test_month_helpers_cover_month_boundaries() -> None:
    assert month_start(2026, 4) == date(2026, 4, 1)
    assert month_end(2024, 2) == date(2024, 2, 29)
    assert add_months(date(2025, 12, 1), 2) == date(2026, 2, 1)


def test_resolve_period_uses_shared_month_helpers() -> None:
    period = resolve_period(None, None, None, today=date(2026, 4, 19))
    assert period == Period("all", date(1970, 1, 1), date(2026, 4, 19))

    this_month = resolve_period("this_month", None, None, today=date(2026, 4, 19))
    assert this_month == Period("this_month", date(2026, 4, 1), date(2026, 4, 30))

    last_month = resolve_period("last_month", None, None, today=date(2026, 4, 19))
    assert last_month == Period("last_month", date(2026, 3, 1), date(2026, 3, 31))
