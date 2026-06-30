import SwiftUI

struct DigestView: View {
    @Environment(AppModel.self) private var model
    @State private var weekOf: Date?

    var body: some View {
        NavigationStack {
            List {
                if model.identity?.authenticated != true {
                    SignedOutStateSection()
                } else if let digest = model.digest {
                    DigestHeadlineSection(digest: digest)
                    DigestCategoriesSection(categories: digest.topCategories)
                    DigestBudgetPulseSection(rows: digest.budgetPulse)
                    DigestUnusualSection(rows: digest.unusualTransactions)
                    DigestRecurringSection(rows: digest.recurringPostings)
                } else if model.showsDigestInitialLoading {
                    LoadingStateSection(title: "Loading digest")
                } else {
                    ContentUnavailableView("No digest loaded", systemImage: "newspaper")
                }
            }
            .navigationTitle("Digest")
            .expensesScreenStyle()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        shiftWeek(by: -7)
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                    .accessibilityLabel("Previous week")
                    .disabled(model.digest == nil)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        shiftWeek(by: 7)
                    } label: {
                        Image(systemName: "chevron.right")
                    }
                    .accessibilityLabel("Next week")
                    .disabled(model.digest == nil)
                }
            }
            .task {
                await loadDigest()
            }
            .refreshable {
                await loadDigest()
            }
            .animation(.easeInOut(duration: 0.18), value: model.showsDigestInitialLoading)
        }
    }

    private func loadDigest() async {
        await model.loadDigest(weekOf: weekOf.map(Self.dateString))
        if let digest = model.digest {
            weekOf = digest.weekStart
        }
    }

    private func shiftWeek(by days: Int) {
        let base = weekOf ?? model.digest?.weekStart ?? Date()
        weekOf = Calendar.current.date(byAdding: .day, value: days, to: base) ?? base
        Task { await loadDigest() }
    }

    private static func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

struct ForecastView: View {
    @Environment(AppModel.self) private var model
    @State private var forecastHorizon = 6
    @State private var forecastMode = "full"
    @State private var showingScenarioEditor = false

    var body: some View {
        List {
            if model.identity?.authenticated != true {
                SignedOutStateSection()
            } else {
                ForecastControlsSection(
                    horizon: $forecastHorizon,
                    mode: $forecastMode
                )
                ForecastScenarioEntrySection {
                    showingScenarioEditor = true
                }
                if let forecast = model.forecast {
                    ForecastSummarySection(forecast: forecast)
                    ForecastMonthSection(months: forecast.months)
                } else if model.isLoading {
                    LoadingStateSection(title: "Loading forecast")
                } else {
                    ContentUnavailableView("No forecast loaded", systemImage: "chart.line.uptrend.xyaxis")
                }
            }
        }
        .navigationTitle("Forecast")
        .expensesScreenStyle()
        .task(id: "\(forecastHorizon)-\(forecastMode)") {
            await loadForecast()
        }
        .sheet(isPresented: $showingScenarioEditor) {
            ScenarioEditorSheet(horizon: forecastHorizon, mode: forecastMode)
        }
        .refreshable {
            await loadForecast()
        }
        .animation(.easeInOut(duration: 0.18), value: model.isLoading && model.forecast == nil)
    }

    private func loadForecast() async {
        await model.loadForecast(horizon: forecastHorizon, mode: forecastMode)
    }
}

struct PlanningView: View {
    @Environment(AppModel.self) private var model
    @State private var section: PlanningSection = .digest
    @State private var weekOf: Date?
    @State private var forecastHorizon = 6
    @State private var forecastMode = "full"
    @State private var showingScenarioEditor = false

