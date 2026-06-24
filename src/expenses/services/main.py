import json
import logging
import re
import shlex
from calendar import monthrange
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Literal, Optional
from uuid import uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import case, delete, false, func, or_, select, tuple_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased, joinedload, selectinload

from rapidfuzz.distance import Levenshtein

from expenses.core.app_logging import get_logger, log_event
from expenses.core.config import get_settings
from expenses.core.safe_regex import (
    RegexRejected,
    safe_regex_search,
    validate_regex,
)
from expenses.db.models import (
    BalanceAnchor,
    BudgetFrequency,
    BudgetOverride,
    BudgetTemplate,
    Category,
    CurrencyCode,
    DurablePurchase,
    IntervalUnit,
    MonthDayPolicy,
    MonthlyRollup,
    ReceiptAttachment,
    ReimbursementAllocation,
    RecurringRule,
    Rule,
    RuleMatchType,
    Tag,
    TransactionTemplate,
    TransactionClassificationEvent,
    transaction_tags,
    Transaction,
    TransactionType,
)
from expenses.infra.fx_rates import FxQuote, FxRateService
from expenses.core.periods import Period, add_months, month_end, month_start
from expenses.recurrence.engine import (
    RecurringEngine,
    calculate_next_date,
    local_today,
)
from expenses.services.csv_utils import export_transactions, parse_csv
from expenses.services.rollups import (
    recompute_monthly_rollup,
    recompute_monthly_rollup_for_date,
)
from expenses.schemas import (
    BalanceAnchorIn,
    BudgetOverrideIn,
    BudgetTemplateIn,
    CategoryIn,
    CategoryUpdateIn,
    DurablePurchaseIn,
    ForecastScenarioIn,
    IngestTransactionIn,
    RecurringRuleIn,
    ReportOptions,
    RuleIn,
    ScenarioAddRuleIn,
    ScenarioAdjustCategoryIn,
    ScenarioModifyRuleIn,
    ScenarioOneTimeIn,
    ScenarioRemoveRuleIn,
    TemplateReorderIn,
    TransactionIn,
    TransactionTemplateIn,
)

logger = get_logger("expenses.services")


def get_current_user_id() -> int:
    return 1


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


@dataclass
class TransactionFilters:
    type: Optional[TransactionType] = None
    category_id: Optional[int] = None
    matched_category_ids: Optional[list[int]] = None
    query: Optional[str] = None
    tag_id: Optional[int] = None
    search: Optional[AdvancedSearchFilters] = None


def _tag_names_json(tags: list[Tag]) -> str:
    return json.dumps(
        sorted(tag.name for tag in tags),
        ensure_ascii=False,
        separators=(",", ":"),
    )


class TagService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def list_all(self, include_archived: bool = False) -> list[Tag]:
        stmt = select(Tag).where(Tag.user_id == self.user_id).order_by(Tag.name)
        if not include_archived:
            stmt = stmt.where(Tag.archived_at.is_(None))
        return self.session.scalars(stmt).all()

    def get_or_create(self, name: str) -> Tag:
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Tag name cannot be empty")

        stmt = select(Tag).where(
            Tag.user_id == self.user_id, func.lower(Tag.name) == clean_name.lower()
        )
        existing = self.session.scalar(stmt)
        if existing:
            if existing.archived_at is not None:
                existing.archived_at = None
            return existing

        tag = Tag(user_id=self.user_id, name=clean_name)
        self.session.add(tag)
        self.session.flush()
        return tag

    def create(
        self,
        name: str,
        is_hidden_from_budget: bool = False,
        color: str | None = None,
    ) -> Tag:
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Tag name cannot be empty")

        stmt = select(Tag).where(
            Tag.user_id == self.user_id, func.lower(Tag.name) == clean_name.lower()
        )
        existing = self.session.scalar(stmt)
        if existing:
            raise ValueError("Tag already exists")

        tag = Tag(
            user_id=self.user_id,
            name=clean_name,
            color=color,
            is_hidden_from_budget=is_hidden_from_budget,
        )
        self.session.add(tag)
        self.session.commit()
        self.session.refresh(tag)
        log_event(
            logger,
            logging.INFO,
            "tag_created",
            tag_id=tag.id,
            name=tag.name,
            hidden_from_budget=tag.is_hidden_from_budget,
        )
        return tag

    def update(
        self,
        tag_id: int,
        name: str,
        is_hidden_from_budget: bool,
        color: str | None = None,
    ) -> Tag:
        tag = self.session.get(Tag, tag_id)
        if not tag or tag.user_id != self.user_id:
            raise ValueError("Tag not found")

        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Tag name cannot be empty")

        stmt = select(Tag).where(
            Tag.user_id == self.user_id,
            func.lower(Tag.name) == clean_name.lower(),
            Tag.id != tag_id,
        )
        if self.session.scalar(stmt):
            raise ValueError("Tag with this name already exists")

        tag.name = clean_name
        tag.color = color
        tag.is_hidden_from_budget = is_hidden_from_budget
        self.session.commit()
        self.session.refresh(tag)
        log_event(
            logger,
            logging.INFO,
            "tag_updated",
            tag_id=tag.id,
            name=tag.name,
            hidden_from_budget=tag.is_hidden_from_budget,
        )
        return tag

    def archive(self, tag_id: int) -> None:
        tag = self.session.get(Tag, tag_id)
        if not tag or tag.user_id != self.user_id:
            raise ValueError("Tag not found")
        tag.archived_at = datetime.now(UTC)
        self.session.commit()
        log_event(logger, logging.INFO, "tag_archived", tag_id=tag.id, name=tag.name)

    def delete(self, tag_id: int) -> None:
        tag = self.session.get(Tag, tag_id)
        if not tag or tag.user_id != self.user_id:
            raise ValueError("Tag not found")

        self.session.execute(
            delete(transaction_tags).where(transaction_tags.c.tag_id == tag.id)
        )
        self.session.execute(
            update(Rule)
            .where(Rule.user_id == self.user_id, Rule.budget_exclude_tag_id == tag.id)
            .values(budget_exclude_tag_id=None)
        )
        rules_add_tags_updated = 0
        rules = self.session.scalars(
            select(Rule).where(
                Rule.user_id == self.user_id,
                Rule.add_tags_json.is_not(None),
            )
        ).all()
        tag_name_lower = tag.name.lower()
        for rule in rules:
            try:
                tag_names = json.loads(rule.add_tags_json or "[]")
            except json.JSONDecodeError:
                continue
            if not isinstance(tag_names, list):
                continue
            next_tags: list[str] = []
            seen_lower: set[str] = set()
            changed = False
            for raw_name in tag_names:
                clean_name = str(raw_name).strip()
                if not clean_name:
                    changed = True
                    continue
                if clean_name.lower() == tag_name_lower:
                    changed = True
                    continue
                if clean_name.lower() in seen_lower:
                    changed = True
                    continue
                seen_lower.add(clean_name.lower())
                next_tags.append(clean_name)
            if changed:
                rule.add_tags_json = json.dumps(next_tags)
                rules_add_tags_updated += 1
        tag_name = tag.name
        self.session.delete(tag)
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "tag_deleted",
            tag_id=tag_id,
            name=tag_name,
            rules_add_tags_updated=rules_add_tags_updated,
        )

    def merge_preview(self, source_tag_id: int, target_tag_id: int) -> dict[str, int]:
        source = self.session.get(Tag, source_tag_id)
        target = self.session.get(Tag, target_tag_id)
        if not source or source.user_id != self.user_id:
            raise ValueError("Source tag not found")
        if not target or target.user_id != self.user_id:
            raise ValueError("Target tag not found")
        if source.id == target.id:
            raise ValueError("Source and target tags must differ")
        if target.archived_at is not None:
            raise ValueError("Target tag is archived")

        transaction_links = int(
            self.session.execute(
                select(func.count())
                .select_from(transaction_tags)
                .where(transaction_tags.c.tag_id == source.id)
            ).scalar_one()
            or 0
        )
        budget_exclude_rules = int(
            self.session.execute(
                select(func.count(Rule.id)).where(
                    Rule.user_id == self.user_id,
                    Rule.budget_exclude_tag_id == source.id,
                )
            ).scalar_one()
            or 0
        )
        add_tags_rules = int(
            self.session.execute(
                select(func.count(Rule.id)).where(
                    Rule.user_id == self.user_id,
                    Rule.add_tags_json.is_not(None),
                )
            ).scalar_one()
            or 0
        )
        return {
            "transaction_links": transaction_links,
            "budget_exclude_rules": budget_exclude_rules,
            "add_tags_rules_scanned": add_tags_rules,
        }

    def merge(self, source_tag_id: int, target_tag_id: int) -> dict[str, int]:
        preview = self.merge_preview(source_tag_id, target_tag_id)
        source = self.session.get(Tag, source_tag_id)
        target = self.session.get(Tag, target_tag_id)
        if source is None or target is None:
            raise ValueError("Source or target tag not found")

        source_txn_ids = self.session.execute(
            select(transaction_tags.c.transaction_id).where(
                transaction_tags.c.tag_id == source.id
            )
        ).all()
        source_txn_id_values = [int(row.transaction_id) for row in source_txn_ids]

        existing_target_txn_ids = set(
            int(row.transaction_id)
            for row in self.session.execute(
                select(transaction_tags.c.transaction_id).where(
                    transaction_tags.c.tag_id == target.id
                )
            )
        )

        inserted_links = 0
        for txn_id in source_txn_id_values:
            if txn_id in existing_target_txn_ids:
                continue
            self.session.execute(
                transaction_tags.insert().values(
                    transaction_id=txn_id,
                    tag_id=target.id,
                )
            )
            inserted_links += 1

        self.session.execute(
            delete(transaction_tags).where(transaction_tags.c.tag_id == source.id)
        )

        rules_budget_updated = int(
            self.session.execute(
                update(Rule)
                .where(
                    Rule.user_id == self.user_id,
                    Rule.budget_exclude_tag_id == source.id,
                )
                .values(budget_exclude_tag_id=target.id)
            ).rowcount
            or 0
        )

        rules_add_tags_updated = 0
        rules = self.session.scalars(
            select(Rule).where(
                Rule.user_id == self.user_id,
                Rule.add_tags_json.is_not(None),
            )
        ).all()
        source_name_lower = source.name.lower()
        for rule in rules:
            try:
                tag_names = json.loads(rule.add_tags_json or "[]")
            except json.JSONDecodeError:
                continue
            if not isinstance(tag_names, list):
                continue
            next_tags: list[str] = []
            seen_lower: set[str] = set()
            changed = False
            for raw_name in tag_names:
                clean_name = str(raw_name).strip()
                if not clean_name:
                    continue
                name_to_use = (
                    target.name
                    if clean_name.lower() == source_name_lower
                    else clean_name
                )
                if name_to_use.lower() in seen_lower:
                    changed = True
                    continue
                seen_lower.add(name_to_use.lower())
                next_tags.append(name_to_use)
                if name_to_use != clean_name:
                    changed = True
            if changed:
                rule.add_tags_json = json.dumps(next_tags)
                rules_add_tags_updated += 1

        source.archived_at = datetime.now(UTC)
        self.session.commit()
        return {
            "source_transaction_links": preview["transaction_links"],
            "inserted_target_links": inserted_links,
            "rules_budget_updated": rules_budget_updated,
            "rules_add_tags_updated": rules_add_tags_updated,
        }


class RuleService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def list_all(self) -> list[Rule]:
        stmt = (
            select(Rule)
            .options(
                joinedload(Rule.set_category),
                joinedload(Rule.budget_exclude_tag),
            )
            .where(Rule.user_id == self.user_id)
            .order_by(Rule.priority.asc(), Rule.id.asc())
        )
        return self.session.scalars(stmt).all()

    def get(self, rule_id: int) -> Rule:
        rule = self.session.get(Rule, rule_id)
        if not rule or rule.user_id != self.user_id:
            raise ValueError("Rule not found")
        return rule

    def create(self, data: RuleIn) -> Rule:
        category_id = data.set_category_id
        if category_id is not None:
            category = self.session.get(Category, category_id)
            if not category or category.user_id != self.user_id:
                raise ValueError("Category not found")
            if data.transaction_type and category.type != data.transaction_type:
                raise ValueError("Category type mismatch")

        budget_exclude_tag_id = data.budget_exclude_tag_id
        if budget_exclude_tag_id is not None:
            tag = self.session.get(Tag, budget_exclude_tag_id)
            if not tag or tag.user_id != self.user_id:
                raise ValueError("Tag not found")
        if data.match_type == RuleMatchType.regex:
            validate_regex(data.match_value.strip())

        rule = Rule(
            user_id=self.user_id,
            name=data.name.strip(),
            enabled=data.enabled,
            priority=data.priority,
            match_type=data.match_type,
            match_value=data.match_value.strip(),
            transaction_type=data.transaction_type,
            min_amount_cents=data.min_amount_cents,
            max_amount_cents=data.max_amount_cents,
            set_category_id=category_id,
            add_tags_json=json.dumps([t.strip() for t in data.add_tags if t.strip()]),
            budget_exclude_tag_id=budget_exclude_tag_id,
        )
        self.session.add(rule)
        self.session.commit()
        self.session.refresh(rule)
        log_event(
            logger,
            logging.INFO,
            "rule_created",
            rule_id=rule.id,
            name=rule.name,
            enabled=rule.enabled,
            priority=rule.priority,
        )
        return rule

    def update(self, rule_id: int, data: RuleIn) -> Rule:
        rule = self.get(rule_id)

        category_id = data.set_category_id
        if category_id is not None:
            category = self.session.get(Category, category_id)
            if not category or category.user_id != self.user_id:
                raise ValueError("Category not found")
            if data.transaction_type and category.type != data.transaction_type:
                raise ValueError("Category type mismatch")

        budget_exclude_tag_id = data.budget_exclude_tag_id
        if budget_exclude_tag_id is not None:
            tag = self.session.get(Tag, budget_exclude_tag_id)
            if not tag or tag.user_id != self.user_id:
                raise ValueError("Tag not found")
        if data.match_type == RuleMatchType.regex:
            validate_regex(data.match_value.strip())

        rule.name = data.name.strip()
        rule.enabled = data.enabled
        rule.priority = data.priority
        rule.match_type = data.match_type
        rule.match_value = data.match_value.strip()
        rule.transaction_type = data.transaction_type
        rule.min_amount_cents = data.min_amount_cents
        rule.max_amount_cents = data.max_amount_cents
        rule.set_category_id = category_id
        rule.add_tags_json = json.dumps([t.strip() for t in data.add_tags if t.strip()])
        rule.budget_exclude_tag_id = budget_exclude_tag_id

        self.session.commit()
        self.session.refresh(rule)
        log_event(
            logger,
            logging.INFO,
            "rule_updated",
            rule_id=rule.id,
            name=rule.name,
            enabled=rule.enabled,
            priority=rule.priority,
        )
        return rule

    def toggle(self, rule_id: int, enabled: bool) -> None:
        rule = self.get(rule_id)
        rule.enabled = enabled
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "rule_toggled",
            rule_id=rule.id,
            name=rule.name,
            enabled=enabled,
        )

    def delete(self, rule_id: int) -> None:
        rule = self.get(rule_id)
        rule_name = rule.name
        self.session.delete(rule)
        self.session.commit()
        log_event(logger, logging.INFO, "rule_deleted", rule_id=rule_id, name=rule_name)

    def apply_rules(self, txn: Transaction) -> dict[str, object]:
        """
        Apply enabled rules to a transaction (category + tags).
        Returns a lightweight summary for UI/debugging.
        Category rules only apply if the transaction currently has the "Uncategorized" category.
        Tag rules always apply.
        """
        stmt = (
            select(Rule)
            .options(joinedload(Rule.set_category), joinedload(Rule.budget_exclude_tag))
            .where(Rule.user_id == self.user_id, Rule.enabled.is_(True))
            .order_by(Rule.priority.asc(), Rule.id.asc())
        )
        rules = self.session.scalars(stmt).all()
        if not rules:
            return {"matched": 0, "applied": 0}

        title = (txn.title or "").strip()
        title_lower = title.lower()

        applied = 0
        matched = 0
        category_set = False

        category_name = txn.category.name if txn.category else None
        if category_name is None and txn.category_id is not None:
            category_name = self.session.scalar(
                select(Category.name).where(
                    Category.id == txn.category_id,
                    Category.user_id == self.user_id,
                    Category.type == txn.type,
                )
            )

        can_change_category = (
            category_name is not None
            and category_name.lower() == CategoryService.UNCATEGORIZED_NAME.lower()
        )

        existing_tag_names = {t.name.lower() for t in (txn.tags or [])}

        def matches(rule: Rule) -> bool:
            if rule.transaction_type and rule.transaction_type != txn.type:
                return False
            if (
                rule.min_amount_cents is not None
                and txn.amount_cents < rule.min_amount_cents
            ):
                return False
            if (
                rule.max_amount_cents is not None
                and txn.amount_cents > rule.max_amount_cents
            ):
                return False

            needle = (rule.match_value or "").strip()
            if not needle:
                return False
            if rule.match_type == RuleMatchType.contains:
                return needle.lower() in title_lower
            if rule.match_type == RuleMatchType.equals:
                return title_lower == needle.lower()
            if rule.match_type == RuleMatchType.starts_with:
                return title_lower.startswith(needle.lower())
            if rule.match_type == RuleMatchType.regex:
                try:
                    return safe_regex_search(needle, title)
                except RegexRejected:
                    return False
            return False

        tag_service = TagService(self.session, self.user_id)

        for rule in rules:
            if not matches(rule):
                continue
            matched += 1

            if can_change_category and rule.set_category_id and not category_set:
                cat = rule.set_category
                if cat and cat.user_id == self.user_id and cat.type == txn.type:
                    if txn.category_id != cat.id:
                        txn.category_id = cat.id
                        applied += 1
                    category_set = True

            add_names: list[str] = []
            if rule.add_tags_json:
                try:
                    add_names.extend(json.loads(rule.add_tags_json) or [])
                except json.JSONDecodeError:
                    add_names = []
            if rule.budget_exclude_tag:
                add_names.append(rule.budget_exclude_tag.name)

            for name in add_names:
                clean = str(name).strip()
                if not clean:
                    continue
                if clean.lower() in existing_tag_names:
                    continue
                tag = tag_service.get_or_create(clean)
                txn.tags.append(tag)
                existing_tag_names.add(clean.lower())
                applied += 1

        return {"matched": matched, "applied": applied}


class CategoryService:
    UNCATEGORIZED_NAME = "Uncategorized"

    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def get_or_create_uncategorized(self, txn_type: TransactionType) -> Category:
        category = self.session.scalar(
            select(Category).where(
                Category.user_id == self.user_id,
                Category.type == txn_type,
                Category.archived_at.is_(None),
                func.lower(Category.name) == self.UNCATEGORIZED_NAME.lower(),
            )
        )
        if category:
            return category
        archived = self.session.scalar(
            select(Category).where(
                Category.user_id == self.user_id,
                Category.type == txn_type,
                Category.archived_at.is_not(None),
                func.lower(Category.name) == self.UNCATEGORIZED_NAME.lower(),
            )
        )
        if archived:
            archived.archived_at = None
            self.session.flush()
            return archived
        category = Category(
            user_id=self.user_id,
            name=self.UNCATEGORIZED_NAME,
            type=txn_type,
            order=0,
        )
        self.session.add(category)
        self.session.flush()
        return category

    def list_all(self, include_archived: bool = False) -> list[Category]:
        stmt = (
            select(Category)
            .where(Category.user_id == self.user_id)
            .order_by(Category.type, Category.order, Category.name)
        )
        if not include_archived:
            stmt = stmt.where(Category.archived_at.is_(None))
        return self.session.scalars(stmt).all()

    def create(self, data: CategoryIn) -> Category:
        clean_name = data.name.strip()
        if not clean_name:
            raise ValueError("Category name cannot be empty")
        existing = self.session.scalar(
            select(Category).where(
                Category.user_id == self.user_id,
                Category.type == data.type,
                func.lower(Category.name) == clean_name.lower(),
            )
        )
        if existing:
            raise ValueError("Category with this name already exists")
        category = Category(
            user_id=self.user_id,
            name=clean_name,
            type=data.type,
            icon=data.icon,
            order=data.order,
        )
        self.session.add(category)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise ValueError("Category with this name already exists") from exc
        self.session.refresh(category)
        log_event(
            logger,
            logging.INFO,
            "category_created",
            category_id=category.id,
            name=category.name,
            category_type=category.type.value,
        )
        return category

    def rename(self, category_id: int, name: str) -> Category:
        category = self.session.get(Category, category_id)
        if not category or category.user_id != self.user_id:
            raise ValueError("Category not found")
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Category name cannot be empty")
        category.name = clean_name
        self.session.commit()
        return category

    def update(self, category_id: int, data: CategoryUpdateIn) -> Category:
        category = self.session.get(Category, category_id)
        if not category or category.user_id != self.user_id:
            raise ValueError("Category not found")
        name = data.name.strip()
        existing = self.session.scalar(
            select(Category).where(
                Category.user_id == self.user_id,
                Category.type == category.type,
                func.lower(Category.name) == name.lower(),
                Category.id != category.id,
            )
        )
        if existing:
            raise ValueError("Category with this name already exists")
        category.name = name
        category.icon = data.icon
        category.order = data.order
        self.session.commit()
        self.session.refresh(category)
        log_event(
            logger,
            logging.INFO,
            "category_updated",
            category_id=category.id,
            name=category.name,
            category_type=category.type.value,
            icon=category.icon,
        )
        return category

    def archive(self, category_id: int) -> None:
        category = self.session.get(Category, category_id)
        if not category or category.user_id != self.user_id:
            raise ValueError("Category not found")
        category.archived_at = datetime.utcnow()
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "category_archived",
            category_id=category.id,
            name=category.name,
            category_type=category.type.value,
        )

    def restore(self, category_id: int) -> None:
        category = self.session.get(Category, category_id)
        if not category or category.user_id != self.user_id:
            raise ValueError("Category not found")
        category.archived_at = None
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "category_restored",
            category_id=category.id,
            name=category.name,
            category_type=category.type.value,
        )

    def merge_preview(
        self, source_category_id: int, target_category_id: int
    ) -> dict[str, int]:
        source = self.session.get(Category, source_category_id)
        target = self.session.get(Category, target_category_id)
        if not source or source.user_id != self.user_id:
            raise ValueError("Source category not found")
        if not target or target.user_id != self.user_id:
            raise ValueError("Target category not found")
        if source.id == target.id:
            raise ValueError("Source and target categories must differ")
        if source.type != target.type:
            raise ValueError("Category type mismatch")
        if target.archived_at is not None:
            raise ValueError("Target category is archived")

        transactions_count = int(
            self.session.execute(
                select(func.count(Transaction.id)).where(
                    Transaction.user_id == self.user_id,
                    Transaction.category_id == source.id,
                )
            ).scalar_one()
            or 0
        )
        recurring_rules_count = int(
            self.session.execute(
                select(func.count(RecurringRule.id)).where(
                    RecurringRule.user_id == self.user_id,
                    RecurringRule.category_id == source.id,
                )
            ).scalar_one()
            or 0
        )
        rule_set_category_count = int(
            self.session.execute(
                select(func.count(Rule.id)).where(
                    Rule.user_id == self.user_id,
                    Rule.set_category_id == source.id,
                )
            ).scalar_one()
            or 0
        )
        budget_template_count = int(
            self.session.execute(
                select(func.count(BudgetTemplate.id)).where(
                    BudgetTemplate.user_id == self.user_id,
                    BudgetTemplate.category_id == source.id,
                )
            ).scalar_one()
            or 0
        )
        budget_override_count = int(
            self.session.execute(
                select(func.count(BudgetOverride.id)).where(
                    BudgetOverride.user_id == self.user_id,
                    BudgetOverride.category_id == source.id,
                )
            ).scalar_one()
            or 0
        )
        return {
            "transactions": transactions_count,
            "recurring_rules": recurring_rules_count,
            "rules_set_category": rule_set_category_count,
            "budget_templates": budget_template_count,
            "budget_overrides": budget_override_count,
        }

    def merge(self, source_category_id: int, target_category_id: int) -> dict[str, int]:
        preview = self.merge_preview(source_category_id, target_category_id)
        source = self.session.get(Category, source_category_id)
        target = self.session.get(Category, target_category_id)
        if source is None or target is None:
            raise ValueError("Source or target category not found")
        source_template_scopes = {
            (row.frequency, row.starts_on)
            for row in self.session.execute(
                select(BudgetTemplate.frequency, BudgetTemplate.starts_on).where(
                    BudgetTemplate.user_id == self.user_id,
                    BudgetTemplate.category_id == source.id,
                )
            )
        }
        target_template_scopes = {
            (row.frequency, row.starts_on)
            for row in self.session.execute(
                select(BudgetTemplate.frequency, BudgetTemplate.starts_on).where(
                    BudgetTemplate.user_id == self.user_id,
                    BudgetTemplate.category_id == target.id,
                )
            )
        }
        template_conflicts = source_template_scopes & target_template_scopes

        source_override_scopes = {
            (row.year, row.month)
            for row in self.session.execute(
                select(BudgetOverride.year, BudgetOverride.month).where(
                    BudgetOverride.user_id == self.user_id,
                    BudgetOverride.category_id == source.id,
                )
            )
        }
        target_override_scopes = {
            (row.year, row.month)
            for row in self.session.execute(
                select(BudgetOverride.year, BudgetOverride.month).where(
                    BudgetOverride.user_id == self.user_id,
                    BudgetOverride.category_id == target.id,
                )
            )
        }
        override_conflicts = source_override_scopes & target_override_scopes
        if template_conflicts or override_conflicts:
            conflict_parts: list[str] = []
            if template_conflicts:
                conflict_parts.append(
                    f"{len(template_conflicts)} budget template scope conflict(s)"
                )
            if override_conflicts:
                conflict_parts.append(
                    f"{len(override_conflicts)} budget override scope conflict(s)"
                )
            raise ValueError(
                "Cannot merge categories with overlapping budget scopes: "
                + ", ".join(conflict_parts)
            )

        updated_transactions = int(
            self.session.execute(
                update(Transaction)
                .where(
                    Transaction.user_id == self.user_id,
                    Transaction.category_id == source.id,
                )
                .values(category_id=target.id)
            ).rowcount
            or 0
        )
        updated_recurring_rules = int(
            self.session.execute(
                update(RecurringRule)
                .where(
                    RecurringRule.user_id == self.user_id,
                    RecurringRule.category_id == source.id,
                )
                .values(category_id=target.id)
            ).rowcount
            or 0
        )
        updated_rules = int(
            self.session.execute(
                update(Rule)
                .where(
                    Rule.user_id == self.user_id,
                    Rule.set_category_id == source.id,
                )
                .values(set_category_id=target.id)
            ).rowcount
            or 0
        )
        updated_budget_templates = int(
            self.session.execute(
                update(BudgetTemplate)
                .where(
                    BudgetTemplate.user_id == self.user_id,
                    BudgetTemplate.category_id == source.id,
                )
                .values(category_id=target.id)
            ).rowcount
            or 0
        )
        updated_budget_overrides = int(
            self.session.execute(
                update(BudgetOverride)
                .where(
                    BudgetOverride.user_id == self.user_id,
                    BudgetOverride.category_id == source.id,
                )
                .values(category_id=target.id)
            ).rowcount
            or 0
        )

        source.archived_at = datetime.now(UTC)
        self.session.commit()
        return {
            "transactions": updated_transactions,
            "recurring_rules": updated_recurring_rules,
            "rules_set_category": updated_rules,
            "budget_templates": updated_budget_templates,
            "budget_overrides": updated_budget_overrides,
            "preview_transactions": preview["transactions"],
        }


