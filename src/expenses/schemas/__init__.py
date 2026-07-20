from __future__ import annotations

import datetime as dt
import math
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from expenses.db.models import (
    BudgetFrequency,
    CurrencyCode,
    IntervalUnit,
    MonthDayPolicy,
    RuleMatchType,
    TransactionType,
)


class ReportOptions(BaseModel):
    start: date
    end: date
    sections: list[str] = Field(
        default_factory=lambda: [
            "summary",
            "category_breakdown",
            "recent_transactions",
        ]
    )
    include_cents: bool = True
    notes: Optional[str] = None
    transaction_type: Optional[TransactionType] = None
    category_ids: Optional[list[int]] = None
    transactions_sort: Literal["newest", "oldest"] = "newest"
    show_running_balance: bool = False
    include_category_subtotals: bool = False


class AuthCredentialsIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=80)
    password: str = Field(..., min_length=1, max_length=512)

    @model_validator(mode="after")
    def validate_non_blank_credentials(self):
        normalized_username = self.username.strip()
        if not normalized_username:
            raise ValueError("Username cannot be blank")
        if not self.password.strip():
            raise ValueError("Password cannot be blank")
        self.username = normalized_username
        return self


class MobileAuthCredentialsIn(AuthCredentialsIn):
    device_id: str = Field(..., min_length=1, max_length=120)
    device_name: str = Field(..., min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_device_fields(self):
        self.device_id = self.device_id.strip()
        self.device_name = self.device_name.strip()
        if not self.device_id:
            raise ValueError("Device ID cannot be blank")
        if not self.device_name:
            raise ValueError("Device name cannot be blank")
        return self


class MobileSessionOut(BaseModel):
    id: int
    device_id: str
    device_name: str
    created_at: datetime
    last_used_at: Optional[datetime] = None
    expires_at: datetime
    revoked_at: Optional[datetime] = None
    elevated_until: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AuthUserOut(BaseModel):
    id: int
    username: str
    is_admin: bool


class MobileAuthIdentityOut(BaseModel):
    authenticated: bool
    user: Optional[AuthUserOut] = None
    token: Optional[str] = None
    session: Optional[MobileSessionOut] = None


class MobileStatusOut(BaseModel):
    app: str
    version: str
    setup_required: bool
    setup_token_required: bool
    signup_allowed: bool
    timezone: str
    receipt_max_bytes: int
    llm_enabled: bool


class RecurringPreviewIn(BaseModel):
    start_date: date
    interval_unit: IntervalUnit = IntervalUnit.month
    interval_count: int = Field(default=1, ge=1)
    month_day_policy: MonthDayPolicy = MonthDayPolicy.snap_to_end
    skip_weekends: bool = False

    @property
    def anchor_date(self) -> date:
        return self.start_date


class RecurringPreviewOut(BaseModel):
    occurrences: list[date]
    error: Optional[str] = None


class PeriodOut(BaseModel):
    slug: str
    start: date
    end: date


class CategorySummaryOut(BaseModel):
    id: int
    name: str
    type: Optional[str] = None
    icon: Optional[str] = None


class CategoryListItemOut(CategorySummaryOut):
    archived_at: Optional[datetime] = None
    order: int
    usage_count: int = 0


class CategoryOut(CategorySummaryOut):
    archived_at: Optional[datetime] = None
    order: int


class CategoriesResponseOut(BaseModel):
    period: PeriodOut
    categories: list[CategoryListItemOut]


class TransactionTagOut(BaseModel):
    id: int
    name: str


class TagOut(TransactionTagOut):
    color: Optional[str] = None
    is_hidden_from_budget: bool
    usage_count: int = 0


class TagMutationOut(TransactionTagOut):
    color: Optional[str] = None
    is_hidden_from_budget: bool


class TagsResponseOut(BaseModel):
    period: PeriodOut
    tags: list[TagOut]


class TransactionTemplateOut(BaseModel):
    id: int
    name: str
    type: str
    category_id: int
    category: Optional[CategorySummaryOut]
    default_amount_cents: Optional[int] = None
    title: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    sort_order: int


class TemplatesResponseOut(BaseModel):
    templates: list[TransactionTemplateOut]


class TransactionListItemOut(BaseModel):
    id: int
    date: date
    occurred_at: datetime
    type: str
    amount_cents: int
    net_amount_cents: int
    reimbursed_total_cents: int
    is_reimbursement: bool
    category: Optional[CategorySummaryOut] = None
    title: Optional[str] = None
    description: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    tags: list[TransactionTagOut] = Field(default_factory=list)
    has_attachments: bool = False


class DurablePurchaseOut(BaseModel):
    expected_lifespan_days: int
    acquired_on: date


class TransactionDetailOut(BaseModel):
    id: int
    date: date
    occurred_at: Optional[datetime] = None
    type: str
    amount_cents: int
    category_id: Optional[int] = None
    category: Optional[CategorySummaryOut] = None
    title: str
    description: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    is_reimbursement: bool
    tags: list[str] = Field(default_factory=list)
    durable_purchase: Optional[DurablePurchaseOut] = None
    attachments: list[ReceiptAttachmentOut] = Field(default_factory=list)


class TransactionFiltersOut(BaseModel):
    type: Optional[str] = None
    category_id: Optional[int] = None
    tag_id: Optional[int] = None
    query: Optional[str] = None


class TransactionsResponseOut(BaseModel):
    items: list[TransactionListItemOut]
    page: int
    limit: int
    has_more: bool
    period: PeriodOut
    filters: TransactionFiltersOut
    categories: list[CategorySummaryOut]
    tags: list[TransactionTagOut]


class DeletedTransactionOut(BaseModel):
    id: int
    date: date
    type: str
    amount_cents: int
    category: Optional[CategorySummaryOut] = None
    title: Optional[str] = None
    description: Optional[str] = None
    deleted_at: Optional[datetime] = None


class DeletedTransactionsResponseOut(BaseModel):
    transactions: list[DeletedTransactionOut]


class IdOut(BaseModel):
    id: int


class StatusOut(BaseModel):
    status: str


class PermanentDeleteTransactionOut(StatusOut):
    attachments_count: int
    deleted_count: int


class DashboardFiltersOut(BaseModel):
    type: Optional[str] = None


class DashboardKpisOut(BaseModel):
    income: int
    expenses: int
    balance: int


class DashboardSparklinesOut(BaseModel):
    income: Optional[str] = None
    expenses: Optional[str] = None
    balance: Optional[str] = None


class DashboardDeltasOut(BaseModel):
    income: int
    expenses: int
    balance: int


class BreakdownItemOut(BaseModel):
    name: str
    amount_cents: int
    percent: float


class DashboardDonutOut(BaseModel):
    has_any_transactions: bool
    mode: Optional[Literal["both", "expense-only", "income-only"]] = None
    expense_breakdown: Optional[list[BreakdownItemOut]] = None
    income_breakdown: Optional[list[BreakdownItemOut]] = None


class DashboardDurablePurchaseOut(BaseModel):
    id: int
    transaction_id: int
    expected_lifespan_days: int
    acquired_on: date
    days_owned: int
    cost_per_day_cents: float
    amortized_cents: int
    remaining_cents: int
    percent_amortized: float
    fully_amortized: bool
    paid_for_itself_on: date
    original_amount_cents: int
    title: Optional[str] = None
    category: Optional[CategorySummaryOut] = None


class DashboardBudgetPaceOut(BaseModel):
    velocity_ratio: float
    projected_cents: int
    budget_cents: int
    sparkline: str


class DashboardCategoryBudgetPulseOut(BaseModel):
    scope_category_id: int
    scope_label: str
    amount_cents: int
    spent_cents: int
    remaining_cents: int
    velocity_ratio: float


class DashboardCategoryBudgetSummaryOut(BaseModel):
    total: int
    needs_attention: int
    priority: DashboardCategoryBudgetPulseOut


class DashboardResponseOut(BaseModel):
    period: PeriodOut
    filters: DashboardFiltersOut
    kpis: DashboardKpisOut
    sparklines: DashboardSparklinesOut
    deltas: Optional[DashboardDeltasOut] = None
    donut: DashboardDonutOut
    recent: list[TransactionListItemOut]
    categories: list[CategorySummaryOut]
    tags: list[TransactionTagOut]
    durable_purchases: Optional[list[DashboardDurablePurchaseOut]] = None
    budget_pace: Optional[DashboardBudgetPaceOut] = None
    category_budget_pulse: Optional[list[DashboardCategoryBudgetPulseOut]] = None
    category_budget_summary: Optional[DashboardCategoryBudgetSummaryOut] = None


class InsightsFiltersOut(BaseModel):
    type: Optional[Literal["income", "expense"]] = None
    tag_id: Optional[int] = None


class InsightsCategoryOut(BaseModel):
    id: int
    name: str
    type: Literal["income", "expense"]
    icon: Optional[str] = None


class InsightsMonthlySeriesPointOut(BaseModel):
    year: int
    month: int
    label: str
    income_cents: int
    expense_cents: int
    net_cents: int


class InsightsDeltaItemOut(BaseModel):
    category_id: int
    category_name: str
    current_cents: int
    previous_cents: int
    delta_cents: int


class InsightsDeltasOut(BaseModel):
    increases: list[InsightsDeltaItemOut]
    decreases: list[InsightsDeltaItemOut]


class InsightsTopTagOut(BaseModel):
    id: int
    name: str
    amount_cents: int


class InsightsTrendPointOut(BaseModel):
    year: int
    month: int
    label: str
    amount_cents: int


class InsightsBudgetEffectiveOut(BaseModel):
    scope_category_id: Optional[int] = None
    scope_label: str
    amount_cents: int
    source: str
    source_id: int


class InsightsBudgetProgressOut(BaseModel):
    spent_cents: int
    remaining_cents: int


class InsightsResponseOut(BaseModel):
    period: PeriodOut
    filters: InsightsFiltersOut
    tags: list[TransactionTagOut]
    categories: list[InsightsCategoryOut]
    series: list[InsightsMonthlySeriesPointOut]
    expense_breakdown: list[BreakdownItemOut]
    income_breakdown: list[BreakdownItemOut]
    deltas: InsightsDeltasOut
    top_tags: list[InsightsTopTagOut]
    trend_category_id: Optional[int] = None
    trend: list[InsightsTrendPointOut]
    budget_month: str
    budget_effective: list[InsightsBudgetEffectiveOut]
    budget_progress: dict[str, InsightsBudgetProgressOut]


class InsightsFlowNodeOut(BaseModel):
    id: str
    label: str
    type: Literal["income", "expense", "savings", "deficit"]
    amount_cents: int
    category_id: Optional[int] = None


class InsightsFlowLinkOut(BaseModel):
    from_: str = Field(alias="from")
    to: str
    amount_cents: int


class InsightsFlowResponseOut(BaseModel):
    period: PeriodOut
    filters: InsightsFiltersOut
    nodes: list[InsightsFlowNodeOut]
    links: list[InsightsFlowLinkOut]


class DurablePurchasesResponseOut(BaseModel):
    items: list[DashboardDurablePurchaseOut]


class BankStatementPreviewRowOut(BaseModel):
    booking_date: date
    value_date: Optional[date] = None
    amount_cents: int
    currency: str
    payee: Optional[str] = None
    booking_text: Optional[str] = None
    purpose: Optional[str] = None
    raw_description: str
    duplicate: bool


class BankStatementPreviewResponseOut(BaseModel):
    account_label: str
    rows: list[BankStatementPreviewRowOut]
    errors: list[str]
    new_count: int
    duplicate_count: int


class BankStatementImportResponseOut(BaseModel):
    imported_count: int
    duplicate_count: int


class BankReconciliationSummaryOut(BaseModel):
    row_count: int
    unresolved_count: int
    suggested_count: int
    matched_count: int
    reviewed_count: int
    bank_total_cents: int
    only_in_expenses_count: int


class BankReconciliationTransactionOut(BaseModel):
    id: int
    date: date
    type: Literal["income", "expense"]
    amount_cents: int
    signed_amount_cents: int
    title: Optional[str] = None
    category: Optional[str] = None
    date_delta_days: int


class BankStatementRowOut(BaseModel):
    id: int
    account_label: str
    booking_date: date
    value_date: Optional[date] = None
    amount_cents: int
    currency: str
    payee: Optional[str] = None
    booking_text: Optional[str] = None
    purpose: Optional[str] = None
    raw_description: str
    reviewed_at: Optional[datetime] = None
    status: Literal["matched", "suggested", "ambiguous", "missing", "reviewed"]
    candidate_count: int
    suggested_transaction: Optional[BankReconciliationTransactionOut] = None


class BankReconciliationResponseOut(BaseModel):
    summary: BankReconciliationSummaryOut
    rows: list[BankStatementRowOut]
    only_in_expenses: list[BankReconciliationTransactionOut]


class BankRowActionResponseOut(StatusOut):
    transaction_id: Optional[int] = None


class AdminInfoOut(BaseModel):
    app_version: str
    environment: str
    db_path: str
    db_size_mb: float
    db_modified: Optional[datetime] = None
    log_path: str
    log_size_mb: float
    log_modified: Optional[datetime] = None
    log_retained_files: int
    users_count: int


class AdminSystemHealthOut(BaseModel):
    cpu_temp_celsius: Optional[float] = None
    cpu_load_percent: float
    ram_used_bytes: int
    ram_total_bytes: int
    disk_used_bytes: int
    disk_total_bytes: int
    disk_free_bytes: int
    db_size_bytes: int
    receipts_size_bytes: int
    status: Literal["healthy", "warm", "critical"]


class AdminLogsResponseOut(BaseModel):
    entries: list[dict[str, Any]]
    next_cursor: Optional[str] = None


class AIUsageSummaryOut(BaseModel):
    feature: str
    period: Literal["week", "month", "all"]
    started_at: Optional[datetime] = None
    total_chats: int
    completed_chats: int
    failed_chats: int
    cancelled_chats: int
    costed_chats: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cached_input_tokens: int
    cache_write_tokens: int
    reasoning_tokens: int
    total_cost_decimal: str
    average_cost_decimal: str
    cost_unit: Optional[str] = None
    average_total_tokens: int
    p95_duration_ms: Optional[int] = None


class AdminPurgeDeletedIn(BaseModel):
    days: int = Field(default=30, ge=1)


class AdminPurgeDeletedOut(StatusOut):
    count: int
    attachments_count: int


class AdminRebuildRollupsOut(StatusOut):
    rebuilt_users: int


class AdminRecurringCatchUpOut(StatusOut):
    advanced_rules: int
    overdue_rules: int
    updated: bool


class MobileSessionsResponseOut(BaseModel):
    sessions: list[MobileSessionOut]


class AdminElevationOut(BaseModel):
    elevated: bool
    elevated_until: Optional[datetime] = None


class AdminElevationIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=512)

    @model_validator(mode="after")
    def validate_non_blank_password(self):
        if not self.password.strip():
            raise ValueError("Password cannot be blank")
        return self


