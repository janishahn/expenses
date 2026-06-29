from __future__ import annotations

from typing import Any

from expenses.ai.schemas import SearchTranslationOutput
from expenses.core.search import parse_advanced_search


class SearchTranslationValidationError(ValueError):
    pass


def validate_search_translation_output(
    output: SearchTranslationOutput, payload: dict[str, Any]
) -> None:
    query = output.query.strip()
    if not query:
        if not output.clarification_needed:
            raise SearchTranslationValidationError(
                "Return clarification_needed=true when query is empty."
            )
        if not output.clarification_question:
            raise SearchTranslationValidationError(
                "Return a clarification_question when clarification is needed."
            )
        return
    try:
        parsed = parse_advanced_search(query)
    except ValueError as exc:
        raise SearchTranslationValidationError("Invalid search syntax.") from exc

    unsupported_terms = [
        term
        for term in parsed.free_terms
        if term.strip("()").casefold() in {"and", "or", "not"}
        or term in {"(", ")"}
        or (":" in term.strip("()") and (term.startswith("(") or term.endswith(")")))
    ]
    if unsupported_terms:
        invalid = ", ".join(unsupported_terms)
        raise SearchTranslationValidationError(
            "Boolean operators and parentheses are not supported by search syntax. "
            f"Invalid: {invalid}."
        )

    category_names = {
        str(category["name"]).casefold() for category in payload["categories"]
    }
    invalid_categories = [
        category
        for category in parsed.category_values
        if category.casefold() not in category_names
    ]
    if invalid_categories:
        invalid = ", ".join(sorted(invalid_categories))
        raise SearchTranslationValidationError(
            "Use exact category names from the payload. Quote category values with "
            f"spaces or punctuation. Invalid: {invalid}."
        )

    tag_names = {str(tag["name"]).casefold() for tag in payload["tags"]}
    invalid_tags = [tag for tag in parsed.tag_values if tag.casefold() not in tag_names]
    if invalid_tags:
        invalid = ", ".join(sorted(invalid_tags))
        raise SearchTranslationValidationError(
            "Use exact tag names from the payload. Quote tag values with spaces or "
            f"punctuation. Invalid: {invalid}."
        )

    if output.clarification_needed and not output.clarification_question:
        raise SearchTranslationValidationError(
            "Return a clarification_question when clarification is needed."
        )
