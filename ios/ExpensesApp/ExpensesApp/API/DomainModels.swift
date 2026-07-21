import Foundation

struct Period: Codable, Equatable {
    let slug: String
    let start: Date
    let end: Date
}

struct CategorySummary: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let type: String?
    let icon: String?
}

struct CategoryListItem: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let type: String
    let icon: String?
    let archivedAt: Date?
    let order: Int
    let usageCount: Int

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case type
        case icon
        case archivedAt = "archived_at"
        case order
        case usageCount = "usage_count"
    }
}

struct CategoriesResponse: Codable, Equatable {
    let period: Period
    let categories: [CategoryListItem]
}

struct TransactionTag: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
}

struct TagRow: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let color: String?
    let isHiddenFromBudget: Bool
    let usageCount: Int

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case color
        case isHiddenFromBudget = "is_hidden_from_budget"
        case usageCount = "usage_count"
    }
}

struct TagsResponse: Codable, Equatable {
    let period: Period
    let tags: [TagRow]
}

struct TemplateRow: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let type: String
    let categoryID: Int
    let category: CategorySummary?
    let defaultAmountCents: Int?
    let title: String?
    let tags: [String]
    let sortOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case type
        case categoryID = "category_id"
        case category
        case defaultAmountCents = "default_amount_cents"
        case title
        case tags
        case sortOrder = "sort_order"
    }
}

struct TemplatesResponse: Codable, Equatable {
    let templates: [TemplateRow]
}

struct RuleTag: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let isHiddenFromBudget: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case isHiddenFromBudget = "is_hidden_from_budget"
    }
}

struct RuleBudgetExcludeTag: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
}

struct RuleRow: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let enabled: Bool
    let priority: Int
    let matchType: String
    let matchValue: String
    let transactionType: String?
    let minAmountCents: Int?
    let maxAmountCents: Int?
    let setCategoryID: Int?
    let setCategory: CategorySummary?
    let addTags: [String]
    let budgetExcludeTagID: Int?
    let budgetExcludeTag: RuleBudgetExcludeTag?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case enabled
        case priority
        case matchType = "match_type"
        case matchValue = "match_value"
        case transactionType = "transaction_type"
        case minAmountCents = "min_amount_cents"
        case maxAmountCents = "max_amount_cents"
        case setCategoryID = "set_category_id"
        case setCategory = "set_category"
        case addTags = "add_tags"
        case budgetExcludeTagID = "budget_exclude_tag_id"
        case budgetExcludeTag = "budget_exclude_tag"
    }
}

struct RulesResponse: Codable, Equatable {
    let rules: [RuleRow]
    let categories: [CategorySummary]
    let tags: [RuleTag]
}

struct RuleMutationRequest: Codable, Equatable {
    let name: String
    let enabled: Bool
    let priority: Int
    let matchType: String
    let matchValue: String
    let transactionType: String?
    let minAmountCents: Int?
    let maxAmountCents: Int?
    let setCategoryID: Int?
    let addTags: [String]
    let budgetExcludeTagID: Int?

    enum CodingKeys: String, CodingKey {
        case name
        case enabled
        case priority
        case matchType = "match_type"
        case matchValue = "match_value"
        case transactionType = "transaction_type"
        case minAmountCents = "min_amount_cents"
        case maxAmountCents = "max_amount_cents"
        case setCategoryID = "set_category_id"
        case addTags = "add_tags"
        case budgetExcludeTagID = "budget_exclude_tag_id"
    }
}

struct RuleToggleRequest: Codable, Equatable {
    let enabled: Bool
}

struct RulePreviewSample: Codable, Equatable, Identifiable {
    let id: Int
    let title: String?
    let amountCents: Int
    let type: String
    let beforeCategory: String
    let afterCategory: String
    let addTags: [String]

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case amountCents = "amount_cents"
        case type
        case beforeCategory = "before_category"
        case afterCategory = "after_category"
        case addTags = "add_tags"
    }
}

struct RulePreview: Codable, Equatable {
    let matchesCount: Int
    let sample: [RulePreviewSample]

    enum CodingKeys: String, CodingKey {
        case matchesCount = "matches_count"
        case sample
    }
}

struct RuleSuggestion: Codable, Equatable, Identifiable {
    let id: Int
    let status: String
    let name: String
    let matchType: String
    let matchValue: String
    let transactionType: String?
    let minAmountCents: Int?
    let maxAmountCents: Int?
    let setCategoryID: Int?
    let setCategoryName: String?
    let addTags: [String]
    let confidence: Double
    let reason: String
    let evidenceTransactionIDs: [Int]
    let previewMatchesCount: Int

    enum CodingKeys: String, CodingKey {
        case id
        case status
        case name
        case matchType = "match_type"
        case matchValue = "match_value"
        case transactionType = "transaction_type"
        case minAmountCents = "min_amount_cents"
        case maxAmountCents = "max_amount_cents"
        case setCategoryID = "set_category_id"
        case setCategoryName = "set_category_name"
        case addTags = "add_tags"
        case confidence
        case reason
        case evidenceTransactionIDs = "evidence_transaction_ids"
        case previewMatchesCount = "preview_matches_count"
    }
}

struct BudgetCategory: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let type: String
    let icon: String?
    let archivedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case type
        case icon
        case archivedAt = "archived_at"
    }
}

struct BudgetScope: Codable, Equatable, Identifiable {
    var id: String { "\(scopeCategoryID.map(String.init) ?? "overall")-\(source)-\(sourceID)" }
    let scopeCategoryID: Int?
    let scopeLabel: String
    let amountCents: Int
    let source: String
    let sourceID: Int

    enum CodingKeys: String, CodingKey {
        case scopeCategoryID = "scope_category_id"
        case scopeLabel = "scope_label"
        case amountCents = "amount_cents"
        case source
        case sourceID = "source_id"
    }
}

struct BudgetProgress: Codable, Equatable, Identifiable {
    var id: String { scopeCategoryID.map(String.init) ?? "overall" }
    let scopeCategoryID: Int?
    let spentCents: Int
    let remainingCents: Int
    let velocityRatio: Double
    let dailyRemainingCents: Int
    let projectedTotalCents: Int
    let daysElapsed: Int
    let daysRemaining: Int

    enum CodingKeys: String, CodingKey {
        case scopeCategoryID = "scope_category_id"
        case spentCents = "spent_cents"
        case remainingCents = "remaining_cents"
        case velocityRatio = "velocity_ratio"
        case dailyRemainingCents = "daily_remaining_cents"
        case projectedTotalCents = "projected_total_cents"
        case daysElapsed = "days_elapsed"
        case daysRemaining = "days_remaining"
    }
}

struct BudgetTemplateRow: Codable, Equatable, Identifiable {
    let id: Int
    let frequency: String
    let category: CategorySummary?
    let amountCents: Int
    let startsOn: Date
    let endsOn: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case frequency
        case category
        case amountCents = "amount_cents"
        case startsOn = "starts_on"
        case endsOn = "ends_on"
    }
}

struct BudgetYearSpent: Codable, Equatable, Identifiable {
    var id: String { scopeCategoryID.map(String.init) ?? "overall" }
    let scopeCategoryID: Int?
    let spentCents: Int

    enum CodingKeys: String, CodingKey {
        case scopeCategoryID = "scope_category_id"
        case spentCents = "spent_cents"
    }
}

struct BudgetsResponse: Codable, Equatable {
    let view: String
    let year: Int
    let month: Int
    let monthValue: String
    let budgets: [BudgetScope]
    let progress: [BudgetProgress]
    let categories: [BudgetCategory]
    let templates: [BudgetTemplateRow]
    let yearValue: Int
    let yearlyBudgets: [BudgetScope]
    let yearlySpent: [BudgetYearSpent]
    let defaultMonthTemplateStart: Date
    let defaultYearTemplateStart: Date

    enum CodingKeys: String, CodingKey {
        case view
        case year
        case month
        case monthValue = "month_value"
        case budgets
        case progress
        case categories
        case templates
        case yearValue = "year_value"
        case yearlyBudgets = "yearly_budgets"
        case yearlySpent = "yearly_spent"
        case defaultMonthTemplateStart = "default_month_template_start"
        case defaultYearTemplateStart = "default_year_template_start"
    }
}

struct BudgetOverrideRequest: Codable, Equatable {
    let year: Int
    let month: Int
    let categoryID: Int?
    let amountCents: Int