    var body: some View {
        NavigationStack {
            List {
                if model.identity?.authenticated != true {
                    SignedOutStateSection()
                } else {
                    Section {
                        PlanningSectionPicker(section: $section)
                    }

                    switch section {
                    case .digest:
                        if let digest = model.digest {
                            DigestHeadlineSection(digest: digest)
                            DigestCategoriesSection(categories: digest.topCategories)
                            DigestBudgetPulseSection(rows: digest.budgetPulse)
                            DigestUnusualSection(rows: digest.unusualTransactions)
                            DigestRecurringSection(rows: digest.recurringPostings)
                        } else if model.showsDigestInitialLoading {
                            LoadingStateSection(title: "Loading digest")
                        } else {
                            ContentUnavailableView("No digest loaded", systemImage: "newspaper")
                        }
                    case .forecast:
                        ForecastControlsSection(
                            horizon: $forecastHorizon,
                            mode: $forecastMode
                        )
                        ForecastScenarioEntrySection {
                            showingScenarioEditor = true
                        }
                        if let forecast = model.forecast {
                            ForecastSummarySection(forecast: forecast)
                            ForecastMonthSection(months: forecast.months)
                        } else {
                            ContentUnavailableView("No forecast loaded", systemImage: "chart.line.uptrend.xyaxis")
                        }
                    }
                }
            }
            .navigationTitle("Planning")
            .expensesScreenStyle()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        shiftWeek(by: -7)
                    } label: {
                        Image(systemName: "chevron.left")
                    }
                    .disabled(section != .digest || model.digest == nil)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        shiftWeek(by: 7)
                    } label: {
                        Image(systemName: "chevron.right")
                    }
                    .disabled(section != .digest || model.digest == nil)
                }
            }
            .task(id: section) {
                await loadSelectedSection()
            }
            .task(id: forecastHorizon) {
                if section == .forecast {
                    await loadForecast()
                }
            }
            .task(id: forecastMode) {
                if section == .forecast {
                    await loadForecast()
                }
            }
            .sheet(isPresented: $showingScenarioEditor) {
                ScenarioEditorSheet(horizon: forecastHorizon, mode: forecastMode)
            }
            .refreshable {
                await loadSelectedSection()
            }
            .animation(.easeInOut(duration: 0.18), value: model.showsDigestInitialLoading)
        }
    }

    private func loadSelectedSection() async {
        switch section {
        case .digest:
            await loadDigest()
        case .forecast:
            await loadForecast()
        }
    }

    private func loadDigest() async {
        await model.loadDigest(weekOf: weekOf.map(Self.dateString))
        if let digest = model.digest {
            weekOf = digest.weekStart
        }
    }

    private func loadForecast() async {
        await model.loadForecast(horizon: forecastHorizon, mode: forecastMode)
    }

    private func shiftWeek(by days: Int) {
        let base = weekOf ?? model.digest?.weekStart ?? Date()
        weekOf = Calendar.current.date(byAdding: .day, value: days, to: base) ?? base
        Task { await loadDigest() }
    }

    private static func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

private struct PlanningSectionPicker: View {
    @Binding var section: PlanningSection

    var body: some View {
        Picker("Section", selection: $section) {
            ForEach(PlanningSection.allCases) { item in
                Text(item.title).tag(item)
            }
        }
        .pickerStyle(.segmented)
        .sensoryFeedback(.selection, trigger: section)
    }
}

private enum PlanningSection: String, CaseIterable, Identifiable {
    case digest
    case forecast

    var id: String { rawValue }

    var title: String {
        switch self {
        case .digest:
            "Digest"
        case .forecast:
            "Forecast"
        }
    }
}

private struct DigestHeadlineSection: View {
    let digest: DigestResponse

    var body: some View {
        Section {
            LabeledContent("Week", value: "\(AppFormatters.day(digest.weekStart)) - \(AppFormatters.day(digest.weekEnd))")
            LabeledContent("Total spent", value: AppFormatters.euros(digest.headline.totalSpentCents))
            LabeledContent("Transactions", value: "\(digest.headline.transactionCount)")
            LabeledContent("vs. last week", value: signedEuros(digest.headline.vsLastWeekCents))
            LabeledContent("vs. 4-week avg", value: signedEuros(digest.headline.vsFourWeekAvgCents))
        } header: {
            Text("Weekly Digest")
        }
    }

    private func signedEuros(_ amount: Int) -> String {
        "\(amount > 0 ? "+" : "")\(AppFormatters.euros(amount))"
    }
}

private struct DigestCategoriesSection: View {
    let categories: [DigestCategory]

