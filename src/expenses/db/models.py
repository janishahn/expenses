from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from expenses.db.session import Base


class TransactionType(str, Enum):
    income = "income"
    expense = "expense"


class RuleMatchType(str, Enum):
    contains = "contains"
    equals = "equals"
    starts_with = "starts_with"
    regex = "regex"


class CurrencyCode(str, Enum):
    eur = "EUR"
    usd = "USD"


CURRENCY_CODE_ENUM = SAEnum(
    CurrencyCode,
    name="currencycode",
    values_callable=lambda enum_cls: [member.value for member in enum_cls],
)


class IntervalUnit(str, Enum):
    day = "day"
    week = "week"
    month = "month"
    year = "year"


class MonthDayPolicy(str, Enum):
    snap_to_end = "snap_to_end"
    skip = "skip"
    carry_forward = "carry_forward"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("username", name="uq_users_username"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    auth_sessions: Mapped[list["AuthSession"]] = relationship(
        "AuthSession",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    mobile_auth_sessions: Mapped[list["MobileAuthSession"]] = relationship(
        "MobileAuthSession",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    ingest_token: Mapped["UserIngestToken | None"] = relationship(
        "UserIngestToken",
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
    )


class AuthSession(Base, TimestampMixin):
    __tablename__ = "auth_sessions"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_auth_sessions_token_hash"),
        Index("ix_auth_sessions_user", "user_id"),
        Index("ix_auth_sessions_user_active", "user_id", "revoked_at", "expires_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    csrf_secret: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    elevated_until: Mapped[Optional[datetime]] = mapped_column(DateTime)

    user: Mapped["User"] = relationship("User", back_populates="auth_sessions")


class MobileAuthSession(Base, TimestampMixin):
    __tablename__ = "mobile_auth_sessions"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_mobile_auth_sessions_token_hash"),
        UniqueConstraint(
            "user_id", "device_id", name="uq_mobile_auth_sessions_user_device"
        ),
        Index("ix_mobile_auth_sessions_user", "user_id"),
        Index(
            "ix_mobile_auth_sessions_user_active",
            "user_id",
            "revoked_at",
            "expires_at",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    device_id: Mapped[str] = mapped_column(String(120), nullable=False)
    device_name: Mapped[str] = mapped_column(String(120), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    elevated_until: Mapped[Optional[datetime]] = mapped_column(DateTime)

    user: Mapped["User"] = relationship("User", back_populates="mobile_auth_sessions")


class UserIngestToken(Base, TimestampMixin):
    __tablename__ = "user_ingest_tokens"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_user_ingest_tokens_user_id"),
        UniqueConstraint("token_hash", name="uq_user_ingest_tokens_token_hash"),
        Index("ix_user_ingest_tokens_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    token_hint: Mapped[str] = mapped_column(String(16), nullable=False)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    user: Mapped["User"] = relationship("User", back_populates="ingest_token")


class FxQuoteCache(Base):
    __tablename__ = "fx_quotes"
    __table_args__ = (
        UniqueConstraint(
            "base_currency_code",
            "quote_currency_code",
            "lookup_date",
            name="uq_fx_quotes_pair_lookup_date",
        ),
        Index(
            "ix_fx_quotes_pair_lookup_date",
            "base_currency_code",
            "quote_currency_code",
            "lookup_date",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    base_currency_code: Mapped[CurrencyCode] = mapped_column(
        CURRENCY_CODE_ENUM, nullable=False
    )
    quote_currency_code: Mapped[CurrencyCode] = mapped_column(
        CURRENCY_CODE_ENUM, nullable=False
    )
    lookup_date: Mapped[date] = mapped_column(Date, nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    rate_micros: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Category(Base, TimestampMixin):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[TransactionType] = mapped_column(
        SAEnum(TransactionType), nullable=False
    )
    color: Mapped[Optional[str]] = mapped_column(String(7))
    icon: Mapped[Optional[str]] = mapped_column(String(50))
    order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    transactions: Mapped[list["Transaction"]] = relationship(
        "Transaction", back_populates="category"
    )
    recurring_rules: Mapped[list["RecurringRule"]] = relationship(
        "RecurringRule", back_populates="category"
    )
    transaction_templates: Mapped[list["TransactionTemplate"]] = relationship(
        "TransactionTemplate", back_populates="category"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "type", "name", name="uq_category_user_type_name"),
    )


class Tag(Base, TimestampMixin):
    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_tag_user_name"),
        Index("ix_tags_user_archived_at", "user_id", "archived_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[Optional[str]] = mapped_column(String(9))
    is_hidden_from_budget: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    transactions: Mapped[list["Transaction"]] = relationship(
        "Transaction", secondary="transaction_tags", back_populates="tags"
    )


transaction_tags = Table(
    "transaction_tags",
    Base.metadata,
    Column("transaction_id", Integer, ForeignKey("transactions.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id"), primary_key=True),
)


class Transaction(Base, TimestampMixin):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    type: Mapped[TransactionType] = mapped_column(
        SAEnum(TransactionType), nullable=False
    )
    is_reimbursement: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    source_currency_code: Mapped[Optional[CurrencyCode]] = mapped_column(
        CURRENCY_CODE_ENUM
    )
    source_amount_cents: Mapped[Optional[int]] = mapped_column(Integer)
    fx_rate_micros: Mapped[Optional[int]] = mapped_column(Integer)
    fx_rate_date: Mapped[Optional[date]] = mapped_column(Date)
    fx_provider: Mapped[Optional[str]] = mapped_column(String(40))
    fx_fetched_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id"), nullable=False
    )
    title: Mapped[Optional[str]] = mapped_column(Text)
    description: Mapped[Optional[str]] = mapped_column(Text)
    latitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(9, 6))
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    origin_rule_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("recurring_rules.id")
    )
    occurrence_date: Mapped[Optional[date]] = mapped_column(Date)

    category: Mapped["Category"] = relationship(
        "Category", back_populates="transactions"
    )
    origin_rule: Mapped[Optional["RecurringRule"]] = relationship(
        "RecurringRule", back_populates="transactions"
    )
    tags: Mapped[list["Tag"]] = relationship(
        "Tag", secondary="transaction_tags", back_populates="transactions"
    )
    reimbursement_allocations_out: Mapped[list["ReimbursementAllocation"]] = (
        relationship(
            "ReimbursementAllocation",
            foreign_keys="ReimbursementAllocation.reimbursement_transaction_id",
            back_populates="reimbursement_transaction",
        )
    )
    reimbursement_allocations_in: Mapped[list["ReimbursementAllocation"]] = (
        relationship(
            "ReimbursementAllocation",
            foreign_keys="ReimbursementAllocation.expense_transaction_id",
            back_populates="expense_transaction",
        )
    )
    attachments: Mapped[list["ReceiptAttachment"]] = relationship(
        "ReceiptAttachment",
        back_populates="transaction",
        cascade="all, delete-orphan",
    )
    durable_purchase: Mapped[Optional["DurablePurchase"]] = relationship(
        "DurablePurchase",
        back_populates="transaction",
        cascade="all, delete-orphan",
        uselist=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "origin_rule_id",
            "occurrence_date",
            name="uq_txn_origin_occurrence",
        ),
        Index("ix_transactions_user_date", "user_id", "date"),
        Index("ix_transactions_user_category_date", "user_id", "category_id", "date"),
        Index("ix_transactions_user_type_date", "user_id", "type", "date"),
        Index(
            "ix_transactions_user_occurred",
            "user_id",
            "occurred_at",
            sqlite_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_transactions_user_is_reimbursement_date",
            "user_id",
            "is_reimbursement",
            "date",
        ),
        CheckConstraint("amount_cents >= 0", name="ck_transactions_amount_positive"),
        CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL) "
            "OR (latitude IS NOT NULL AND longitude IS NOT NULL)",
            name="ck_transactions_location_pair",
        ),
        CheckConstraint(
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
            name="ck_transactions_latitude_range",
        ),
        CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="ck_transactions_longitude_range",
        ),
    )


class RecurringRule(Base, TimestampMixin):
    __tablename__ = "recurring_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[Optional[str]] = mapped_column(String(120))
    type: Mapped[TransactionType] = mapped_column(
        SAEnum(TransactionType), nullable=False
    )
    currency_code: Mapped[CurrencyCode] = mapped_column(
        CURRENCY_CODE_ENUM, nullable=False, default=CurrencyCode.eur
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id"), nullable=False
    )
    anchor_date: Mapped[date] = mapped_column(Date, nullable=False)
    interval_unit: Mapped[IntervalUnit] = mapped_column(
        SAEnum(IntervalUnit), nullable=False
    )
    interval_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    next_occurrence: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    auto_post: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    skip_weekends: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    month_day_policy: Mapped[MonthDayPolicy] = mapped_column(
        SAEnum(MonthDayPolicy),
        default=MonthDayPolicy.snap_to_end,
        nullable=False,
    )

    category: Mapped["Category"] = relationship(
        "Category", back_populates="recurring_rules"
    )
    transactions: Mapped[list["Transaction"]] = relationship(
        "Transaction", back_populates="origin_rule"
    )

    __table_args__ = (
        CheckConstraint("interval_count > 0", name="ck_rule_interval_positive"),
        CheckConstraint("amount_cents >= 0", name="ck_rule_amount_positive"),
    )


class TransactionTemplate(Base, TimestampMixin):
    __tablename__ = "transaction_templates"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_template_user_name"),
        Index("ix_template_user_sort", "user_id", "sort_order", "id"),
        CheckConstraint(
            "default_amount_cents IS NULL OR default_amount_cents >= 0",
            name="ck_template_amount_nonnegative",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[TransactionType] = mapped_column(
        SAEnum(TransactionType), nullable=False
    )
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id"), nullable=False
    )
    default_amount_cents: Mapped[Optional[int]] = mapped_column(Integer)
    title: Mapped[Optional[str]] = mapped_column(Text)
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    category: Mapped["Category"] = relationship(
        "Category",
        back_populates="transaction_templates",
    )


class DurablePurchase(Base, TimestampMixin):
    __tablename__ = "durable_purchases"
    __table_args__ = (
        UniqueConstraint("transaction_id", name="uq_durable_purchase_transaction"),
        Index("ix_durable_purchase_user", "user_id", "id"),
        CheckConstraint(
            "expected_lifespan_days > 0", name="ck_durable_lifespan_positive"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False
    )
    expected_lifespan_days: Mapped[int] = mapped_column(Integer, nullable=False)
    acquired_on: Mapped[date] = mapped_column(Date, nullable=False)

    transaction: Mapped["Transaction"] = relationship(
        "Transaction",
        back_populates="durable_purchase",
    )


class ReimbursementAllocation(Base, TimestampMixin):
    __tablename__ = "reimbursement_allocations"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "reimbursement_transaction_id",
            "expense_transaction_id",
            name="uq_reimbursement_allocation_pair",
        ),
        Index(
            "ix_reimbursement_allocations_user_reimbursement",
            "user_id",
            "reimbursement_transaction_id",
        ),
        Index(
            "ix_reimbursement_allocations_user_expense",
            "user_id",
            "expense_transaction_id",
        ),
        CheckConstraint("amount_cents >= 0", name="ck_reimbursement_allocation_amount"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reimbursement_transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False
    )
    expense_transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    reimbursement_transaction: Mapped["Transaction"] = relationship(
        "Transaction",
        foreign_keys=[reimbursement_transaction_id],
        back_populates="reimbursement_allocations_out",
    )
    expense_transaction: Mapped["Transaction"] = relationship(
        "Transaction",
        foreign_keys=[expense_transaction_id],
        back_populates="reimbursement_allocations_in",
    )


class MonthlyRollup(Base, TimestampMixin):
    __tablename__ = "monthly_rollups"
    __table_args__ = (
        UniqueConstraint("user_id", "year", "month", name="uq_rollup_user_month"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    income_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expense_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class BudgetFrequency(str, Enum):
    monthly = "monthly"
    yearly = "yearly"


class BudgetTemplate(Base, TimestampMixin):
    __tablename__ = "budget_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    frequency: Mapped[BudgetFrequency] = mapped_column(
        SAEnum(BudgetFrequency), nullable=False
    )
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"))
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[Optional[date]] = mapped_column(Date)

    category: Mapped[Optional["Category"]] = relationship("Category")

    __table_args__ = (
        CheckConstraint("amount_cents >= 0", name="ck_budget_template_amount_positive"),
        UniqueConstraint(
            "user_id",
            "frequency",
            "category_id",
            "starts_on",
            name="uq_budget_template_scope_start",
        ),
        Index("ix_budget_template_user_freq", "user_id", "frequency"),
    )


class BudgetOverride(Base, TimestampMixin):
    __tablename__ = "budget_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"))
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    category: Mapped[Optional["Category"]] = relationship("Category")

    __table_args__ = (
        CheckConstraint("amount_cents >= 0", name="ck_budget_override_amount_positive"),
        UniqueConstraint(
            "user_id",
            "year",
            "month",
            "category_id",
            name="uq_budget_override_user_month_category",
        ),
        Index("ix_budget_override_user_month", "user_id", "year", "month"),
    )


class Rule(Base, TimestampMixin):
    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)

    match_type: Mapped[RuleMatchType] = mapped_column(
        SAEnum(RuleMatchType), nullable=False
    )
    match_value: Mapped[str] = mapped_column(String(200), nullable=False)
    transaction_type: Mapped[Optional[TransactionType]] = mapped_column(
        SAEnum(TransactionType)
    )
    min_amount_cents: Mapped[Optional[int]] = mapped_column(Integer)
    max_amount_cents: Mapped[Optional[int]] = mapped_column(Integer)

    set_category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"))
    add_tags_json: Mapped[Optional[str]] = mapped_column(Text)
    budget_exclude_tag_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tags.id"))

    set_category: Mapped[Optional["Category"]] = relationship(
        "Category", foreign_keys=[set_category_id]
    )
    budget_exclude_tag: Mapped[Optional["Tag"]] = relationship(
        "Tag", foreign_keys=[budget_exclude_tag_id]
    )

    __table_args__ = (
        Index("ix_rules_user_enabled_priority", "user_id", "enabled", "priority", "id"),
    )


class BalanceAnchor(Base, TimestampMixin):
    __tablename__ = "balance_anchors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    as_of_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    balance_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text)

    __table_args__ = (Index("ix_balance_anchor_user_at", "user_id", "as_of_at"),)


class BankStatementRow(Base, TimestampMixin):
    __tablename__ = "bank_statement_rows"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "source",
            "import_hash",
            name="uq_bank_statement_rows_user_source_hash",
        ),
        Index(
            "ix_bank_statement_rows_user_booking",
            "user_id",
            "booking_date",
            "id",
        ),
        Index(
            "ix_bank_statement_rows_user_status",
            "user_id",
            "reviewed_at",
            "matched_transaction_id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    account_label: Mapped[str] = mapped_column(String(120), nullable=False)
    booking_date: Mapped[date] = mapped_column(Date, nullable=False)
    value_date: Mapped[Optional[date]] = mapped_column(Date)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    payee: Mapped[Optional[str]] = mapped_column(Text)
    booking_text: Mapped[Optional[str]] = mapped_column(Text)
    purpose: Mapped[Optional[str]] = mapped_column(Text)
    raw_description: Mapped[str] = mapped_column(Text, nullable=False)
    import_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    matched_transaction_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    matched_transaction: Mapped[Optional["Transaction"]] = relationship("Transaction")


class LLMJob(Base):
    __tablename__ = "llm_jobs"
    __table_args__ = (
        Index("ix_llm_jobs_user_feature_created", "user_id", "feature", "created_at"),
        Index("ix_llm_jobs_user_status", "user_id", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    feature: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(80), nullable=False)
    model: Mapped[str] = mapped_column(String(80), nullable=False)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[Optional[str]] = mapped_column(String(40))
    entity_id: Mapped[Optional[int]] = mapped_column(Integer)
    input_json: Mapped[Optional[str]] = mapped_column(Text)
    output_json: Mapped[Optional[str]] = mapped_column(Text)
    error: Mapped[Optional[str]] = mapped_column(Text)
    usage_input_tokens: Mapped[Optional[int]] = mapped_column(Integer)
    usage_output_tokens: Mapped[Optional[int]] = mapped_column(Integer)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime)


class TransactionLLMSuggestion(Base, TimestampMixin):
    __tablename__ = "transaction_llm_suggestions"
    __table_args__ = (
        Index(
            "ix_transaction_llm_suggestions_user_txn_status",
            "user_id",
            "transaction_id",
            "status",
        ),
        UniqueConstraint(
            "transaction_id",
            "fingerprint_hash",
            name="uq_transaction_llm_suggestions_txn_fingerprint",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False
    )
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("llm_jobs.id"))
    fingerprint_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"))
    clean_title: Mapped[Optional[str]] = mapped_column(String(200))
    tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    confidence_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    transaction: Mapped["Transaction"] = relationship("Transaction")
    category: Mapped[Optional["Category"]] = relationship("Category")
    job: Mapped[Optional["LLMJob"]] = relationship("LLMJob")


class RuleLLMSuggestion(Base, TimestampMixin):
    __tablename__ = "rule_llm_suggestions"
    __table_args__ = (
        Index("ix_rule_llm_suggestions_user_status", "user_id", "status", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("llm_jobs.id"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    match_type: Mapped[str] = mapped_column(String(20), nullable=False)
    match_value: Mapped[str] = mapped_column(String(200), nullable=False)
    transaction_type: Mapped[Optional[str]] = mapped_column(String(20))
    min_amount_cents: Mapped[Optional[int]] = mapped_column(Integer)
    max_amount_cents: Mapped[Optional[int]] = mapped_column(Integer)
    set_category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"))
    add_tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    confidence_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_transaction_ids_json: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]"
    )
    preview_matches_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )

    set_category: Mapped[Optional["Category"]] = relationship("Category")
    job: Mapped[Optional["LLMJob"]] = relationship("LLMJob")


class TransactionClassificationEvent(Base):
    __tablename__ = "transaction_classification_events"
    __table_args__ = (
        Index(
            "ix_transaction_classification_events_user_txn_created",
            "user_id",
            "transaction_id",
            "created_at",
        ),
        Index(
            "ix_transaction_classification_events_user_source_created",
            "user_id",
            "source",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    before_category_id: Mapped[Optional[int]] = mapped_column(Integer)
    after_category_id: Mapped[Optional[int]] = mapped_column(Integer)
    before_title: Mapped[Optional[str]] = mapped_column(Text)
    after_title: Mapped[Optional[str]] = mapped_column(Text)
    before_tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    after_tags_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    transaction: Mapped["Transaction"] = relationship("Transaction")


class ReceiptAttachment(Base, TimestampMixin):
    __tablename__ = "receipt_attachments"
    __table_args__ = (
        UniqueConstraint("storage_key", name="uq_receipt_attachment_storage_key"),
        Index("ix_receipt_attachment_user_txn", "user_id", "transaction_id"),
        Index("ix_receipt_attachment_user_created", "user_id", "created_at"),
        CheckConstraint("size_bytes > 0", name="ck_receipt_attachment_size_positive"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256_hex: Mapped[str] = mapped_column(String(64), nullable=False)

    transaction: Mapped["Transaction"] = relationship(
        "Transaction",
        back_populates="attachments",
    )