    enum CodingKeys: String, CodingKey {
        case year
        case month
        case categoryID = "category_id"
        case amountCents = "amount_cents"
    }
}

struct BudgetTemplateRequest: Codable, Equatable {
    let frequency: String
    let categoryID: Int?
    let amountCents: Int
    let startsOn: String
    let endsOn: String?

    enum CodingKeys: String, CodingKey {
        case frequency
        case categoryID = "category_id"
        case amountCents = "amount_cents"
        case startsOn = "starts_on"
        case endsOn = "ends_on"
    }
}

struct BudgetBurndownTransaction: Codable, Equatable, Identifiable {
    let id: Int
    let title: String
    let amountCents: Int

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case amountCents = "amount_cents"
    }
}

struct BudgetBurndownTopDay: Codable, Equatable, Identifiable {
    let day: Int
    let date: Date?
    let totalCents: Int
    let transactions: [BudgetBurndownTransaction]

    var id: Int { day }

    enum CodingKeys: String, CodingKey {
        case day
        case date
        case totalCents = "total_cents"
        case transactions
    }
}

struct BudgetBurndownPoint: Codable, Equatable, Identifiable {
    let day: Int
    let cumulativeCents: Int

    var id: Int { day }

    enum CodingKeys: String, CodingKey {
        case day
        case cumulativeCents = "cumulative_cents"
    }
}

struct BudgetBurndownResponse: Codable, Equatable {
    let budgetAmountCents: Int
    let daysInMonth: Int
    let dailySeries: [BudgetBurndownPoint]
    let compareMonth: String?
    let compareDailySeries: [BudgetBurndownPoint]
    let topSpendingDays: [BudgetBurndownTopDay]

    enum CodingKeys: String, CodingKey {
        case budgetAmountCents = "budget_amount_cents"
        case daysInMonth = "days_in_month"
        case dailySeries = "daily_series"
        case compareMonth = "compare_month"
        case compareDailySeries = "compare_daily_series"
        case topSpendingDays = "top_spending_days"
    }
}

struct DigestHeadline: Codable, Equatable {
    let totalSpentCents: Int
    let vsLastWeekCents: Int
    let vsFourWeekAvgCents: Int
    let transactionCount: Int

    enum CodingKeys: String, CodingKey {
        case totalSpentCents = "total_spent_cents"
        case vsLastWeekCents = "vs_last_week_cents"
        case vsFourWeekAvgCents = "vs_four_week_avg_cents"
        case transactionCount = "transaction_count"
    }
}

struct DigestCategory: Codable, Equatable, Identifiable {
    var id: Int { categoryID }
    let categoryID: Int
    let name: String
    let icon: String?
    let amountCents: Int
    let barPercent: Double
    let trailingWeeklyAvgCents: Int
    let isAboveTrailing50: Bool

    enum CodingKeys: String, CodingKey {
        case categoryID = "category_id"
        case name
        case icon
        case amountCents = "amount_cents"
        case barPercent = "bar_percent"
        case trailingWeeklyAvgCents = "trailing_weekly_avg_cents"
        case isAboveTrailing50 = "is_above_trailing_50"
    }
}

struct DigestBudgetPulse: Codable, Equatable, Identifiable {
    var id: String { "\(scopeCategoryID.map(String.init) ?? "overall")-\(scopeLabel)" }
    let scopeCategoryID: Int?
    let scopeLabel: String
    let amountCents: Int
    let spentCents: Int
    let usedPercent: Double
    let daysLeft: Int
    let velocityRatio: Double
    let paceState: String

    enum CodingKeys: String, CodingKey {
        case scopeCategoryID = "scope_category_id"
        case scopeLabel = "scope_label"
        case amountCents = "amount_cents"
        case spentCents = "spent_cents"
        case usedPercent = "used_percent"
        case daysLeft = "days_left"
        case velocityRatio = "velocity_ratio"
        case paceState = "pace_state"
    }
}

struct DigestCategoryReference: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let icon: String?
}

struct DigestUnusualTransaction: Codable, Equatable, Identifiable {
    let id: Int
    let date: Date
    let title: String
    let amountCents: Int
    let trailingAvgCents: Int
    let category: DigestCategoryReference?

    enum CodingKeys: String, CodingKey {
        case id
        case date
        case title
        case amountCents = "amount_cents"
        case trailingAvgCents = "trailing_avg_cents"
        case category
    }
}

struct DigestRecurringPosting: Codable, Equatable, Identifiable {
    var id: Int { transactionID }
    let transactionID: Int
    let ruleID: Int?
    let ruleName: String
    let date: Date
    let amountCents: Int
    let category: DigestCategoryReference?

    enum CodingKeys: String, CodingKey {
        case transactionID = "transaction_id"
        case ruleID = "rule_id"
        case ruleName = "rule_name"
        case date
        case amountCents = "amount_cents"
        case category
    }
}

struct DigestResponse: Codable, Equatable {
    let weekStart: Date
    let weekEnd: Date
    let headline: DigestHeadline
    let topCategories: [DigestCategory]
    let budgetPulse: [DigestBudgetPulse]
    let unusualTransactions: [DigestUnusualTransaction]
    let recurringPostings: [DigestRecurringPosting]

    enum CodingKeys: String, CodingKey {
        case weekStart = "week_start"
        case weekEnd = "week_end"
        case headline
        case topCategories = "top_categories"
        case budgetPulse = "budget_pulse"
        case unusualTransactions = "unusual_transactions"
        case recurringPostings = "recurring_postings"
    }
}

struct ForecastRecurringRule: Codable, Equatable, Identifiable {
    var id: String { "\(ruleID.map(String.init) ?? name)-\(occurrenceDate.timeIntervalSince1970)" }
    let ruleID: Int?
    let name: String
    let type: String
    let amountCents: Int
    let occurrenceDate: Date
    let categoryID: Int?
    let categoryName: String?

    enum CodingKeys: String, CodingKey {
        case ruleID = "rule_id"
        case name
        case type
        case amountCents = "amount_cents"
        case occurrenceDate = "occurrence_date"
        case categoryID = "category_id"
        case categoryName = "category_name"
    }
}

struct ForecastVariableEstimate: Codable, Equatable, Identifiable {
    let categoryID: Int
    let name: String
    let icon: String?
    let amountCents: Int

    var id: Int { categoryID }

    enum CodingKeys: String, CodingKey {
        case categoryID = "category_id"
        case name
        case icon
        case amountCents = "amount_cents"
    }
}

struct ForecastOneTimeEvent: Codable, Equatable, Identifiable {
    var id: String { "\(type)-\(name)-\(amountCents)" }
    let name: String
    let type: String
    let amountCents: Int

    enum CodingKeys: String, CodingKey {
        case name
        case type
        case amountCents = "amount_cents"
    }
}

struct ForecastBreakdown: Codable, Equatable {
    let recurringRules: [ForecastRecurringRule]
    let variableEstimates: [ForecastVariableEstimate]
    let variableIncomeEstimates: [ForecastVariableEstimate]?
    let oneTimeEvents: [ForecastOneTimeEvent]

    enum CodingKeys: String, CodingKey {
        case recurringRules = "recurring_rules"
        case variableEstimates = "variable_estimates"
        case variableIncomeEstimates = "variable_income_estimates"
        case oneTimeEvents = "one_time_events"
    }
}

struct ForecastMonth: Codable, Equatable, Identifiable {
    var id: String { month }
    let month: String
    let projectedIncomeCents: Int
    let projectedExpensesCents: Int
    let projectedNetCents: Int
    let endBalanceCents: Int
    let endBalanceP10Cents: Int?
    let endBalanceP90Cents: Int?
    let minimumBalanceCents: Int?
    let crossesNegative: Bool
    let breakdown: ForecastBreakdown

    enum CodingKeys: String, CodingKey {
        case month
        case projectedIncomeCents = "projected_income_cents"
        case projectedExpensesCents = "projected_expenses_cents"
        case projectedNetCents = "projected_net_cents"
        case endBalanceCents = "end_balance_cents"
        case endBalanceP10Cents = "end_balance_p10_cents"
        case endBalanceP90Cents = "end_balance_p90_cents"
        case minimumBalanceCents = "minimum_balance_cents"
        case crossesNegative = "crosses_negative"
        case breakdown
    }
}