    var body: some View {
        Section("Top Categories") {
            if categories.isEmpty {
                Text("No spending this week.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(categories) { category in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(category.name)
                                .font(.body.weight(.medium))
                            if category.isAboveTrailing50 {
                                Image(systemName: "arrow.up.right")
                                    .foregroundStyle(.red)
                            }
                            Spacer()
                            Text(AppFormatters.euros(category.amountCents))
                                .font(.body.weight(.semibold).monospacedDigit())
                        }
                        ProgressView(value: min(100, max(0, category.barPercent)), total: 100)
                            .tint(.red)
                        Text("Trailing weekly average \(AppFormatters.euros(category.trailingWeeklyAvgCents))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }
}

private struct DigestBudgetPulseSection: View {
    let rows: [DigestBudgetPulse]

    var body: some View {
        Section("Budget Pulse") {
            if rows.isEmpty {
                Text("No active budgets this month.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(rows) { row in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.scopeLabel)
                                .font(.body.weight(.medium))
                            Text("\(Int(row.usedPercent.rounded()))% used · \(row.daysLeft) days left · \(row.velocityRatio.formatted(.number.precision(.fractionLength(2))))x pace")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Circle()
                            .fill(color(for: row.paceState))
                            .frame(width: 10, height: 10)
                    }
                }
            }
        }
    }

    private func color(for state: String) -> Color {
        switch state {
        case "under":
            .green
        case "over":
            .red
        default:
            .blue
        }
    }
}

private struct DigestUnusualSection: View {
    let rows: [DigestUnusualTransaction]

    var body: some View {
        Section("Flagged This Week") {
            if rows.isEmpty {
                Text("Nothing unusual this week.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(rows) { row in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.title.isEmpty ? row.category?.name ?? "Untitled" : row.title)
                                .font(.body.weight(.medium))
                            Text("Avg for \(row.category?.name ?? "category") is \(AppFormatters.euros(row.trailingAvgCents))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(AppFormatters.euros(row.amountCents))
                            .font(.body.weight(.semibold).monospacedDigit())
                            .foregroundStyle(.red)
                    }
                }
            }
        }
    }
}

private struct DigestRecurringSection: View {
    let rows: [DigestRecurringPosting]

    var body: some View {
        Section("Auto-posted This Week") {
            if rows.isEmpty {
                Text("No recurring postings this week.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(rows) { row in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.ruleName.isEmpty ? "Recurring rule" : row.ruleName)
                                .font(.body.weight(.medium))
                            Text(row.category?.name ?? "Uncategorized")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(AppFormatters.euros(row.amountCents))
                            .font(.body.weight(.semibold).monospacedDigit())
                    }
                }
            }
        }
    }
}

private struct ForecastControlsSection: View {
    @Binding var horizon: Int
    @Binding var mode: String

    var body: some View {
        Section("Forecast") {
            Picker("Horizon", selection: $horizon) {
                Text("3 months").tag(3)
                Text("6 months").tag(6)
                Text("12 months").tag(12)
            }
            Picker("Mode", selection: $mode) {
                Text("Recurring only").tag("recurring")
                Text("Full estimate").tag("full")
            }
        }
    }
}

private struct ForecastScenarioEntrySection: View {
    let openScenarioEditor: () -> Void

    var body: some View {
        Section {
            Button {
                openScenarioEditor()
            } label: {
                Label("What If", systemImage: "sparkles")
            }
        } footer: {
            Text("Compare temporary changes without modifying recurring rules or budgets.")
        }
    }
}

private struct ForecastSummarySection: View {
    let forecast: ForecastResponse

    var body: some View {
        Section("Summary") {
            LabeledContent("Projected balance", value: AppFormatters.euros(forecast.summary.projectedBalanceCents))
            LabeledContent("Average monthly net", value: signedEuros(forecast.summary.averageMonthlyNetCents))
            LabeledContent("Start balance", value: AppFormatters.euros(forecast.startBalanceCents))
            LabeledContent("Negative in", value: forecast.summary.monthsUntilNegative.map { "\($0) months" } ?? "N/A")
        }
    }

    private func signedEuros(_ amount: Int) -> String {
        "\(amount >= 0 ? "+" : "")\(AppFormatters.euros(amount))"
    }
}

private struct ForecastMonthSection: View {
    let months: [ForecastMonth]

    var body: some View {
        Section("Months") {
            ForEach(months) { month in
                DisclosureGroup {
                    ForecastBreakdownRows(month: month)
                } label: {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(monthLabel(month.month))
                                .font(.body.weight(.medium))
                            Text("Net \(signedEuros(month.projectedNetCents))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(AppFormatters.euros(month.endBalanceCents))
                            .font(.body.weight(.semibold).monospacedDigit())
                            .foregroundStyle(month.endBalanceCents < 0 ? .red : .primary)
                    }
                }
                .tint(month.crossesNegative ? .red : .accentColor)
            }
        }
    }

    private func monthLabel(_ value: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM"
        guard let date = formatter.date(from: value) else {
            return value
        }
        return date.formatted(.dateTime.month(.abbreviated).year())
    }

    private func signedEuros(_ amount: Int) -> String {
        "\(amount >= 0 ? "+" : "")\(AppFormatters.euros(amount))"
    }
}

private struct ForecastBreakdownRows: View {
    let month: ForecastMonth

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForecastLine(label: "Income", amount: month.projectedIncomeCents, color: .green)
            ForecastLine(label: "Expenses", amount: month.projectedExpensesCents, color: .red)
            if !month.breakdown.recurringRules.isEmpty {
                Divider()
                Text("Recurring")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(month.breakdown.recurringRules) { row in
                    ForecastLine(
                        label: row.name,
                        detail: row.categoryName,
                        amount: row.type == "income" ? row.amountCents : -row.amountCents,
                        color: row.type == "income" ? .green : .red
                    )
                }
            }
            if !month.breakdown.variableEstimates.isEmpty {
                Divider()
                Text("Variable estimates")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(month.breakdown.variableEstimates) { row in
                    ForecastLine(label: row.name, amount: -row.amountCents, color: .red)
                }
            }
            if !month.breakdown.oneTimeEvents.isEmpty {
                Divider()
                Text("One-time events")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(month.breakdown.oneTimeEvents) { row in
                    ForecastLine(
                        label: row.name,
                        amount: row.type == "income" ? row.amountCents : -row.amountCents,
                        color: row.type == "income" ? .green : .red
                    )
                }
            }
        }
        .padding(.vertical, 6)
    }
}