class TransactionTemplateService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def _category_for_type(
        self, category_id: int, transaction_type: TransactionType
    ) -> Category:
        category = self.session.get(Category, category_id)
        if not category or category.user_id != self.user_id:
            raise ValueError("Category not found")
        if category.type != transaction_type:
            raise ValueError("Category type mismatch")
        return category

    def _normalized_tags(self, tags: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for raw in tags:
            clean = raw.strip()
            if not clean:
                continue
            lowered = clean.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            out.append(clean)
        return out

    def _next_sort_order(self) -> int:
        current = self.session.execute(
            select(func.coalesce(func.max(TransactionTemplate.sort_order), -1)).where(
                TransactionTemplate.user_id == self.user_id
            )
        ).scalar_one()
        return int(current) + 1

    def get(self, template_id: int) -> TransactionTemplate:
        template = self.session.get(TransactionTemplate, template_id)
        if not template or template.user_id != self.user_id:
            raise ValueError("Template not found")
        return template

    def list_all(self) -> list[TransactionTemplate]:
        stmt = (
            select(TransactionTemplate)
            .options(joinedload(TransactionTemplate.category))
            .where(TransactionTemplate.user_id == self.user_id)
            .order_by(
                TransactionTemplate.sort_order.asc(), TransactionTemplate.id.asc()
            )
        )
        return self.session.scalars(stmt).all()

    def create(self, data: TransactionTemplateIn) -> TransactionTemplate:
        self._category_for_type(data.category_id, data.type)
        template = TransactionTemplate(
            user_id=self.user_id,
            name=data.name.strip(),
            type=data.type,
            category_id=data.category_id,
            default_amount_cents=data.default_amount_cents,
            title=(data.title.strip() if data.title and data.title.strip() else None),
            tags_json=json.dumps(self._normalized_tags(data.tags)),
            sort_order=self._next_sort_order(),
        )
        self.session.add(template)
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise ValueError("Template name already exists") from exc
        self.session.refresh(template)
        log_event(
            logger,
            logging.INFO,
            "template_created",
            template_id=template.id,
            name=template.name,
            transaction_type=template.type.value,
        )
        return template

    def update(
        self, template_id: int, data: TransactionTemplateIn
    ) -> TransactionTemplate:
        template = self.get(template_id)
        self._category_for_type(data.category_id, data.type)
        template.name = data.name.strip()
        template.type = data.type
        template.category_id = data.category_id
        template.default_amount_cents = data.default_amount_cents
        template.title = (
            data.title.strip() if data.title and data.title.strip() else None
        )
        template.tags_json = json.dumps(self._normalized_tags(data.tags))
        try:
            self.session.commit()
        except IntegrityError as exc:
            self.session.rollback()
            raise ValueError("Template name already exists") from exc
        self.session.refresh(template)
        log_event(
            logger,
            logging.INFO,
            "template_updated",
            template_id=template.id,
            name=template.name,
            transaction_type=template.type.value,
        )
        return template

    def delete(self, template_id: int) -> None:
        template = self.get(template_id)
        template_name = template.name
        self.session.delete(template)
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "template_deleted",
            template_id=template_id,
            name=template_name,
        )

    def reorder(self, data: TemplateReorderIn) -> None:
        templates = self.list_all()
        current_ids = [template.id for template in templates]
        if sorted(data.template_ids) != sorted(current_ids):
            raise ValueError("template_ids must include all templates exactly once")
        order_lookup = {
            template_id: idx for idx, template_id in enumerate(data.template_ids)
        }
        for template in templates:
            template.sort_order = order_lookup[template.id]
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "template_reordered",
            template_ids=data.template_ids,
        )


class DurablePurchaseService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def upsert(self, transaction_id: int, data: DurablePurchaseIn) -> DurablePurchase:
        transaction = self.session.get(Transaction, transaction_id)
        if not transaction or transaction.user_id != self.user_id:
            raise LookupError("Transaction not found")
        if transaction.deleted_at is not None:
            raise LookupError("Transaction not found")
        if transaction.type != TransactionType.expense:
            raise ValueError("Durable tracking requires an expense transaction")
        acquired_on = data.acquired_on or transaction.date

        durable = self.session.scalar(
            select(DurablePurchase).where(
                DurablePurchase.user_id == self.user_id,
                DurablePurchase.transaction_id == transaction_id,
            )
        )
        if durable is None:
            durable = DurablePurchase(
                user_id=self.user_id,
                transaction_id=transaction_id,
                expected_lifespan_days=data.expected_lifespan_days,
                acquired_on=acquired_on,
            )
            self.session.add(durable)
        else:
            durable.expected_lifespan_days = data.expected_lifespan_days
            durable.acquired_on = acquired_on
        self.session.commit()
        self.session.refresh(durable)
        return durable

    def delete(self, transaction_id: int) -> None:
        durable = self.session.scalar(
            select(DurablePurchase).where(
                DurablePurchase.user_id == self.user_id,
                DurablePurchase.transaction_id == transaction_id,
            )
        )
        if durable is None:
            return
        self.session.delete(durable)
        self.session.commit()

    def for_transaction(self, transaction_id: int) -> DurablePurchase | None:
        return self.session.scalar(
            select(DurablePurchase)
            .join(Transaction, DurablePurchase.transaction_id == Transaction.id)
            .where(
                DurablePurchase.user_id == self.user_id,
                DurablePurchase.transaction_id == transaction_id,
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.expense,
            )
        )

    def list_computed(self, *, today: date | None = None) -> list[dict[str, object]]:
        current_day = today or date.today()
        rows = self.session.scalars(
            select(DurablePurchase)
            .options(
                joinedload(DurablePurchase.transaction).joinedload(Transaction.category)
            )
            .join(Transaction, DurablePurchase.transaction_id == Transaction.id)
            .where(
                DurablePurchase.user_id == self.user_id,
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.expense,
            )
        ).all()

        items: list[dict[str, object]] = []
        for row in rows:
            transaction = row.transaction
            amount_cents = int(transaction.amount_cents)
            lifespan_days = int(row.expected_lifespan_days)
            days_owned = max(0, (current_day - row.acquired_on).days)
            active_days = min(days_owned, lifespan_days)
            cost_per_day_cents = amount_cents / lifespan_days
            amortized_cents = int(round(cost_per_day_cents * active_days))
            remaining_cents = max(0, amount_cents - amortized_cents)
            percent_amortized = min(100.0, days_owned / lifespan_days * 100)
            fully_amortized = days_owned >= lifespan_days
            paid_for_itself_on = row.acquired_on + timedelta(days=lifespan_days)
            items.append(
                {
                    "id": row.id,
                    "transaction_id": row.transaction_id,
                    "expected_lifespan_days": lifespan_days,
                    "acquired_on": row.acquired_on.isoformat(),
                    "days_owned": days_owned,
                    "cost_per_day_cents": cost_per_day_cents,
                    "amortized_cents": amortized_cents,
                    "remaining_cents": remaining_cents,
                    "percent_amortized": percent_amortized,
                    "fully_amortized": fully_amortized,
                    "paid_for_itself_on": paid_for_itself_on.isoformat(),
                    "original_amount_cents": amount_cents,
                    "title": transaction.title,
                    "category": (
                        {
                            "id": transaction.category.id,
                            "name": transaction.category.name,
                            "type": transaction.category.type.value,
                            "icon": transaction.category.icon,
                        }
                        if transaction.category
                        else None
                    ),
                }
            )
        items.sort(
            key=lambda item: (
                float(item["cost_per_day_cents"]),
                -int(item["transaction_id"]),
            ),
            reverse=True,
        )
        return items


class TransactionService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def has_any(self) -> bool:
        stmt = select(func.count(Transaction.id)).where(
            Transaction.user_id == self.user_id,
            Transaction.deleted_at.is_(None),
        )
        return (self.session.execute(stmt).scalar_one() or 0) > 0

    def create(
        self,
        data: TransactionIn,
        *,
        source: str = "user",
    ) -> Transaction:
        if data.is_reimbursement and data.type != TransactionType.income:
            raise ValueError("Reimbursements must be income transactions")

        if data.category_id is not None:
            category = self.session.get(Category, data.category_id)
            if not category or category.user_id != self.user_id:
                raise ValueError("Category not found")
            if category.type != data.type:
                raise ValueError("Category type mismatch")
            category_id = data.category_id
        else:
            category = CategoryService(
                self.session, self.user_id
            ).get_or_create_uncategorized(data.type)
            category_id = category.id

        is_reimbursement = (
            bool(data.is_reimbursement)
            if data.type == TransactionType.income
            else False
        )
        txn = Transaction(
            user_id=self.user_id,
            date=data.date,
            occurred_at=data.occurred_at,
            type=data.type,
            is_reimbursement=is_reimbursement,
            amount_cents=data.amount_cents,
            category_id=category_id,
            title=data.title,
            description=(
                data.description.strip()
                if data.description and data.description.strip()
                else None
            ),
            latitude=data.latitude,
            longitude=data.longitude,
        )
        if data.tags:
            tag_service = TagService(self.session, self.user_id)
            tags: list[Tag] = []
            tag_ids: set[int] = set()
            for name in data.tags:
                tag = tag_service.get_or_create(name)
                if tag.id not in tag_ids:
                    tags.append(tag)
                    tag_ids.add(tag.id)
            txn.tags = tags

        self.session.add(txn)
        self.session.flush()
        self.session.refresh(txn, ["category", "tags"])
        rule_result = RuleService(self.session, self.user_id).apply_rules(txn)
        self.session.flush()
        self._record_classification_event(
            transaction=txn,
            event_type="created",
            source=source,
            before_category_id=None,
            after_category_id=txn.category_id,
            before_title=None,
            after_title=txn.title,
            before_tags_json="[]",
            after_tags_json=_tag_names_json(txn.tags),
        )
        recompute_monthly_rollup_for_date(self.session, self.user_id, data.date)
        period = Period("transaction", data.date, data.date)
        metrics = MetricsService(self.session, self.user_id)
        metrics._invalidate_period_cache(period)
        self.session.commit()
        self.session.refresh(txn)
        txn._rule_result = rule_result
        log_event(
            logger,
            logging.INFO,
            "transaction_created",
            transaction_id=txn.id,
            transaction_type=txn.type.value,
            amount_cents=txn.amount_cents,
            category_id=txn.category_id,
            rules_matched=rule_result["matched"],
            rules_applied=rule_result["applied"],
            is_reimbursement=txn.is_reimbursement,
        )
        return txn

    def _record_classification_event(
        self,
        *,
        transaction: Transaction,
        event_type: str,
        source: str,
        before_category_id: int | None,
        after_category_id: int | None,
        before_title: str | None,
        after_title: str | None,
        before_tags_json: str,
        after_tags_json: str,
    ) -> None:
        self.session.add(
            TransactionClassificationEvent(
                user_id=self.user_id,
                transaction_id=transaction.id,
                event_type=event_type,
                source=source,
                before_category_id=before_category_id,
                after_category_id=after_category_id,
                before_title=before_title,
                after_title=after_title,
                before_tags_json=before_tags_json,
                after_tags_json=after_tags_json,
            )
        )

    def get(self, transaction_id: int, *, include_deleted: bool = False) -> Transaction:
        stmt = (
            select(Transaction)
            .options(
                joinedload(Transaction.category),
                joinedload(Transaction.tags),
                joinedload(Transaction.attachments),
            )
            .where(
                Transaction.user_id == self.user_id, Transaction.id == transaction_id
            )
        )
        if not include_deleted:
            stmt = stmt.where(Transaction.deleted_at.is_(None))
        txn = self.session.scalar(stmt)
        if not txn:
            raise ValueError("Transaction not found")
        return txn

    def update(
        self,
        transaction_id: int,
        data: TransactionIn,
        *,
        source: str = "user",
    ) -> Transaction:
        txn = self.get(transaction_id, include_deleted=False)

        old_date = txn.date
        old_type = txn.type
        old_is_reimbursement = txn.is_reimbursement
        before_category_id = txn.category_id
        before_title = txn.title
        before_tags_json = _tag_names_json(txn.tags)

        if data.category_id is not None:
            category = self.session.get(Category, data.category_id)
            if not category or category.user_id != self.user_id:
                raise ValueError("Category not found")
            if category.type != data.type:
                raise ValueError("Category type mismatch")
            category_id = data.category_id

        if old_type == TransactionType.expense and data.type == TransactionType.income:
            has_allocations_in = int(
                self.session.execute(
                    select(func.count(ReimbursementAllocation.id)).where(
                        ReimbursementAllocation.user_id == self.user_id,
                        ReimbursementAllocation.expense_transaction_id == txn.id,
                    )
                ).scalar_one()
                or 0
            )
            if has_allocations_in:
                raise ValueError(
                    "Cannot convert reimbursed expense to income; remove allocations first"
                )

        if old_type == TransactionType.income and data.type == TransactionType.expense:
            has_allocations_out = int(
                self.session.execute(
                    select(func.count(ReimbursementAllocation.id)).where(
                        ReimbursementAllocation.user_id == self.user_id,
                        ReimbursementAllocation.reimbursement_transaction_id == txn.id,
                    )
                ).scalar_one()
                or 0
            )
            if has_allocations_out:
                raise ValueError(
                    "Cannot convert reimbursement income to expense; remove allocations first"
                )

        if data.category_id is None:
            category = CategoryService(
                self.session, self.user_id
            ).get_or_create_uncategorized(data.type)
            category_id = category.id

        txn.date = data.date
        txn.occurred_at = data.occurred_at
        txn.type = data.type
        txn.amount_cents = data.amount_cents
        txn.category_id = category_id
        txn.title = data.title
        txn.description = (
            data.description.strip()
            if data.description and data.description.strip()
            else None
        )
        if "latitude" in data.model_fields_set or "longitude" in data.model_fields_set:
            txn.latitude = data.latitude
            txn.longitude = data.longitude
        if txn.type == TransactionType.income and data.is_reimbursement is not None:
            txn.is_reimbursement = bool(data.is_reimbursement)
        if txn.type == TransactionType.expense:
            txn.is_reimbursement = False
        if old_type == TransactionType.expense and txn.type != TransactionType.expense:
            self.session.execute(
                delete(DurablePurchase).where(
                    DurablePurchase.user_id == self.user_id,
                    DurablePurchase.transaction_id == txn.id,
                )
            )

        if data.tags is not None:
            tag_service = TagService(self.session, self.user_id)
            tags: list[Tag] = []
            tag_ids: set[int] = set()
            for name in data.tags:
                tag = tag_service.get_or_create(name)
                if tag.id not in tag_ids:
                    tags.append(tag)
                    tag_ids.add(tag.id)
            txn.tags = tags

        self.session.flush()
        self.session.refresh(txn, ["category", "tags"])
        rule_result = RuleService(self.session, self.user_id).apply_rules(txn)
        self.session.flush()
        after_tags_json = _tag_names_json(txn.tags)
        if (
            before_category_id != txn.category_id
            or before_title != txn.title
            or before_tags_json != after_tags_json
        ):
            self._record_classification_event(
                transaction=txn,
                event_type="updated",
                source=source,
                before_category_id=before_category_id,
                after_category_id=txn.category_id,
                before_title=before_title,
                after_title=txn.title,
                before_tags_json=before_tags_json,
                after_tags_json=after_tags_json,
            )

        allocations_deleted_expense_dates: list[date] = []
        if (
            old_type == TransactionType.income
            and old_is_reimbursement
            and txn.type == TransactionType.income
            and not txn.is_reimbursement
        ):
            allocations_deleted_expense_dates = [
                row[0]
                for row in self.session.execute(
                    select(Transaction.date)
                    .join(
                        ReimbursementAllocation,
                        ReimbursementAllocation.expense_transaction_id
                        == Transaction.id,
                    )
                    .where(
                        ReimbursementAllocation.user_id == self.user_id,
                        ReimbursementAllocation.reimbursement_transaction_id == txn.id,
                    )
                ).all()
            ]
            self.session.execute(
                delete(ReimbursementAllocation).where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.reimbursement_transaction_id == txn.id,
                )
            )

        if txn.type == TransactionType.expense:
            reimbursed_total = int(
                self.session.execute(
                    select(
                        func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0)
                    ).where(
                        ReimbursementAllocation.user_id == self.user_id,
                        ReimbursementAllocation.expense_transaction_id == txn.id,
                    )
                ).scalar_one()
                or 0
            )
            if txn.amount_cents < reimbursed_total:
                raise ValueError("Expense amount cannot be less than reimbursed total")

        if txn.type == TransactionType.income and txn.is_reimbursement:
            allocated_total = int(
                self.session.execute(
                    select(
                        func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0)
                    ).where(
                        ReimbursementAllocation.user_id == self.user_id,
                        ReimbursementAllocation.reimbursement_transaction_id == txn.id,
                    )
                ).scalar_one()
                or 0
            )
            if txn.amount_cents < allocated_total:
                raise ValueError(
                    "Reimbursement amount cannot be less than allocated total"
                )

        self.session.flush()

        months_to_recompute: set[tuple[int, int]] = {
            (old_date.year, old_date.month),
            (txn.date.year, txn.date.month),
        }
        for d in allocations_deleted_expense_dates:
            months_to_recompute.add((d.year, d.month))
        for y, m in months_to_recompute:
            recompute_monthly_rollup(self.session, self.user_id, y, m)

        metrics = MetricsService(self.session, self.user_id)
        metrics._invalidate_period_cache(Period("transaction", old_date, old_date))
        metrics._invalidate_period_cache(Period("transaction", data.date, data.date))

        self.session.commit()
        self.session.refresh(txn)
        txn._rule_result = rule_result
        log_event(
            logger,
            logging.INFO,
            "transaction_updated",
            transaction_id=txn.id,
            transaction_type=txn.type.value,
            amount_cents=txn.amount_cents,
            category_id=txn.category_id,
            rules_matched=rule_result["matched"],
            rules_applied=rule_result["applied"],
            is_reimbursement=txn.is_reimbursement,
        )
        return txn

    def _hydrate_reimbursement_totals(self, transactions: list[Transaction]) -> None:
        if not transactions:
            return
        expense_ids = [
            txn.id for txn in transactions if txn.type == TransactionType.expense
        ]
        reimbursed_by_expense = ReimbursementService(
            self.session, self.user_id
        ).reimbursed_totals_for_expenses(expense_ids)
        for txn in transactions:
            gross = int(txn.amount_cents)
            setattr(txn, "gross_amount_cents", gross)
            if txn.type == TransactionType.expense:
                reimbursed = int(reimbursed_by_expense.get(txn.id, 0))
                setattr(txn, "reimbursed_total_cents", reimbursed)
                setattr(txn, "net_amount_cents", max(0, gross - reimbursed))
            else:
                setattr(txn, "reimbursed_total_cents", 0)
                setattr(txn, "net_amount_cents", gross)

    def list_for_period(
        self,
        period: Period,
        filters: TransactionFilters,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Transaction]:
        stmt = self._build_period_query(
            period,
            include_deleted=False,
            order_desc=True,
        )
        stmt = self._apply_filters(stmt, filters)
        stmt = stmt.offset(offset).limit(limit)
        transactions = self.session.scalars(stmt).unique().all()
        self._hydrate_reimbursement_totals(transactions)
        return transactions

    def all_for_period(
        self, period: Period, filters: Optional[TransactionFilters] = None
    ) -> list[Transaction]:
        filters = filters or TransactionFilters()
        stmt = self._build_period_query(
            period,
            include_deleted=False,
            order_desc=False,
        )
        stmt = self._apply_filters(stmt, filters)
        return self.session.scalars(stmt).unique().all()

    def list_deleted_for_period(
        self,
        period: Period,
        filters: TransactionFilters,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Transaction]:
        stmt = self._build_period_query(
            period,
            include_deleted=True,
            order_desc=True,
        )
        stmt = self._apply_filters(stmt, filters).offset(offset).limit(limit)
        transactions = self.session.scalars(stmt).unique().all()
        self._hydrate_reimbursement_totals(transactions)
        return transactions

    def recent(self, limit: int = 10) -> list[Transaction]:
        stmt = (
            select(Transaction)
            .options(joinedload(Transaction.category), joinedload(Transaction.tags))
            .where(
                Transaction.user_id == self.user_id, Transaction.deleted_at.is_(None)
            )
            .order_by(Transaction.occurred_at.desc(), Transaction.id.desc())
            .limit(limit)
        )
        transactions = self.session.scalars(stmt).unique().all()
        self._hydrate_reimbursement_totals(transactions)
        return transactions

    def soft_delete(self, transaction_id: int) -> None:
        txn = self.session.get(Transaction, transaction_id)
        if not txn or txn.user_id != self.user_id:
            raise ValueError("Transaction not found")
        if txn.deleted_at is not None:
            return
        txn.deleted_at = datetime.utcnow()
        self.session.flush()

        months_to_recompute: set[tuple[int, int]] = {(txn.date.year, txn.date.month)}
        if txn.type == TransactionType.income and txn.is_reimbursement:
            expense_dates = self.session.execute(
                select(Transaction.date)
                .join(
                    ReimbursementAllocation,
                    ReimbursementAllocation.expense_transaction_id == Transaction.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.reimbursement_transaction_id == txn.id,
                )
            ).all()
            for row in expense_dates:
                d = row[0]
                months_to_recompute.add((d.year, d.month))
        for y, m in months_to_recompute:
            recompute_monthly_rollup(self.session, self.user_id, y, m)

        period = Period("transaction", txn.date, txn.date)
        metrics = MetricsService(self.session, self.user_id)
        metrics._invalidate_period_cache(period)
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "transaction_soft_deleted",
            transaction_id=txn.id,
            transaction_type=txn.type.value,
        )

    def restore(self, transaction_id: int) -> None:
        txn = self.session.get(Transaction, transaction_id)
        if not txn or txn.user_id != self.user_id:
            raise ValueError("Transaction not found")
        if txn.deleted_at is None:
            return
        txn.deleted_at = None
        self.session.flush()
        months_to_recompute: set[tuple[int, int]] = {(txn.date.year, txn.date.month)}
        if txn.type == TransactionType.income and txn.is_reimbursement:
            expense_dates = self.session.execute(
                select(Transaction.date)
                .join(
                    ReimbursementAllocation,
                    ReimbursementAllocation.expense_transaction_id == Transaction.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.reimbursement_transaction_id == txn.id,
                )
            ).all()
            for row in expense_dates:
                d = row[0]
                months_to_recompute.add((d.year, d.month))
        for y, m in months_to_recompute:
            recompute_monthly_rollup(self.session, self.user_id, y, m)
        metrics = MetricsService(self.session, self.user_id)
        metrics._invalidate_period_cache(Period("transaction", txn.date, txn.date))
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "transaction_restored",
            transaction_id=txn.id,
            transaction_type=txn.type.value,
        )

    def permanent_delete(self, transaction_id: int) -> tuple[int, int]:
        deleted_transaction_id = self.session.execute(
            select(Transaction.id).where(
                Transaction.user_id == self.user_id,
                Transaction.id == transaction_id,
                Transaction.deleted_at.isnot(None),
            )
        ).scalar_one_or_none()
        if deleted_transaction_id is None:
            raise ValueError("Deleted transaction not found")
        return self._delete_deleted_transactions([deleted_transaction_id])

    def purge_deleted_before(self, cutoff_date: datetime) -> tuple[int, int]:
        transaction_ids = [
            int(row.id)
            for row in self.session.execute(
                select(Transaction.id).where(
                    Transaction.user_id == self.user_id,
                    Transaction.deleted_at.isnot(None),
                    Transaction.deleted_at < cutoff_date,
                )
            )
        ]
        if not transaction_ids:
            return 0, 0
        return self._delete_deleted_transactions(transaction_ids)

    def _delete_deleted_transactions(
        self, transaction_ids: list[int]
    ) -> tuple[int, int]:
        self.session.execute(
            delete(transaction_tags).where(
                transaction_tags.c.transaction_id.in_(transaction_ids)
            )
        )
        deleted_attachments = ReceiptAttachmentService(
            self.session, self.user_id
        ).purge_for_transaction_ids(transaction_ids)
        result = self.session.execute(
            delete(Transaction).where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.isnot(None),
                Transaction.id.in_(transaction_ids),
            )
        )
        self.session.commit()
        return int(result.rowcount or 0), deleted_attachments

    def deleted(self, limit: int = 200) -> list[Transaction]:
        stmt = (
            select(Transaction)
            .options(
                joinedload(Transaction.category),
                joinedload(Transaction.tags),
                joinedload(Transaction.attachments),
            )
            .where(
                Transaction.user_id == self.user_id, Transaction.deleted_at.isnot(None)
            )
            .order_by(Transaction.deleted_at.desc(), Transaction.id.desc())
            .limit(limit)
        )
        return self.session.scalars(stmt).unique().all()

    def _build_period_query(
        self,
        period: Period,
        *,
        include_deleted: bool,
        order_desc: bool,
    ):
        stmt = (
            select(Transaction)
            .options(
                joinedload(Transaction.category),
                selectinload(Transaction.tags),
                selectinload(Transaction.attachments),
            )
            .where(Transaction.user_id == self.user_id)
        )
        if include_deleted:
            stmt = stmt.where(Transaction.deleted_at.isnot(None))
        else:
            stmt = stmt.where(Transaction.deleted_at.is_(None))
        if order_desc:
            stmt = stmt.order_by(Transaction.occurred_at.desc(), Transaction.id.desc())
        else:
            stmt = stmt.order_by(Transaction.occurred_at.asc(), Transaction.id.asc())
        if period.slug == "all":
            stmt = stmt.where(Transaction.date >= period.start)
        else:
            stmt = stmt.where(Transaction.date.between(period.start, period.end))
        return stmt

    def _resolve_name_tokens_to_ids(
        self, values: list[str], *, target: str
    ) -> list[int]:
        ids: set[int] = set()
        numeric_ids: set[int] = set()
        names: list[str] = []
        for value in values:
            stripped = value.strip()
            if not stripped:
                continue
            if stripped.isdigit():
                numeric_ids.add(int(stripped))
            else:
                names.append(stripped.lower())
        ids.update(numeric_ids)
        if target == "category" and names:
            rows = self.session.execute(
                select(Category.id).where(
                    Category.user_id == self.user_id,
                    func.lower(Category.name).in_(names),
                )
            )
            ids.update(int(row.id) for row in rows)
        if target == "tag" and names:
            rows = self.session.execute(
                select(Tag.id).where(
                    Tag.user_id == self.user_id,
                    func.lower(Tag.name).in_(names),
                )
            )
            ids.update(int(row.id) for row in rows)
        return sorted(ids)

    def _apply_advanced_search(self, stmt, search: AdvancedSearchFilters):
        if search.token_type:
            stmt = stmt.where(Transaction.type == search.token_type)

        category_ids = self._resolve_name_tokens_to_ids(
            search.category_values, target="category"
        )
        if search.category_values:
            if not category_ids:
                return stmt.where(false())
            stmt = stmt.where(Transaction.category_id.in_(category_ids))

        tag_ids = self._resolve_name_tokens_to_ids(search.tag_values, target="tag")
        if search.tag_values:
            if not tag_ids:
                return stmt.where(false())
            stmt = stmt.where(Transaction.tags.any(Tag.id.in_(tag_ids)))

        for operator, cents in search.amount_filters:
            if operator == "=":
                stmt = stmt.where(Transaction.amount_cents == cents)
            if operator == ">":
                stmt = stmt.where(Transaction.amount_cents > cents)
            if operator == ">=":
                stmt = stmt.where(Transaction.amount_cents >= cents)
            if operator == "<":
                stmt = stmt.where(Transaction.amount_cents < cents)
            if operator == "<=":
                stmt = stmt.where(Transaction.amount_cents <= cents)

        for operator, date_value in search.date_filters:
            if operator == "=":
                stmt = stmt.where(Transaction.date == date_value)
            if operator == ">":
                stmt = stmt.where(Transaction.date > date_value)
            if operator == ">=":
                stmt = stmt.where(Transaction.date >= date_value)
            if operator == "<":
                stmt = stmt.where(Transaction.date < date_value)
            if operator == "<=":
                stmt = stmt.where(Transaction.date <= date_value)

        if search.is_reimbursement:
            stmt = stmt.where(
                Transaction.type == TransactionType.income,
                Transaction.is_reimbursement.is_(True),
            )
        if search.has_receipt:
            stmt = stmt.where(Transaction.attachments.any())

        for term in search.free_terms:
            like = f"%{term.lower()}%"
            stmt = stmt.where(
                func.lower(func.coalesce(Transaction.title, "")).like(like)
            )
        return stmt

    def _apply_filters(self, stmt, filters: TransactionFilters):
        if filters.type:
            stmt = stmt.where(Transaction.type == filters.type)
        if filters.category_id:
            stmt = stmt.where(Transaction.category_id == filters.category_id)
        if filters.matched_category_ids is not None:
            if not filters.matched_category_ids:
                return stmt.where(false())
            stmt = stmt.where(Transaction.category_id.in_(filters.matched_category_ids))
        if filters.tag_id:
            stmt = stmt.where(Transaction.tags.any(Tag.id == filters.tag_id))
        if filters.search:
            stmt = self._apply_advanced_search(stmt, filters.search)
        elif filters.query:
            like = f"%{filters.query.lower()}%"
            stmt = stmt.where(
                func.lower(func.coalesce(Transaction.title, "")).like(like)
            )
        return stmt

    def count_for_period(
        self,
        period: Period,
        filters: TransactionFilters,
    ) -> int:
        stmt = select(func.count(Transaction.id)).where(
            Transaction.user_id == self.user_id,
            Transaction.deleted_at.is_(None),
        )
        if period.slug == "all":
            stmt = stmt.where(Transaction.date >= period.start)
        else:
            stmt = stmt.where(Transaction.date.between(period.start, period.end))
        stmt = self._apply_filters(stmt, filters)
        return int(self.session.execute(stmt).scalar_one() or 0)


