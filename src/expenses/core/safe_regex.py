from __future__ import annotations

import time

import regex

from expenses.core.config import get_settings


class RegexRejected(ValueError):
    pass


class RegexBudgetExceeded(ValueError):
    pass


BUDGET_EXCEEDED_MESSAGE = (
    "Regex rules took too long on this import; "
    "simplify or turn off slow regex rules, or import fewer rows"
)


class RegexBudget:
    """Total regex time shared by many searches, such as one CSV import."""

    def __init__(self, seconds: float) -> None:
        self.seconds_left = seconds


def safe_regex_search(
    pattern: str,
    value: str,
    *,
    ignore_case: bool = True,
    budget: RegexBudget | None = None,
) -> bool:
    settings = get_settings()
    if len(pattern) > settings.rule_regex_max_length:
        raise RegexRejected("Regex pattern is too long")
    flags = regex.IGNORECASE if ignore_case else 0
    timeout = settings.rule_regex_timeout_seconds
    if budget is not None:
        if budget.seconds_left <= 0:
            raise RegexBudgetExceeded(BUDGET_EXCEEDED_MESSAGE)
        timeout = min(timeout, budget.seconds_left)
    started = time.monotonic()
    try:
        return (
            regex.search(
                pattern,
                value,
                flags=flags,
                timeout=timeout,
            )
            is not None
        )
    except TimeoutError as exc:
        if timeout < settings.rule_regex_timeout_seconds:
            raise RegexBudgetExceeded(BUDGET_EXCEEDED_MESSAGE) from exc
        raise RegexRejected("Regex evaluation timed out") from exc
    except regex.error as exc:
        raise RegexRejected("Invalid regex pattern") from exc
    finally:
        if budget is not None:
            budget.seconds_left -= time.monotonic() - started


def validate_regex(pattern: str) -> None:
    safe_regex_search(pattern, "")