private struct ForecastLine: View {
    let label: String
    var detail: String?
    let amount: Int
    let color: Color

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text("\(amount >= 0 ? "+" : "")\(AppFormatters.euros(amount))")
                .font(.callout.monospacedDigit())
                .foregroundStyle(color)
        }
    }
}

private enum ScenarioModificationKind: String, CaseIterable, Identifiable {
    case removeRule = "remove_rule"
    case addRule = "add_rule"
    case modifyRule = "modify_rule"
    case oneTime = "one_time"
    case adjustCategory = "adjust_category"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .removeRule:
            "Remove rule"
        case .addRule:
            "Add rule"
        case .modifyRule:
            "Change rule"
        case .oneTime:
            "One-time event"
        case .adjustCategory:
            "Adjust category"
        }
    }
}

private struct ScenarioEditorSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let horizon: Int
    let mode: String

    @State private var modifications: [ForecastScenarioModificationRequest] = []
    @State private var selectedKind: ScenarioModificationKind = .removeRule
    @State private var removeRuleID: Int?
    @State private var modifyRuleID: Int?
    @State private var modifyAmount = ""
    @State private var modifyMonth = ScenarioEditorSheet.nextMonthValue()
    @State private var addName = ""
    @State private var addType = "expense"
    @State private var addAmount = ""
    @State private var addInterval = "monthly"
    @State private var oneTimeName = ""
    @State private var oneTimeType = "expense"
    @State private var oneTimeAmount = ""
    @State private var oneTimeMonth = ScenarioEditorSheet.nextMonthValue()
    @State private var adjustCategoryID: Int?
    @State private var adjustAmount = ""
    @State private var formError: String?

    private var rules: [RecurringRule] {
        model.recurring?.rules ?? []
    }

    private var expenseCategories: [RecurringCategory] {
        model.recurring?.categories.filter { $0.type == "expense" } ?? []
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Adjustment") {
                    Picker("Type", selection: $selectedKind) {
                        ForEach(ScenarioModificationKind.allCases) { kind in
                            Text(kind.title).tag(kind)
                        }
                    }

                    selectedFields

                    if let formError {
                        Text(formError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    Button {
                        addModification()
                    } label: {
                        Label("Add Adjustment", systemImage: "plus")
                    }
                }

                Section("Adjustments") {
                    if modifications.isEmpty {
                        Text("No temporary changes added.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(modifications) { modification in
                            Text(modificationDescription(modification))
                        }
                        .onDelete { offsets in
                            modifications.remove(atOffsets: offsets)
                            model.forecastScenario = nil
                        }
                    }
                }

                Section {
                    Button {
                        Task {
                            await runScenario()
                        }
                    } label: {
                        Label("Run Scenario", systemImage: "chart.line.uptrend.xyaxis")
                    }
                    .disabled(modifications.isEmpty || model.isLoading)

                    if model.isLoading {
                        ProgressView()
                    }
                }

                if let scenario = model.forecastScenario {
                    ScenarioImpactSection(scenario: scenario)
                }
            }
            .navigationTitle("What If")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear") {
                        modifications.removeAll()
                        model.forecastScenario = nil
                    }
                    .disabled(modifications.isEmpty && model.forecastScenario == nil)
                }
            }
            .task {
                if model.recurring == nil {
                    await model.loadRecurring()
                }
            }
        }
    }

    @ViewBuilder
    private var selectedFields: some View {
        switch selectedKind {
        case .removeRule:
            Picker("Rule", selection: $removeRuleID) {
                Text("Select").tag(Optional<Int>.none)
                ForEach(rules) { rule in
                    Text(rule.name ?? "Recurring rule").tag(Optional(rule.id))
                }
            }
        case .addRule:
            TextField("Name", text: $addName)
            Picker("Type", selection: $addType) {
                Text("Expense").tag("expense")
                Text("Income").tag("income")
            }
            TextField("Amount", text: $addAmount)
                .keyboardType(.decimalPad)
            Picker("Interval", selection: $addInterval) {
                Text("Monthly").tag("monthly")
                Text("Yearly").tag("yearly")
                Text("Weekly").tag("weekly")
            }
        case .modifyRule:
            Picker("Rule", selection: $modifyRuleID) {
                Text("Select").tag(Optional<Int>.none)
                ForEach(rules) { rule in
                    Text(rule.name ?? "Recurring rule").tag(Optional(rule.id))
                }
            }
            TextField("New amount", text: $modifyAmount)
                .keyboardType(.decimalPad)
            TextField("Effective month", text: $modifyMonth)
                .textInputAutocapitalization(.never)
        case .oneTime:
            TextField("Name", text: $oneTimeName)
            Picker("Type", selection: $oneTimeType) {
                Text("Expense").tag("expense")
                Text("Income").tag("income")
            }
            TextField("Amount", text: $oneTimeAmount)
                .keyboardType(.decimalPad)
            TextField("Month", text: $oneTimeMonth)
                .textInputAutocapitalization(.never)
        case .adjustCategory:
            Picker("Category", selection: $adjustCategoryID) {
                Text("Select").tag(Optional<Int>.none)
                ForEach(expenseCategories) { category in
                    Text(category.name).tag(Optional(category.id))
                }
            }
            TextField("Monthly estimate", text: $adjustAmount)
                .keyboardType(.decimalPad)
        }
    }

    private func addModification() {
        formError = nil
        switch selectedKind {
        case .removeRule:
            guard let removeRuleID else {
                formError = "Select a rule to remove."
                return
            }
            modifications.append(.init(type: "remove_rule", ruleID: removeRuleID))
        case .addRule:
            guard let amountCents = amountCents(from: addAmount), !addName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                formError = "Enter a valid name and amount."
                return
            }
            modifications.append(.init(
                type: "add_rule",
                name: addName.trimmingCharacters(in: .whitespacesAndNewlines),
                txType: addType,
                amountCents: amountCents,
                interval: addInterval
            ))
            addName = ""
            addAmount = ""
        case .modifyRule:
            guard let modifyRuleID, let amountCents = amountCents(from: modifyAmount), !modifyMonth.isEmpty else {
                formError = "Select a rule, month, and valid amount."
                return
            }
            modifications.append(.init(
                type: "modify_rule",
                ruleID: modifyRuleID,
                newAmountCents: amountCents,
                effectiveMonth: modifyMonth
            ))
            modifyAmount = ""
        case .oneTime:
            guard let amountCents = amountCents(from: oneTimeAmount), !oneTimeName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !oneTimeMonth.isEmpty else {
                formError = "Enter a valid name, month, and amount."
                return
            }
            modifications.append(.init(
                type: "one_time",
                name: oneTimeName.trimmingCharacters(in: .whitespacesAndNewlines),
                txType: oneTimeType,
                amountCents: amountCents,
                month: oneTimeMonth
            ))
            oneTimeName = ""
            oneTimeAmount = ""
        case .adjustCategory:
            guard let adjustCategoryID, let amountCents = amountCents(from: adjustAmount) else {
                formError = "Select a category and valid monthly estimate."
                return
            }
            modifications.append(.init(
                type: "adjust_category",
                categoryID: adjustCategoryID,
                newMonthlyCents: amountCents
            ))
            adjustAmount = ""
        }
        model.forecastScenario = nil
    }

    private func runScenario() async {
        formError = nil
        let success = await model.runForecastScenario(
            horizon: horizon,
            mode: mode,
            modifications: modifications
        )
        if !success {
            formError = model.lastError?.message ?? "Scenario could not be run."
        }
    }

    private func modificationDescription(_ modification: ForecastScenarioModificationRequest) -> String {
        switch modification.type {
        case "remove_rule":
            return "Cancel \(ruleName(modification.ruleID))"
        case "add_rule":
            return "Add \(modification.name ?? "rule") (\(modification.interval ?? "monthly"))"
        case "modify_rule":
            return "Change \(ruleName(modification.ruleID)) starting \(modification.effectiveMonth ?? "")"
        case "one_time":
            return "\(modification.name ?? "One-time event") in \(modification.month ?? "")"
        default:
            let category = expenseCategories.first { $0.id == modification.categoryID }
            return "Adjust \(category?.name ?? "category") to \(AppFormatters.euros(modification.newMonthlyCents ?? 0))/mo"
        }
    }

    private func ruleName(_ id: Int?) -> String {
        rules.first { $0.id == id }?.name ?? "rule"
    }

    private func amountCents(from raw: String) -> Int? {
        let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ",", with: ".")
        guard let value = Decimal(string: normalized), value >= 0 else {
            return nil
        }
        return NSDecimalNumber(decimal: value * Decimal(100)).rounding(accordingToBehavior: nil).intValue
    }

    private static func nextMonthValue() -> String {
        let calendar = Calendar(identifier: .gregorian)
        let nextMonth = calendar.date(byAdding: .month, value: 1, to: Date()) ?? Date()
        let components = calendar.dateComponents([.year, .month], from: nextMonth)
        return "\(components.year ?? 2026)-\(String(format: "%02d", components.month ?? 1))"
    }
}