class ReimbursementService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def set_reimbursement(self, transaction_id: int, is_reimbursement: bool) -> None:
        txn = self.session.get(Transaction, transaction_id)
        if not txn or txn.user_id != self.user_id:
            raise ValueError("Transaction not found")
        if txn.type != TransactionType.income:
            raise ValueError("Only income transactions can be reimbursements")
        if txn.is_reimbursement == is_reimbursement:
            return

        affected_expense_months: set[tuple[int, int]] = set()
        if not is_reimbursement:
            expense_dates = self.session.execute(
                select(Transaction.date)
                .join(
                    ReimbursementAllocation,
                    ReimbursementAllocation.expense_transaction_id == Transaction.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.reimbursement_transaction_id == txn.id,
                )
            ).all()
            for row in expense_dates:
                d = row[0]
                affected_expense_months.add((d.year, d.month))
            self.session.execute(
                delete(ReimbursementAllocation).where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.reimbursement_transaction_id == txn.id,
                )
            )

        txn.is_reimbursement = is_reimbursement
        self.session.flush()

        recompute_monthly_rollup_for_date(self.session, self.user_id, txn.date)
        for y, m in affected_expense_months:
            recompute_monthly_rollup(self.session, self.user_id, y, m)
        self.session.commit()

    def allocated_total_for_reimbursement(
        self, reimbursement_transaction_id: int
    ) -> int:
        expense = aliased(Transaction)
        return int(
            self.session.execute(
                select(func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0))
                .join(
                    expense,
                    ReimbursementAllocation.expense_transaction_id == expense.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == reimbursement_transaction_id,
                    expense.user_id == self.user_id,
                    expense.deleted_at.is_(None),
                    expense.type == TransactionType.expense,
                )
            ).scalar_one()
            or 0
        )

    def reimbursed_total_for_expense(self, expense_transaction_id: int) -> int:
        active_reimb = aliased(Transaction)
        return int(
            self.session.execute(
                select(func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0))
                .join(
                    active_reimb,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == active_reimb.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.expense_transaction_id
                    == expense_transaction_id,
                    active_reimb.deleted_at.is_(None),
                    active_reimb.type == TransactionType.income,
                    active_reimb.is_reimbursement.is_(True),
                )
            ).scalar_one()
            or 0
        )

    def reimbursed_totals_for_expenses(
        self, expense_transaction_ids: list[int]
    ) -> dict[int, int]:
        if not expense_transaction_ids:
            return {}

        ExpenseTxn = aliased(Transaction)
        ReimbursementTxn = aliased(Transaction)
        rows = self.session.execute(
            select(
                ReimbursementAllocation.expense_transaction_id.label("expense_id"),
                func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0).label(
                    "total"
                ),
            )
            .join(
                ExpenseTxn,
                ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
            )
            .join(
                ReimbursementTxn,
                ReimbursementAllocation.reimbursement_transaction_id
                == ReimbursementTxn.id,
            )
            .where(
                ReimbursementAllocation.user_id == self.user_id,
                ReimbursementAllocation.expense_transaction_id.in_(
                    expense_transaction_ids
                ),
                ExpenseTxn.user_id == self.user_id,
                ExpenseTxn.deleted_at.is_(None),
                ExpenseTxn.type == TransactionType.expense,
                ReimbursementTxn.user_id == self.user_id,
                ReimbursementTxn.deleted_at.is_(None),
                ReimbursementTxn.type == TransactionType.income,
                ReimbursementTxn.is_reimbursement.is_(True),
            )
            .group_by(ReimbursementAllocation.expense_transaction_id)
        ).all()
        return {int(r.expense_id): int(r.total or 0) for r in rows}

    def allocations_for_reimbursement(
        self, reimbursement_transaction_id: int
    ) -> list[ReimbursementAllocation]:
        expense = aliased(Transaction)
        stmt = (
            select(ReimbursementAllocation)
            .join(expense, ReimbursementAllocation.expense_transaction_id == expense.id)
            .options(
                joinedload(ReimbursementAllocation.expense_transaction).joinedload(
                    Transaction.category
                )
            )
            .where(
                ReimbursementAllocation.user_id == self.user_id,
                ReimbursementAllocation.reimbursement_transaction_id
                == reimbursement_transaction_id,
            )
            .order_by(expense.date.desc(), expense.id.desc())
        )
        return self.session.scalars(stmt).all()

    def allocations_for_expense(
        self, expense_transaction_id: int
    ) -> list[ReimbursementAllocation]:
        reimb = aliased(Transaction)
        stmt = (
            select(ReimbursementAllocation)
            .join(
                reimb, ReimbursementAllocation.reimbursement_transaction_id == reimb.id
            )
            .options(
                joinedload(
                    ReimbursementAllocation.reimbursement_transaction
                ).joinedload(Transaction.category)
            )
            .where(
                ReimbursementAllocation.user_id == self.user_id,
                ReimbursementAllocation.expense_transaction_id
                == expense_transaction_id,
            )
            .order_by(reimb.date.desc(), reimb.id.desc())
        )
        return self.session.scalars(stmt).all()

    def upsert_allocation(
        self,
        reimbursement_transaction_id: int,
        expense_transaction_id: int,
        amount_cents: int,
    ) -> ReimbursementAllocation:
        if amount_cents <= 0:
            raise ValueError("Allocation amount must be positive")
        reimbursement = self.session.get(Transaction, reimbursement_transaction_id)
        if not reimbursement or reimbursement.user_id != self.user_id:
            raise ValueError("Reimbursement transaction not found")
        if reimbursement.deleted_at is not None:
            raise ValueError("Reimbursement transaction is deleted")
        if (
            reimbursement.type != TransactionType.income
            or not reimbursement.is_reimbursement
        ):
            raise ValueError("Transaction is not marked as a reimbursement")

        expense = self.session.get(Transaction, expense_transaction_id)
        if not expense or expense.user_id != self.user_id:
            raise ValueError("Expense transaction not found")
        if expense.deleted_at is not None:
            raise ValueError("Expense transaction is deleted")
        if expense.type != TransactionType.expense:
            raise ValueError("Allocations can only target expense transactions")

        existing = self.session.scalar(
            select(ReimbursementAllocation).where(
                ReimbursementAllocation.user_id == self.user_id,
                ReimbursementAllocation.reimbursement_transaction_id
                == reimbursement_transaction_id,
                ReimbursementAllocation.expense_transaction_id
                == expense_transaction_id,
            )
        )

        allocated_other = int(
            self.session.execute(
                select(func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0))
                .join(
                    Transaction,
                    ReimbursementAllocation.expense_transaction_id == Transaction.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == reimbursement_transaction_id,
                    ReimbursementAllocation.expense_transaction_id
                    != expense_transaction_id,
                    Transaction.user_id == self.user_id,
                    Transaction.deleted_at.is_(None),
                    Transaction.type == TransactionType.expense,
                )
            ).scalar_one()
            or 0
        )
        if allocated_other + amount_cents > reimbursement.amount_cents:
            raise ValueError("Allocation exceeds reimbursement amount")

        reimbursed_other = int(
            self.session.execute(
                select(
                    func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0)
                ).where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.expense_transaction_id
                    == expense_transaction_id,
                    ReimbursementAllocation.reimbursement_transaction_id
                    != reimbursement_transaction_id,
                )
            ).scalar_one()
            or 0
        )
        if reimbursed_other + amount_cents > expense.amount_cents:
            raise ValueError("Allocation exceeds expense amount")

        if existing:
            existing.amount_cents = amount_cents
            allocation = existing
        else:
            allocation = ReimbursementAllocation(
                user_id=self.user_id,
                reimbursement_transaction_id=reimbursement_transaction_id,
                expense_transaction_id=expense_transaction_id,
                amount_cents=amount_cents,
            )
            self.session.add(allocation)

        self.session.flush()
        recompute_monthly_rollup_for_date(self.session, self.user_id, expense.date)
        self.session.commit()
        self.session.refresh(allocation)
        return allocation

    def delete_allocation(self, allocation_id: int) -> None:
        allocation = self.session.get(ReimbursementAllocation, allocation_id)
        if not allocation or allocation.user_id != self.user_id:
            raise ValueError("Allocation not found")
        expense = self.session.get(Transaction, allocation.expense_transaction_id)
        expense_date = expense.date if expense else None
        self.session.delete(allocation)
        self.session.flush()
        if expense_date:
            recompute_monthly_rollup_for_date(self.session, self.user_id, expense_date)
        self.session.commit()

    def search_expenses_for_reimbursement(
        self, reimbursement_transaction_id: int, *, query: str, limit: int = 25
    ) -> list[dict[str, object]]:
        reimbursement = self.session.get(Transaction, reimbursement_transaction_id)
        if not reimbursement or reimbursement.user_id != self.user_id:
            raise ValueError("Reimbursement transaction not found")
        if reimbursement.deleted_at is not None:
            raise ValueError("Reimbursement transaction is deleted")
        if (
            reimbursement.type != TransactionType.income
            or not reimbursement.is_reimbursement
        ):
            raise ValueError("Transaction is not marked as a reimbursement")

        stmt = (
            select(Transaction)
            .options(joinedload(Transaction.category))
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.expense,
            )
        )
        query_clean = query.strip()
        if query_clean:
            like = f"%{query_clean.lower()}%"
            stmt = stmt.join(Category, Category.id == Transaction.category_id).where(
                or_(
                    func.lower(func.coalesce(Transaction.title, "")).like(like),
                    func.lower(Category.name).like(like),
                )
            )
        stmt = stmt.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(
            limit
        )
        expenses = self.session.scalars(stmt).all()
        if not expenses:
            return []

        expense_ids = [e.id for e in expenses]

        active_reimb = aliased(Transaction)
        reimbursed_totals = {
            int(r.expense_transaction_id): int(r.total or 0)
            for r in self.session.execute(
                select(
                    ReimbursementAllocation.expense_transaction_id,
                    func.coalesce(
                        func.sum(ReimbursementAllocation.amount_cents), 0
                    ).label("total"),
                )
                .join(
                    active_reimb,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == active_reimb.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.expense_transaction_id.in_(expense_ids),
                    active_reimb.deleted_at.is_(None),
                    active_reimb.type == TransactionType.income,
                    active_reimb.is_reimbursement.is_(True),
                )
                .group_by(ReimbursementAllocation.expense_transaction_id)
            )
        }

        allocated_to_this = {
            int(r.expense_transaction_id): int(r.total or 0)
            for r in self.session.execute(
                select(
                    ReimbursementAllocation.expense_transaction_id,
                    func.coalesce(
                        func.sum(ReimbursementAllocation.amount_cents), 0
                    ).label("total"),
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == reimbursement_transaction_id,
                    ReimbursementAllocation.expense_transaction_id.in_(expense_ids),
                )
                .group_by(ReimbursementAllocation.expense_transaction_id)
            )
        }

        remaining_reimbursement = max(
            0,
            reimbursement.amount_cents
            - self.allocated_total_for_reimbursement(reimbursement_transaction_id),
        )

        results: list[dict[str, object]] = []
        for expense in expenses:
            reimbursed_total = int(reimbursed_totals.get(expense.id, 0))
            remaining_unreimbursed = max(0, expense.amount_cents - reimbursed_total)
            suggested = min(remaining_reimbursement, remaining_unreimbursed)
            results.append(
                {
                    "expense": expense,
                    "reimbursed_total_cents": reimbursed_total,
                    "remaining_unreimbursed_cents": remaining_unreimbursed,
                    "allocated_to_this_cents": int(
                        allocated_to_this.get(expense.id, 0)
                    ),
                    "suggested_amount_cents": suggested,
                }
            )
        return results


