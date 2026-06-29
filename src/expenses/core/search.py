from __future__ import annotations

import re
import shlex
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Optional

from expenses.db.models import TransactionType


@dataclass
class AdvancedSearchFilters:
    raw_query: str
    free_terms: list[str] = field(default_factory=list)
    token_type: Optional[TransactionType] = None
    category_values: list[str] = field(default_factory=list)
    tag_values: list[str] = field(default_factory=list)
    amount_filters: list[tuple[str, int]] = field(default_factory=list)
    date_filters: list[tuple[str, date]] = field(default_factory=list)
    is_reimbursement: Optional[bool] = None
    has_receipt: Optional[bool] = None
    applied_tokens: list[dict[str, str]] = field(default_factory=list)


def parse_advanced_search(raw_query: str) -> AdvancedSearchFilters:
    parsed = AdvancedSearchFilters(raw_query=raw_query)
    if not raw_query.strip():
        return parsed
    try:
        tokens = shlex.split(raw_query)
    except ValueError as exc:
        raise ValueError("Invalid search syntax") from exc

    amount_pattern = re.compile(r"^amount(<=|>=|=|<|>)(.+)$", re.IGNORECASE)
    date_pattern = re.compile(r"^date(<=|>=|=|<|>)(.+)$", re.IGNORECASE)

    for token in tokens:
        amount_match = amount_pattern.match(token)
        if amount_match:
            op = amount_match.group(1)
            value = amount_match.group(2).strip()
            try:
                cents = int(
                    (Decimal(value.replace(",", ".")) * 100).quantize(Decimal("1"))
                )
            except (InvalidOperation, ValueError) as exc:
                raise ValueError(f"Invalid amount filter: {token}") from exc
            parsed.amount_filters.append((op, cents))
            parsed.applied_tokens.append(
                {"key": "amount", "operator": op, "value": value}
            )
            continue

        date_match = date_pattern.match(token)
        if date_match:
            op = date_match.group(1)
            value = date_match.group(2).strip()
            try:
                date_value = date.fromisoformat(value)
            except ValueError as exc:
                raise ValueError(f"Invalid date filter: {token}") from exc
            parsed.date_filters.append((op, date_value))
            parsed.applied_tokens.append(
                {"key": "date", "operator": op, "value": value}
            )
            continue

        if ":" not in token:
            parsed.free_terms.append(token)
            continue

        key, value = token.split(":", 1)
        key = key.strip().lower()
        value = value.strip()

        if key in {"category", "cat"}:
            if not value:
                raise ValueError("Empty category token")
            parsed.category_values.append(value)
            parsed.applied_tokens.append({"key": "category", "value": value})
            continue
        if key == "tag":
            if not value:
                raise ValueError("Empty tag token")
            parsed.tag_values.append(value)
            parsed.applied_tokens.append({"key": "tag", "value": value})
            continue
        if key == "type":
            if not value:
                raise ValueError("Empty type token")
            try:
                parsed.token_type = TransactionType(value.lower())
            except ValueError as exc:
                raise ValueError(f"Invalid type token: {value}") from exc
            parsed.applied_tokens.append(
                {"key": "type", "value": parsed.token_type.value}
            )
            continue
        if key == "date":
            if not value:
                raise ValueError("Empty date token")
            try:
                date_value = date.fromisoformat(value)
            except ValueError as exc:
                raise ValueError(f"Invalid date token: {value}") from exc
            parsed.date_filters.append(("=", date_value))
            parsed.applied_tokens.append(
                {"key": "date", "operator": "=", "value": value}
            )
            continue
        if key == "is":
            normalized = value.lower()
            if normalized != "reimbursement":
                raise ValueError(f"Invalid is token: {value}")
            parsed.is_reimbursement = True
            parsed.applied_tokens.append({"key": "is", "value": "reimbursement"})
            continue
        if key == "has":
            normalized = value.lower()
            if normalized != "receipt":
                raise ValueError(f"Invalid has token: {value}")
            parsed.has_receipt = True
            parsed.applied_tokens.append({"key": "has", "value": "receipt"})
            continue

        parsed.free_terms.append(token)

    return parsed