private struct ScenarioImpactSection: View {
    let scenario: ForecastScenarioResponse

    var body: some View {
        Section("Result") {
            LabeledContent("Final impact", value: signedEuros(scenario.impact.finalDeltaCents))
            LabeledContent("Average monthly impact", value: signedEuros(scenario.impact.averageMonthlyDeltaCents))
            LabeledContent("Scenario balance", value: AppFormatters.euros(scenario.summary.projectedBalanceCents))
            LabeledContent("Baseline balance", value: AppFormatters.euros(scenario.baseline.summary.projectedBalanceCents))
        }

        Section("Monthly Delta") {
            ForEach(scenario.impact.monthlyDelta) { row in
                LabeledContent(row.month, value: signedEuros(row.deltaEndBalanceCents))
            }
        }

        Section("By Adjustment") {
            ForEach(scenario.impact.byModification) { row in
                VStack(alignment: .leading, spacing: 6) {
                    Text(row.label)
                        .font(.body.weight(.medium))
                    Text("Final \(signedEuros(row.finalDeltaCents)) · average \(signedEuros(row.averageMonthlyDeltaCents))/mo")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func signedEuros(_ amount: Int) -> String {
        "\(amount >= 0 ? "+" : "")\(AppFormatters.euros(amount))"
    }
}

#Preview {
    PlanningView()
        .environment(AppModel())
}
