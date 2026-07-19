from expenses.services.rollups import (
    rebuild_monthly_rollups,
    recompute_monthly_rollup,
    recompute_monthly_rollup_for_date,
)

__all__ = [
    "BalanceAnchorService",
    "BudgetService",
    "CSVService",
    "CategoryService",
    "DigestService",
    "DurablePurchaseService",
    "ForecastService",
    "get_current_user_id",
    "IngestCategoryAmbiguous",
    "IngestCategoryNotFound",
    "IngestService",
    "InsightsService",
    "MetricsService",
    "ReceiptAttachmentService",
    "RecurringRuleService",
    "rebuild_monthly_rollups",
    "recompute_monthly_rollup",
    "recompute_monthly_rollup_for_date",
    "ReimbursementService",
    "ReportService",
    "RuleService",
    "TagService",
    "TransactionFilters",
    "TransactionService",
    "TransactionTemplateService",
]

_MAIN_EXPORTS = {
    "BalanceAnchorService",
    "BudgetService",
    "CSVService",
    "CategoryService",
    "DigestService",
    "DurablePurchaseService",
    "ForecastService",
    "get_current_user_id",
    "IngestCategoryAmbiguous",
    "IngestCategoryNotFound",
    "IngestService",
    "InsightsService",
    "MetricsService",
    "ReceiptAttachmentService",
    "RecurringRuleService",
    "ReimbursementService",
    "ReportService",
    "RuleService",
    "TagService",
    "TransactionFilters",
    "TransactionService",
    "TransactionTemplateService",
}


def __getattr__(name: str):
    if name in _MAIN_EXPORTS:
        from expenses.services import main

        return getattr(main, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
