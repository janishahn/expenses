import SwiftUI

struct BudgetsView: View {
    @Environment(AppModel.self) private var model
    @Binding private var quickAddTrigger: Int
    @State private var viewMode: BudgetViewMode = .month
    @State private var activeSheet: BudgetSheet?
    @State private var pendingOverrideDelete: BudgetScope?
    @State private var pendingTemplateDelete: BudgetTemplateRow?

    init(quickAddTrigger: Binding<Int> = .constant(0)) {
        _quickAddTrigger = quickAddTrigger
    }

    var body: some View {
        List {
            if model.identity?.authenticated != true {
                SignedOutStateSection()
            } else {
                Section {
                    BudgetViewModePicker(viewMode: $viewMode)
                }

                if let budgets = model.budgets {
                    switch viewMode {
                    case .month:
                        MonthBudgetsView(
                            budgets: budgets,
                            burndown: model.budgetBurndown,
                            onDeleteOverride: { pendingOverrideDelete = $0 }
                        )
                    case .templates:
                        BudgetTemplatesView(
                            budgets: budgets,
                            onDelete: { pendingTemplateDelete = $0 }
                        )
                    case .year:
                        YearBudgetsView(budgets: budgets)
                    }
                } else if model.isLoading {
                    LoadingStateSection(title: "Loading budgets")
                } else {
                    ContentUnavailableView("No budgets loaded", systemImage: "chart.bar")
                }
            }
        }
        .navigationTitle("Budgets")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    activeSheet = viewMode.defaultSheet ?? .override
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add Budget")
                .disabled(model.identity?.authenticated != true)
            }
        }
        .expensesScreenStyle()
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .override:
                BudgetOverrideFormView(budgets: model.budgets)
            case .template:
                BudgetTemplateFormView(budgets: model.budgets)
            }
        }
        .confirmationDialog("Remove month budget?", isPresented: overrideDeletePresented) {
            Button("Remove Month Budget", role: .destructive) {
                if let budget = pendingOverrideDelete {
                    Task { await model.deleteBudgetOverride(id: budget.sourceID, view: viewMode.rawValue) }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete recurring budget?", isPresented: templateDeletePresented) {
            Button("Delete Recurring Budget", role: .destructive) {
                if let template = pendingTemplateDelete {
                    Task { await model.deleteBudgetTemplate(id: template.id, view: viewMode.rawValue) }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .task(id: viewMode) {
            await model.loadBudgets(view: viewMode.rawValue)
        }
        .refreshable {
            await model.loadBudgets(view: viewMode.rawValue)
        }
        .animation(.easeInOut(duration: 0.18), value: model.isLoading && model.budgets == nil)
        .onChange(of: quickAddTrigger) { _, _ in
            activeSheet = viewMode.defaultSheet ?? .override
        }
    }

    private var overrideDeletePresented: Binding<Bool> {
        Binding(
            get: { pendingOverrideDelete != nil },
            set: { isPresented in
                if !isPresented {
                    pendingOverrideDelete = nil
                }
            }
        )
    }

    private var templateDeletePresented: Binding<Bool> {
        Binding(
            get: { pendingTemplateDelete != nil },
            set: { isPresented in
                if !isPresented {
                    pendingTemplateDelete = nil
                }
            }
        )
    }
}

private struct BudgetViewModePicker: View {
    @Binding var viewMode: BudgetViewMode

    var body: some View {
        Picker("View", selection: $viewMode) {
            ForEach(BudgetViewMode.allCases) { mode in
                Text(mode.title).tag(mode)
            }
        }
        .pickerStyle(.segmented)
    }
}

private enum BudgetViewMode: String, CaseIterable, Identifiable {
    case month
    case templates
    case year

    var id: String { rawValue }

    var title: String {
        switch self {
        case .month:
            "Month"
        case .templates:
            "Recurring"
        case .year:
            "Year"
        }
    }

    var defaultSheet: BudgetSheet? {
        switch self {
        case .month:
            .override
        case .templates:
            .template
        case .year:
            nil
        }
    }
}

private enum BudgetSheet: Identifiable {
    case override
    case template

    var id: String {
        switch self {
        case .override:
            "override"
        case .template:
            "template"
        }
    }
}

private struct MonthBudgetsView: View {
    let budgets: BudgetsResponse
    let burndown: BudgetBurndownResponse?
    var onDeleteOverride: (BudgetScope) -> Void

    private var progressByScope: [String: BudgetProgress] {
        Dictionary(uniqueKeysWithValues: budgets.progress.map { ($0.id, $0) })
    }

    var body: some View {
        if let burndown {
            BudgetBurndownSection(burndown: burndown)
        }

        Section(budgets.monthValue) {
            ForEach(budgets.budgets) { budget in
                let progress = progressByScope[budget.scopeCategoryID.map(String.init) ?? "overall"]
                BudgetScopeRow(
                    budget: budget,
                    progress: progress,
                    onRemove: budget.source == "override" ? { onDeleteOverride(budget) } : nil
                )
                    .swipeActions(edge: .trailing) {
                        if budget.source == "override" {
                            Button("Remove", role: .destructive) {
                                onDeleteOverride(budget)
                            }
                        }
                    }
            }
        }
    }
}

private struct BudgetBurndownSection: View {
    let burndown: BudgetBurndownResponse

    private var latestCumulative: Int {
        burndown.dailySeries.last?.cumulativeCents ?? 0
    }

    private var daysElapsed: Int {
        max(burndown.dailySeries.last?.day ?? 0, 1)
    }

    private var daysRemaining: Int {
        max(0, burndown.daysInMonth - daysElapsed)
    }

    private var dailyAllowance: Int {
        if daysRemaining > 0 {
            return (burndown.budgetAmountCents - latestCumulative) / daysRemaining
        }
        return burndown.budgetAmountCents - latestCumulative
    }

    private var projectedFinish: Int {
        latestCumulative + (latestCumulative / daysElapsed) * (burndown.daysInMonth - daysElapsed)
    }

    var body: some View {
        Section("Overall Pace") {
            LabeledContent("Budget", value: AppFormatters.euros(burndown.budgetAmountCents))
            LabeledContent("Spent", value: AppFormatters.euros(latestCumulative))
            LabeledContent("Daily allowance", value: "\(AppFormatters.euros(dailyAllowance)) / day")
            LabeledContent("Projected finish", value: AppFormatters.euros(projectedFinish))
            if let topDay = burndown.topSpendingDays.first {
                LabeledContent(
                    "Highest day",
                    value: "\(topDayLabel(topDay)) · \(AppFormatters.euros(topDay.totalCents))"
                )
            }
            if !burndown.compareDailySeries.isEmpty, let compareMonth = burndown.compareMonth {
                LabeledContent("Compared with", value: compareMonth)
            }
        }
    }

    private func topDayLabel(_ topDay: BudgetBurndownTopDay) -> String {
        topDay.date.map(AppFormatters.day) ?? "Day \(topDay.day)"
    }
}

private struct YearBudgetsView: View {
    let budgets: BudgetsResponse

    private var spentByScope: [String: BudgetYearSpent] {
        Dictionary(uniqueKeysWithValues: budgets.yearlySpent.map { ($0.id, $0) })
    }

    var body: some View {
        Section(String(budgets.yearValue)) {
            ForEach(budgets.yearlyBudgets) { budget in
                let spent = spentByScope[budget.scopeCategoryID.map(String.init) ?? "overall"]?.spentCents ?? 0
                let progress = BudgetProgress(
                    scopeCategoryID: budget.scopeCategoryID,
                    spentCents: spent,
                    remainingCents: budget.amountCents - spent,
                    velocityRatio: budget.amountCents > 0 ? Double(spent) / Double(budget.amountCents) : 0,
                    dailyRemainingCents: 0,
                    projectedTotalCents: spent,
                    daysElapsed: 0,
                    daysRemaining: 0
                )
                BudgetScopeRow(budget: budget, progress: progress)
            }
        }
    }
}

private struct BudgetScopeRow: View {
    let budget: BudgetScope
    let progress: BudgetProgress?
    var onRemove: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(budget.scopeLabel)
                        .font(.body.weight(.medium))
                    Text(budget.source == "override" ? "Month budget" : "Recurring budget")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(AppFormatters.euros(budget.amountCents))
                    .font(.body.weight(.semibold))
                if let onRemove {
                    Menu {
                        Button("Remove override", role: .destructive) {
                            onRemove()
                        }
                    } label: {
                        Label("Budget actions", systemImage: "ellipsis.circle")
                            .labelStyle(.iconOnly)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Budget actions")
                }
            }

            if let progress {
                ProgressView(value: min(1, Double(progress.spentCents) / Double(max(budget.amountCents, 1))))
                    .tint(progress.remainingCents < 0 ? .red : .green)
                HStack {
                    Text("Spent \(AppFormatters.euros(progress.spentCents))")
                    Spacer()
                    Text("\(progress.remainingCents < 0 ? "Over" : "Left") \(AppFormatters.euros(abs(progress.remainingCents)))")
                }
                .font(.caption)
                .foregroundStyle(progress.remainingCents < 0 ? .red : .secondary)
                Text("Projected \(AppFormatters.euros(progress.projectedTotalCents)) · \(progress.velocityRatio.formatted(.number.precision(.fractionLength(2))))x pace")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct BudgetTemplatesView: View {
    let budgets: BudgetsResponse
    var onDelete: (BudgetTemplateRow) -> Void

    var body: some View {
        Section("Recurring budgets") {
            if budgets.templates.isEmpty {
                ContentUnavailableView("No recurring budgets", systemImage: "calendar.badge.plus")
            } else {
                ForEach(budgets.templates) { template in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(template.category?.name ?? "All expense categories")
                                .font(.body.weight(.medium))
                            Text("\(template.frequency.capitalized) from \(AppFormatters.day(template.startsOn))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(AppFormatters.euros(template.amountCents))
                            .font(.body.weight(.semibold))
                        Menu {
                            Button("Delete template", role: .destructive) {
                                onDelete(template)
                            }
                        } label: {
                            Label("Budget template actions", systemImage: "ellipsis.circle")
                                .labelStyle(.iconOnly)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Budget template actions")
                    }
                    .swipeActions(edge: .trailing) {
                        Button("Delete", role: .destructive) {
                            onDelete(template)
                        }
                    }
                }
            }
        }
    }
}

private struct BudgetOverrideFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let budgets: BudgetsResponse?
    @State private var categoryID: Int?
    @State private var amount = ""
    @State private var formError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Category", selection: $categoryID) {
                        Text("All expense categories").tag(Int?.none)
                        ForEach(expenseCategories) { category in
                            Text(category.name).tag(Optional(category.id))
                        }
                    }
                    TextField("Amount", text: $amount)
                        .keyboardType(.decimalPad)
                }
                if let formError {
                    Section {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Set Month Budget")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(model.isLoading)
                }
            }
        }
    }

    private var expenseCategories: [BudgetCategory] {
        budgets?.categories.filter { $0.type == "expense" && $0.archivedAt == nil } ?? []
    }

    private func save() async {
        guard let budgets else {
            formError = "Budgets are not loaded."
            return
        }
        guard let amountCents = BudgetFormParsing.parseAmount(amount) else {
            formError = "Amount is invalid."
            return
        }
        let body = BudgetOverrideRequest(
            year: budgets.year,
            month: budgets.month,
            categoryID: categoryID,
            amountCents: amountCents
        )
        if await model.saveBudgetOverride(body, view: "month") {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Budget could not be saved."
        }
    }
}

private struct BudgetTemplateFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let budgets: BudgetsResponse?
    @State private var frequency = "monthly"
    @State private var categoryID: Int?
    @State private var amount = ""
    @State private var startsOn: Date
    @State private var endsOn: Date?
    @State private var hasEndDate = false
    @State private var formError: String?

    init(budgets: BudgetsResponse?) {
        self.budgets = budgets
        _startsOn = State(initialValue: budgets?.defaultMonthTemplateStart ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Frequency", selection: $frequency) {
                        Text("Monthly").tag("monthly")
                        Text("Yearly").tag("yearly")
                    }
                    .pickerStyle(.segmented)
                    Picker("Category", selection: $categoryID) {
                        Text("All expense categories").tag(Int?.none)
                        ForEach(expenseCategories) { category in
                            Text(category.name).tag(Optional(category.id))
                        }
                    }
                    TextField("Amount", text: $amount)
                        .keyboardType(.decimalPad)
                }
                Section {
                    DatePicker("Starts on", selection: $startsOn, displayedComponents: .date)
                    Toggle("Has end date", isOn: $hasEndDate)
                    if hasEndDate {
                        DatePicker(
                            "Ends on",
                            selection: Binding(
                                get: { endsOn ?? startsOn },
                                set: { endsOn = $0 }
                            ),
                            displayedComponents: .date
                        )
                    }
                }
                if let formError {
                    Section {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Recurring Budget")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(model.isLoading)
                }
            }
            .onChange(of: frequency) { _, next in
                if next == "yearly", let date = budgets?.defaultYearTemplateStart {
                    startsOn = date
                }
                if next == "monthly", let date = budgets?.defaultMonthTemplateStart {
                    startsOn = date
                }
            }
        }
    }

    private var expenseCategories: [BudgetCategory] {
        budgets?.categories.filter { $0.type == "expense" && $0.archivedAt == nil } ?? []
    }

    private func save() async {
        guard let amountCents = BudgetFormParsing.parseAmount(amount) else {
            formError = "Amount is invalid."
            return
        }
        let body = BudgetTemplateRequest(
            frequency: frequency,
            categoryID: categoryID,
            amountCents: amountCents,
            startsOn: BudgetFormParsing.dateString(startsOn),
            endsOn: hasEndDate ? BudgetFormParsing.dateString(endsOn ?? startsOn) : nil
        )
        if await model.saveBudgetTemplate(body, view: "templates") {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Recurring budget could not be saved."
        }
    }
}

private enum BudgetFormParsing {
    static func parseAmount(_ raw: String) -> Int? {
        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value >= 0, value.isFinite else {
            return nil
        }
        return Int((value * 100).rounded())
    }

    static func dateString(_ date: Date) -> String {
        formatter.string(from: date)
    }

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