class BudgetOverrideIn(BaseModel):
    year: int = Field(..., ge=1970, le=3000)
    month: int = Field(..., ge=1, le=12)
    category_id: Optional[int] = None
    amount_cents: int = Field(..., ge=0)


class BudgetTemplateIn(BaseModel):
    frequency: BudgetFrequency
    category_id: Optional[int] = None
    amount_cents: int = Field(..., ge=0)
    starts_on: date
    ends_on: Optional[date] = None


class BudgetTemplateApplyFromIn(BaseModel):
    frequency: BudgetFrequency
    category_id: Optional[int] = None
    amount_cents: int = Field(..., ge=0)
    starts_on: date


class BudgetCategoryOut(BaseModel):
    id: int
    name: str
    type: str
    icon: Optional[str] = None
    archived_at: Optional[datetime] = None


class BudgetScopeOut(BaseModel):
    scope_category_id: Optional[int] = None
    scope_label: str
    amount_cents: int
    source: str
    source_id: int


class BudgetProgressOut(BaseModel):
    scope_category_id: Optional[int] = None
    spent_cents: int
    remaining_cents: int
    velocity_ratio: float
    daily_remaining_cents: int
    projected_total_cents: int
    days_elapsed: int
    days_remaining: int


class BudgetTemplateRowOut(BaseModel):
    id: int
    frequency: str
    category: Optional[CategorySummaryOut] = None
    amount_cents: int
    starts_on: date
    ends_on: Optional[date] = None