class ReceiptAttachmentService:
    ALLOWED_MIME_TYPES = {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
    }
    THUMBNAILABLE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
    THUMBNAIL_MAX_EDGE = 1024
    MAX_ATTACHMENTS_PER_TRANSACTION = 5

    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def _receipts_dir(self) -> Path:
        settings = get_settings()
        settings.receipts_dir.mkdir(parents=True, exist_ok=True)
        return settings.receipts_dir

    def path_for_storage_key(self, storage_key: str) -> Path:
        base = self._receipts_dir()
        resolved = (base / storage_key).resolve()
        if base not in resolved.parents and resolved != base:
            raise ValueError("Invalid storage key")
        return resolved

    def list_for_transaction(self, transaction_id: int) -> list[ReceiptAttachment]:
        stmt = (
            select(ReceiptAttachment)
            .where(
                ReceiptAttachment.user_id == self.user_id,
                ReceiptAttachment.transaction_id == transaction_id,
            )
            .order_by(ReceiptAttachment.created_at.desc(), ReceiptAttachment.id.desc())
        )
        return self.session.scalars(stmt).all()

    def count_for_transaction(self, transaction_id: int) -> int:
        return int(
            self.session.execute(
                select(func.count(ReceiptAttachment.id)).where(
                    ReceiptAttachment.user_id == self.user_id,
                    ReceiptAttachment.transaction_id == transaction_id,
                )
            ).scalar_one()
            or 0
        )

    def generate_storage_key(self, transaction_id: int, original_filename: str) -> str:
        suffix = Path(original_filename).suffix.lower()
        if not suffix:
            suffix = ".bin"
        return f"txn_{transaction_id}/{uuid4().hex}{suffix}"

    def create_metadata(
        self,
        *,
        transaction_id: int,
        storage_key: str,
        original_filename: str,
        mime_type: str,
        size_bytes: int,
        sha256_hex: str,
    ) -> ReceiptAttachment:
        attachment = ReceiptAttachment(
            user_id=self.user_id,
            transaction_id=transaction_id,
            storage_key=storage_key,
            original_filename=original_filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            sha256_hex=sha256_hex,
        )
        self.session.add(attachment)
        self.session.commit()
        self.session.refresh(attachment)
        log_event(
            logger,
            logging.INFO,
            "attachment_created",
            attachment_id=attachment.id,
            transaction_id=attachment.transaction_id,
            filename=attachment.original_filename,
            mime_type=attachment.mime_type,
            size_bytes=attachment.size_bytes,
            sha256_hex=attachment.sha256_hex,
        )
        return attachment

    def get(self, attachment_id: int) -> ReceiptAttachment:
        attachment = self.session.get(ReceiptAttachment, attachment_id)
        if not attachment or attachment.user_id != self.user_id:
            raise ValueError("Attachment not found")
        return attachment

    def thumbnail_path_for(self, attachment: ReceiptAttachment) -> Path:
        return self._receipts_dir() / ".thumbs" / f"{attachment.id}.webp"

    def ensure_thumbnail(self, attachment: ReceiptAttachment) -> Optional[Path]:
        if attachment.mime_type not in self.THUMBNAILABLE_MIME_TYPES:
            return None
        thumb_path = self.thumbnail_path_for(attachment)
        if thumb_path.exists():
            return thumb_path
        source_path = self.path_for_storage_key(attachment.storage_key)
        if not source_path.exists():
            return None

        from PIL import Image, UnidentifiedImageError

        settings = get_settings()
        edge = self.THUMBNAIL_MAX_EDGE
        thumb_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with Image.open(source_path) as image:
                if image.width * image.height > settings.receipt_thumbnail_max_pixels:
                    raise ValueError("Attachment image is too large")
                image.draft("RGB", (edge, edge))
                rgb = image.convert("RGB")
                rgb.thumbnail((edge, edge))
                rgb.save(thumb_path, format="WEBP", quality=80, method=4)
        except Image.DecompressionBombError as exc:
            raise ValueError("Attachment image is too large") from exc
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError("Attachment image cannot be thumbnailed") from exc
        return thumb_path

    def delete(self, attachment_id: int) -> None:
        attachment = self.get(attachment_id)
        filename = attachment.original_filename
        transaction_id = attachment.transaction_id
        path = self.path_for_storage_key(attachment.storage_key)
        if path.exists():
            path.unlink()
        thumb_path = self.thumbnail_path_for(attachment)
        if thumb_path.exists():
            thumb_path.unlink()
        self.session.delete(attachment)
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "attachment_deleted",
            attachment_id=attachment_id,
            transaction_id=transaction_id,
            filename=filename,
        )

    def purge_for_transaction_ids(self, transaction_ids: list[int]) -> int:
        if not transaction_ids:
            return 0
        attachments = self.session.scalars(
            select(ReceiptAttachment).where(
                ReceiptAttachment.user_id == self.user_id,
                ReceiptAttachment.transaction_id.in_(transaction_ids),
            )
        ).all()
        for attachment in attachments:
            path = self.path_for_storage_key(attachment.storage_key)
            if path.exists():
                path.unlink()
            thumb_path = self.thumbnail_path_for(attachment)
            if thumb_path.exists():
                thumb_path.unlink()
            self.session.delete(attachment)
        return len(attachments)


class IngestCategoryNotFound(ValueError):
    pass


class IngestCategoryAmbiguous(ValueError):
    pass


@dataclass(slots=True)
class IngestExpenseResult:
    transaction: Transaction
    location_status: Literal["not_provided", "stored", "ignored_partial"]


class IngestService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def ingest_expense(self, data: IngestTransactionIn) -> IngestExpenseResult:
        now_local = (
            datetime.now(ZoneInfo(get_settings().timezone))
            .replace(tzinfo=None)
            .replace(second=0, microsecond=0)
        )
        txn_date = data.date or now_local.date()
        latitude = data.latitude
        longitude = data.longitude
        location_status: Literal["not_provided", "stored", "ignored_partial"]
        stored_latitude: Optional[Decimal] = None
        stored_longitude: Optional[Decimal] = None
        if (
            "latitude" not in data.model_fields_set
            and "longitude" not in data.model_fields_set
        ):
            location_status = "not_provided"
        elif latitude is None or longitude is None:
            location_status = "ignored_partial"
        else:
            if latitude < -90 or latitude > 90:
                location_status = "ignored_partial"
            elif longitude < -180 or longitude > 180:
                location_status = "ignored_partial"
            else:
                stored_latitude = latitude.quantize(Decimal("0.000001"))
                stored_longitude = longitude.quantize(Decimal("0.000001"))
                location_status = "stored"
        category_resolution = "uncategorized"
        fuzzy_distance: int | None = None

        category_name_raw = (data.category or "").strip()
        if category_name_raw:
            input_lower = category_name_raw.lower()
            exact = self.session.scalar(
                select(Category).where(
                    Category.user_id == self.user_id,
                    Category.type == TransactionType.expense,
                    Category.archived_at.is_(None),
                    func.lower(Category.name) == input_lower,
                )
            )
            if exact:
                category_id = exact.id
                category_resolution = "exact"
            else:
                categories = self.session.scalars(
                    select(Category).where(
                        Category.user_id == self.user_id,
                        Category.type == TransactionType.expense,
                        Category.archived_at.is_(None),
                    )
                ).all()
                best_distance: Optional[int] = None
                best: list[Category] = []
                for category in categories:
                    name_lower = (category.name or "").strip().lower()
                    dist = int(Levenshtein.distance(input_lower, name_lower))
                    if best_distance is None or dist < best_distance:
                        best_distance = dist
                        best = [category]
                    elif dist == best_distance:
                        best.append(category)

                if best_distance is not None and best_distance <= 1:
                    if len(best) > 1:
                        options = ", ".join(sorted({c.name for c in best}))
                        raise IngestCategoryAmbiguous(
                            f"Category '{category_name_raw}' is ambiguous; matches: {options}"
                        )
                    category_id = best[0].id
                    category_resolution = "fuzzy"
                    fuzzy_distance = best_distance
                else:
                    try:
                        created = CategoryService(self.session, self.user_id).create(
                            CategoryIn(
                                name=category_name_raw,
                                type=TransactionType.expense,
                                order=0,
                            )
                        )
                        category_id = created.id
                        category_resolution = "created"
                    except ValueError as exc:
                        existing = self.session.scalar(
                            select(Category).where(
                                Category.user_id == self.user_id,
                                Category.type == TransactionType.expense,
                                func.lower(Category.name) == input_lower,
                            )
                        )
                        if existing:
                            if existing.archived_at is not None:
                                CategoryService(self.session, self.user_id).restore(
                                    existing.id
                                )
                                category_resolution = "restored"
                            else:
                                category_resolution = "exact"
                            category_id = existing.id
                        else:
                            raise IngestCategoryNotFound(str(exc)) from exc
        else:
            category_id = None

        txn_in = TransactionIn(
            date=txn_date,
            occurred_at=now_local,
            type=TransactionType.expense,
            amount_cents=data.amount_cents,
            category_id=category_id,
            title=data.title,
            description=None,
            latitude=stored_latitude,
            longitude=stored_longitude,
            tags=[],
        )
        txn = TransactionService(self.session, self.user_id).create(
            txn_in, source="ingest"
        )
        txn._ingest_log_fields = {
            "category_input": category_name_raw or None,
            "category_resolution": category_resolution,
            "fuzzy_distance": fuzzy_distance,
            "location_status": location_status,
            "rules_matched": txn._rule_result["matched"],
            "rules_applied": txn._rule_result["applied"],
        }
        return IngestExpenseResult(txn, location_status)


class BalanceAnchorService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def list_all(self) -> list[BalanceAnchor]:
        stmt = (
            select(BalanceAnchor)
            .where(BalanceAnchor.user_id == self.user_id)
            .order_by(BalanceAnchor.as_of_at.desc(), BalanceAnchor.id.desc())
        )
        return self.session.scalars(stmt).all()

    def create(self, data: BalanceAnchorIn) -> BalanceAnchor:
        anchor = BalanceAnchor(
            user_id=self.user_id,
            as_of_at=data.as_of_at,
            balance_cents=data.balance_cents,
            note=data.note,
        )
        self.session.add(anchor)
        self.session.commit()
        self.session.refresh(anchor)
        log_event(
            logger,
            logging.INFO,
            "balance_anchor_created",
            anchor_id=anchor.id,
            as_of_at=anchor.as_of_at.isoformat(),
            balance_cents=anchor.balance_cents,
        )
        return anchor

    def update(self, anchor_id: int, data: BalanceAnchorIn) -> BalanceAnchor:
        anchor = self.session.get(BalanceAnchor, anchor_id)
        if not anchor or anchor.user_id != self.user_id:
            raise ValueError("Balance snapshot not found")
        anchor.as_of_at = data.as_of_at
        anchor.balance_cents = data.balance_cents
        anchor.note = data.note
        self.session.commit()
        self.session.refresh(anchor)
        log_event(
            logger,
            logging.INFO,
            "balance_anchor_updated",
            anchor_id=anchor.id,
            as_of_at=anchor.as_of_at.isoformat(),
            balance_cents=anchor.balance_cents,
        )
        return anchor

    def delete(self, anchor_id: int) -> None:
        anchor = self.session.get(BalanceAnchor, anchor_id)
        if not anchor or anchor.user_id != self.user_id:
            raise ValueError("Balance anchor not found")
        self.session.delete(anchor)
        self.session.commit()
        log_event(logger, logging.INFO, "balance_anchor_deleted", anchor_id=anchor_id)

    def balance_as_of(self, target: datetime) -> int:
        earliest = datetime(1970, 1, 1, 0, 0, 0)
        if target < earliest:
            return 0

        anchor = self.session.scalar(
            select(BalanceAnchor)
            .where(
                BalanceAnchor.user_id == self.user_id,
                BalanceAnchor.as_of_at <= target,
            )
            .order_by(BalanceAnchor.as_of_at.desc(), BalanceAnchor.id.desc())
            .limit(1)
        )
        if anchor:
            baseline = int(anchor.balance_cents)
            start = anchor.as_of_at
            if start >= target:
                return baseline
        else:
            baseline = 0
            start = earliest

        stmt = select(
            func.coalesce(
                func.sum(
                    case(
                        (
                            Transaction.type == TransactionType.income,
                            Transaction.amount_cents,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("income"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            Transaction.type == TransactionType.expense,
                            Transaction.amount_cents,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("expenses"),
        ).where(
            Transaction.user_id == self.user_id,
            Transaction.deleted_at.is_(None),
            Transaction.occurred_at > start,
            Transaction.occurred_at <= target,
        )
        row = self.session.execute(stmt).one()
        income = int(row.income)
        expenses = int(row.expenses)
        return baseline + income - expenses


class MetricsService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()
        self._category_breakdown_cache: dict[str, list[dict[str, object]]] = {}

    def _invalidate_period_cache(self, period: Period) -> None:
        period_base = f"{period.start.isoformat()}_{period.end.isoformat()}"

        for type_suffix in ["expense", "income"]:
            period_key = f"{period_base}_{type_suffix}"
            if period_key in self._category_breakdown_cache:
                del self._category_breakdown_cache[period_key]

        old_key = period_base
        if old_key in self._category_breakdown_cache:
            del self._category_breakdown_cache[old_key]

    def kpis(
        self, period: Period, *, tag_ids: Optional[list[int]] = None
    ) -> dict[str, int]:
        def kpis_from_transactions(start: date, end: date) -> tuple[int, int]:
            income_stmt = select(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                (Transaction.type == TransactionType.income)
                                & (Transaction.is_reimbursement.is_(False)),
                                Transaction.amount_cents,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("income")
            ).where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.date.between(start, end),
            )
            expense_stmt = select(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                Transaction.type == TransactionType.expense,
                                Transaction.amount_cents,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("expenses")
            ).where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.date.between(start, end),
            )
            if tag_ids:
                income_stmt = income_stmt.where(
                    Transaction.tags.any(Tag.id.in_(tag_ids))
                )
                expense_stmt = expense_stmt.where(
                    Transaction.tags.any(Tag.id.in_(tag_ids))
                )

            income = int(self.session.execute(income_stmt).scalar_one() or 0)
            expense_gross = int(self.session.execute(expense_stmt).scalar_one() or 0)

            ExpenseTxn = aliased(Transaction)
            ReimbursementTxn = aliased(Transaction)
            reimbursed_stmt = (
                select(func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0))
                .join(
                    ExpenseTxn,
                    ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
                )
                .join(
                    ReimbursementTxn,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == ReimbursementTxn.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ExpenseTxn.user_id == self.user_id,
                    ReimbursementTxn.user_id == self.user_id,
                    ExpenseTxn.deleted_at.is_(None),
                    ExpenseTxn.type == TransactionType.expense,
                    ExpenseTxn.date.between(start, end),
                    ReimbursementTxn.deleted_at.is_(None),
                    ReimbursementTxn.type == TransactionType.income,
                    ReimbursementTxn.is_reimbursement.is_(True),
                )
            )
            if tag_ids:
                reimbursed_stmt = reimbursed_stmt.where(
                    ExpenseTxn.tags.any(Tag.id.in_(tag_ids))
                )
            reimbursed = int(self.session.execute(reimbursed_stmt).scalar_one() or 0)

            expenses = max(0, expense_gross - reimbursed)
            return income, expenses

        # Balance calculation currently ignores tags because it's account-level.
        # Ideally, we should support calculating balance for a tag (income - expense),
        # but BalanceAnchor is global.
        # For now, if tag_ids are present, "balance" in KPI means "net flow for this tag".

        balance_at_end = 0
        if not tag_ids:
            balance_at_end = BalanceAnchorService(
                self.session, self.user_id
            ).balance_as_of(datetime.combine(period.end, time.max))

        # If filtering by tags, we cannot use MonthlyRollup as it doesn't have tag info.
        if tag_ids:
            income, expenses = kpis_from_transactions(period.start, period.end)
            return {
                "income": income,
                "expenses": expenses,
                "balance": balance_at_end if not tag_ids else (income - expenses),
            }

        is_single_full_month = (
            period.start == month_start(period.start.year, period.start.month)
            and period.end == month_end(period.start.year, period.start.month)
            and period.start.year == period.end.year
            and period.start.month == period.end.month
        )
        if is_single_full_month:
            rollup = self.session.scalar(
                select(MonthlyRollup).where(
                    MonthlyRollup.user_id == self.user_id,
                    MonthlyRollup.year == period.start.year,
                    MonthlyRollup.month == period.start.month,
                )
            )
            income = rollup.income_cents if rollup else 0
            expenses = rollup.expense_cents if rollup else 0
            return {
                "income": income,
                "expenses": expenses,
                "balance": balance_at_end,
            }

        if (
            period.start.year == period.end.year
            and period.start.month == period.end.month
        ):
            income, expenses = kpis_from_transactions(period.start, period.end)
            return {
                "income": income,
                "expenses": expenses,
                "balance": balance_at_end,
            }

        start_month_end = month_end(period.start.year, period.start.month)
        end_month_start = month_start(period.end.year, period.end.month)

        start_income, start_expenses = kpis_from_transactions(
            period.start, start_month_end
        )
        end_income, end_expenses = kpis_from_transactions(end_month_start, period.end)

        full_months_start = add_months(
            month_start(period.start.year, period.start.month), 1
        )
        full_months_end = add_months(month_start(period.end.year, period.end.month), -1)
        full_income = 0
        full_expenses = 0
        if full_months_start <= full_months_end:
            start_key = full_months_start.year * 12 + (full_months_start.month - 1)
            end_key = full_months_end.year * 12 + (full_months_end.month - 1)
            stmt = select(
                func.coalesce(func.sum(MonthlyRollup.income_cents), 0).label("income"),
                func.coalesce(func.sum(MonthlyRollup.expense_cents), 0).label(
                    "expenses"
                ),
            ).where(
                MonthlyRollup.user_id == self.user_id,
                (MonthlyRollup.year * 12 + (MonthlyRollup.month - 1)).between(
                    start_key, end_key
                ),
            )
            row = self.session.execute(stmt).one()
            full_income = int(row.income)
            full_expenses = int(row.expenses)

        income = start_income + full_income + end_income
        expenses = start_expenses + full_expenses + end_expenses
        return {
            "income": income,
            "expenses": expenses,
            "balance": balance_at_end,
        }

    def kpi_sparklines(
        self,
        period: Period,
        *,
        max_points: int = 12,
        tag_ids: Optional[list[int]] = None,
    ) -> dict[str, str]:
        def income_expense_between(start: date, end: date) -> tuple[int, int]:
            income_stmt = select(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                (Transaction.type == TransactionType.income)
                                & (Transaction.is_reimbursement.is_(False)),
                                Transaction.amount_cents,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("income")
            ).where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.date.between(start, end),
            )
            expense_stmt = select(
                func.coalesce(
                    func.sum(
                        case(
                            (
                                Transaction.type == TransactionType.expense,
                                Transaction.amount_cents,
                            ),
                            else_=0,
                        )
                    ),
                    0,
                ).label("expenses")
            ).where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.date.between(start, end),
            )
            if tag_ids:
                income_stmt = income_stmt.where(
                    Transaction.tags.any(Tag.id.in_(tag_ids))
                )
                expense_stmt = expense_stmt.where(
                    Transaction.tags.any(Tag.id.in_(tag_ids))
                )

            income = int(self.session.execute(income_stmt).scalar_one() or 0)
            expense_gross = int(self.session.execute(expense_stmt).scalar_one() or 0)

            ExpenseTxn = aliased(Transaction)
            ReimbursementTxn = aliased(Transaction)
            reimbursed_stmt = (
                select(func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0))
                .join(
                    ExpenseTxn,
                    ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
                )
                .join(
                    ReimbursementTxn,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == ReimbursementTxn.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ExpenseTxn.user_id == self.user_id,
                    ReimbursementTxn.user_id == self.user_id,
                    ExpenseTxn.deleted_at.is_(None),
                    ExpenseTxn.type == TransactionType.expense,
                    ExpenseTxn.date.between(start, end),
                    ReimbursementTxn.deleted_at.is_(None),
                    ReimbursementTxn.type == TransactionType.income,
                    ReimbursementTxn.is_reimbursement.is_(True),
                )
            )
            if tag_ids:
                reimbursed_stmt = reimbursed_stmt.where(
                    ExpenseTxn.tags.any(Tag.id.in_(tag_ids))
                )
            reimbursed = int(self.session.execute(reimbursed_stmt).scalar_one() or 0)

            expenses = max(0, expense_gross - reimbursed)
            return income, expenses

        def build_points(values: list[int]) -> str:
            if not values:
                return ""
            if len(values) == 1:
                values = [values[0], values[0]]
            min_v = min(values)
            max_v = max(values)
            pad_top = 2.0
            pad_bottom = 2.0
            height = 30.0
            width = 100.0
            usable_h = height - pad_top - pad_bottom
            step = width / (len(values) - 1)
            points: list[str] = []
            for idx, v in enumerate(values):
                x = idx * step
                if max_v == min_v:
                    y = height / 2
                else:
                    t = (v - min_v) / (max_v - min_v)
                    y = pad_top + (1 - t) * usable_h
                points.append(f"{x:.2f},{y:.2f}")
            return " ".join(points)

        start_month = month_start(period.start.year, period.start.month)
        end_month = month_start(period.end.year, period.end.month)
        months: list[date] = []
        current = start_month
        while current <= end_month:
            months.append(current)
            current = add_months(current, 1)

        if len(months) > max_points:
            months = months[-max_points:]

        rollup_map = {}
        if not tag_ids:
            keys = [(m.year, m.month) for m in months]
            rollups = self.session.scalars(
                select(MonthlyRollup).where(
                    MonthlyRollup.user_id == self.user_id,
                    tuple_(MonthlyRollup.year, MonthlyRollup.month).in_(keys),
                )
            ).all()
            rollup_map = {(r.year, r.month): r for r in rollups}

        income_series: list[int] = []
        expense_series: list[int] = []
        balance_series: list[int] = []
        balance_service = BalanceAnchorService(self.session, self.user_id)

        current_balance_offset = 0
        if tag_ids:
            # For tags, balance is cumulative net flow
            current_balance_offset = 0

        for month in months:
            bucket_start = month
            bucket_end = month_end(month.year, month.month)
            if bucket_start < period.start:
                bucket_start = period.start
            if bucket_end > period.end:
                bucket_end = period.end

            full_month = bucket_start == month and bucket_end == month_end(
                month.year, month.month
            )

            income = 0
            expenses = 0

            if full_month and not tag_ids:
                rollup = rollup_map.get((month.year, month.month))
                if rollup:
                    income = rollup.income_cents
                    expenses = rollup.expense_cents
                else:
                    income, expenses = income_expense_between(bucket_start, bucket_end)
            else:
                income, expenses = income_expense_between(bucket_start, bucket_end)

            income_series.append(income)
            expense_series.append(expenses)

            if tag_ids:
                current_balance_offset += income - expenses
                balance_series.append(current_balance_offset)
            else:
                balance_series.append(
                    balance_service.balance_as_of(
                        datetime.combine(bucket_end, time.max)
                    )
                )

        return {
            "income": build_points(income_series),
            "expenses": build_points(expense_series),
            "balance": build_points(balance_series),
        }

    def category_breakdown(
        self,
        period: Period,
        transaction_type: Optional[TransactionType] = None,
        *,
        category_ids: Optional[list[int]] = None,
        tag_ids: Optional[list[int]] = None,
    ) -> list[dict[str, object]]:
        if transaction_type is None:
            transaction_type = TransactionType.expense

        type_suffix = transaction_type.value if transaction_type else "expense"
        category_suffix = (
            "all"
            if not category_ids
            else "cats_" + "_".join(str(i) for i in sorted(set(category_ids)))
        )
        tag_suffix = (
            "all"
            if not tag_ids
            else "tags_" + "_".join(str(i) for i in sorted(set(tag_ids)))
        )
        period_key = f"{period.start.isoformat()}_{period.end.isoformat()}_{type_suffix}_{category_suffix}_{tag_suffix}"
        if period_key in self._category_breakdown_cache:
            return self._category_breakdown_cache[period_key]

        if transaction_type == TransactionType.income:
            stmt = (
                select(Category.name, func.sum(Transaction.amount_cents).label("total"))
                .join(Category, Category.id == Transaction.category_id)
                .where(
                    Transaction.user_id == self.user_id,
                    Transaction.deleted_at.is_(None),
                    Transaction.type == TransactionType.income,
                    Transaction.is_reimbursement.is_(False),
                    Transaction.date.between(period.start, period.end),
                )
                .group_by(Category.name)
                .order_by(func.sum(Transaction.amount_cents).desc())
            )
            if category_ids:
                stmt = stmt.where(Transaction.category_id.in_(category_ids))
            if tag_ids:
                stmt = stmt.where(Transaction.tags.any(Tag.id.in_(tag_ids)))

            rows = self.session.execute(stmt).all()
            total = sum(row.total or 0 for row in rows)
            breakdown = []
            for row in rows:
                amount = int(row.total or 0)
                percent = (amount / total * 100) if total else 0
                breakdown.append(
                    {"name": row.name, "amount_cents": amount, "percent": percent}
                )
            self._category_breakdown_cache[period_key] = breakdown
            return breakdown

        gross_stmt = (
            select(
                Category.id.label("category_id"),
                Category.name.label("name"),
                func.coalesce(func.sum(Transaction.amount_cents), 0).label("gross"),
            )
            .join(Category, Category.id == Transaction.category_id)
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.expense,
                Transaction.date.between(period.start, period.end),
            )
            .group_by(Category.id, Category.name)
        )
        if category_ids:
            gross_stmt = gross_stmt.where(Transaction.category_id.in_(category_ids))
        if tag_ids:
            gross_stmt = gross_stmt.where(Transaction.tags.any(Tag.id.in_(tag_ids)))
        gross_rows = self.session.execute(gross_stmt).all()

        ExpenseTxn = aliased(Transaction)
        ReimbursementTxn = aliased(Transaction)
        reimb_stmt = (
            select(
                ExpenseTxn.category_id.label("category_id"),
                func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0).label(
                    "reimbursed"
                ),
            )
            .join(
                ExpenseTxn,
                ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
            )
            .join(
                ReimbursementTxn,
                ReimbursementAllocation.reimbursement_transaction_id
                == ReimbursementTxn.id,
            )
            .where(
                ReimbursementAllocation.user_id == self.user_id,
                ExpenseTxn.user_id == self.user_id,
                ReimbursementTxn.user_id == self.user_id,
                ExpenseTxn.deleted_at.is_(None),
                ExpenseTxn.type == TransactionType.expense,
                ExpenseTxn.date.between(period.start, period.end),
                ReimbursementTxn.deleted_at.is_(None),
                ReimbursementTxn.type == TransactionType.income,
                ReimbursementTxn.is_reimbursement.is_(True),
            )
            .group_by(ExpenseTxn.category_id)
        )
        if category_ids:
            reimb_stmt = reimb_stmt.where(ExpenseTxn.category_id.in_(category_ids))
        if tag_ids:
            reimb_stmt = reimb_stmt.where(ExpenseTxn.tags.any(Tag.id.in_(tag_ids)))

        reimb_rows = self.session.execute(reimb_stmt).all()
        reimb_map = {row.category_id: int(row.reimbursed or 0) for row in reimb_rows}

        breakdown = []
        total = 0
        for row in gross_rows:
            gross = int(row.gross or 0)
            reimbursed = int(reimb_map.get(row.category_id, 0))
            net = max(0, gross - reimbursed)
            if net <= 0:
                continue
            total += net
            breakdown.append({"name": row.name, "amount_cents": net, "percent": 0})
        breakdown.sort(key=lambda r: int(r["amount_cents"]), reverse=True)
        breakdown = breakdown[:8]
        for item in breakdown:
            amount = int(item["amount_cents"])
            item["percent"] = (amount / total * 100) if total else 0
        self._category_breakdown_cache[period_key] = breakdown
        return breakdown