struct ForecastSummary: Codable, Equatable {
    let projectedBalanceCents: Int
    let projectedBalanceP10Cents: Int?
    let projectedBalanceP90Cents: Int?
    let averageMonthlyNetCents: Int
    let monthsUntilNegative: Int?
    let riskMonthsUntilNegative: Int?

    enum CodingKeys: String, CodingKey {
        case projectedBalanceCents = "projected_balance_cents"
        case projectedBalanceP10Cents = "projected_balance_p10_cents"
        case projectedBalanceP90Cents = "projected_balance_p90_cents"
        case averageMonthlyNetCents = "average_monthly_net_cents"
        case monthsUntilNegative = "months_until_negative"
        case riskMonthsUntilNegative = "risk_months_until_negative"
    }
}

struct ForecastModel: Codable, Equatable {
    let method: String
    let historyMonths: Int
    let seasonalityApplied: Bool
    let predictionIntervalAvailable: Bool

    enum CodingKeys: String, CodingKey {
        case method
        case historyMonths = "history_months"
        case seasonalityApplied = "seasonality_applied"
        case predictionIntervalAvailable = "prediction_interval_available"
    }
}

struct ForecastResponse: Codable, Equatable {
    let horizon: Int
    let mode: String
    let startBalanceCents: Int
    let currentMonthNetCents: Int?
    let months: [ForecastMonth]
    let model: ForecastModel?
    let summary: ForecastSummary

    enum CodingKeys: String, CodingKey {
        case horizon
        case mode
        case startBalanceCents = "start_balance_cents"
        case currentMonthNetCents = "current_month_net_cents"
        case months
        case model
        case summary
    }
}

struct ForecastScenarioModificationRequest: Encodable, Equatable, Identifiable {
    let id = UUID()
    let type: String
    var ruleID: Int?
    var name: String?
    var txType: String?
    var amountCents: Int?
    var interval: String?
    var newAmountCents: Int?
    var effectiveMonth: String?
    var month: String?
    var categoryID: Int?
    var newMonthlyCents: Int?

    init(
        type: String,
        ruleID: Int? = nil,
        name: String? = nil,
        txType: String? = nil,
        amountCents: Int? = nil,
        interval: String? = nil,
        newAmountCents: Int? = nil,
        effectiveMonth: String? = nil,
        month: String? = nil,
        categoryID: Int? = nil,
        newMonthlyCents: Int? = nil
    ) {
        self.type = type
        self.ruleID = ruleID
        self.name = name
        self.txType = txType
        self.amountCents = amountCents
        self.interval = interval
        self.newAmountCents = newAmountCents
        self.effectiveMonth = effectiveMonth
        self.month = month
        self.categoryID = categoryID
        self.newMonthlyCents = newMonthlyCents
    }

    enum CodingKeys: String, CodingKey {
        case type
        case ruleID = "rule_id"
        case name
        case txType = "tx_type"
        case amountCents = "amount_cents"
        case interval
        case newAmountCents = "new_amount_cents"
        case effectiveMonth = "effective_month"
        case month
        case categoryID = "category_id"
        case newMonthlyCents = "new_monthly_cents"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        try container.encodeIfPresent(ruleID, forKey: .ruleID)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(txType, forKey: .txType)
        try container.encodeIfPresent(amountCents, forKey: .amountCents)
        try container.encodeIfPresent(interval, forKey: .interval)
        try container.encodeIfPresent(newAmountCents, forKey: .newAmountCents)
        try container.encodeIfPresent(effectiveMonth, forKey: .effectiveMonth)
        try container.encodeIfPresent(month, forKey: .month)
        try container.encodeIfPresent(categoryID, forKey: .categoryID)
        try container.encodeIfPresent(newMonthlyCents, forKey: .newMonthlyCents)
    }
}

struct ForecastScenarioRequest: Encodable, Equatable {
    let horizon: Int
    let modifications: [ForecastScenarioModificationRequest]
}

struct ForecastProjection: Codable, Equatable {
    let mode: String
    let startBalanceCents: Int
    let currentMonthNetCents: Int?
    let months: [ForecastMonth]
    let model: ForecastModel?
    let summary: ForecastSummary

    enum CodingKeys: String, CodingKey {
        case mode
        case startBalanceCents = "start_balance_cents"
        case currentMonthNetCents = "current_month_net_cents"
        case months
        case model
        case summary
    }
}

struct ForecastScenarioMonthlyDelta: Codable, Equatable, Identifiable {
    var id: String { month }
    let month: String
    let deltaEndBalanceCents: Int

    enum CodingKeys: String, CodingKey {
        case month
        case deltaEndBalanceCents = "delta_end_balance_cents"
    }
}

struct ForecastScenarioModificationImpact: Codable, Equatable, Identifiable {
    var id: Int { index }
    let index: Int
    let label: String
    let finalDeltaCents: Int
    let averageMonthlyDeltaCents: Int
    let monthlyDelta: [ForecastScenarioMonthlyDelta]

    enum CodingKeys: String, CodingKey {
        case index
        case label
        case finalDeltaCents = "final_delta_cents"
        case averageMonthlyDeltaCents = "average_monthly_delta_cents"
        case monthlyDelta = "monthly_delta"
    }
}

struct ForecastScenarioImpact: Codable, Equatable {
    let finalDeltaCents: Int
    let averageMonthlyDeltaCents: Int
    let monthlyDelta: [ForecastScenarioMonthlyDelta]
    let byModification: [ForecastScenarioModificationImpact]

    enum CodingKeys: String, CodingKey {
        case finalDeltaCents = "final_delta_cents"
        case averageMonthlyDeltaCents = "average_monthly_delta_cents"
        case monthlyDelta = "monthly_delta"
        case byModification = "by_modification"
    }
}

struct ForecastScenarioResponse: Codable, Equatable {
    let horizon: Int
    let mode: String
    let startBalanceCents: Int
    let currentMonthNetCents: Int?
    let months: [ForecastMonth]
    let model: ForecastModel?
    let summary: ForecastSummary
    let baseline: ForecastProjection
    let impact: ForecastScenarioImpact

    enum CodingKeys: String, CodingKey {
        case horizon
        case mode
        case startBalanceCents = "start_balance_cents"
        case currentMonthNetCents = "current_month_net_cents"
        case months
        case model
        case summary
        case baseline
        case impact
    }
}

struct RecurringCategory: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let type: String?
    let icon: String?
}

struct RecurringBreakdown: Codable, Equatable, Identifiable {
    var id: String { name }
    let name: String
    let amountCents: Int
    let percent: Double

    enum CodingKeys: String, CodingKey {
        case name
        case amountCents = "amount_cents"
        case percent
    }
}

struct RecurringRuleCounts: Codable, Equatable {
    let income: Int
    let expense: Int
    let total: Int
}

struct RecurringStats: Codable, Equatable {
    let totalMonthlyIncome: Int
    let totalMonthlyExpenses: Int
    let netMonthly: Int
    let coverageRatio: Double
    let expenseBreakdown: [RecurringBreakdown]
    let incomeBreakdown: [RecurringBreakdown]
    let ruleCounts: RecurringRuleCounts

    enum CodingKeys: String, CodingKey {
        case totalMonthlyIncome = "total_monthly_income"
        case totalMonthlyExpenses = "total_monthly_expenses"
        case netMonthly = "net_monthly"
        case coverageRatio = "coverage_ratio"
        case expenseBreakdown = "expense_breakdown"
        case incomeBreakdown = "income_breakdown"
        case ruleCounts = "rule_counts"
    }
}

struct RecurringRule: Codable, Equatable, Identifiable {
    let id: Int
    let name: String?
    let type: String
    let currencyCode: String
    let amountCents: Int
    let monthlyEquivalentCents: Int?
    let categoryID: Int?
    let category: RecurringCategory?
    let anchorDate: Date
    let intervalUnit: String
    let intervalCount: Int
    let nextOccurrence: Date
    let endDate: Date?
    let autoPost: Bool
    let skipWeekends: Bool?
    let monthDayPolicy: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case type
        case currencyCode = "currency_code"
        case amountCents = "amount_cents"
        case monthlyEquivalentCents = "monthly_equivalent_cents"
        case categoryID = "category_id"
        case category
        case anchorDate = "anchor_date"
        case intervalUnit = "interval_unit"
        case intervalCount = "interval_count"
        case nextOccurrence = "next_occurrence"
        case endDate = "end_date"
        case autoPost = "auto_post"
        case skipWeekends = "skip_weekends"
        case monthDayPolicy = "month_day_policy"
    }
}