class BudgetYearSpentOut(BaseModel):
    scope_category_id: Optional[int] = None
    spent_cents: int


class BudgetsResponseOut(BaseModel):
    view: str
    year: int
    month: int
    month_value: str
    budgets: list[BudgetScopeOut]
    progress: list[BudgetProgressOut]
    categories: list[BudgetCategoryOut]
    templates: list[BudgetTemplateRowOut]
    year_value: int
    yearly_budgets: list[BudgetScopeOut]
    yearly_spent: list[BudgetYearSpentOut]
    default_month_template_start: date
    default_year_template_start: date


class BudgetOverrideOut(BaseModel):
    id: int
    year: int
    month: int
    category_id: Optional[int] = None
    amount_cents: int


class BudgetTemplateMutationOut(BaseModel):
    id: int
    frequency: str
    category_id: Optional[int] = None
    amount_cents: int
    starts_on: date
    ends_on: Optional[date] = None


class BudgetBurndownTransactionOut(BaseModel):
    id: int
    title: str
    amount_cents: int


class BudgetBurndownTopDayOut(BaseModel):
    day: int
    date: Optional[dt.date] = None
    total_cents: int
    transactions: list[BudgetBurndownTransactionOut]


class BudgetBurndownPointOut(BaseModel):
    day: int
    cumulative_cents: int