class InsightsService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()
        self.metrics = MetricsService(session, self.user_id)

    def monthly_series(
        self,
        period: Period,
        *,
        months_back: int = 12,
        tag_ids: Optional[list[int]] = None,
    ) -> list[dict[str, object]]:
        start_month = month_start(period.start.year, period.start.month)
        end_month = month_start(period.end.year, period.end.month)
        months: list[date] = []
        current = start_month
        while current <= end_month:
            months.append(current)
            current = add_months(current, 1)
        if len(months) > months_back:
            months = months[-months_back:]

        base_start = months[0]
        base_end = period.end

        income_stmt = (
            select(
                func.strftime("%Y", Transaction.date).label("year"),
                func.strftime("%m", Transaction.date).label("month"),
                func.coalesce(func.sum(Transaction.amount_cents), 0).label("total"),
            )
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.income,
                Transaction.is_reimbursement.is_(False),
                Transaction.date.between(base_start, base_end),
            )
            .group_by("year", "month")
        )
        expense_gross_stmt = (
            select(
                func.strftime("%Y", Transaction.date).label("year"),
                func.strftime("%m", Transaction.date).label("month"),
                func.coalesce(func.sum(Transaction.amount_cents), 0).label("total"),
            )
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.expense,
                Transaction.date.between(base_start, base_end),
            )
            .group_by("year", "month")
        )
        if tag_ids:
            income_stmt = income_stmt.where(Transaction.tags.any(Tag.id.in_(tag_ids)))
            expense_gross_stmt = expense_gross_stmt.where(
                Transaction.tags.any(Tag.id.in_(tag_ids))
            )

        income_totals: dict[tuple[int, int], int] = {}
        for row in self.session.execute(income_stmt):
            income_totals[(int(row.year), int(row.month))] = int(row.total or 0)

        expense_gross_totals: dict[tuple[int, int], int] = {}
        for row in self.session.execute(expense_gross_stmt):
            expense_gross_totals[(int(row.year), int(row.month))] = int(row.total or 0)

        ExpenseTxn = aliased(Transaction)
        ReimbursementTxn = aliased(Transaction)
        reimb_stmt = (
            select(
                func.strftime("%Y", ExpenseTxn.date).label("year"),
                func.strftime("%m", ExpenseTxn.date).label("month"),
                func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0).label(
                    "total"
                ),
            )
            .join(
                ExpenseTxn,
                ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
            )
            .join(
                ReimbursementTxn,
                ReimbursementAllocation.reimbursement_transaction_id
                == ReimbursementTxn.id,
            )
            .where(
                ReimbursementAllocation.user_id == self.user_id,
                ExpenseTxn.user_id == self.user_id,
                ReimbursementTxn.user_id == self.user_id,
                ExpenseTxn.deleted_at.is_(None),
                ExpenseTxn.type == TransactionType.expense,
                ExpenseTxn.date.between(base_start, base_end),
                ReimbursementTxn.deleted_at.is_(None),
                ReimbursementTxn.type == TransactionType.income,
                ReimbursementTxn.is_reimbursement.is_(True),
            )
            .group_by("year", "month")
        )
        if tag_ids:
            reimb_stmt = reimb_stmt.where(ExpenseTxn.tags.any(Tag.id.in_(tag_ids)))

        reimb_totals: dict[tuple[int, int], int] = {}
        for row in self.session.execute(reimb_stmt):
            reimb_totals[(int(row.year), int(row.month))] = int(row.total or 0)

        out: list[dict[str, object]] = []
        for month in months:
            key = (month.year, month.month)
            income = income_totals.get(key, 0)
            expense_gross = expense_gross_totals.get(key, 0)
            reimbursed = reimb_totals.get(key, 0)
            expense = max(0, expense_gross - reimbursed)
            out.append(
                {
                    "year": month.year,
                    "month": month.month,
                    "label": f"{month.year:04d}-{month.month:02d}",
                    "income_cents": income,
                    "expense_cents": expense,
                    "net_cents": income - expense,
                }
            )
        return out

    def top_tags(
        self,
        period: Period,
        *,
        transaction_type: TransactionType = TransactionType.expense,
        limit: int = 12,
    ) -> list[dict[str, object]]:
        if transaction_type == TransactionType.income:
            stmt = (
                select(
                    Tag.id.label("tag_id"),
                    Tag.name.label("tag_name"),
                    func.coalesce(func.sum(Transaction.amount_cents), 0).label("total"),
                )
                .select_from(Transaction)
                .join(Transaction.tags)
                .where(
                    Transaction.user_id == self.user_id,
                    Transaction.deleted_at.is_(None),
                    Transaction.type == TransactionType.income,
                    Transaction.is_reimbursement.is_(False),
                    Transaction.date.between(period.start, period.end),
                )
                .group_by(Tag.id, Tag.name)
                .order_by(func.sum(Transaction.amount_cents).desc())
                .limit(limit)
            )
            return [
                {
                    "id": int(r.tag_id),
                    "name": str(r.tag_name),
                    "amount_cents": int(r.total),
                }
                for r in self.session.execute(stmt)
            ]

        gross_rows = self.session.execute(
            select(
                Tag.id.label("tag_id"),
                Tag.name.label("tag_name"),
                func.coalesce(func.sum(Transaction.amount_cents), 0).label("gross"),
            )
            .select_from(Transaction)
            .join(Transaction.tags)
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.expense,
                Transaction.date.between(period.start, period.end),
            )
            .group_by(Tag.id, Tag.name)
        ).all()
        if not gross_rows:
            return []

        ExpenseTxn = aliased(Transaction)
        ReimbursementTxn = aliased(Transaction)
        reimb_by_tag = {
            int(r.tag_id): int(r.reimbursed or 0)
            for r in self.session.execute(
                select(
                    Tag.id.label("tag_id"),
                    func.coalesce(
                        func.sum(ReimbursementAllocation.amount_cents), 0
                    ).label("reimbursed"),
                )
                .select_from(ReimbursementAllocation)
                .join(
                    ExpenseTxn,
                    ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
                )
                .join(
                    transaction_tags,
                    transaction_tags.c.transaction_id == ExpenseTxn.id,
                )
                .join(Tag, Tag.id == transaction_tags.c.tag_id)
                .join(
                    ReimbursementTxn,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == ReimbursementTxn.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ExpenseTxn.user_id == self.user_id,
                    ExpenseTxn.deleted_at.is_(None),
                    ExpenseTxn.type == TransactionType.expense,
                    ExpenseTxn.date.between(period.start, period.end),
                    Tag.user_id == self.user_id,
                    ReimbursementTxn.user_id == self.user_id,
                    ReimbursementTxn.deleted_at.is_(None),
                    ReimbursementTxn.type == TransactionType.income,
                    ReimbursementTxn.is_reimbursement.is_(True),
                )
                .group_by(Tag.id)
            )
        }

        out = []
        for row in gross_rows:
            gross = int(row.gross or 0)
            reimbursed = int(reimb_by_tag.get(int(row.tag_id), 0))
            out.append(
                {
                    "id": int(row.tag_id),
                    "name": str(row.tag_name),
                    "amount_cents": max(0, gross - reimbursed),
                }
            )
        out.sort(key=lambda r: int(r["amount_cents"]), reverse=True)
        return out[:limit]

    def category_trend(
        self,
        category_id: int,
        *,
        end: date,
        months_back: int = 12,
        tag_ids: Optional[list[int]] = None,
    ) -> list[dict[str, object]]:
        end_month = month_start(end.year, end.month)
        start_month = add_months(end_month, -(months_back - 1))
        months: list[date] = []
        current = start_month
        while current <= end_month:
            months.append(current)
            current = add_months(current, 1)

        stmt = (
            select(
                func.strftime("%Y", Transaction.date).label("year"),
                func.strftime("%m", Transaction.date).label("month"),
                func.coalesce(func.sum(Transaction.amount_cents), 0).label("total"),
            )
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.category_id == category_id,
                Transaction.date.between(start_month, end),
            )
            .group_by("year", "month")
        )
        if tag_ids:
            stmt = stmt.where(Transaction.tags.any(Tag.id.in_(tag_ids)))

        gross_totals = {
            (int(r.year), int(r.month)): int(r.total or 0)
            for r in self.session.execute(stmt)
        }

        ExpenseTxn = aliased(Transaction)
        ReimbursementTxn = aliased(Transaction)
        reimb_stmt = (
            select(
                func.strftime("%Y", ExpenseTxn.date).label("year"),
                func.strftime("%m", ExpenseTxn.date).label("month"),
                func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0).label(
                    "total"
                ),
            )
            .join(
                ExpenseTxn,
                ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
            )
            .join(
                ReimbursementTxn,
                ReimbursementAllocation.reimbursement_transaction_id
                == ReimbursementTxn.id,
            )
            .where(
                ReimbursementAllocation.user_id == self.user_id,
                ExpenseTxn.user_id == self.user_id,
                ReimbursementTxn.user_id == self.user_id,
                ExpenseTxn.deleted_at.is_(None),
                ExpenseTxn.type == TransactionType.expense,
                ExpenseTxn.category_id == category_id,
                ExpenseTxn.date.between(start_month, end),
                ReimbursementTxn.deleted_at.is_(None),
                ReimbursementTxn.type == TransactionType.income,
                ReimbursementTxn.is_reimbursement.is_(True),
            )
            .group_by("year", "month")
        )
        if tag_ids:
            reimb_stmt = reimb_stmt.where(ExpenseTxn.tags.any(Tag.id.in_(tag_ids)))
        reimb_totals = {
            (int(r.year), int(r.month)): int(r.total or 0)
            for r in self.session.execute(reimb_stmt)
        }

        out: list[dict[str, object]] = []
        for month in months:
            key = (month.year, month.month)
            gross = gross_totals.get(key, 0)
            reimbursed = reimb_totals.get(key, 0)
            net = max(0, gross - reimbursed)
            out.append(
                {
                    "year": month.year,
                    "month": month.month,
                    "label": f"{month.year:04d}-{month.month:02d}",
                    "amount_cents": net,
                }
            )
        return out

    def flow_data(
        self,
        period: Period,
        *,
        tag_ids: Optional[list[int]] = None,
        tx_type: Optional[TransactionType] = None,
    ) -> dict[str, list[dict[str, object]]]:
        incomes: list[dict[str, object]] = []
        if tx_type in {None, TransactionType.income}:
            income_stmt = (
                select(
                    Category.id.label("category_id"),
                    Category.name.label("category_name"),
                    Category.icon.label("category_icon"),
                    func.coalesce(func.sum(Transaction.amount_cents), 0).label("total"),
                )
                .select_from(Transaction)
                .join(Category, Category.id == Transaction.category_id)
                .where(
                    Transaction.user_id == self.user_id,
                    Transaction.deleted_at.is_(None),
                    Transaction.type == TransactionType.income,
                    Transaction.is_reimbursement.is_(False),
                    Transaction.date.between(period.start, period.end),
                )
                .group_by(Category.id, Category.name, Category.icon)
                .order_by(
                    func.sum(Transaction.amount_cents).desc(), Category.name.asc()
                )
            )
            if tag_ids:
                income_stmt = income_stmt.where(
                    Transaction.tags.any(Tag.id.in_(tag_ids))
                )
            income_rows = self.session.execute(income_stmt).all()
            incomes = [
                {
                    "category_id": int(row.category_id),
                    "label": str(row.category_name),
                    "icon": row.category_icon,
                    "amount_cents": int(row.total or 0),
                }
                for row in income_rows
                if int(row.total or 0) > 0
            ]

        expenses: list[dict[str, object]] = []
        if tx_type in {None, TransactionType.expense}:
            expense_gross_stmt = (
                select(
                    Category.id.label("category_id"),
                    Category.name.label("category_name"),
                    Category.icon.label("category_icon"),
                    func.coalesce(func.sum(Transaction.amount_cents), 0).label("gross"),
                )
                .select_from(Transaction)
                .join(Category, Category.id == Transaction.category_id)
                .where(
                    Transaction.user_id == self.user_id,
                    Transaction.deleted_at.is_(None),
                    Transaction.type == TransactionType.expense,
                    Transaction.date.between(period.start, period.end),
                )
                .group_by(Category.id, Category.name, Category.icon)
            )
            if tag_ids:
                expense_gross_stmt = expense_gross_stmt.where(
                    Transaction.tags.any(Tag.id.in_(tag_ids))
                )
            gross_rows = self.session.execute(expense_gross_stmt).all()
            gross_by_category = {
                int(row.category_id): {
                    "label": str(row.category_name),
                    "icon": row.category_icon,
                    "gross_cents": int(row.gross or 0),
                }
                for row in gross_rows
            }

            ExpenseTxn = aliased(Transaction)
            ReimbursementTxn = aliased(Transaction)
            reimb_stmt = (
                select(
                    ExpenseTxn.category_id.label("category_id"),
                    func.coalesce(
                        func.sum(ReimbursementAllocation.amount_cents), 0
                    ).label("reimbursed"),
                )
                .join(
                    ExpenseTxn,
                    ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
                )
                .join(
                    ReimbursementTxn,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == ReimbursementTxn.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ExpenseTxn.user_id == self.user_id,
                    ReimbursementTxn.user_id == self.user_id,
                    ExpenseTxn.deleted_at.is_(None),
                    ExpenseTxn.type == TransactionType.expense,
                    ExpenseTxn.date.between(period.start, period.end),
                    ReimbursementTxn.deleted_at.is_(None),
                    ReimbursementTxn.type == TransactionType.income,
                    ReimbursementTxn.is_reimbursement.is_(True),
                )
                .group_by(ExpenseTxn.category_id)
            )
            if tag_ids:
                reimb_stmt = reimb_stmt.where(ExpenseTxn.tags.any(Tag.id.in_(tag_ids)))
            reimbursed_by_category = {
                int(row.category_id): int(row.reimbursed or 0)
                for row in self.session.execute(reimb_stmt)
            }

            for category_id, row in gross_by_category.items():
                net_amount = max(
                    0,
                    int(row["gross_cents"])
                    - int(reimbursed_by_category.get(category_id, 0)),
                )
                if net_amount <= 0:
                    continue
                expenses.append(
                    {
                        "category_id": category_id,
                        "label": str(row["label"]),
                        "icon": row["icon"],
                        "amount_cents": net_amount,
                    }
                )
            expenses.sort(key=lambda item: int(item["amount_cents"]), reverse=True)

        total_income = sum(int(row["amount_cents"]) for row in incomes)
        total_expense = sum(int(row["amount_cents"]) for row in expenses)
        if total_income <= 0 and total_expense <= 0:
            return {"nodes": [], "links": []}

        nodes: list[dict[str, object]] = []
        links: list[dict[str, object]] = []

        source_nodes = [
            {
                "id": f"income:{int(row['category_id'])}",
                "label": row["label"],
                "type": "income",
                "amount_cents": int(row["amount_cents"]),
                "category_id": int(row["category_id"]),
            }
            for row in incomes
        ]
        expense_nodes = [
            {
                "id": f"expense:{int(row['category_id'])}",
                "label": row["label"],
                "type": "expense",
                "amount_cents": int(row["amount_cents"]),
                "category_id": int(row["category_id"]),
            }
            for row in expenses
        ]

        if total_income <= 0 and total_expense > 0:
            source_nodes = [
                {
                    "id": "deficit",
                    "label": "Deficit / drawn from savings",
                    "type": "deficit",
                    "amount_cents": total_expense,
                    "category_id": None,
                }
            ]
            sink_nodes = [*expense_nodes]
        elif total_income > 0 and total_expense <= 0:
            sink_nodes = [
                {
                    "id": "savings",
                    "label": "Net savings",
                    "type": "savings",
                    "amount_cents": total_income,
                    "category_id": None,
                }
            ]
        elif total_income >= total_expense:
            savings_amount = total_income - total_expense
            sink_nodes = [*expense_nodes]
            if savings_amount > 0:
                sink_nodes.append(
                    {
                        "id": "savings",
                        "label": "Net savings",
                        "type": "savings",
                        "amount_cents": savings_amount,
                        "category_id": None,
                    }
                )
        else:
            deficit_amount = total_expense - total_income
            source_nodes.append(
                {
                    "id": "deficit",
                    "label": "Deficit / drawn from savings",
                    "type": "deficit",
                    "amount_cents": deficit_amount,
                    "category_id": None,
                }
            )
            sink_nodes = [*expense_nodes]

        nodes.extend(source_nodes)
        nodes.extend(sink_nodes)

        sink_amounts = [int(node["amount_cents"]) for node in sink_nodes]
        sink_ids = [str(node["id"]) for node in sink_nodes]
        sink_total = sum(sink_amounts)
        if sink_total <= 0:
            return {"nodes": [], "links": []}

        for source in source_nodes:
            source_amount = int(source["amount_cents"])
            raw_shares = [
                source_amount * amount / sink_total for amount in sink_amounts
            ]
            floored = [int(value) for value in raw_shares]
            remainder = source_amount - sum(floored)
            ranked_remainders = sorted(
                range(len(raw_shares)),
                key=lambda idx: raw_shares[idx] - floored[idx],
                reverse=True,
            )
            for idx in ranked_remainders[:remainder]:
                floored[idx] += 1

            for sink_index, amount in enumerate(floored):
                if amount <= 0:
                    continue
                links.append(
                    {
                        "from": str(source["id"]),
                        "to": sink_ids[sink_index],
                        "amount_cents": amount,
                    }
                )

        return {"nodes": nodes, "links": links}

    def expense_category_deltas(
        self, period: Period, *, tag_ids: Optional[list[int]] = None, limit: int = 8
    ) -> dict[str, list[dict[str, object]]]:
        duration_days = (period.end - period.start).days + 1
        prev_end = period.start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=duration_days - 1)
        prev = Period("prev", prev_start, prev_end)

        def totals_for(p: Period) -> dict[int, int]:
            gross_stmt = (
                select(
                    Transaction.category_id,
                    func.coalesce(func.sum(Transaction.amount_cents), 0).label("total"),
                )
                .where(
                    Transaction.user_id == self.user_id,
                    Transaction.deleted_at.is_(None),
                    Transaction.type == TransactionType.expense,
                    Transaction.date.between(p.start, p.end),
                )
                .group_by(Transaction.category_id)
            )
            if tag_ids:
                gross_stmt = gross_stmt.where(Transaction.tags.any(Tag.id.in_(tag_ids)))
            gross = {
                int(r.category_id): int(r.total or 0)
                for r in self.session.execute(gross_stmt)
            }

            ExpenseTxn = aliased(Transaction)
            ReimbursementTxn = aliased(Transaction)
            reimb_stmt = (
                select(
                    ExpenseTxn.category_id.label("category_id"),
                    func.coalesce(
                        func.sum(ReimbursementAllocation.amount_cents), 0
                    ).label("total"),
                )
                .join(
                    ExpenseTxn,
                    ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
                )
                .join(
                    ReimbursementTxn,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == ReimbursementTxn.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ExpenseTxn.user_id == self.user_id,
                    ReimbursementTxn.user_id == self.user_id,
                    ExpenseTxn.deleted_at.is_(None),
                    ExpenseTxn.type == TransactionType.expense,
                    ExpenseTxn.date.between(p.start, p.end),
                    ReimbursementTxn.deleted_at.is_(None),
                    ReimbursementTxn.type == TransactionType.income,
                    ReimbursementTxn.is_reimbursement.is_(True),
                )
                .group_by(ExpenseTxn.category_id)
            )
            if tag_ids:
                reimb_stmt = reimb_stmt.where(ExpenseTxn.tags.any(Tag.id.in_(tag_ids)))
            reimb = {
                int(r.category_id): int(r.total or 0)
                for r in self.session.execute(reimb_stmt)
            }

            net: dict[int, int] = {}
            for cid, gross_amount in gross.items():
                net[cid] = max(0, gross_amount - reimb.get(cid, 0))
            return net

        cur_totals = totals_for(period)
        prev_totals = totals_for(prev)

        all_category_ids = set(cur_totals.keys()) | set(prev_totals.keys())
        if not all_category_ids:
            return {"increases": [], "decreases": []}

        categories = self.session.scalars(
            select(Category).where(
                Category.user_id == self.user_id,
                Category.id.in_(list(all_category_ids)),
            )
        ).all()
        names = {c.id: c.name for c in categories}

        deltas: list[dict[str, object]] = []
        for cid in all_category_ids:
            cur = cur_totals.get(cid, 0)
            prev_amount = prev_totals.get(cid, 0)
            delta = cur - prev_amount
            deltas.append(
                {
                    "category_id": cid,
                    "category_name": names.get(cid, "Unknown"),
                    "current_cents": cur,
                    "previous_cents": prev_amount,
                    "delta_cents": delta,
                }
            )

        increases = sorted(deltas, key=lambda r: r["delta_cents"], reverse=True)[:limit]
        decreases = sorted(deltas, key=lambda r: r["delta_cents"])[:limit]
        return {"increases": increases, "decreases": decreases}