struct RecurringResponse: Codable, Equatable {
    let rules: [RecurringRule]
    let stats: RecurringStats
    let categories: [RecurringCategory]
}

struct RecurringRuleRequest: Codable, Equatable {
    let name: String?
    let type: String
    let currencyCode: String
    let amountCents: Int
    let categoryID: Int
    let anchorDate: String
    let intervalUnit: String
    let intervalCount: Int
    let nextOccurrence: String
    let endDate: String?
    let autoPost: Bool
    let skipWeekends: Bool
    let monthDayPolicy: String

    enum CodingKeys: String, CodingKey {
        case name
        case type
        case currencyCode = "currency_code"
        case amountCents = "amount_cents"
        case categoryID = "category_id"
        case anchorDate = "anchor_date"
        case intervalUnit = "interval_unit"
        case intervalCount = "interval_count"
        case nextOccurrence = "next_occurrence"
        case endDate = "end_date"
        case autoPost = "auto_post"
        case skipWeekends = "skip_weekends"
        case monthDayPolicy = "month_day_policy"
    }
}

struct RecurringPreviewRequest: Codable, Equatable {
    let startDate: String
    let intervalUnit: String
    let intervalCount: Int
    let monthDayPolicy: String
    let skipWeekends: Bool

    enum CodingKeys: String, CodingKey {
        case startDate = "start_date"
        case intervalUnit = "interval_unit"
        case intervalCount = "interval_count"
        case monthDayPolicy = "month_day_policy"
        case skipWeekends = "skip_weekends"
    }
}

struct RecurringPreviewResponse: Codable, Equatable {
    let occurrences: [Date]
    let error: String?
}

struct RecurringToggleRequest: Codable, Equatable {
    let autoPost: Bool

    enum CodingKeys: String, CodingKey {
        case autoPost = "auto_post"
    }
}

struct RecurringOccurrence: Codable, Equatable, Identifiable {
    let id: Int
    let occurrenceDate: Date?
    let amountCents: Int
    let category: RecurringCategory?
    let title: String?
    let createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case occurrenceDate = "occurrence_date"
        case amountCents = "amount_cents"
        case category
        case title
        case createdAt = "created_at"
    }
}

struct RecurringOccurrencesResponse: Codable, Equatable {
    let rule: RecurringRule
    let occurrences: [RecurringOccurrence]
}

struct CategoryCreateRequest: Codable, Equatable {
    let name: String
    let type: String
    let icon: String?
    let order: Int
}

struct CategoryUpdateRequest: Codable, Equatable {
    let name: String
    let icon: String?
    let order: Int
}

struct TagMutationRequest: Codable, Equatable {
    let name: String
    let color: String?
    let isHiddenFromBudget: Bool

    enum CodingKeys: String, CodingKey {
        case name
        case color
        case isHiddenFromBudget = "is_hidden_from_budget"
    }
}

struct CategoryMergeRequest: Codable, Equatable {
    let sourceCategoryID: Int
    let targetCategoryID: Int

    enum CodingKeys: String, CodingKey {
        case sourceCategoryID = "source_category_id"
        case targetCategoryID = "target_category_id"
    }
}

struct TagMergeRequest: Codable, Equatable {
    let sourceTagID: Int
    let targetTagID: Int

    enum CodingKeys: String, CodingKey {
        case sourceTagID = "source_tag_id"
        case targetTagID = "target_tag_id"
    }
}

struct MergeResponse: Codable, Equatable {
    let counts: [String: Int]
}

struct TemplateMutationRequest: Codable, Equatable {
    let name: String
    let type: String
    let categoryID: Int
    let defaultAmountCents: Int?
    let title: String?
    let tags: [String]

    enum CodingKeys: String, CodingKey {
        case name
        case type
        case categoryID = "category_id"
        case defaultAmountCents = "default_amount_cents"
        case title
        case tags
    }
}

struct TemplateReorderRequest: Codable, Equatable {
    let templateIDs: [Int]

    enum CodingKeys: String, CodingKey {
        case templateIDs = "template_ids"
    }
}

struct TransactionListItem: Codable, Equatable, Identifiable {
    let id: Int
    let date: Date
    let occurredAt: Date
    let type: String
    let amountCents: Int
    let netAmountCents: Int
    let reimbursedTotalCents: Int
    let isReimbursement: Bool
    let category: CategorySummary?
    let title: String?
    let description: String?
    let latitude: Double?
    let longitude: Double?
    let tags: [TransactionTag]
    let hasAttachments: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case date
        case occurredAt = "occurred_at"
        case type
        case amountCents = "amount_cents"
        case netAmountCents = "net_amount_cents"
        case reimbursedTotalCents = "reimbursed_total_cents"
        case isReimbursement = "is_reimbursement"
        case category
        case title
        case description
        case latitude
        case longitude
        case tags
        case hasAttachments = "has_attachments"
    }
}

struct TransactionSuggestion: Codable, Equatable, Identifiable {
    let id: Int
    let transactionID: Int
    let status: String
    let categoryID: Int?
    let categoryName: String?
    let cleanTitle: String?
    let tags: [String]
    let confidence: Double
    let reason: String

    enum CodingKeys: String, CodingKey {
        case id
        case transactionID = "transaction_id"
        case status
        case categoryID = "category_id"
        case categoryName = "category_name"
        case cleanTitle = "clean_title"
        case tags
        case confidence
        case reason
    }
}

struct TransactionDetail: Codable, Equatable, Identifiable {
    let id: Int
    let date: Date
    let occurredAt: Date?
    let type: String
    let amountCents: Int
    let categoryID: Int?
    let category: CategorySummary?
    let title: String
    let description: String?
    let latitude: Double?
    let longitude: Double?
    let isReimbursement: Bool
    let tags: [String]
    let durablePurchase: DurablePurchase?
    let attachments: [ReceiptAttachment]

    enum CodingKeys: String, CodingKey {
        case id
        case date
        case occurredAt = "occurred_at"
        case type
        case amountCents = "amount_cents"
        case categoryID = "category_id"
        case category
        case title
        case description
        case latitude
        case longitude
        case isReimbursement = "is_reimbursement"
        case tags
        case durablePurchase = "durable_purchase"
        case attachments
    }
}

struct DurablePurchase: Codable, Equatable {
    let expectedLifespanDays: Int
    let acquiredOn: Date

    enum CodingKeys: String, CodingKey {
        case expectedLifespanDays = "expected_lifespan_days"
        case acquiredOn = "acquired_on"
    }
}

struct ReceiptAttachment: Codable, Equatable, Identifiable {
    let id: Int
    let transactionID: Int
    let originalFilename: String
    let mimeType: String
    let sizeBytes: Int
    let sha256Hex: String
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case transactionID = "transaction_id"
        case originalFilename = "original_filename"
        case mimeType = "mime_type"
        case sizeBytes = "size_bytes"
        case sha256Hex = "sha256_hex"
        case createdAt = "created_at"
    }
}

struct ReceiptAttachmentsResponse: Codable, Equatable {
    let attachments: [ReceiptAttachment]
}

struct AttachmentDownload: Equatable {
    let data: Data
    let filename: String
    let mimeType: String
}

struct ReimbursementTransactionCategory: Codable, Equatable {
    let id: Int
    let name: String
    let type: String
}

struct ReimbursementTransactionSummary: Codable, Equatable, Identifiable {
    let id: Int
    let date: Date
    let title: String?
    let deletedAt: Date?
    let category: ReimbursementTransactionCategory?

    enum CodingKeys: String, CodingKey {
        case id
        case date
        case title
        case deletedAt = "deleted_at"
        case category
    }
}

struct ReimbursementAllocationOut: Codable, Equatable, Identifiable {
    var id: Int { allocationID }
    let allocationID: Int
    let amountCents: Int
    let expenseTransaction: ReimbursementTransactionSummary

    enum CodingKeys: String, CodingKey {
        case allocationID = "allocation_id"
        case amountCents = "amount_cents"
        case expenseTransaction = "expense_transaction"
    }
}

struct ReimbursementAllocationInRow: Codable, Equatable, Identifiable {
    var id: Int { allocationID }
    let allocationID: Int
    let amountCents: Int
    let reimbursementTransaction: ReimbursementTransactionSummary