class BudgetBurndownResponseOut(BaseModel):
    budget_amount_cents: int
    days_in_month: int
    daily_series: list[BudgetBurndownPointOut]
    compare_month: Optional[str] = None
    compare_daily_series: list[BudgetBurndownPointOut]
    top_spending_days: list[BudgetBurndownTopDayOut]


class CategoryIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    type: TransactionType
    icon: Optional[str] = Field(None, max_length=50)
    order: int = 0

    @model_validator(mode="after")
    def normalize_name(self):
        clean_name = self.name.strip()
        if not clean_name:
            raise ValueError("Category name cannot be blank")
        self.name = clean_name
        return self


class CategoryUpdateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    icon: Optional[str] = Field(None, max_length=50)
    order: int = 0

    @model_validator(mode="after")
    def normalize_name(self):
        clean_name = self.name.strip()
        if not clean_name:
            raise ValueError("Category name cannot be blank")
        self.name = clean_name
        return self


class TransactionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    occurred_at: datetime
    type: TransactionType
    is_reimbursement: Optional[bool] = None
    amount_cents: int = Field(..., ge=0)
    category_id: Optional[int] = None
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def validate_coordinate_input_types(cls, data):
        if not isinstance(data, dict):
            return data
        latitude_provided = "latitude" in data
        longitude_provided = "longitude" in data
        if latitude_provided != longitude_provided:
            raise ValueError("Latitude and longitude must both be provided")
        for field_name in ("latitude", "longitude"):
            value = data.get(field_name)
            if value is None:
                continue
            if isinstance(value, bool):
                raise ValueError(f"{field_name} must be a number")
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError(f"{field_name} must be a finite number")
            if isinstance(value, Decimal) and not value.is_finite():
                raise ValueError(f"{field_name} must be a finite number")
        return data

    @model_validator(mode="after")
    def validate_coordinates(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must both be provided")
        if self.latitude is not None:
            if not self.latitude.is_finite():
                raise ValueError("Latitude must be a finite number")
            if self.latitude < -90 or self.latitude > 90:
                raise ValueError("Latitude must be between -90 and 90")
        if self.longitude is not None:
            if not self.longitude.is_finite():
                raise ValueError("Longitude must be a finite number")
            if self.longitude < -180 or self.longitude > 180:
                raise ValueError("Longitude must be between -180 and 180")
        return self


class TransactionTemplateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    type: TransactionType
    category_id: int
    default_amount_cents: Optional[int] = Field(default=None, ge=0)
    title: Optional[str] = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list)


