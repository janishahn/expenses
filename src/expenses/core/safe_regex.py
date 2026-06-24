from __future__ import annotations

import regex

from expenses.core.config import get_settings


class RegexRejected(ValueError):
    pass


def safe_regex_search(pattern: str, value: str, *, ignore_case: bool = True) -> bool:
    settings = get_settings()
    if len(pattern) > settings.rule_regex_max_length:
        raise RegexRejected("Regex pattern is too long")
    flags = regex.IGNORECASE if ignore_case else 0
    try:
        return (
            regex.search(
                pattern,
                value,
                flags=flags,
                timeout=settings.rule_regex_timeout_seconds,
            )
            is not None
        )
    except TimeoutError as exc:
        raise RegexRejected("Regex evaluation timed out") from exc
    except regex.error as exc:
        raise RegexRejected("Invalid regex pattern") from exc


def validate_regex(pattern: str) -> None:
    safe_regex_search(pattern, "")