    enum CodingKeys: String, CodingKey {
        case allocationID = "allocation_id"
        case amountCents = "amount_cents"
        case reimbursementTransaction = "reimbursement_transaction"
    }
}

struct TransactionReimbursementsResponse: Codable, Equatable {
    let mode: String
    let isReimbursement: Bool?
    let allocatedTotalCents: Int?
    let remainingToAllocateCents: Int?
    let allocationsOut: [ReimbursementAllocationOut]?
    let reimbursedTotalCents: Int?
    let netCostCents: Int?
    let allocationsIn: [ReimbursementAllocationInRow]?

    enum CodingKeys: String, CodingKey {
        case mode
        case isReimbursement = "is_reimbursement"
        case allocatedTotalCents = "allocated_total_cents"
        case remainingToAllocateCents = "remaining_to_allocate_cents"
        case allocationsOut = "allocations_out"
        case reimbursedTotalCents = "reimbursed_total_cents"
        case netCostCents = "net_cost_cents"
        case allocationsIn = "allocations_in"
    }
}

struct ReimbursementExpenseSummary: Codable, Equatable, Identifiable {
    let id: Int
    let date: Date
    let amountCents: Int
    let title: String?
    let category: ReimbursementTransactionCategory?

    enum CodingKeys: String, CodingKey {
        case id
        case date
        case amountCents = "amount_cents"
        case title
        case category
    }
}

struct ReimbursementExpenseSearchItem: Codable, Equatable, Identifiable {
    var id: Int { expense.id }
    let expense: ReimbursementExpenseSummary
    let reimbursedTotalCents: Int
    let remainingUnreimbursedCents: Int
    let allocatedToThisCents: Int
    let suggestedAmountCents: Int

    enum CodingKeys: String, CodingKey {
        case expense
        case reimbursedTotalCents = "reimbursed_total_cents"
        case remainingUnreimbursedCents = "remaining_unreimbursed_cents"
        case allocatedToThisCents = "allocated_to_this_cents"
        case suggestedAmountCents = "suggested_amount_cents"
    }
}

struct ReimbursementExpenseSearchResponse: Codable, Equatable {
    let results: [ReimbursementExpenseSearchItem]
}

struct ReimbursementAllocationRequest: Codable, Equatable {
    let expenseTransactionID: Int
    let amountCents: Int

    enum CodingKeys: String, CodingKey {
        case expenseTransactionID = "expense_transaction_id"
        case amountCents = "amount_cents"
    }
}

struct AllocationIDResponse: Codable, Equatable {
    let allocationID: Int

    enum CodingKeys: String, CodingKey {
        case allocationID = "allocation_id"
    }
}

struct TransactionsResponse: Codable, Equatable {
    let items: [TransactionListItem]
    let page: Int
    let limit: Int
    let hasMore: Bool
    let period: Period
    let filters: TransactionFilters
    let categories: [CategorySummary]
    let tags: [TransactionTag]

    enum CodingKeys: String, CodingKey {
        case items
        case page
        case limit
        case hasMore = "has_more"
        case period
        case filters
        case categories
        case tags
    }
}

struct UncategorizedDefinition: Codable, Equatable {
    let categoryName: String
    let matchedCategoryIDs: [Int]

    enum CodingKeys: String, CodingKey {
        case categoryName = "category_name"
        case matchedCategoryIDs = "matched_category_ids"
    }
}

struct UncategorizedTransactionsResponse: Codable, Equatable {
    let items: [TransactionListItem]
    let page: Int
    let limit: Int
    let hasMore: Bool
    let total: Int
    let definition: UncategorizedDefinition
    let period: Period
    let filters: TransactionFilters
    let categories: [CategorySummary]
    let tags: [TransactionTag]

    enum CodingKeys: String, CodingKey {
        case items
        case page
        case limit
        case hasMore = "has_more"
        case total
        case definition
        case period
        case filters
        case categories
        case tags
    }
}

struct DeletedTransaction: Codable, Equatable, Identifiable {
    let id: Int
    let date: Date
    let type: String
    let amountCents: Int
    let category: CategorySummary?
    let title: String?
    let description: String?
    let deletedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case date
        case type
        case amountCents = "amount_cents"
        case category
        case title
        case description
        case deletedAt = "deleted_at"
    }
}

struct DeletedTransactionsResponse: Codable, Equatable {
    let transactions: [DeletedTransaction]
}

struct TransactionFilters: Codable, Equatable {
    let type: String?
    let categoryID: Int?
    let tagID: Int?
    let query: String?

    enum CodingKeys: String, CodingKey {
        case type
        case categoryID = "category_id"
        case tagID = "tag_id"
        case query
    }
}

struct TransactionMutationRequest: Codable, Equatable {
    let date: String
    let occurredAt: String
    let type: String
    let isReimbursement: Bool
    let amountCents: Int
    let categoryID: Int?
    let title: String
    let description: String?
    let latitude: Double?
    let longitude: Double?
    let tags: [String]

    enum CodingKeys: String, CodingKey {
        case date
        case occurredAt = "occurred_at"
        case type
        case isReimbursement = "is_reimbursement"
        case amountCents = "amount_cents"
        case categoryID = "category_id"
        case title
        case description
        case latitude
        case longitude
        case tags
    }
}

struct BulkSelectionQueryRequest: Codable, Equatable {
    let period: String
    let start: String?
    let end: String?
    let type: String?
    let category: Int?
    let matchedCategoryIDs: [Int]?
    let tag: Int?
    let q: String?

    enum CodingKeys: String, CodingKey {
        case period
        case start
        case end
        case type
        case category
        case matchedCategoryIDs = "matched_category_ids"
        case tag
        case q
    }
}

struct BulkSelectionRequest: Codable, Equatable {
    let mode: String
    let transactionIDs: [Int]
    let query: BulkSelectionQueryRequest?

    enum CodingKeys: String, CodingKey {
        case mode
        case transactionIDs = "transaction_ids"
        case query
    }
}

struct BulkTagPatchRequest: Codable, Equatable {
    let mode: String
    let tags: [String]
}

struct BulkOperationRequest: Codable, Equatable {
    let setCategoryID: Int?
    let tagPatch: BulkTagPatchRequest?
    let lifecycle: String

    enum CodingKeys: String, CodingKey {
        case setCategoryID = "set_category_id"
        case tagPatch = "tag_patch"
        case lifecycle
    }
}

struct BulkEditRequest: Codable, Equatable {
    let selection: BulkSelectionRequest
    let operation: BulkOperationRequest
}

struct BulkEditChanges: Codable, Equatable {
    let categoryChanged: Int
    let tagsAdded: Int
    let tagsRemoved: Int
    let tagsReplaced: Int
    let deleted: Int
    let restored: Int

    enum CodingKeys: String, CodingKey {
        case categoryChanged = "category_changed"
        case tagsAdded = "tags_added"
        case tagsRemoved = "tags_removed"
        case tagsReplaced = "tags_replaced"
        case deleted
        case restored
    }
}

struct BulkEditResponse: Codable, Equatable {
    let resolvedCount: Int
    let eligibleCount: Int
    let skippedCount: Int
    let sampleIDs: [Int]
    let changes: BulkEditChanges

    enum CodingKeys: String, CodingKey {
        case resolvedCount = "resolved_count"
        case eligibleCount = "eligible_count"
        case skippedCount = "skipped_count"
        case sampleIDs = "sample_ids"
        case changes
    }
}

struct IDResponse: Codable, Equatable {
    let id: Int
}

struct DashboardResponse: Codable, Equatable {
    let period: Period
    let filters: DashboardFilters
    let kpis: DashboardKPIs
    let sparklines: DashboardSparklines
    let deltas: DashboardKPIs?
    let donut: DashboardDonut
    let recent: [TransactionListItem]
    let categories: [CategorySummary]
    let tags: [TransactionTag]
    let durablePurchases: [DashboardDurablePurchase]?
    let budgetPace: DashboardBudgetPace?
    let categoryBudgetPulse: [DashboardCategoryBudgetPulse]?
    let categoryBudgetSummary: DashboardCategoryBudgetSummary?