class ForecastService:
    @dataclass
    class ProjectionRule:
        source_rule_id: int | None
        name: str
        type: TransactionType
        currency_code: CurrencyCode
        amount_cents: int
        category_id: int | None
        category_name: str | None
        anchor_date: date
        interval_unit: IntervalUnit
        interval_count: int
        next_occurrence: date
        end_date: date | None
        skip_weekends: bool
        month_day_policy: MonthDayPolicy

    @dataclass
    class VariableEstimate:
        category_id: int
        name: str
        icon: str | None
        amount_cents: int

    @dataclass
    class OneTimeEvent:
        name: str
        type: TransactionType
        amount_cents: int

    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    @staticmethod
    def _parse_year_month(value: str, field_name: str) -> date:
        parts = value.split("-")
        if len(parts) != 2:
            raise ValueError(f"Invalid {field_name} format")
        year = int(parts[0])
        month = int(parts[1])
        if month < 1 or month > 12:
            raise ValueError(f"Invalid {field_name} value")
        return date(year, month, 1)

    def _month_starts(self, *, horizon: int, today: date) -> list[date]:
        first = add_months(month_start(today.year, today.month), 1)
        return [add_months(first, offset) for offset in range(horizon)]

    def _starting_balance_cents(self, *, today: date) -> int:
        all_period = Period("all", date(1970, 1, 1), today)
        return int(
            MetricsService(self.session, self.user_id).kpis(all_period)["balance"]
        )

    def _load_projection_rules(self) -> list["ForecastService.ProjectionRule"]:
        rows = self.session.scalars(
            select(RecurringRule)
            .options(joinedload(RecurringRule.category))
            .where(
                RecurringRule.user_id == self.user_id,
            )
            .order_by(RecurringRule.next_occurrence.asc(), RecurringRule.id.asc())
        ).all()
        out: list[ForecastService.ProjectionRule] = []
        for row in rows:
            out.append(
                ForecastService.ProjectionRule(
                    source_rule_id=int(row.id),
                    name=row.name
                    or (row.category.name if row.category else "Recurring"),
                    type=row.type,
                    currency_code=row.currency_code,
                    amount_cents=int(row.amount_cents),
                    category_id=row.category_id,
                    category_name=row.category.name if row.category else None,
                    anchor_date=row.anchor_date,
                    interval_unit=row.interval_unit,
                    interval_count=int(row.interval_count),
                    next_occurrence=row.next_occurrence,
                    end_date=row.end_date,
                    skip_weekends=bool(row.skip_weekends),
                    month_day_policy=row.month_day_policy,
                )
            )
        return out

    def _trailing_variable_estimates(
        self, *, today: date, projection_start: date
    ) -> dict[int, "ForecastService.VariableEstimate"]:
        trailing_end = month_start(today.year, today.month) - date.resolution
        trailing_start = add_months(month_start(today.year, today.month), -3)
        if trailing_start > trailing_end:
            return {}

        covered_category_ids = {
            int(rule.category_id)
            for rule in self.session.scalars(
                select(RecurringRule).where(
                    RecurringRule.user_id == self.user_id,
                    RecurringRule.type == TransactionType.expense,
                    or_(
                        RecurringRule.end_date.is_(None),
                        RecurringRule.end_date >= projection_start,
                    ),
                )
            ).all()
            if rule.category_id is not None
        }

        gross_rows = self.session.execute(
            select(
                Transaction.category_id.label("category_id"),
                Category.name.label("category_name"),
                Category.icon.label("category_icon"),
                func.coalesce(func.sum(Transaction.amount_cents), 0).label("gross"),
            )
            .join(Category, Category.id == Transaction.category_id)
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.expense,
                Transaction.date.between(trailing_start, trailing_end),
            )
            .group_by(Transaction.category_id, Category.name, Category.icon)
        ).all()

        gross_by_category: dict[int, tuple[str, str | None, int]] = {
            int(row.category_id): (
                str(row.category_name),
                row.category_icon,
                int(row.gross or 0),
            )
            for row in gross_rows
        }

        ExpenseTxn = aliased(Transaction)
        ReimbursementTxn = aliased(Transaction)
        reimb_by_category = {
            int(row.category_id): int(row.reimbursed or 0)
            for row in self.session.execute(
                select(
                    ExpenseTxn.category_id.label("category_id"),
                    func.coalesce(
                        func.sum(ReimbursementAllocation.amount_cents),
                        0,
                    ).label("reimbursed"),
                )
                .join(
                    ExpenseTxn,
                    ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
                )
                .join(
                    ReimbursementTxn,
                    ReimbursementAllocation.reimbursement_transaction_id
                    == ReimbursementTxn.id,
                )
                .where(
                    ReimbursementAllocation.user_id == self.user_id,
                    ExpenseTxn.user_id == self.user_id,
                    ReimbursementTxn.user_id == self.user_id,
                    ExpenseTxn.deleted_at.is_(None),
                    ExpenseTxn.type == TransactionType.expense,
                    ExpenseTxn.date.between(trailing_start, trailing_end),
                    ReimbursementTxn.deleted_at.is_(None),
                    ReimbursementTxn.type == TransactionType.income,
                    ReimbursementTxn.is_reimbursement.is_(True),
                )
                .group_by(ExpenseTxn.category_id)
            )
        }

        estimates: dict[int, ForecastService.VariableEstimate] = {}
        for category_id, row in gross_by_category.items():
            if category_id in covered_category_ids:
                continue
            net = max(0, int(row[2]) - int(reimb_by_category.get(category_id, 0)))
            if net <= 0:
                continue
            monthly = int(round(net / 3))
            if monthly <= 0:
                continue
            estimates[category_id] = ForecastService.VariableEstimate(
                category_id=category_id,
                name=row[0],
                icon=row[1],
                amount_cents=monthly,
            )
        return estimates

    def _clone_rules(
        self, rules: list["ForecastService.ProjectionRule"]
    ) -> list["ForecastService.ProjectionRule"]:
        return [
            ForecastService.ProjectionRule(
                source_rule_id=rule.source_rule_id,
                name=rule.name,
                type=rule.type,
                currency_code=rule.currency_code,
                amount_cents=rule.amount_cents,
                category_id=rule.category_id,
                category_name=rule.category_name,
                anchor_date=rule.anchor_date,
                interval_unit=rule.interval_unit,
                interval_count=rule.interval_count,
                next_occurrence=rule.next_occurrence,
                end_date=rule.end_date,
                skip_weekends=rule.skip_weekends,
                month_day_policy=rule.month_day_policy,
            )
            for rule in rules
        ]

    def _project(
        self,
        *,
        month_starts: list[date],
        start_balance_cents: int,
        mode: str,
        rules: list["ForecastService.ProjectionRule"],
        variable_estimates: dict[int, "ForecastService.VariableEstimate"],
        modified_rule_amounts: dict[int, tuple[int, date]] | None = None,
        one_time_events: dict[date, list["ForecastService.OneTimeEvent"]] | None = None,
        summary_only: bool = False,
    ) -> dict[str, object]:
        modified_rule_amounts = modified_rule_amounts or {}
        one_time_events = one_time_events or {}
        fx_quotes: dict[date, FxQuote] = {}

        if month_starts and any(
            rule.currency_code == CurrencyCode.usd for rule in rules
        ):
            projection_end = month_end(month_starts[-1].year, month_starts[-1].month)
            fx_dates: set[date] = set()
            for rule in self._clone_rules(rules):
                if rule.currency_code != CurrencyCode.usd:
                    continue
                occurrence = rule.next_occurrence
                while occurrence <= projection_end:
                    if rule.end_date is not None and occurrence > rule.end_date:
                        break
                    if occurrence >= month_starts[0]:
                        fx_dates.add(occurrence)
                    next_occurrence = calculate_next_date(rule, occurrence)
                    if next_occurrence <= occurrence:
                        break
                    occurrence = next_occurrence
            if fx_dates:
                fx_quotes = FxRateService(self.session).resolve_usd_to_eur_quotes(
                    fx_dates,
                    allow_stale_cache=True,
                    allow_static_fallback=True,
                )

        months: list[dict[str, object]] = []
        balance = int(start_balance_cents)
        first_negative_index: int | None = None
        total_net = 0

        for index, month_bucket in enumerate(month_starts):
            month_end_date = month_end(month_bucket.year, month_bucket.month)
            recurring_rows: list[dict[str, object]] = []
            variable_rows: list[dict[str, object]] = []
            one_time_rows: list[dict[str, object]] = []
            income = 0
            expenses = 0

            for rule in rules:
                occurrence = rule.next_occurrence
                while occurrence <= month_end_date:
                    if rule.end_date is not None and occurrence > rule.end_date:
                        break
                    if occurrence >= month_bucket:
                        amount = int(rule.amount_cents)
                        if (
                            rule.source_rule_id is not None
                            and rule.source_rule_id in modified_rule_amounts
                            and occurrence
                            >= modified_rule_amounts[rule.source_rule_id][1]
                        ):
                            amount = int(modified_rule_amounts[rule.source_rule_id][0])
                        if rule.currency_code == CurrencyCode.usd:
                            amount = int(
                                (Decimal(amount) * fx_quotes[occurrence].rate).quantize(
                                    Decimal("1"),
                                    rounding=ROUND_HALF_UP,
                                )
                            )
                        if not summary_only:
                            recurring_rows.append(
                                {
                                    "rule_id": rule.source_rule_id,
                                    "name": rule.name,
                                    "type": rule.type.value,
                                    "amount_cents": amount,
                                    "occurrence_date": occurrence.isoformat(),
                                    "category_id": rule.category_id,
                                    "category_name": rule.category_name,
                                }
                            )
                        if rule.type == TransactionType.income:
                            income += amount
                        else:
                            expenses += amount

                    next_occurrence = calculate_next_date(rule, occurrence)
                    if next_occurrence <= occurrence:
                        break
                    occurrence = next_occurrence

                rule.next_occurrence = occurrence

            if mode == "full":
                for value in variable_estimates.values():
                    amount = value.amount_cents
                    if amount <= 0:
                        continue
                    if not summary_only:
                        variable_rows.append(
                            {
                                "category_id": value.category_id,
                                "name": value.name,
                                "icon": value.icon,
                                "amount_cents": amount,
                            }
                        )
                    expenses += amount

            for event in one_time_events.get(month_bucket, []):
                if not summary_only:
                    one_time_rows.append(
                        {
                            "name": event.name,
                            "type": event.type.value,
                            "amount_cents": event.amount_cents,
                        }
                    )
                if event.type == TransactionType.income:
                    income += event.amount_cents
                else:
                    expenses += event.amount_cents

            end_balance = balance + income - expenses
            net = income - expenses
            total_net += net
            if first_negative_index is None and end_balance < 0:
                first_negative_index = index + 1

            if not summary_only:
                months.append(
                    {
                        "month": month_bucket.isoformat()[:7],
                        "projected_income_cents": income,
                        "projected_expenses_cents": expenses,
                        "projected_net_cents": net,
                        "end_balance_cents": end_balance,
                        "crosses_negative": balance >= 0 and end_balance < 0,
                        "breakdown": {
                            "recurring_rules": recurring_rows,
                            "variable_estimates": variable_rows,
                            "one_time_events": one_time_rows,
                        },
                    }
                )
            balance = end_balance

        month_count = len(month_starts)
        avg_monthly_net = int(round(total_net / month_count)) if month_count else 0
        return {
            "mode": mode,
            "start_balance_cents": start_balance_cents,
            "months": months,
            "summary": {
                "projected_balance_cents": balance,
                "average_monthly_net_cents": avg_monthly_net,
                "months_until_negative": first_negative_index,
            },
        }

    def _build_rule_lookup(
        self, rules: list["ForecastService.ProjectionRule"]
    ) -> dict[int, "ForecastService.ProjectionRule"]:
        return {
            int(rule.source_rule_id): rule
            for rule in rules
            if rule.source_rule_id is not None
        }

    def _category_info(self, category_id: int) -> tuple[str, str | None]:
        category = self.session.scalar(
            select(Category).where(
                Category.user_id == self.user_id,
                Category.id == category_id,
            )
        )
        if not category:
            raise ValueError("Category not found")
        if category.type != TransactionType.expense:
            raise ValueError("Category estimate must be an expense category")
        return category.name, category.icon

    def _modification_label(
        self,
        modification: ScenarioRemoveRuleIn
        | ScenarioAddRuleIn
        | ScenarioModifyRuleIn
        | ScenarioOneTimeIn
        | ScenarioAdjustCategoryIn,
        rule_lookup: dict[int, "ForecastService.ProjectionRule"],
        category_names: dict[int, str],
    ) -> str:
        if isinstance(modification, ScenarioRemoveRuleIn):
            rule = rule_lookup.get(modification.rule_id)
            return f"Cancel {rule.name if rule else modification.rule_id}"
        if isinstance(modification, ScenarioAddRuleIn):
            return f"Add {modification.name}"
        if isinstance(modification, ScenarioModifyRuleIn):
            rule = rule_lookup.get(modification.rule_id)
            name = rule.name if rule else str(modification.rule_id)
            return f"Change {name}"
        if isinstance(modification, ScenarioOneTimeIn):
            return f"{modification.name} ({modification.month})"
        return f"Adjust {category_names.get(modification.category_id, modification.category_id)}"

    def _apply_modifications(
        self,
        *,
        base_rules: list["ForecastService.ProjectionRule"],
        base_variable_estimates: dict[int, "ForecastService.VariableEstimate"],
        modifications: list[
            ScenarioRemoveRuleIn
            | ScenarioAddRuleIn
            | ScenarioModifyRuleIn
            | ScenarioOneTimeIn
            | ScenarioAdjustCategoryIn
        ],
        projection_start: date,
    ) -> tuple[
        list["ForecastService.ProjectionRule"],
        dict[int, "ForecastService.VariableEstimate"],
        dict[int, tuple[int, date]],
        dict[date, list["ForecastService.OneTimeEvent"]],
        list[str],
    ]:
        rules = self._clone_rules(base_rules)
        variable_estimates = {
            category_id: ForecastService.VariableEstimate(
                category_id=row.category_id,
                name=row.name,
                icon=row.icon,
                amount_cents=row.amount_cents,
            )
            for category_id, row in base_variable_estimates.items()
        }
        rule_lookup = self._build_rule_lookup(rules)
        category_names = {
            int(category_id): row.name
            for category_id, row in variable_estimates.items()
        }
        removed_rule_ids: set[int] = set()
        modified_rule_amounts: dict[int, tuple[int, date]] = {}
        one_time_events: dict[date, list[ForecastService.OneTimeEvent]] = {}
        labels: list[str] = []

        for modification in modifications:
            labels.append(
                self._modification_label(modification, rule_lookup, category_names)
            )

            if isinstance(modification, ScenarioRemoveRuleIn):
                if modification.rule_id not in rule_lookup:
                    raise ValueError("Rule not found")
                removed_rule_ids.add(int(modification.rule_id))
                continue

            if isinstance(modification, ScenarioAddRuleIn):
                if modification.interval == "weekly":
                    interval_unit = IntervalUnit.week
                elif modification.interval == "yearly":
                    interval_unit = IntervalUnit.year
                else:
                    interval_unit = IntervalUnit.month
                rules.append(
                    ForecastService.ProjectionRule(
                        source_rule_id=None,
                        name=modification.name,
                        type=modification.tx_type,
                        currency_code=CurrencyCode.eur,
                        amount_cents=int(modification.amount_cents),
                        category_id=None,
                        category_name=None,
                        anchor_date=projection_start,
                        interval_unit=interval_unit,
                        interval_count=1,
                        next_occurrence=projection_start,
                        end_date=None,
                        skip_weekends=False,
                        month_day_policy=MonthDayPolicy.snap_to_end,
                    )
                )
                continue

            if isinstance(modification, ScenarioModifyRuleIn):
                if modification.rule_id not in rule_lookup:
                    raise ValueError("Rule not found")
                modified_rule_amounts[int(modification.rule_id)] = (
                    int(modification.new_amount_cents),
                    self._parse_year_month(
                        modification.effective_month, "effective_month"
                    ),
                )
                continue

            if isinstance(modification, ScenarioOneTimeIn):
                month_start = self._parse_year_month(modification.month, "month")
                one_time_events.setdefault(month_start, []).append(
                    ForecastService.OneTimeEvent(
                        name=modification.name,
                        type=modification.tx_type,
                        amount_cents=int(modification.amount_cents),
                    )
                )
                continue

            category_name, category_icon = self._category_info(modification.category_id)
            variable_estimates[int(modification.category_id)] = (
                ForecastService.VariableEstimate(
                    category_id=int(modification.category_id),
                    name=category_name,
                    icon=category_icon,
                    amount_cents=int(modification.new_monthly_cents),
                )
            )
            category_names[int(modification.category_id)] = category_name

        rules = [
            rule
            for rule in rules
            if rule.source_rule_id is None
            or rule.source_rule_id not in removed_rule_ids
        ]

        return (
            rules,
            variable_estimates,
            modified_rule_amounts,
            one_time_events,
            labels,
        )

    def forecast(self, *, horizon: int, mode: str) -> dict[str, object]:
        if mode not in {"recurring", "full"}:
            raise ValueError("Invalid mode")
        today = local_today()
        month_starts = self._month_starts(horizon=horizon, today=today)
        if not month_starts:
            raise ValueError("Invalid horizon")
        base_rules = self._load_projection_rules()
        base_variable = self._trailing_variable_estimates(
            today=today,
            projection_start=month_starts[0],
        )
        start_balance = self._starting_balance_cents(today=today)

        projection = self._project(
            month_starts=month_starts,
            start_balance_cents=start_balance,
            mode=mode,
            rules=self._clone_rules(base_rules),
            variable_estimates=base_variable,
        )
        return {
            "horizon": horizon,
            **projection,
        }

    def scenario(self, *, payload: ForecastScenarioIn, mode: str) -> dict[str, object]:
        if mode not in {"recurring", "full"}:
            raise ValueError("Invalid mode")
        today = local_today()
        month_starts = self._month_starts(horizon=int(payload.horizon), today=today)
        if not month_starts:
            raise ValueError("Invalid horizon")

        base_rules = self._load_projection_rules()
        base_variable = self._trailing_variable_estimates(
            today=today,
            projection_start=month_starts[0],
        )
        start_balance = self._starting_balance_cents(today=today)

        baseline = self._project(
            month_starts=month_starts,
            start_balance_cents=start_balance,
            mode=mode,
            rules=self._clone_rules(base_rules),
            variable_estimates=base_variable,
        )

        (
            scenario_rules,
            scenario_variable,
            modified_amounts,
            one_time_events,
            labels,
        ) = self._apply_modifications(
            base_rules=base_rules,
            base_variable_estimates=base_variable,
            modifications=payload.modifications,
            projection_start=month_starts[0],
        )

        scenario_projection = self._project(
            month_starts=month_starts,
            start_balance_cents=start_balance,
            mode=mode,
            rules=scenario_rules,
            variable_estimates=scenario_variable,
            modified_rule_amounts=modified_amounts,
            one_time_events=one_time_events,
        )

        baseline_months = baseline["months"]
        scenario_months = scenario_projection["months"]
        monthly_delta = [
            {
                "month": str(scenario_row["month"]),
                "delta_end_balance_cents": int(scenario_row["end_balance_cents"])
                - int(baseline_row["end_balance_cents"]),
            }
            for baseline_row, scenario_row in zip(baseline_months, scenario_months)
        ]

        final_delta = int(
            scenario_projection["summary"]["projected_balance_cents"]
        ) - int(baseline["summary"]["projected_balance_cents"])
        average_monthly_delta = int(
            scenario_projection["summary"]["average_monthly_net_cents"]
        ) - int(baseline["summary"]["average_monthly_net_cents"])

        baseline_final = int(baseline["summary"]["projected_balance_cents"])
        baseline_average = int(baseline["summary"]["average_monthly_net_cents"])
        by_modification = []
        if len(payload.modifications) == 1:
            by_modification.append(
                {
                    "index": 0,
                    "label": labels[0],
                    "final_delta_cents": final_delta,
                    "average_monthly_delta_cents": average_monthly_delta,
                    "monthly_delta": monthly_delta,
                }
            )
        else:
            cached_deltas: dict[
                tuple[object, ...], tuple[int, int, list[dict[str, object]]]
            ] = {}
            for index, modification in enumerate(payload.modifications):
                if isinstance(modification, ScenarioRemoveRuleIn):
                    key: tuple[object, ...] = (
                        "remove_rule",
                        int(modification.rule_id),
                    )
                elif isinstance(modification, ScenarioAddRuleIn):
                    key = (
                        "add_rule",
                        modification.name,
                        modification.tx_type.value,
                        int(modification.amount_cents),
                        modification.interval,
                    )
                elif isinstance(modification, ScenarioModifyRuleIn):
                    key = (
                        "modify_rule",
                        int(modification.rule_id),
                        int(modification.new_amount_cents),
                        modification.effective_month,
                    )
                elif isinstance(modification, ScenarioOneTimeIn):
                    key = (
                        "one_time",
                        modification.name,
                        modification.tx_type.value,
                        int(modification.amount_cents),
                        modification.month,
                    )
                else:
                    key = (
                        "adjust_category",
                        int(modification.category_id),
                        int(modification.new_monthly_cents),
                    )

                if key not in cached_deltas:
                    (
                        single_rules,
                        single_variable,
                        single_modified_amounts,
                        single_one_time,
                        _single_labels,
                    ) = self._apply_modifications(
                        base_rules=base_rules,
                        base_variable_estimates=base_variable,
                        modifications=[modification],
                        projection_start=month_starts[0],
                    )
                    single_projection = self._project(
                        month_starts=month_starts,
                        start_balance_cents=start_balance,
                        mode=mode,
                        rules=single_rules,
                        variable_estimates=single_variable,
                        modified_rule_amounts=single_modified_amounts,
                        one_time_events=single_one_time,
                    )
                    single_months = single_projection["months"]
                    single_monthly_delta = [
                        {
                            "month": str(single_row["month"]),
                            "delta_end_balance_cents": int(
                                single_row["end_balance_cents"]
                            )
                            - int(baseline_row["end_balance_cents"]),
                        }
                        for baseline_row, single_row in zip(
                            baseline_months, single_months
                        )
                    ]
                    cached_deltas[key] = (
                        int(single_projection["summary"]["projected_balance_cents"])
                        - baseline_final,
                        int(single_projection["summary"]["average_monthly_net_cents"])
                        - baseline_average,
                        single_monthly_delta,
                    )

                by_final_delta, by_average_delta, by_monthly_delta = cached_deltas[key]
                by_modification.append(
                    {
                        "index": index,
                        "label": labels[index],
                        "final_delta_cents": by_final_delta,
                        "average_monthly_delta_cents": by_average_delta,
                        "monthly_delta": by_monthly_delta,
                    }
                )

        return {
            "horizon": int(payload.horizon),
            **scenario_projection,
            "baseline": baseline,
            "impact": {
                "final_delta_cents": final_delta,
                "average_monthly_delta_cents": average_monthly_delta,
                "monthly_delta": monthly_delta,
                "by_modification": by_modification,
            },
        }