class TemplateReorderIn(BaseModel):
    template_ids: list[int] = Field(default_factory=list)


class DurablePurchaseIn(BaseModel):
    expected_lifespan_days: int = Field(..., gt=0)
    acquired_on: Optional[date] = None


class ScenarioRemoveRuleIn(BaseModel):
    type: Literal["remove_rule"]
    rule_id: int


class ScenarioAddRuleIn(BaseModel):
    type: Literal["add_rule"]
    name: str = Field(..., min_length=1, max_length=120)
    tx_type: TransactionType
    amount_cents: int = Field(..., ge=0)
    interval: Literal["monthly", "yearly", "weekly"]


class ScenarioModifyRuleIn(BaseModel):
    type: Literal["modify_rule"]
    rule_id: int
    new_amount_cents: int = Field(..., ge=0)
    effective_month: str = Field(..., pattern=r"^\d{4}-\d{2}$")


class ScenarioOneTimeIn(BaseModel):
    type: Literal["one_time"]
    name: str = Field(..., min_length=1, max_length=120)
    tx_type: TransactionType
    amount_cents: int = Field(..., ge=0)
    month: str = Field(..., pattern=r"^\d{4}-\d{2}$")


class ScenarioAdjustCategoryIn(BaseModel):
    type: Literal["adjust_category"]
    category_id: int
    new_monthly_cents: int = Field(..., ge=0)


ScenarioModificationIn = Annotated[
    ScenarioRemoveRuleIn
    | ScenarioAddRuleIn
    | ScenarioModifyRuleIn
    | ScenarioOneTimeIn
    | ScenarioAdjustCategoryIn,
    Field(discriminator="type"),
]


class ForecastScenarioIn(BaseModel):
    horizon: Literal[3, 6, 12] = 12
    modifications: list[ScenarioModificationIn] = Field(default_factory=list)


class ForecastRecurringRuleOut(BaseModel):
    rule_id: Optional[int] = None
    name: str
    type: Literal["income", "expense"]
    amount_cents: int
    occurrence_date: date
    category_id: Optional[int] = None
    category_name: Optional[str] = None


class ForecastVariableEstimateOut(BaseModel):
    category_id: int
    name: str
    icon: Optional[str] = None
    amount_cents: int


class ForecastOneTimeEventOut(BaseModel):
    name: str
    type: Literal["income", "expense"]
    amount_cents: int


class ForecastBreakdownOut(BaseModel):
    recurring_rules: list[ForecastRecurringRuleOut]
    variable_estimates: list[ForecastVariableEstimateOut]
    variable_income_estimates: list[ForecastVariableEstimateOut]
    one_time_events: list[ForecastOneTimeEventOut]


class ForecastMonthOut(BaseModel):
    month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    projected_income_cents: int
    projected_expenses_cents: int
    projected_net_cents: int
    end_balance_cents: int
    end_balance_p10_cents: Optional[int] = None
    end_balance_p90_cents: Optional[int] = None
    minimum_balance_cents: int
    crosses_negative: bool
    breakdown: ForecastBreakdownOut


class ForecastSummaryOut(BaseModel):
    projected_balance_cents: int
    projected_balance_p10_cents: Optional[int] = None
    projected_balance_p90_cents: Optional[int] = None
    average_monthly_net_cents: int
    months_until_negative: Optional[int] = None
    risk_months_until_negative: Optional[int] = None


class ForecastModelOut(BaseModel):
    method: Literal["recurring_only", "recent_median", "seasonal_median"]
    history_months: int
    seasonality_applied: bool
    prediction_interval_available: bool


class ForecastProjectionOut(BaseModel):
    mode: Literal["recurring", "full"]
    start_balance_cents: int
    current_month_net_cents: int
    months: list[ForecastMonthOut]
    model: ForecastModelOut
    summary: ForecastSummaryOut


class ForecastResponseOut(ForecastProjectionOut):
    horizon: Literal[3, 6, 12]


class ForecastScenarioMonthlyDeltaOut(BaseModel):
    month: str = Field(..., pattern=r"^\d{4}-\d{2}$")
    delta_end_balance_cents: int


class ForecastScenarioModificationImpactOut(BaseModel):
    index: int
    label: str
    final_delta_cents: int
    average_monthly_delta_cents: int
    monthly_delta: list[ForecastScenarioMonthlyDeltaOut]


class ForecastScenarioImpactOut(BaseModel):
    final_delta_cents: int
    average_monthly_delta_cents: int
    monthly_delta: list[ForecastScenarioMonthlyDeltaOut]
    by_modification: list[ForecastScenarioModificationImpactOut]


class ForecastScenarioResponseOut(ForecastResponseOut):
    baseline: ForecastProjectionOut
    impact: ForecastScenarioImpactOut


class IngestTransactionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount_cents: int = Field(..., ge=0)
    title: str = Field(..., min_length=1, max_length=200)
    date: Optional[dt.date] = None
    category: Optional[str] = Field(default=None, max_length=100)
    latitude: Optional[Decimal] = None
    longitude: Optional[Decimal] = None

    @model_validator(mode="before")
    @classmethod
    def validate_coordinate_input_types(cls, data):
        if not isinstance(data, dict):
            return data
        data = dict(data)
        for field_name in ("latitude", "longitude"):
            value = data.get(field_name)
            if value is None:
                continue
            if isinstance(value, bool):
                data[field_name] = None
                continue
            if isinstance(value, str):
                stripped = value.strip()
                if not stripped:
                    data[field_name] = None
                    continue
                try:
                    value = Decimal(stripped)
                except InvalidOperation:
                    data[field_name] = None
                    continue
            if isinstance(value, float) and not math.isfinite(value):
                data[field_name] = None
                continue
            if isinstance(value, Decimal) and not value.is_finite():
                data[field_name] = None
                continue
            if not isinstance(value, (Decimal, int, float)):
                data[field_name] = None
                continue
            data[field_name] = value
        return data


class IngestTransactionOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int
    date: date
    occurred_at: datetime
    type: Literal["expense"]
    amount_cents: int
    category: str
    title: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_status: Literal["not_provided", "stored", "ignored_partial"]


class TagIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    color: Optional[str] = Field(None, max_length=9)
    is_hidden_from_budget: bool = False


class RecurringRuleIn(BaseModel):
    name: Optional[str] = None
    type: TransactionType
    currency_code: CurrencyCode = CurrencyCode.eur
    amount_cents: int = Field(..., ge=0)
    category_id: int
    anchor_date: date
    interval_unit: IntervalUnit
    interval_count: int = Field(..., gt=0)
    next_occurrence: date
    end_date: Optional[date] = None
    auto_post: bool = True
    skip_weekends: bool = False
    month_day_policy: MonthDayPolicy = MonthDayPolicy.snap_to_end


class RecurringRuleCategoryOut(BaseModel):
    id: int
    name: str
    type: Optional[str] = None
    icon: Optional[str] = None


class RecurringBreakdownOut(BaseModel):
    name: str
    amount_cents: int
    percent: float


class RecurringRuleCountsOut(BaseModel):
    income: int
    expense: int
    total: int


class RecurringStatsOut(BaseModel):
    total_monthly_income: int
    total_monthly_expenses: int
    net_monthly: int
    coverage_ratio: float
    expense_breakdown: list[RecurringBreakdownOut]
    income_breakdown: list[RecurringBreakdownOut]
    rule_counts: RecurringRuleCountsOut


class RecurringRuleOut(BaseModel):
    id: int
    name: Optional[str] = None
    type: str
    currency_code: str
    amount_cents: int
    monthly_equivalent_cents: Optional[int] = None
    category_id: Optional[int] = None
    category: Optional[RecurringRuleCategoryOut] = None
    anchor_date: dt.date
    interval_unit: str
    interval_count: int
    next_occurrence: dt.date
    end_date: Optional[dt.date] = None
    auto_post: bool
    skip_weekends: Optional[bool] = None
    month_day_policy: Optional[str] = None


class RecurringResponseOut(BaseModel):
    rules: list[RecurringRuleOut]
    stats: RecurringStatsOut
    categories: list[RecurringRuleCategoryOut]


class RecurringToggleIn(BaseModel):
    auto_post: bool


class RecurringOccurrenceOut(BaseModel):
    id: int
    occurrence_date: Optional[dt.date] = None
    amount_cents: int
    category: Optional[RecurringRuleCategoryOut] = None
    title: Optional[str] = None
    created_at: Optional[datetime] = None


class RecurringOccurrencesResponseOut(BaseModel):
    rule: RecurringRuleOut
    occurrences: list[RecurringOccurrenceOut]


class CSVRow(BaseModel):
    date: date
    type: TransactionType
    is_reimbursement: bool = False
    amount_cents: int
    category: str
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None


class CSVPreviewRowOut(BaseModel):
    date: date
    type: str
    is_reimbursement: bool
    amount_cents: int
    category: Optional[str] = None
    title: str
    description: Optional[str] = None
    category_id: Optional[int] = None


class CSVPreviewResponseOut(BaseModel):
    rows: list[CSVPreviewRowOut]
    errors: list[str]


class CSVCommitResponseOut(BaseModel):
    imported_count: int


class BalanceAnchorIn(BaseModel):
    as_of_at: datetime
    balance_cents: int
    note: Optional[str] = Field(default=None, max_length=200)


class BalanceAnchorOut(BaseModel):
    id: int
    as_of_at: datetime
    balance_cents: int
    note: Optional[str] = None


class IngestTokenMetadataOut(BaseModel):
    token_hint: str
    created_at: datetime
    updated_at: datetime
    last_used_at: Optional[datetime] = None


class SettingsResponseOut(BaseModel):
    current_balance: int
    balance_anchors: list[BalanceAnchorOut]
    ingest_token: Optional[IngestTokenMetadataOut] = None


class IngestTokenCreateResponseOut(BaseModel):
    token: str
    ingest_token: IngestTokenMetadataOut


class RuleIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    enabled: bool = True
    priority: int = Field(default=100, ge=0, le=10_000)
    match_type: RuleMatchType
    match_value: str = Field(..., min_length=1, max_length=200)
    transaction_type: Optional[TransactionType] = None
    min_amount_cents: Optional[int] = Field(default=None, ge=0)
    max_amount_cents: Optional[int] = Field(default=None, ge=0)
    set_category_id: Optional[int] = None
    add_tags: list[str] = Field(default_factory=list)
    budget_exclude_tag_id: Optional[int] = None


class RuleTagOut(BaseModel):
    id: int
    name: str
    is_hidden_from_budget: bool


class RuleBudgetExcludeTagOut(BaseModel):
    id: int
    name: str


class RuleOut(BaseModel):
    id: int
    name: str
    enabled: bool
    priority: int
    match_type: str
    match_value: str
    transaction_type: Optional[str] = None
    min_amount_cents: Optional[int] = None
    max_amount_cents: Optional[int] = None
    set_category_id: Optional[int] = None
    set_category: Optional[CategorySummaryOut] = None
    add_tags: list[str] = Field(default_factory=list)
    budget_exclude_tag_id: Optional[int] = None
    budget_exclude_tag: Optional[RuleBudgetExcludeTagOut] = None


class RulesResponseOut(BaseModel):
    rules: list[RuleOut]
    categories: list[CategorySummaryOut]
    tags: list[RuleTagOut]


class RuleToggleIn(BaseModel):
    enabled: bool


class RulePreviewSampleOut(BaseModel):
    id: int
    title: Optional[str] = None
    amount_cents: int
    type: str
    before_category: str
    after_category: str
    add_tags: list[str] = Field(default_factory=list)


class RulePreviewOut(BaseModel):
    matches_count: int
    sample: list[RulePreviewSampleOut]


class ReimbursementAllocationIn(BaseModel):
    expense_transaction_id: int
    amount_cents: int = Field(..., gt=0)


class ReimbursementTransactionCategoryOut(BaseModel):
    id: int
    name: str
    type: str


class ReimbursementTransactionSummaryOut(BaseModel):
    id: int
    date: date
    title: Optional[str] = None
    deleted_at: Optional[datetime] = None
    category: Optional[ReimbursementTransactionCategoryOut] = None


class ReimbursementAllocationOut(BaseModel):
    allocation_id: int
    amount_cents: int
    expense_transaction: ReimbursementTransactionSummaryOut


class ReimbursementAllocationInOut(BaseModel):
    allocation_id: int
    amount_cents: int
    reimbursement_transaction: ReimbursementTransactionSummaryOut


class TransactionReimbursementsResponseOut(BaseModel):
    mode: str
    is_reimbursement: Optional[bool] = None
    allocated_total_cents: Optional[int] = None
    remaining_to_allocate_cents: Optional[int] = None
    allocations_out: Optional[list[ReimbursementAllocationOut]] = None
    reimbursed_total_cents: Optional[int] = None
    net_cost_cents: Optional[int] = None
    allocations_in: Optional[list[ReimbursementAllocationInOut]] = None


class ReimbursementExpenseSummaryOut(BaseModel):
    id: int
    date: date
    amount_cents: int
    title: Optional[str] = None
    category: Optional[ReimbursementTransactionCategoryOut] = None


class ReimbursementExpenseSearchItemOut(BaseModel):
    expense: ReimbursementExpenseSummaryOut
    reimbursed_total_cents: int
    remaining_unreimbursed_cents: int
    allocated_to_this_cents: int
    suggested_amount_cents: int


class ReimbursementExpenseSearchResponseOut(BaseModel):
    results: list[ReimbursementExpenseSearchItemOut]


class AllocationIDOut(BaseModel):
    allocation_id: int


class LegacySqliteImportOptions(BaseModel):
    import_recurring_rules: bool = True
    recurring_auto_post: bool = False
    link_recurring_transactions: bool = True
    preserve_time_in_title: bool = False


class LegacySqliteMappingTarget(BaseModel):
    legacy_type: TransactionType
    legacy_category: str = Field(..., min_length=1, max_length=200)
    target: Literal["discard", "create", "existing"]
    existing_category_id: Optional[int] = None


class LegacySqliteCommitIn(BaseModel):
    token: str = Field(..., min_length=1, max_length=200)
    options: LegacySqliteImportOptions
    mapping_targets: list[LegacySqliteMappingTarget]


class LegacySqliteMappingRowOut(BaseModel):
    idx: int
    legacy_type: str
    legacy_category: str
    transaction_count: int
    suggested_category_id: Optional[int] = None
    suggested_category_name: Optional[str] = None


class LegacySqliteRecurringRowOut(BaseModel):
    description: str
    legacy_type: str
    legacy_category: str
    amount_cents: int
    start_date: date
    recurrence_type: str
    interval: int
    last_processed_date: Optional[date] = None
    computed_next_occurrence: Optional[date] = None


class LegacySqlitePreviewOut(BaseModel):
    transactions_count: int
    recurring_count: int
    min_transaction_date: Optional[date] = None
    max_transaction_date: Optional[date] = None
    non_midnight_transaction_times: int
    warnings: list[str]
    mapping_rows: list[LegacySqliteMappingRowOut]
    recurring_rows: list[LegacySqliteRecurringRowOut]