    enum CodingKeys: String, CodingKey {
        case period
        case filters
        case kpis
        case sparklines
        case deltas
        case donut
        case recent
        case categories
        case tags
        case durablePurchases = "durable_purchases"
        case budgetPace = "budget_pace"
        case categoryBudgetPulse = "category_budget_pulse"
        case categoryBudgetSummary = "category_budget_summary"
    }
}

struct DashboardFilters: Codable, Equatable {
    let type: String?
}

struct DashboardKPIs: Codable, Equatable {
    let income: Int
    let expenses: Int
    let balance: Int
}

struct DashboardSparklines: Codable, Equatable {
    let income: String?
    let expenses: String?
    let balance: String?
}

struct DashboardDonut: Codable, Equatable {
    let hasAnyTransactions: Bool
    let mode: String?
    let expenseBreakdown: [BreakdownItem]?
    let incomeBreakdown: [BreakdownItem]?

    enum CodingKeys: String, CodingKey {
        case hasAnyTransactions = "has_any_transactions"
        case mode
        case expenseBreakdown = "expense_breakdown"
        case incomeBreakdown = "income_breakdown"
    }
}

struct BreakdownItem: Codable, Equatable, Identifiable {
    var id: String { name }
    let name: String
    let amountCents: Int
    let percent: Double

    enum CodingKeys: String, CodingKey {
        case name
        case amountCents = "amount_cents"
        case percent
    }
}

struct DashboardDurablePurchase: Codable, Equatable, Identifiable {
    let id: Int
    let transactionID: Int
    let expectedLifespanDays: Int
    let acquiredOn: Date
    let daysOwned: Int
    let costPerDayCents: Double
    let amortizedCents: Int
    let remainingCents: Int
    let percentAmortized: Double
    let fullyAmortized: Bool
    let paidForItselfOn: Date
    let originalAmountCents: Int
    let title: String?
    let category: CategorySummary?

    enum CodingKeys: String, CodingKey {
        case id
        case transactionID = "transaction_id"
        case expectedLifespanDays = "expected_lifespan_days"
        case acquiredOn = "acquired_on"
        case daysOwned = "days_owned"
        case costPerDayCents = "cost_per_day_cents"
        case amortizedCents = "amortized_cents"
        case remainingCents = "remaining_cents"
        case percentAmortized = "percent_amortized"
        case fullyAmortized = "fully_amortized"
        case paidForItselfOn = "paid_for_itself_on"
        case originalAmountCents = "original_amount_cents"
        case title
        case category
    }
}

struct DurablePurchasesResponse: Codable, Equatable {
    let items: [DashboardDurablePurchase]
}

struct InsightsFilters: Codable, Equatable {
    let type: String?
    let tagID: Int?

    enum CodingKeys: String, CodingKey {
        case type
        case tagID = "tag_id"
    }
}

struct InsightsCategory: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let type: String
    let icon: String?
}

struct InsightsMonthlySeriesPoint: Codable, Equatable, Identifiable {
    var id: String { label }
    let year: Int
    let month: Int
    let label: String
    let incomeCents: Int
    let expenseCents: Int
    let netCents: Int

    enum CodingKeys: String, CodingKey {
        case year
        case month
        case label
        case incomeCents = "income_cents"
        case expenseCents = "expense_cents"
        case netCents = "net_cents"
    }
}

struct InsightsDeltaItem: Codable, Equatable, Identifiable {
    var id: Int { categoryID }
    let categoryID: Int
    let categoryName: String
    let currentCents: Int
    let previousCents: Int
    let deltaCents: Int

    enum CodingKeys: String, CodingKey {
        case categoryID = "category_id"
        case categoryName = "category_name"
        case currentCents = "current_cents"
        case previousCents = "previous_cents"
        case deltaCents = "delta_cents"
    }
}

struct InsightsDeltas: Codable, Equatable {
    let increases: [InsightsDeltaItem]
    let decreases: [InsightsDeltaItem]
}

struct InsightsTopTag: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let amountCents: Int

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case amountCents = "amount_cents"
    }
}

struct InsightsTrendPoint: Codable, Equatable, Identifiable {
    var id: String { label }
    let year: Int
    let month: Int
    let label: String
    let amountCents: Int

    enum CodingKeys: String, CodingKey {
        case year
        case month
        case label
        case amountCents = "amount_cents"
    }
}

struct InsightsBudgetEffective: Codable, Equatable, Identifiable {
    var id: String { "\(scopeCategoryID.map(String.init) ?? "overall")-\(source)-\(sourceID)" }
    let scopeCategoryID: Int?
    let scopeLabel: String
    let amountCents: Int
    let source: String
    let sourceID: Int

    enum CodingKeys: String, CodingKey {
        case scopeCategoryID = "scope_category_id"
        case scopeLabel = "scope_label"
        case amountCents = "amount_cents"
        case source
        case sourceID = "source_id"
    }
}

struct InsightsBudgetProgress: Codable, Equatable {
    let spentCents: Int
    let remainingCents: Int

    enum CodingKeys: String, CodingKey {
        case spentCents = "spent_cents"
        case remainingCents = "remaining_cents"
    }
}

struct InsightsResponse: Codable, Equatable {
    let period: Period
    let filters: InsightsFilters
    let tags: [TransactionTag]
    let categories: [InsightsCategory]
    let series: [InsightsMonthlySeriesPoint]
    let expenseBreakdown: [BreakdownItem]
    let incomeBreakdown: [BreakdownItem]
    let deltas: InsightsDeltas
    let topTags: [InsightsTopTag]
    let trendCategoryID: Int?
    let trend: [InsightsTrendPoint]
    let budgetMonth: String
    let budgetEffective: [InsightsBudgetEffective]
    let budgetProgress: [String: InsightsBudgetProgress]

    enum CodingKeys: String, CodingKey {
        case period
        case filters
        case tags
        case categories
        case series
        case expenseBreakdown = "expense_breakdown"
        case incomeBreakdown = "income_breakdown"
        case deltas
        case topTags = "top_tags"
        case trendCategoryID = "trend_category_id"
        case trend
        case budgetMonth = "budget_month"
        case budgetEffective = "budget_effective"
        case budgetProgress = "budget_progress"
    }
}

struct InsightsFlowNode: Codable, Equatable, Identifiable {
    let id: String
    let label: String
    let type: String
    let amountCents: Int
    let categoryID: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case label
        case type
        case amountCents = "amount_cents"
        case categoryID = "category_id"
    }
}

struct InsightsFlowLink: Codable, Equatable, Identifiable {
    var id: String { "\(from)-\(to)" }
    let from: String
    let to: String
    let amountCents: Int

    enum CodingKeys: String, CodingKey {
        case from
        case to
        case amountCents = "amount_cents"
    }
}

struct InsightsFlowResponse: Codable, Equatable {
    let period: Period
    let filters: InsightsFilters
    let nodes: [InsightsFlowNode]
    let links: [InsightsFlowLink]
}

struct ReportOptionsRequest: Codable, Equatable {
    let start: String
    let end: String
    let sections: [String]
    let includeCents: Bool
    let notes: String?
    let transactionType: String?
    let categoryIDs: [Int]?
    let transactionsSort: String
    let showRunningBalance: Bool
    let includeCategorySubtotals: Bool

    enum CodingKeys: String, CodingKey {
        case start
        case end
        case sections
        case includeCents = "include_cents"
        case notes
        case transactionType = "transaction_type"
        case categoryIDs = "category_ids"
        case transactionsSort = "transactions_sort"
        case showRunningBalance = "show_running_balance"
        case includeCategorySubtotals = "include_category_subtotals"
    }
}

struct BankStatementPreviewRow: Codable, Equatable, Identifiable {
    var id: String { "\(bookingDate.timeIntervalSince1970)-\(amountCents)-\(rawDescription)" }
    let bookingDate: Date
    let valueDate: Date?
    let amountCents: Int
    let currency: String
    let payee: String?
    let bookingText: String?
    let purpose: String?
    let rawDescription: String
    let duplicate: Bool

    enum CodingKeys: String, CodingKey {
        case bookingDate = "booking_date"
        case valueDate = "value_date"
        case amountCents = "amount_cents"
        case currency
        case payee
        case bookingText = "booking_text"
        case purpose
        case rawDescription = "raw_description"
        case duplicate
    }
}

struct BankStatementPreviewResponse: Codable, Equatable {
    let accountLabel: String
    let rows: [BankStatementPreviewRow]
    let errors: [String]
    let newCount: Int
    let duplicateCount: Int