class RecurringRuleService:
    @dataclass
    class OverviewRule:
        rule: RecurringRule
        monthly_equivalent_cents: int

    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def get(self, rule_id: int) -> RecurringRule:
        rule = self.session.get(RecurringRule, rule_id)
        if not rule or rule.user_id != self.user_id:
            raise ValueError("Rule not found")
        return rule

    def list_all(self) -> list[RecurringRule]:
        stmt = (
            select(RecurringRule)
            .options(joinedload(RecurringRule.category))
            .where(RecurringRule.user_id == self.user_id)
            .order_by(RecurringRule.next_occurrence)
        )
        return self.session.scalars(stmt).all()

    def _monthly_equivalent_amount(
        self, amount_cents: int, interval_unit: IntervalUnit, interval_count: int
    ) -> int:
        if interval_unit == IntervalUnit.day:
            return int(amount_cents * 30.44 / interval_count)
        if interval_unit == IntervalUnit.week:
            return int(amount_cents * 4.35 / interval_count)
        if interval_unit == IntervalUnit.month:
            return int(amount_cents / interval_count)
        if interval_unit == IntervalUnit.year:
            return int(amount_cents / (12 * interval_count))
        return amount_cents

    def overview(
        self,
    ) -> tuple[list["RecurringRuleService.OverviewRule"], dict[str, object]]:
        rules = self.list_all()
        total_income = 0
        total_expenses = 0
        income_by_category: dict[str, int] = {}
        expense_by_category: dict[str, int] = {}
        income_count = 0
        expense_count = 0
        overview_rules: list[RecurringRuleService.OverviewRule] = []
        usd_quote: FxQuote | None = None

        if any(rule.currency_code == CurrencyCode.usd for rule in rules):
            usd_quote = FxRateService(self.session).usd_to_eur_quote_for_date(
                local_today(),
                allow_stale_cache=True,
                allow_static_fallback=True,
            )

        for rule in rules:
            amount = int(rule.amount_cents)
            if rule.currency_code == CurrencyCode.usd:
                if usd_quote is None:
                    raise RuntimeError("USD quote missing for recurring overview")
                amount = int(
                    (Decimal(amount) * usd_quote.rate).quantize(
                        Decimal("1"),
                        rounding=ROUND_HALF_UP,
                    )
                )
            monthly = self._monthly_equivalent_amount(
                amount, rule.interval_unit, rule.interval_count
            )
            overview_rules.append(
                RecurringRuleService.OverviewRule(
                    rule=rule,
                    monthly_equivalent_cents=monthly,
                )
            )
            category_name = rule.category.name if rule.category else "Uncategorized"

            if rule.type == TransactionType.income:
                total_income += monthly
                income_count += 1
                income_by_category[category_name] = (
                    income_by_category.get(category_name, 0) + monthly
                )
            else:
                total_expenses += monthly
                expense_count += 1
                expense_by_category[category_name] = (
                    expense_by_category.get(category_name, 0) + monthly
                )

        coverage_ratio = (
            (total_income / total_expenses * 100) if total_expenses > 0 else 100.0
        )

        def build_breakdown(by_category: dict[str, int], total: int) -> list[dict]:
            if total == 0:
                return []
            items = sorted(by_category.items(), key=lambda x: x[1], reverse=True)
            return [
                {
                    "name": name,
                    "amount_cents": amount,
                    "percent": (amount / total * 100) if total > 0 else 0,
                }
                for name, amount in items
            ]

        return (
            overview_rules,
            {
                "total_monthly_income": total_income,
                "total_monthly_expenses": total_expenses,
                "net_monthly": total_income - total_expenses,
                "coverage_ratio": coverage_ratio,
                "expense_breakdown": build_breakdown(
                    expense_by_category, total_expenses
                ),
                "income_breakdown": build_breakdown(income_by_category, total_income),
                "rule_counts": {
                    "income": income_count,
                    "expense": expense_count,
                    "total": income_count + expense_count,
                },
            },
        )

    def create(self, data: RecurringRuleIn) -> RecurringRule:
        category = self.session.get(Category, data.category_id)
        if not category or category.user_id != self.user_id:
            raise ValueError("Category not found")
        if category.type != data.type:
            raise ValueError("Category type mismatch")
        rule = RecurringRule(
            user_id=self.user_id,
            name=data.name,
            type=data.type,
            currency_code=data.currency_code,
            amount_cents=data.amount_cents,
            category_id=data.category_id,
            anchor_date=data.anchor_date,
            interval_unit=data.interval_unit,
            interval_count=data.interval_count,
            next_occurrence=data.next_occurrence,
            end_date=data.end_date,
            auto_post=data.auto_post,
            skip_weekends=data.skip_weekends,
            month_day_policy=data.month_day_policy,
        )
        self.session.add(rule)
        self.session.commit()
        self.session.refresh(rule)
        log_event(
            logger,
            logging.INFO,
            "recurring_rule_created",
            rule_id=rule.id,
            name=rule.name,
            transaction_type=rule.type.value,
            auto_post=rule.auto_post,
        )
        return rule

    def update(self, rule_id: int, data: RecurringRuleIn) -> RecurringRule:
        rule = self.session.get(RecurringRule, rule_id)
        if not rule or rule.user_id != self.user_id:
            raise ValueError("Rule not found")
        if data.category_id != rule.category_id:
            category = self.session.get(Category, data.category_id)
            if not category or category.user_id != self.user_id:
                raise ValueError("Category not found")
            if category.type != data.type:
                raise ValueError("Category type mismatch")
        for attr_name, value in data.model_dump().items():
            setattr(rule, attr_name, value)
        self.session.commit()
        self.session.refresh(rule)
        log_event(
            logger,
            logging.INFO,
            "recurring_rule_updated",
            rule_id=rule.id,
            name=rule.name,
            transaction_type=rule.type.value,
            auto_post=rule.auto_post,
        )
        return rule

    def toggle_auto_post(self, rule_id: int, auto_post: bool) -> None:
        rule = self.session.get(RecurringRule, rule_id)
        if not rule or rule.user_id != self.user_id:
            raise ValueError("Rule not found")
        rule.auto_post = auto_post
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "recurring_rule_toggled",
            rule_id=rule.id,
            name=rule.name,
            auto_post=auto_post,
        )

    def delete(self, rule_id: int) -> None:
        rule = self.session.get(RecurringRule, rule_id)
        if not rule or rule.user_id != self.user_id:
            raise ValueError("Rule not found")
        rule_name = rule.name
        self.session.delete(rule)
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "recurring_rule_deleted",
            rule_id=rule_id,
            name=rule_name,
        )

    def catch_up_all(self) -> int:
        engine = RecurringEngine(self.session)
        return engine.post_due_rules()


class CSVService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def _category_lookup(self) -> dict[tuple[TransactionType, str], int]:
        stmt = select(Category.id, Category.type, Category.name).where(
            Category.user_id == self.user_id, Category.archived_at.is_(None)
        )
        lookup: dict[tuple[TransactionType, str], int] = {}
        for row in self.session.execute(stmt):
            lookup[(row.type, row.name.lower())] = row.id
        return lookup

    def preview(
        self, content: str, *, max_rows: int | None = None
    ) -> tuple[list[dict[str, object]], list[str]]:
        rows, errors = parse_csv(content, max_rows=max_rows)
        lookup = self._category_lookup()
        preview_rows: list[dict[str, object]] = []
        for row in rows:
            category_id = lookup.get((row.type, row.category.lower()))
            if not category_id:
                errors.append(f"Missing category '{row.category}' for {row.type.value}")
            if row.is_reimbursement and row.type != TransactionType.income:
                errors.append("IsReimbursement can only be set for income transactions")
            preview_rows.append(
                {
                    "date": row.date,
                    "type": row.type.value,
                    "is_reimbursement": row.is_reimbursement,
                    "amount_cents": row.amount_cents,
                    "category": row.category,
                    "title": row.title,
                    "description": row.description,
                    "category_id": category_id,
                }
            )
        return preview_rows, errors

    def commit(self, content: str, *, max_rows: int | None = None) -> int:
        preview_rows, errors = self.preview(content, max_rows=max_rows)
        if errors:
            raise ValueError("; ".join(errors))
        dates = set()
        rule_service = RuleService(self.session, self.user_id)
        months: set[tuple[int, int]] = set()
        for row in preview_rows:
            txn_type = TransactionType(row["type"])
            txn = Transaction(
                user_id=self.user_id,
                date=row["date"],
                occurred_at=datetime.combine(row["date"], time(12, 0)),
                type=txn_type,
                is_reimbursement=bool(row["is_reimbursement"])
                if txn_type == TransactionType.income
                else False,
                amount_cents=row["amount_cents"],
                category_id=row["category_id"],
                title=row["title"],
                description=row["description"],
            )
            self.session.add(txn)
            rule_service.apply_rules(txn)
            dates.add(row["date"])
            months.add((row["date"].year, row["date"].month))
        self.session.flush()
        for y, m in months:
            recompute_monthly_rollup(self.session, self.user_id, y, m)
        metrics = MetricsService(self.session, self.user_id)
        for txn_date in dates:
            period = Period("transaction", txn_date, txn_date)
            metrics._invalidate_period_cache(period)
        self.session.commit()
        return len(preview_rows)

    def export(self, transactions: list[Transaction]) -> str:
        return export_transactions(transactions)


class ReportService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()
        self.metrics_service = MetricsService(session, self.user_id)
        self.txn_service = TransactionService(session, self.user_id)
        self.rule_service = RecurringRuleService(session, self.user_id)

    def gather_data(self, options: ReportOptions) -> dict[str, object]:
        period = Period("report", options.start, options.end)
        data: dict[str, object] = {
            "period": period,
            "options": options,
        }

        kpis = None
        wants_overview = "summary" in options.sections or "kpis" in options.sections
        if wants_overview:
            if options.transaction_type is None and options.category_ids is None:
                kpis = self.metrics_service.kpis(period)
            else:
                income = 0
                expenses = 0

                if options.transaction_type in (None, TransactionType.income):
                    income_stmt = select(
                        func.coalesce(
                            func.sum(Transaction.amount_cents),
                            0,
                        ).label("income")
                    ).where(
                        Transaction.user_id == self.user_id,
                        Transaction.deleted_at.is_(None),
                        Transaction.type == TransactionType.income,
                        Transaction.is_reimbursement.is_(False),
                        Transaction.date.between(options.start, options.end),
                    )
                    if options.category_ids:
                        income_stmt = income_stmt.where(
                            Transaction.category_id.in_(options.category_ids)
                        )
                    income = int(self.session.execute(income_stmt).scalar_one() or 0)

                if options.transaction_type in (None, TransactionType.expense):
                    expense_stmt = select(
                        func.coalesce(
                            func.sum(Transaction.amount_cents),
                            0,
                        ).label("expenses")
                    ).where(
                        Transaction.user_id == self.user_id,
                        Transaction.deleted_at.is_(None),
                        Transaction.type == TransactionType.expense,
                        Transaction.date.between(options.start, options.end),
                    )
                    if options.category_ids:
                        expense_stmt = expense_stmt.where(
                            Transaction.category_id.in_(options.category_ids)
                        )
                    expense_gross = int(
                        self.session.execute(expense_stmt).scalar_one() or 0
                    )

                    ExpenseTxn = aliased(Transaction)
                    ReimbursementTxn = aliased(Transaction)
                    reimb_stmt = (
                        select(
                            func.coalesce(
                                func.sum(ReimbursementAllocation.amount_cents), 0
                            )
                        )
                        .join(
                            ExpenseTxn,
                            ReimbursementAllocation.expense_transaction_id
                            == ExpenseTxn.id,
                        )
                        .join(
                            ReimbursementTxn,
                            ReimbursementAllocation.reimbursement_transaction_id
                            == ReimbursementTxn.id,
                        )
                        .where(
                            ReimbursementAllocation.user_id == self.user_id,
                            ExpenseTxn.user_id == self.user_id,
                            ReimbursementTxn.user_id == self.user_id,
                            ExpenseTxn.deleted_at.is_(None),
                            ExpenseTxn.type == TransactionType.expense,
                            ExpenseTxn.date.between(options.start, options.end),
                            ReimbursementTxn.deleted_at.is_(None),
                            ReimbursementTxn.type == TransactionType.income,
                            ReimbursementTxn.is_reimbursement.is_(True),
                        )
                    )
                    if options.category_ids:
                        reimb_stmt = reimb_stmt.where(
                            ExpenseTxn.category_id.in_(options.category_ids)
                        )
                    reimbursed = int(self.session.execute(reimb_stmt).scalar_one() or 0)
                    expenses = max(0, expense_gross - reimbursed)

                kpis = {
                    "income": income,
                    "expenses": expenses,
                    "balance": income - expenses,
                }

        if wants_overview:
            assert kpis is not None
            net_change = int(kpis["income"]) - int(kpis["expenses"])
            has_account_scope = (
                options.transaction_type is None and options.category_ids is None
            )
            data["summary"] = {
                "period": period,
                "total_income": kpis["income"],
                "total_expenses": kpis["expenses"],
                "net_change": net_change,
                "closing_balance": (
                    int(kpis["balance"]) if has_account_scope else None
                ),
            }

        if "category_breakdown" in options.sections:
            breakdown_type = (
                options.transaction_type
                if options.transaction_type is not None
                else TransactionType.expense
            )
            breakdown = self.metrics_service.category_breakdown(
                period, breakdown_type, category_ids=options.category_ids
            )
            data["category_breakdown"] = breakdown

        if "top_categories" in options.sections:
            breakdown_type = (
                options.transaction_type
                if options.transaction_type is not None
                else TransactionType.expense
            )
            breakdown = self.metrics_service.category_breakdown(
                period, breakdown_type, category_ids=options.category_ids
            )
            if not ("category_breakdown" in options.sections and len(breakdown) <= 5):
                data["top_categories"] = breakdown[:5]

        if "trend" in options.sections:
            trend_type = (
                options.transaction_type
                if options.transaction_type is not None
                else TransactionType.expense
            )
            if trend_type == TransactionType.income:
                stmt = (
                    select(Transaction.date, func.sum(Transaction.amount_cents))
                    .where(
                        Transaction.user_id == self.user_id,
                        Transaction.deleted_at.is_(None),
                        Transaction.type == TransactionType.income,
                        Transaction.is_reimbursement.is_(False),
                        Transaction.date.between(options.start, options.end),
                    )
                    .group_by(Transaction.date)
                    .order_by(Transaction.date)
                )
                if options.category_ids:
                    stmt = stmt.where(Transaction.category_id.in_(options.category_ids))
                rows = self.session.execute(stmt).all()
                data["trend"] = [
                    {"date": row[0], "amount_cents": int(row[1] or 0)} for row in rows
                ]
            else:
                gross_stmt = (
                    select(
                        Transaction.date,
                        func.sum(Transaction.amount_cents).label("gross"),
                    )
                    .where(
                        Transaction.user_id == self.user_id,
                        Transaction.deleted_at.is_(None),
                        Transaction.type == TransactionType.expense,
                        Transaction.date.between(options.start, options.end),
                    )
                    .group_by(Transaction.date)
                    .order_by(Transaction.date)
                )
                if options.category_ids:
                    gross_stmt = gross_stmt.where(
                        Transaction.category_id.in_(options.category_ids)
                    )
                gross_rows = self.session.execute(gross_stmt).all()
                gross_map = {row[0]: int(row.gross or 0) for row in gross_rows}

                ExpenseTxn = aliased(Transaction)
                ReimbursementTxn = aliased(Transaction)
                reimb_stmt = (
                    select(
                        ExpenseTxn.date,
                        func.coalesce(
                            func.sum(ReimbursementAllocation.amount_cents), 0
                        ).label("reimbursed"),
                    )
                    .join(
                        ExpenseTxn,
                        ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
                    )
                    .join(
                        ReimbursementTxn,
                        ReimbursementAllocation.reimbursement_transaction_id
                        == ReimbursementTxn.id,
                    )
                    .where(
                        ReimbursementAllocation.user_id == self.user_id,
                        ExpenseTxn.user_id == self.user_id,
                        ReimbursementTxn.user_id == self.user_id,
                        ExpenseTxn.deleted_at.is_(None),
                        ExpenseTxn.type == TransactionType.expense,
                        ExpenseTxn.date.between(options.start, options.end),
                        ReimbursementTxn.deleted_at.is_(None),
                        ReimbursementTxn.type == TransactionType.income,
                        ReimbursementTxn.is_reimbursement.is_(True),
                    )
                    .group_by(ExpenseTxn.date)
                )
                if options.category_ids:
                    reimb_stmt = reimb_stmt.where(
                        ExpenseTxn.category_id.in_(options.category_ids)
                    )
                reimb_rows = self.session.execute(reimb_stmt).all()
                reimb_map = {row[0]: int(row.reimbursed or 0) for row in reimb_rows}

                dates = sorted(set(gross_map.keys()) | set(reimb_map.keys()))
                data["trend"] = [
                    {
                        "date": d,
                        "amount_cents": max(
                            0, gross_map.get(d, 0) - reimb_map.get(d, 0)
                        ),
                    }
                    for d in dates
                ]

        if "recent_transactions" in options.sections:
            sort_order = options.transactions_sort
            if options.show_running_balance:
                sort_order = "oldest"

            stmt = (
                select(Transaction)
                .options(joinedload(Transaction.category))
                .where(
                    Transaction.user_id == self.user_id,
                    Transaction.deleted_at.is_(None),
                    Transaction.date.between(options.start, options.end),
                )
            )
            if options.transaction_type is not None:
                stmt = stmt.where(Transaction.type == options.transaction_type)
            if options.category_ids:
                stmt = stmt.where(Transaction.category_id.in_(options.category_ids))
            if sort_order == "newest":
                stmt = stmt.order_by(
                    Transaction.occurred_at.desc(), Transaction.id.desc()
                )
            else:
                stmt = stmt.order_by(
                    Transaction.occurred_at.asc(), Transaction.id.asc()
                )

            transactions = self.session.scalars(stmt).all()
            if options.show_running_balance:
                use_account_balance = (
                    options.transaction_type is None and not options.category_ids
                )
                if use_account_balance:
                    balance_service = BalanceAnchorService(self.session, self.user_id)
                    start_dt = datetime.combine(options.start, time.min)
                    opening_balance = balance_service.balance_as_of(
                        start_dt - timedelta(seconds=1)
                    )
                    anchors = self.session.scalars(
                        select(BalanceAnchor)
                        .where(
                            BalanceAnchor.user_id == self.user_id,
                            BalanceAnchor.as_of_at.between(
                                datetime.combine(options.start, time.min),
                                datetime.combine(options.end, time.max),
                            ),
                        )
                        .order_by(BalanceAnchor.as_of_at.asc(), BalanceAnchor.id.asc())
                    ).all()
                    next_anchor_idx = 0
                else:
                    opening_stmt = select(
                        func.coalesce(
                            func.sum(
                                case(
                                    (
                                        Transaction.type == TransactionType.income,
                                        Transaction.amount_cents,
                                    ),
                                    else_=0,
                                )
                            ),
                            0,
                        ).label("income"),
                        func.coalesce(
                            func.sum(
                                case(
                                    (
                                        Transaction.type == TransactionType.expense,
                                        Transaction.amount_cents,
                                    ),
                                    else_=0,
                                )
                            ),
                            0,
                        ).label("expenses"),
                    ).where(
                        Transaction.user_id == self.user_id,
                        Transaction.deleted_at.is_(None),
                        Transaction.date < options.start,
                    )
                    if options.transaction_type is not None:
                        opening_stmt = opening_stmt.where(
                            Transaction.type == options.transaction_type
                        )
                    if options.category_ids:
                        opening_stmt = opening_stmt.where(
                            Transaction.category_id.in_(options.category_ids)
                        )

                    opening_row = self.session.execute(opening_stmt).one()
                    opening_income = int(opening_row.income)
                    opening_expenses = int(opening_row.expenses)
                    opening_balance = opening_income - opening_expenses
                data["opening_balance_cents"] = opening_balance

                running = opening_balance
                for txn in transactions:
                    if use_account_balance:
                        while (
                            next_anchor_idx < len(anchors)
                            and anchors[next_anchor_idx].as_of_at <= txn.occurred_at
                        ):
                            running = int(anchors[next_anchor_idx].balance_cents)
                            next_anchor_idx += 1
                    if txn.type == TransactionType.income:
                        running += txn.amount_cents
                    else:
                        running -= txn.amount_cents
                    setattr(txn, "running_balance_cents", running)
            data["recent_transactions"] = transactions
            if options.include_category_subtotals and transactions:
                totals: dict[tuple[str, TransactionType], int] = {}
                for txn in transactions:
                    name = txn.category.name if txn.category else "Uncategorized"
                    key = (name, txn.type)
                    totals[key] = totals.get(key, 0) + txn.amount_cents
                subtotals = [
                    {
                        "name": name,
                        "type": txn_type,
                        "amount_cents": amount,
                    }
                    for (name, txn_type), amount in totals.items()
                ]
                subtotals.sort(key=lambda row: row["amount_cents"], reverse=True)
                data["category_subtotals"] = subtotals

        if "recurring_upcoming" in options.sections:
            end_date = options.end + timedelta(days=30)
            upcoming_rules = []
            for rule in self.rule_service.list_all():
                if rule.auto_post and rule.next_occurrence <= end_date:
                    upcoming_rules.append(rule)
            data["recurring_upcoming"] = upcoming_rules

        return data