class LegacySqliteCategoryOut(BaseModel):
    id: int
    name: str
    type: str
    icon: Optional[str] = None


class LegacySqlitePreviewResponseOut(BaseModel):
    token: str
    preview: LegacySqlitePreviewOut
    categories: list[LegacySqliteCategoryOut]


class LegacySqliteCommitOut(BaseModel):
    result: dict[str, int]


class BulkSelectionQueryIn(BaseModel):
    period: Optional[str] = "all"
    start: Optional[date] = None
    end: Optional[date] = None
    type: Optional[TransactionType] = None
    category: Optional[int] = None
    matched_category_ids: Optional[list[int]] = None
    tag: Optional[int] = None
    q: Optional[str] = None


class BulkSelectionIn(BaseModel):
    mode: Literal["ids", "query"]
    transaction_ids: list[int] = Field(default_factory=list)
    query: Optional[BulkSelectionQueryIn] = None

    @model_validator(mode="after")
    def validate_selection(self) -> "BulkSelectionIn":
        if self.mode == "ids" and not self.transaction_ids:
            raise ValueError("transaction_ids required for ids mode")
        if self.mode == "query" and self.query is None:
            raise ValueError("query required for query mode")
        return self


class BulkTagPatchIn(BaseModel):
    mode: Literal["add", "remove", "replace", "clear"]
    tags: list[str] = Field(default_factory=list)


class BulkOperationIn(BaseModel):
    set_category_id: Optional[int] = None
    tag_patch: Optional[BulkTagPatchIn] = None
    lifecycle: Literal["none", "soft_delete", "restore"] = "none"

    @model_validator(mode="after")
    def validate_operation(self) -> "BulkOperationIn":
        if self.lifecycle != "none" and (
            self.set_category_id is not None or self.tag_patch is not None
        ):
            raise ValueError(
                "lifecycle operations cannot be combined with category/tag updates"
            )
        if (
            self.tag_patch
            and self.tag_patch.mode != "clear"
            and not self.tag_patch.tags
        ):
            raise ValueError("tag_patch.tags required unless mode is clear")
        return self


class BulkEditRequestIn(BaseModel):
    selection: BulkSelectionIn
    operation: BulkOperationIn


class BulkChangesOut(BaseModel):
    category_changed: int
    tags_added: int
    tags_removed: int
    tags_replaced: int
    deleted: int
    restored: int


class BulkEditResponseOut(BaseModel):
    resolved_count: int
    eligible_count: int
    skipped_count: int
    sample_ids: list[int] = Field(default_factory=list)
    changes: BulkChangesOut


class UncategorizedDefinitionOut(BaseModel):
    category_name: str
    matched_category_ids: list[int]


class UncategorizedTransactionsResponseOut(TransactionsResponseOut):
    total: int
    definition: UncategorizedDefinitionOut


class DigestHeadlineOut(BaseModel):
    total_spent_cents: int
    vs_last_week_cents: int
    vs_four_week_avg_cents: int
    transaction_count: int


class DigestCategoryOut(BaseModel):
    category_id: int
    name: str
    icon: Optional[str] = None
    amount_cents: int
    bar_percent: float
    trailing_weekly_avg_cents: int
    is_above_trailing_50: bool


class DigestBudgetPulseOut(BaseModel):
    scope_category_id: Optional[int] = None
    scope_label: str
    amount_cents: int
    spent_cents: int
    used_percent: float
    days_left: int
    velocity_ratio: float
    pace_state: Literal["under", "on", "over"]


class DigestCategoryRefOut(BaseModel):
    id: int
    name: str
    icon: Optional[str] = None


class DigestUnusualTransactionOut(BaseModel):
    id: int
    date: date
    title: str
    amount_cents: int
    trailing_avg_cents: int
    category: Optional[DigestCategoryRefOut] = None


class DigestRecurringPostingOut(BaseModel):
    transaction_id: int
    rule_id: Optional[int] = None
    rule_name: str
    date: date
    amount_cents: int
    category: Optional[DigestCategoryRefOut] = None


class DigestResponseOut(BaseModel):
    week_start: date
    week_end: date
    headline: DigestHeadlineOut
    top_categories: list[DigestCategoryOut]
    budget_pulse: list[DigestBudgetPulseOut]
    unusual_transactions: list[DigestUnusualTransactionOut]
    recurring_postings: list[DigestRecurringPostingOut]


class CategoryMergeIn(BaseModel):
    source_category_id: int
    target_category_id: int


class CategoryMergeResponseOut(BaseModel):
    counts: dict[str, int]


class TagMergeIn(BaseModel):
    source_tag_id: int
    target_tag_id: int


class TagMergeResponseOut(BaseModel):
    counts: dict[str, int]


class ReceiptAttachmentOut(BaseModel):
    id: int
    transaction_id: int
    original_filename: str
    mime_type: str
    size_bytes: int
    sha256_hex: str
    created_at: datetime


class ReceiptAttachmentsResponseOut(BaseModel):
    attachments: list[ReceiptAttachmentOut]