    enum CodingKeys: String, CodingKey {
        case accountLabel = "account_label"
        case rows
        case errors
        case newCount = "new_count"
        case duplicateCount = "duplicate_count"
    }
}

struct BankStatementImportResponse: Codable, Equatable {
    let importedCount: Int
    let duplicateCount: Int

    enum CodingKeys: String, CodingKey {
        case importedCount = "imported_count"
        case duplicateCount = "duplicate_count"
    }
}

struct BankReconciliationSummary: Codable, Equatable {
    let rowCount: Int
    let unresolvedCount: Int
    let suggestedCount: Int
    let matchedCount: Int
    let reviewedCount: Int
    let bankTotalCents: Int
    let onlyInExpensesCount: Int

    enum CodingKeys: String, CodingKey {
        case rowCount = "row_count"
        case unresolvedCount = "unresolved_count"
        case suggestedCount = "suggested_count"
        case matchedCount = "matched_count"
        case reviewedCount = "reviewed_count"
        case bankTotalCents = "bank_total_cents"
        case onlyInExpensesCount = "only_in_expenses_count"
    }
}

struct BankReconciliationTransaction: Codable, Equatable, Identifiable {
    let id: Int
    let date: Date
    let type: String
    let amountCents: Int
    let signedAmountCents: Int
    let title: String?
    let category: String?
    let dateDeltaDays: Int

    enum CodingKeys: String, CodingKey {
        case id
        case date
        case type
        case amountCents = "amount_cents"
        case signedAmountCents = "signed_amount_cents"
        case title
        case category
        case dateDeltaDays = "date_delta_days"
    }
}

struct BankStatementRow: Codable, Equatable, Identifiable {
    let id: Int
    let accountLabel: String
    let bookingDate: Date
    let valueDate: Date?
    let amountCents: Int
    let currency: String
    let payee: String?
    let bookingText: String?
    let purpose: String?
    let rawDescription: String
    let reviewedAt: Date?
    let status: String
    let candidateCount: Int
    let suggestedTransaction: BankReconciliationTransaction?

    enum CodingKeys: String, CodingKey {
        case id
        case accountLabel = "account_label"
        case bookingDate = "booking_date"
        case valueDate = "value_date"
        case amountCents = "amount_cents"
        case currency
        case payee
        case bookingText = "booking_text"
        case purpose
        case rawDescription = "raw_description"
        case reviewedAt = "reviewed_at"
        case status
        case candidateCount = "candidate_count"
        case suggestedTransaction = "suggested_transaction"
    }
}

struct BankReconciliationResponse: Codable, Equatable {
    let summary: BankReconciliationSummary
    let rows: [BankStatementRow]
    let onlyInExpenses: [BankReconciliationTransaction]

    enum CodingKeys: String, CodingKey {
        case summary
        case rows
        case onlyInExpenses = "only_in_expenses"
    }
}

struct BankRowActionResponse: Codable, Equatable {
    let status: String?
    let transactionID: Int?

    enum CodingKeys: String, CodingKey {
        case status
        case transactionID = "transaction_id"
    }
}

struct DashboardBudgetPace: Codable, Equatable {
    let velocityRatio: Double
    let projectedCents: Int
    let budgetCents: Int
    let sparkline: String

    enum CodingKeys: String, CodingKey {
        case velocityRatio = "velocity_ratio"
        case projectedCents = "projected_cents"
        case budgetCents = "budget_cents"
        case sparkline
    }
}

struct DashboardCategoryBudgetPulse: Codable, Equatable, Identifiable {
    var id: Int { scopeCategoryID }
    let scopeCategoryID: Int
    let scopeLabel: String
    let amountCents: Int
    let spentCents: Int
    let remainingCents: Int
    let velocityRatio: Double

    enum CodingKeys: String, CodingKey {
        case scopeCategoryID = "scope_category_id"
        case scopeLabel = "scope_label"
        case amountCents = "amount_cents"
        case spentCents = "spent_cents"
        case remainingCents = "remaining_cents"
        case velocityRatio = "velocity_ratio"
    }
}

struct DashboardCategoryBudgetSummary: Codable, Equatable {
    let total: Int
    let needsAttention: Int
    let priority: DashboardCategoryBudgetPulse

    enum CodingKeys: String, CodingKey {
        case total
        case needsAttention = "needs_attention"
        case priority
    }
}

struct AdminInfo: Codable, Equatable {
    let appVersion: String
    let environment: String
    let dbPath: String
    let dbSizeMB: Double
    let dbModified: Date?
    let logPath: String
    let logSizeMB: Double
    let logModified: Date?
    let logRetainedFiles: Int
    let usersCount: Int

    enum CodingKeys: String, CodingKey {
        case appVersion = "app_version"
        case environment
        case dbPath = "db_path"
        case dbSizeMB = "db_size_mb"
        case dbModified = "db_modified"
        case logPath = "log_path"
        case logSizeMB = "log_size_mb"
        case logModified = "log_modified"
        case logRetainedFiles = "log_retained_files"
        case usersCount = "users_count"
    }
}

struct AdminSystemHealth: Codable, Equatable {
    let cpuTempCelsius: Double?
    let cpuLoadPercent: Double
    let ramUsedBytes: Int
    let ramTotalBytes: Int
    let diskUsedBytes: Int
    let diskTotalBytes: Int
    let diskFreeBytes: Int
    let dbSizeBytes: Int
    let receiptsSizeBytes: Int
    let status: String

    var ramUsagePercent: Double {
        guard ramTotalBytes > 0 else {
            return 0
        }
        return Double(ramUsedBytes) / Double(ramTotalBytes) * 100
    }

    var diskUsagePercent: Double {
        guard diskTotalBytes > 0 else {
            return 0
        }
        return Double(diskUsedBytes) / Double(diskTotalBytes) * 100
    }

    enum CodingKeys: String, CodingKey {
        case cpuTempCelsius = "cpu_temp_celsius"
        case cpuLoadPercent = "cpu_load_percent"
        case ramUsedBytes = "ram_used_bytes"
        case ramTotalBytes = "ram_total_bytes"
        case diskUsedBytes = "disk_used_bytes"
        case diskTotalBytes = "disk_total_bytes"
        case diskFreeBytes = "disk_free_bytes"
        case dbSizeBytes = "db_size_bytes"
        case receiptsSizeBytes = "receipts_size_bytes"
        case status
    }
}

struct AdminLogsResponse: Decodable, Equatable {
    let entries: [AdminLogEntry]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case entries
        case nextCursor = "next_cursor"
    }
}

enum AdminLogFilter: String, CaseIterable, Equatable, Identifiable {
    case errors
    case ingest
    case imports
    case scheduler
    case all

    var id: String { rawValue }

    var label: String {
        switch self {
        case .errors:
            "Errors"
        case .ingest:
            "Ingest"
        case .imports:
            "Imports"
        case .scheduler:
            "Scheduler"
        case .all:
            "All"
        }
    }
}

struct AdminLogEntry: Decodable, Equatable, Identifiable {
    var id: String { "\(timestamp)-\(event)-\(requestID ?? "")" }

    let timestamp: String
    let level: String
    let logger: String?
    let event: String
    let requestID: String?
    let method: String?
    let path: String?
    let route: String?
    let statusCode: Int?
    let durationMS: Double?
    let rawBody: String?
    let payload: [String: JSONValue]

    enum KnownKeys: String, CodingKey {
        case timestamp
        case level
        case logger
        case event
        case requestID = "request_id"
        case method
        case path
        case route
        case statusCode = "status_code"
        case durationMS = "duration_ms"
        case rawBody = "raw_body"
    }

    init(from decoder: Decoder) throws {
        let known = try decoder.container(keyedBy: KnownKeys.self)
        timestamp = try known.decodeIfPresent(String.self, forKey: .timestamp) ?? "-"
        level = try known.decodeIfPresent(String.self, forKey: .level) ?? "INFO"
        logger = try known.decodeIfPresent(String.self, forKey: .logger)
        event = try known.decodeIfPresent(String.self, forKey: .event) ?? "log_entry"
        requestID = try known.decodeIfPresent(String.self, forKey: .requestID)
        method = try known.decodeIfPresent(String.self, forKey: .method)
        path = try known.decodeIfPresent(String.self, forKey: .path)
        route = try known.decodeIfPresent(String.self, forKey: .route)
        statusCode = try known.decodeIfPresent(Int.self, forKey: .statusCode)
        durationMS = try known.decodeIfPresent(Double.self, forKey: .durationMS)
        rawBody = try known.decodeIfPresent(String.self, forKey: .rawBody)

        let dynamic = try decoder.container(keyedBy: DynamicCodingKey.self)
        var values: [String: JSONValue] = [:]
        for key in dynamic.allKeys {
            values[key.stringValue] = try dynamic.decode(JSONValue.self, forKey: key)
        }
        payload = values
    }