class BudgetService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def list_templates(
        self, *, frequency: Optional[BudgetFrequency] = None
    ) -> list[BudgetTemplate]:
        stmt = (
            select(BudgetTemplate)
            .options(joinedload(BudgetTemplate.category))
            .where(BudgetTemplate.user_id == self.user_id)
            .order_by(
                BudgetTemplate.frequency.asc(),
                BudgetTemplate.category_id.is_(None).desc(),
                BudgetTemplate.starts_on.desc(),
                BudgetTemplate.id.desc(),
            )
        )
        if frequency:
            stmt = stmt.where(BudgetTemplate.frequency == frequency)
        return self.session.scalars(stmt).all()

    def upsert_template(self, data: BudgetTemplateIn) -> BudgetTemplate:
        if data.category_id is not None:
            category = self.session.get(Category, data.category_id)
            if not category or category.user_id != self.user_id:
                raise ValueError("Category not found")
            if category.type != TransactionType.expense:
                raise ValueError("Budgets can only be set for expense categories")

        stmt = select(BudgetTemplate).where(
            BudgetTemplate.user_id == self.user_id,
            BudgetTemplate.frequency == data.frequency,
            BudgetTemplate.starts_on == data.starts_on,
            BudgetTemplate.category_id.is_(None)
            if data.category_id is None
            else BudgetTemplate.category_id == data.category_id,
        )
        existing = self.session.scalar(stmt)
        if existing:
            existing.amount_cents = data.amount_cents
            existing.ends_on = data.ends_on
            self.session.commit()
            self.session.refresh(existing)
            log_event(
                logger,
                logging.INFO,
                "budget_template_upserted",
                template_id=existing.id,
                frequency=existing.frequency.value,
                category_id=existing.category_id,
                amount_cents=existing.amount_cents,
                operation="update",
            )
            return existing

        tmpl = BudgetTemplate(
            user_id=self.user_id,
            frequency=data.frequency,
            category_id=data.category_id,
            amount_cents=data.amount_cents,
            starts_on=data.starts_on,
            ends_on=data.ends_on,
        )
        self.session.add(tmpl)
        self.session.commit()
        self.session.refresh(tmpl)
        log_event(
            logger,
            logging.INFO,
            "budget_template_upserted",
            template_id=tmpl.id,
            frequency=tmpl.frequency.value,
            category_id=tmpl.category_id,
            amount_cents=tmpl.amount_cents,
            operation="create",
        )
        return tmpl

    def delete_template(self, template_id: int) -> None:
        tmpl = self.session.get(BudgetTemplate, template_id)
        if not tmpl or tmpl.user_id != self.user_id:
            raise ValueError("Template not found")
        self.session.delete(tmpl)
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "budget_template_deleted",
            template_id=template_id,
        )

    def upsert_override(self, data: BudgetOverrideIn) -> BudgetOverride:
        if data.category_id is not None:
            category = self.session.get(Category, data.category_id)
            if not category or category.user_id != self.user_id:
                raise ValueError("Category not found")
            if category.type != TransactionType.expense:
                raise ValueError("Budgets can only be set for expense categories")

        stmt = select(BudgetOverride).where(
            BudgetOverride.user_id == self.user_id,
            BudgetOverride.year == data.year,
            BudgetOverride.month == data.month,
            BudgetOverride.category_id.is_(None)
            if data.category_id is None
            else BudgetOverride.category_id == data.category_id,
        )
        existing = self.session.scalar(stmt)
        if existing:
            existing.amount_cents = data.amount_cents
            self.session.commit()
            self.session.refresh(existing)
            log_event(
                logger,
                logging.INFO,
                "budget_override_upserted",
                override_id=existing.id,
                year=existing.year,
                month=existing.month,
                category_id=existing.category_id,
                amount_cents=existing.amount_cents,
                operation="update",
            )
            return existing

        override = BudgetOverride(
            user_id=self.user_id,
            year=data.year,
            month=data.month,
            category_id=data.category_id,
            amount_cents=data.amount_cents,
        )
        self.session.add(override)
        self.session.commit()
        self.session.refresh(override)
        log_event(
            logger,
            logging.INFO,
            "budget_override_upserted",
            override_id=override.id,
            year=override.year,
            month=override.month,
            category_id=override.category_id,
            amount_cents=override.amount_cents,
            operation="create",
        )
        return override

    def delete_override(self, override_id: int) -> None:
        override = self.session.get(BudgetOverride, override_id)
        if not override or override.user_id != self.user_id:
            raise ValueError("Override not found")
        self.session.delete(override)
        self.session.commit()
        log_event(
            logger,
            logging.INFO,
            "budget_override_deleted",
            override_id=override_id,
        )

    @dataclass(frozen=True)
    class EffectiveBudget:
        scope_category_id: Optional[int]
        scope_label: str
        amount_cents: int
        source: str  # "override" | "template"
        source_id: int

    def _active_templates_for_date(
        self, target: date, *, frequency: BudgetFrequency
    ) -> list[BudgetTemplate]:
        stmt = (
            select(BudgetTemplate)
            .options(joinedload(BudgetTemplate.category))
            .where(
                BudgetTemplate.user_id == self.user_id,
                BudgetTemplate.frequency == frequency,
                BudgetTemplate.starts_on <= target,
                (BudgetTemplate.ends_on.is_(None) | (BudgetTemplate.ends_on >= target)),
            )
            .order_by(
                BudgetTemplate.category_id.is_(None).desc(),
                BudgetTemplate.starts_on.desc(),
                BudgetTemplate.id.desc(),
            )
        )
        return self.session.scalars(stmt).all()

    def effective_budgets_for_month(
        self, year: int, month: int
    ) -> list[EffectiveBudget]:
        month_start_date = month_start(year, month)
        overrides = self.session.scalars(
            select(BudgetOverride)
            .options(joinedload(BudgetOverride.category))
            .where(
                BudgetOverride.user_id == self.user_id,
                BudgetOverride.year == year,
                BudgetOverride.month == month,
            )
        ).all()
        overrides_by_scope = {o.category_id: o for o in overrides}

        templates = self._active_templates_for_date(
            month_start_date, frequency=BudgetFrequency.monthly
        )
        templates_latest: dict[Optional[int], BudgetTemplate] = {}
        for tmpl in templates:
            if tmpl.category_id in templates_latest:
                continue
            templates_latest[tmpl.category_id] = tmpl

        effective: list[BudgetService.EffectiveBudget] = []
        scopes = set(overrides_by_scope.keys()) | set(templates_latest.keys())
        for category_id in sorted(scopes, key=lambda v: (-1 if v is None else v)):
            override = overrides_by_scope.get(category_id)
            if override:
                label = override.category.name if override.category else "Overall"
                effective.append(
                    BudgetService.EffectiveBudget(
                        scope_category_id=category_id,
                        scope_label=label,
                        amount_cents=override.amount_cents,
                        source="override",
                        source_id=override.id,
                    )
                )
                continue
            tmpl = templates_latest.get(category_id)
            if tmpl:
                label = tmpl.category.name if tmpl.category else "Overall"
                effective.append(
                    BudgetService.EffectiveBudget(
                        scope_category_id=category_id,
                        scope_label=label,
                        amount_cents=tmpl.amount_cents,
                        source="template",
                        source_id=tmpl.id,
                    )
                )
        return effective

    def spent_by_category_for_month(
        self, year: int, month: int
    ) -> dict[Optional[int], int]:
        start = month_start(year, month)
        end = month_end(year, month)
        gross_stmt = (
            select(
                Transaction.category_id,
                func.coalesce(func.sum(Transaction.amount_cents), 0).label("spent"),
            )
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.expense,
                Transaction.date.between(start, end),
                ~Transaction.tags.any(Tag.is_hidden_from_budget),
            )
            .group_by(Transaction.category_id)
        )
        gross_by_category = {
            row.category_id: int(row.spent or 0)
            for row in self.session.execute(gross_stmt)
        }

        ExpenseTxn = aliased(Transaction)
        ReimbursementTxn = aliased(Transaction)
        reimb_stmt = (
            select(
                ExpenseTxn.category_id,
                func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0).label(
                    "reimbursed"
                ),
            )
            .join(
                ExpenseTxn,
                ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
            )
            .join(
                ReimbursementTxn,
                ReimbursementAllocation.reimbursement_transaction_id
                == ReimbursementTxn.id,
            )
            .where(
                ReimbursementAllocation.user_id == self.user_id,
                ExpenseTxn.user_id == self.user_id,
                ReimbursementTxn.user_id == self.user_id,
                ExpenseTxn.deleted_at.is_(None),
                ExpenseTxn.type == TransactionType.expense,
                ExpenseTxn.date.between(start, end),
                ~ExpenseTxn.tags.any(Tag.is_hidden_from_budget),
                ReimbursementTxn.deleted_at.is_(None),
                ReimbursementTxn.type == TransactionType.income,
                ReimbursementTxn.is_reimbursement.is_(True),
            )
            .group_by(ExpenseTxn.category_id)
        )
        reimb_by_category = {
            row.category_id: int(row.reimbursed or 0)
            for row in self.session.execute(reimb_stmt)
        }

        net_by_category: dict[Optional[int], int] = {}
        for category_id, gross in gross_by_category.items():
            net_by_category[category_id] = max(
                0, gross - reimb_by_category.get(category_id, 0)
            )
        net_by_category[None] = sum(net_by_category.values())
        return net_by_category

    def progress_for_month(
        self, year: int, month: int, *, as_of: Optional[date] = None
    ) -> dict[Optional[int], dict[str, int]]:
        effective = self.effective_budgets_for_month(year, month)
        spent_by_scope = self.spent_by_category_for_month(year, month)
        return self._derive_progress(
            effective, spent_by_scope, year, month, as_of=as_of
        )

    def _derive_progress(
        self,
        effective: list["BudgetService.EffectiveBudget"],
        spent_by_scope: dict[Optional[int], int],
        year: int,
        month: int,
        *,
        as_of: Optional[date] = None,
    ) -> dict[Optional[int], dict[str, int]]:
        as_of_date = as_of or date.today()
        days_in_month = monthrange(year, month)[1]
        month_start_date = month_start(year, month)
        month_end_date = month_end(year, month)
        if as_of_date < month_start_date:
            days_elapsed = 0
        elif as_of_date > month_end_date:
            days_elapsed = days_in_month
        else:
            days_elapsed = as_of_date.day
        days_remaining = max(0, days_in_month - days_elapsed)

        progress: dict[Optional[int], dict[str, int]] = {}
        for row in effective:
            spent = spent_by_scope.get(row.scope_category_id, 0)
            remaining = row.amount_cents - spent
            expected_spend = (
                row.amount_cents * (days_elapsed / days_in_month)
                if days_in_month > 0
                else 0.0
            )
            velocity_ratio = (spent / expected_spend) if expected_spend > 0 else 0.0
            if days_remaining > 0:
                daily_remaining = int(round(remaining / days_remaining))
            else:
                daily_remaining = remaining
            if days_elapsed > 0:
                projected_total = int(
                    round(
                        spent + (spent / days_elapsed) * (days_in_month - days_elapsed)
                    )
                )
            else:
                projected_total = spent
            progress[row.scope_category_id] = {
                "spent_cents": spent,
                "remaining_cents": remaining,
                "velocity_ratio": velocity_ratio,
                "daily_remaining_cents": daily_remaining,
                "projected_total_cents": projected_total,
                "days_elapsed": days_elapsed,
                "days_remaining": days_remaining,
            }
        return progress

    def burndown_for_month(
        self,
        year: int,
        month: int,
        *,
        scope_category_id: Optional[int] = None,
        compare_year: Optional[int] = None,
        compare_month: Optional[int] = None,
    ) -> dict[str, object]:
        days_in_month = monthrange(year, month)[1]
        start = month_start(year, month)
        end = month_end(year, month)

        def series_and_top_days(
            target_start: date,
            target_end: date,
            target_days: int,
            *,
            include_top_days: bool = False,
        ) -> tuple[list[dict[str, int]], list[dict[str, object]]]:
            stmt = (
                select(Transaction)
                .options(joinedload(Transaction.category))
                .where(
                    Transaction.user_id == self.user_id,
                    Transaction.deleted_at.is_(None),
                    Transaction.type == TransactionType.expense,
                    Transaction.date.between(target_start, target_end),
                    ~Transaction.tags.any(Tag.is_hidden_from_budget),
                )
                .order_by(Transaction.date.asc(), Transaction.id.asc())
            )
            if scope_category_id is not None:
                stmt = stmt.where(Transaction.category_id == scope_category_id)

            transactions = self.session.scalars(stmt).all()
            reimbursed_map = ReimbursementService(
                self.session, self.user_id
            ).reimbursed_totals_for_expenses([txn.id for txn in transactions])

            daily_totals = [0] * target_days
            per_day_transactions: dict[int, list[dict[str, object]]] = {}
            for txn in transactions:
                net_amount = max(
                    0, int(txn.amount_cents) - int(reimbursed_map.get(txn.id, 0))
                )
                day_index = txn.date.day - 1
                daily_totals[day_index] += net_amount
                if include_top_days:
                    items = per_day_transactions.setdefault(
                        txn.date.day,
                        [],
                    )
                    items.append(
                        {
                            "id": txn.id,
                            "title": txn.title or "",
                            "amount_cents": net_amount,
                        }
                    )

            cumulative = 0
            out_series: list[dict[str, int]] = []
            for day in range(1, target_days + 1):
                cumulative += daily_totals[day - 1]
                out_series.append({"day": day, "cumulative_cents": cumulative})

            top_days: list[dict[str, object]] = []
            if include_top_days:
                ranked_days = sorted(
                    per_day_transactions.items(),
                    key=lambda item: sum(int(row["amount_cents"]) for row in item[1]),
                    reverse=True,
                )[:5]
                for day, rows in ranked_days:
                    rows_sorted = sorted(
                        rows,
                        key=lambda row: int(row["amount_cents"]),
                        reverse=True,
                    )
                    top_days.append(
                        {
                            "day": day,
                            "date": (
                                target_start + timedelta(days=day - 1)
                            ).isoformat(),
                            "total_cents": sum(
                                int(row["amount_cents"]) for row in rows_sorted
                            ),
                            "transactions": rows_sorted,
                        }
                    )
            return out_series, top_days

        current_series, top_spending_days = series_and_top_days(
            start,
            end,
            days_in_month,
            include_top_days=True,
        )

        compare_series: list[dict[str, int]] = []
        compare_month_label: Optional[str] = None
        if compare_year is not None and compare_month is not None:
            compare_days_in_month = monthrange(compare_year, compare_month)[1]
            compare_start = month_start(compare_year, compare_month)
            compare_end = month_end(compare_year, compare_month)
            compare_series, _ = series_and_top_days(
                compare_start,
                compare_end,
                compare_days_in_month,
            )
            compare_month_label = f"{compare_year:04d}-{compare_month:02d}"

        effective = self.effective_budgets_for_month(year, month)
        budget_row = next(
            (row for row in effective if row.scope_category_id == scope_category_id),
            None,
        )
        budget_amount = int(budget_row.amount_cents) if budget_row else 0

        return {
            "budget_amount_cents": budget_amount,
            "days_in_month": days_in_month,
            "daily_series": current_series,
            "compare_month": compare_month_label,
            "compare_daily_series": compare_series,
            "top_spending_days": top_spending_days,
        }

    def dashboard_budget_pace(
        self, *, today: Optional[date] = None
    ) -> dict[str, object]:
        current = today or date.today()
        effective = self.effective_budgets_for_month(current.year, current.month)
        overall = next(
            (row for row in effective if row.scope_category_id is None), None
        )
        if overall is None:
            return {}

        spent_by_scope = self.spent_by_category_for_month(current.year, current.month)
        overall_progress = self._derive_progress(
            effective, spent_by_scope, current.year, current.month, as_of=current
        ).get(None)
        if overall_progress is None:
            return {}

        sparkline_values: list[float] = []
        for offset in range(6, -1, -1):
            target = current - timedelta(days=offset)
            row = self._derive_progress(
                effective,
                spent_by_scope,
                current.year,
                current.month,
                as_of=target,
            ).get(None)
            sparkline_values.append(float(row["velocity_ratio"]) if row else 0.0)

        sparkline = ",".join(
            f"{value:.4f}".rstrip("0").rstrip(".") for value in sparkline_values
        )
        return {
            "velocity_ratio": float(overall_progress["velocity_ratio"]),
            "projected_cents": int(overall_progress["projected_total_cents"]),
            "budget_cents": int(overall.amount_cents),
            "sparkline": sparkline,
        }

    def dashboard_category_budget_pulse(
        self, *, today: Optional[date] = None
    ) -> list[dict[str, object]]:
        current = today or date.today()
        effective = self.effective_budgets_for_month(current.year, current.month)
        spent_by_scope = self.spent_by_category_for_month(current.year, current.month)
        progress = self._derive_progress(
            effective, spent_by_scope, current.year, current.month, as_of=current
        )

        rows = []
        for budget in effective:
            if budget.scope_category_id is None:
                continue
            budget_progress = progress.get(budget.scope_category_id)
            if budget_progress is None:
                continue
            remaining_cents = int(budget_progress["remaining_cents"])
            rows.append(
                {
                    "scope_category_id": budget.scope_category_id,
                    "scope_label": budget.scope_label,
                    "amount_cents": int(budget.amount_cents),
                    "spent_cents": int(budget_progress["spent_cents"]),
                    "remaining_cents": remaining_cents,
                    "velocity_ratio": float(budget_progress["velocity_ratio"]),
                }
            )

        rows.sort(
            key=lambda row: (
                int(row["remaining_cents"]) < 0,
                float(row["velocity_ratio"]),
                -int(row["remaining_cents"]),
            ),
            reverse=True,
        )
        return rows[:3]

    def yearly_budgets_for_year(
        self, year: int
    ) -> list["BudgetService.EffectiveBudget"]:
        year_start = date(year, 1, 1)
        templates = self._active_templates_for_date(
            year_start, frequency=BudgetFrequency.yearly
        )
        templates_latest: dict[Optional[int], BudgetTemplate] = {}
        for tmpl in templates:
            if tmpl.category_id in templates_latest:
                continue
            templates_latest[tmpl.category_id] = tmpl

        effective: list[BudgetService.EffectiveBudget] = []
        for category_id in sorted(
            templates_latest.keys(), key=lambda v: (-1 if v is None else v)
        ):
            tmpl = templates_latest[category_id]
            label = tmpl.category.name if tmpl.category else "Overall"
            effective.append(
                BudgetService.EffectiveBudget(
                    scope_category_id=category_id,
                    scope_label=label,
                    amount_cents=tmpl.amount_cents,
                    source="template",
                    source_id=tmpl.id,
                )
            )
        return effective

    def spent_by_category_for_year(self, year: int) -> dict[Optional[int], int]:
        start = date(year, 1, 1)
        end = date(year + 1, 1, 1) - date.resolution
        gross_stmt = (
            select(
                Transaction.category_id,
                func.coalesce(func.sum(Transaction.amount_cents), 0).label("spent"),
            )
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.type == TransactionType.expense,
                Transaction.date.between(start, end),
                ~Transaction.tags.any(Tag.is_hidden_from_budget),
            )
            .group_by(Transaction.category_id)
        )
        gross_by_category = {
            row.category_id: int(row.spent or 0)
            for row in self.session.execute(gross_stmt)
        }

        ExpenseTxn = aliased(Transaction)
        ReimbursementTxn = aliased(Transaction)
        reimb_stmt = (
            select(
                ExpenseTxn.category_id,
                func.coalesce(func.sum(ReimbursementAllocation.amount_cents), 0).label(
                    "reimbursed"
                ),
            )
            .join(
                ExpenseTxn,
                ReimbursementAllocation.expense_transaction_id == ExpenseTxn.id,
            )
            .join(
                ReimbursementTxn,
                ReimbursementAllocation.reimbursement_transaction_id
                == ReimbursementTxn.id,
            )
            .where(
                ReimbursementAllocation.user_id == self.user_id,
                ExpenseTxn.user_id == self.user_id,
                ReimbursementTxn.user_id == self.user_id,
                ExpenseTxn.deleted_at.is_(None),
                ExpenseTxn.type == TransactionType.expense,
                ExpenseTxn.date.between(start, end),
                ~ExpenseTxn.tags.any(Tag.is_hidden_from_budget),
                ReimbursementTxn.deleted_at.is_(None),
                ReimbursementTxn.type == TransactionType.income,
                ReimbursementTxn.is_reimbursement.is_(True),
            )
            .group_by(ExpenseTxn.category_id)
        )
        reimb_by_category = {
            row.category_id: int(row.reimbursed or 0)
            for row in self.session.execute(reimb_stmt)
        }

        net_by_category: dict[Optional[int], int] = {}
        for category_id, gross in gross_by_category.items():
            net_by_category[category_id] = max(
                0, gross - reimb_by_category.get(category_id, 0)
            )
        net_by_category[None] = sum(net_by_category.values())
        return net_by_category


class DigestService:
    def __init__(self, session: Session, user_id: Optional[int] = None) -> None:
        self.session = session
        self.user_id = user_id or get_current_user_id()

    def weekly_digest(self, *, week_of: Optional[date] = None) -> dict[str, object]:
        reference = week_of or date.today()
        week_start = reference - timedelta(days=reference.weekday())
        week_end = week_start + timedelta(days=6)
        previous_week_start = week_start - timedelta(days=7)
        previous_week_end = week_start - timedelta(days=1)
        trailing_start = week_start - timedelta(days=28)
        trailing_end = week_start - timedelta(days=1)

        txn_service = TransactionService(self.session, self.user_id)
        current_period = Period("week", week_start, week_end)
        previous_period = Period("prev_week", previous_week_start, previous_week_end)
        trailing_period = Period("trailing", trailing_start, trailing_end)
        expense_filter = TransactionFilters(type=TransactionType.expense)

        current_expenses = txn_service.list_for_period(
            current_period,
            expense_filter,
            limit=20_000,
        )
        previous_expenses = txn_service.list_for_period(
            previous_period,
            expense_filter,
            limit=20_000,
        )
        trailing_expenses = txn_service.list_for_period(
            trailing_period,
            expense_filter,
            limit=100_000,
        )

        current_total = sum(int(txn.net_amount_cents) for txn in current_expenses)
        previous_total = sum(int(txn.net_amount_cents) for txn in previous_expenses)
        trailing_weekly_avg = int(
            round(sum(int(txn.net_amount_cents) for txn in trailing_expenses) / 4)
        )

        categories = CategoryService(self.session, self.user_id).list_all()
        category_map = {category.id: category for category in categories}

        current_by_category: dict[int, int] = {}
        trailing_by_category: dict[int, int] = {}
        for txn in current_expenses:
            current_by_category[txn.category_id] = current_by_category.get(
                txn.category_id, 0
            ) + int(txn.net_amount_cents)
        for txn in trailing_expenses:
            trailing_by_category[txn.category_id] = trailing_by_category.get(
                txn.category_id, 0
            ) + int(txn.net_amount_cents)

        top_category_ids = sorted(
            current_by_category.keys(),
            key=lambda category_id: current_by_category[category_id],
            reverse=True,
        )[:5]
        top_categories = []
        top_amount = current_by_category[top_category_ids[0]] if top_category_ids else 0
        for category_id in top_category_ids:
            category = category_map.get(category_id)
            amount = int(current_by_category.get(category_id, 0))
            trailing_avg = int(round(trailing_by_category.get(category_id, 0) / 4))
            top_categories.append(
                {
                    "category_id": category_id,
                    "name": category.name if category else "Unknown",
                    "icon": category.icon if category else None,
                    "amount_cents": amount,
                    "bar_percent": (amount / top_amount * 100)
                    if top_amount > 0
                    else 0.0,
                    "trailing_weekly_avg_cents": trailing_avg,
                    "is_above_trailing_50": amount > int(round(trailing_avg * 1.5))
                    if trailing_avg > 0
                    else False,
                }
            )

        trailing_average_amount_by_category: dict[int, int] = {}
        trailing_count_by_category: dict[int, int] = {}
        for txn in trailing_expenses:
            trailing_average_amount_by_category[txn.category_id] = (
                trailing_average_amount_by_category.get(txn.category_id, 0)
                + int(txn.net_amount_cents)
            )
            trailing_count_by_category[txn.category_id] = (
                trailing_count_by_category.get(txn.category_id, 0) + 1
            )

        unusual_transactions = []
        for txn in sorted(current_expenses, key=lambda row: row.date, reverse=True):
            trailing_count = trailing_count_by_category.get(txn.category_id, 0)
            if trailing_count <= 0:
                continue
            trailing_average = int(
                round(
                    trailing_average_amount_by_category.get(txn.category_id, 0)
                    / trailing_count
                )
            )
            amount = int(txn.net_amount_cents)
            if amount <= trailing_average * 2:
                continue
            unusual_transactions.append(
                {
                    "id": txn.id,
                    "date": txn.date.isoformat(),
                    "title": txn.title or "",
                    "amount_cents": amount,
                    "trailing_avg_cents": trailing_average,
                    "category": {
                        "id": txn.category.id,
                        "name": txn.category.name,
                        "icon": txn.category.icon,
                    }
                    if txn.category
                    else None,
                }
            )

        recurring_txn_stmt = (
            select(Transaction)
            .options(
                joinedload(Transaction.category),
                joinedload(Transaction.origin_rule),
            )
            .where(
                Transaction.user_id == self.user_id,
                Transaction.deleted_at.is_(None),
                Transaction.origin_rule_id.is_not(None),
                Transaction.date.between(week_start, week_end),
            )
            .order_by(Transaction.date.desc(), Transaction.id.desc())
        )
        recurring_transactions = self.session.scalars(recurring_txn_stmt).all()
        reimbursed_map = ReimbursementService(
            self.session, self.user_id
        ).reimbursed_totals_for_expenses(
            [
                txn.id
                for txn in recurring_transactions
                if txn.type == TransactionType.expense
            ]
        )
        recurring_postings = []
        for txn in recurring_transactions:
            amount = int(txn.amount_cents)
            if txn.type == TransactionType.expense:
                amount = max(0, amount - int(reimbursed_map.get(txn.id, 0)))
            recurring_postings.append(
                {
                    "transaction_id": txn.id,
                    "rule_id": txn.origin_rule_id,
                    "rule_name": txn.origin_rule.name if txn.origin_rule else "",
                    "date": txn.date.isoformat(),
                    "amount_cents": amount,
                    "category": {
                        "id": txn.category.id,
                        "name": txn.category.name,
                        "icon": txn.category.icon,
                    }
                    if txn.category
                    else None,
                }
            )

        budget_month_date = week_end
        budget_service = BudgetService(self.session, self.user_id)
        budget_progress = budget_service.progress_for_month(
            budget_month_date.year,
            budget_month_date.month,
            as_of=week_end,
        )
        effective_budgets = budget_service.effective_budgets_for_month(
            budget_month_date.year,
            budget_month_date.month,
        )
        budget_pulse = []
        for budget in effective_budgets:
            progress = budget_progress.get(budget.scope_category_id)
            if progress is None:
                continue
            velocity_ratio = float(progress["velocity_ratio"])
            if velocity_ratio > 1.1:
                pace_state = "over"
            elif velocity_ratio < 0.9:
                pace_state = "under"
            else:
                pace_state = "on"
            budget_pulse.append(
                {
                    "scope_category_id": budget.scope_category_id,
                    "scope_label": budget.scope_label,
                    "amount_cents": budget.amount_cents,
                    "spent_cents": int(progress["spent_cents"]),
                    "used_percent": (
                        (int(progress["spent_cents"]) / budget.amount_cents) * 100
                        if budget.amount_cents > 0
                        else 0.0
                    ),
                    "days_left": int(progress["days_remaining"]),
                    "velocity_ratio": velocity_ratio,
                    "pace_state": pace_state,
                }
            )

        return {
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "headline": {
                "total_spent_cents": current_total,
                "vs_last_week_cents": current_total - previous_total,
                "vs_four_week_avg_cents": current_total - trailing_weekly_avg,
                "transaction_count": len(current_expenses),
            },
            "top_categories": top_categories,
            "budget_pulse": budget_pulse,
            "unusual_transactions": unusual_transactions,
            "recurring_postings": recurring_postings,
        }