    func prettyPayload() -> String {
        JSONValue.object(payload).prettyDescription()
    }
}

struct AdminPurgeDeletedRequest: Codable, Equatable {
    let days: Int
}

struct AdminPurgeDeletedResponse: Codable, Equatable {
    let status: String
    let count: Int
    let attachmentsCount: Int

    enum CodingKeys: String, CodingKey {
        case status
        case count
        case attachmentsCount = "attachments_count"
    }
}

struct AdminRebuildRollupsResponse: Codable, Equatable {
    let status: String
    let rebuiltUsers: Int

    enum CodingKeys: String, CodingKey {
        case status
        case rebuiltUsers = "rebuilt_users"
    }
}

struct AdminRecurringCatchUpResponse: Codable, Equatable {
    let status: String
    let advancedRules: Int
    let overdueRules: Int
    let updated: Bool

    enum CodingKeys: String, CodingKey {
        case status
        case advancedRules = "advanced_rules"
        case overdueRules = "overdue_rules"
        case updated
    }
}

struct LegacySQLitePreviewResponse: Codable, Equatable {
    let token: String
    let preview: LegacySQLitePreview
    let categories: [LegacySQLiteCategory]
}

struct LegacySQLitePreview: Codable, Equatable {
    let transactionsCount: Int
    let recurringCount: Int
    let minTransactionDate: Date?
    let maxTransactionDate: Date?
    let nonMidnightTransactionTimes: Int
    let warnings: [String]
    let mappingRows: [LegacySQLiteMappingRow]
    let recurringRows: [LegacySQLiteRecurringRow]

    enum CodingKeys: String, CodingKey {
        case transactionsCount = "transactions_count"
        case recurringCount = "recurring_count"
        case minTransactionDate = "min_transaction_date"
        case maxTransactionDate = "max_transaction_date"
        case nonMidnightTransactionTimes = "non_midnight_transaction_times"
        case warnings
        case mappingRows = "mapping_rows"
        case recurringRows = "recurring_rows"
    }
}

struct LegacySQLiteMappingRow: Codable, Equatable, Identifiable {
    var id: Int { idx }

    let idx: Int
    let legacyType: String
    let legacyCategory: String
    let transactionCount: Int
    let suggestedCategoryID: Int?
    let suggestedCategoryName: String?

    enum CodingKeys: String, CodingKey {
        case idx
        case legacyType = "legacy_type"
        case legacyCategory = "legacy_category"
        case transactionCount = "transaction_count"
        case suggestedCategoryID = "suggested_category_id"
        case suggestedCategoryName = "suggested_category_name"
    }
}

struct LegacySQLiteRecurringRow: Codable, Equatable, Identifiable {
    var id: String { "\(description)-\(legacyType)-\(legacyCategory)-\(startDate)" }

    let description: String
    let legacyType: String
    let legacyCategory: String
    let amountCents: Int
    let startDate: Date
    let recurrenceType: String
    let interval: Int
    let lastProcessedDate: Date?
    let computedNextOccurrence: Date?

    enum CodingKeys: String, CodingKey {
        case description
        case legacyType = "legacy_type"
        case legacyCategory = "legacy_category"
        case amountCents = "amount_cents"
        case startDate = "start_date"
        case recurrenceType = "recurrence_type"
        case interval
        case lastProcessedDate = "last_processed_date"
        case computedNextOccurrence = "computed_next_occurrence"
    }
}

struct LegacySQLiteCategory: Codable, Equatable, Identifiable {
    let id: Int
    let name: String
    let type: String
    let icon: String?
}

struct LegacySQLiteCommitRequest: Codable, Equatable {
    let token: String
    let options: LegacySQLiteImportOptions
    let mappingTargets: [LegacySQLiteMappingTarget]

    enum CodingKeys: String, CodingKey {
        case token
        case options
        case mappingTargets = "mapping_targets"
    }
}

struct LegacySQLiteImportOptions: Codable, Equatable {
    let importRecurringRules: Bool
    let recurringAutoPost: Bool
    let linkRecurringTransactions: Bool
    let preserveTimeInTitle: Bool

    enum CodingKeys: String, CodingKey {
        case importRecurringRules = "import_recurring_rules"
        case recurringAutoPost = "recurring_auto_post"
        case linkRecurringTransactions = "link_recurring_transactions"
        case preserveTimeInTitle = "preserve_time_in_title"
    }
}

struct LegacySQLiteMappingTarget: Codable, Equatable {
    let legacyType: String
    let legacyCategory: String
    let target: String
    let existingCategoryID: Int?

    enum CodingKeys: String, CodingKey {
        case legacyType = "legacy_type"
        case legacyCategory = "legacy_category"
        case target
        case existingCategoryID = "existing_category_id"
    }
}

struct LegacySQLiteCommitResponse: Codable, Equatable {
    let result: [String: Int]
}

struct MobileSessionsResponse: Codable, Equatable {
    let sessions: [MobileSession]
}

struct BalanceAnchor: Codable, Equatable, Identifiable {
    let id: Int
    let asOfAt: Date
    let balanceCents: Int
    let note: String?

    enum CodingKeys: String, CodingKey {
        case id
        case asOfAt = "as_of_at"
        case balanceCents = "balance_cents"
        case note
    }
}

struct IngestTokenMetadata: Codable, Equatable {
    let tokenHint: String
    let createdAt: Date
    let updatedAt: Date
    let lastUsedAt: Date?

    enum CodingKeys: String, CodingKey {
        case tokenHint = "token_hint"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case lastUsedAt = "last_used_at"
    }
}

struct SettingsResponse: Codable, Equatable {
    let currentBalance: Int
    let balanceAnchors: [BalanceAnchor]
    let ingestToken: IngestTokenMetadata?

    enum CodingKeys: String, CodingKey {
        case currentBalance = "current_balance"
        case balanceAnchors = "balance_anchors"
        case ingestToken = "ingest_token"
    }
}

struct IngestTokenCreateResponse: Codable, Equatable {
    let token: String
    let ingestToken: IngestTokenMetadata

    enum CodingKeys: String, CodingKey {
        case token
        case ingestToken = "ingest_token"
    }
}

struct BalanceAnchorRequest: Codable, Equatable {
    let asOfAt: String
    let balanceCents: Int
    let note: String?

    enum CodingKeys: String, CodingKey {
        case asOfAt = "as_of_at"
        case balanceCents = "balance_cents"
        case note
    }
}

struct CSVPreviewRow: Codable, Equatable, Identifiable {
    var id: String { "\(date)-\(type)-\(title)-\(amountCents)" }

    let date: Date
    let type: String
    let isReimbursement: Bool
    let amountCents: Int
    let category: String?
    let title: String
    let description: String?
    let categoryID: Int?

    enum CodingKeys: String, CodingKey {
        case date
        case type
        case isReimbursement = "is_reimbursement"
        case amountCents = "amount_cents"
        case category
        case title
        case description
        case categoryID = "category_id"
    }
}

struct CSVPreviewResponse: Codable, Equatable {
    let rows: [CSVPreviewRow]
    let errors: [String]
}

struct CSVCommitResponse: Codable, Equatable {
    let importedCount: Int

    enum CodingKeys: String, CodingKey {
        case importedCount = "imported_count"
    }
}

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value):
            try container.encode(value)
        case let .number(value):
            try container.encode(value)
        case let .bool(value):
            try container.encode(value)
        case let .object(value):
            try container.encode(value)
        case let .array(value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    func prettyDescription() -> String {
        guard
            let data = try? JSONEncoder().encode(self),
            let object = try? JSONSerialization.jsonObject(with: data),
            let prettyData = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]),
            let string = String(data: prettyData, encoding: .utf8)
        else {
            return String(describing: self)
        }
        return string
    }
}

struct DynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}
