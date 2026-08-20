import Charts
import SwiftUI

struct InsightsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var section: InsightsViewSection = .charts
    @State private var presentingFilters = false
    @State private var period = "all"
    @State private var typeFilter = ""
    @State private var selectedTagID: Int?
    @State private var excludedTagIDs: Set<Int> = []
    @State private var selectedTrendCategoryID: Int?
    @State private var draftPeriod = "all"
    @State private var draftTypeFilter = ""
    @State private var draftTagID: Int?
    @State private var draftExcludedTagIDs: Set<Int> = []

    private var reloadKey: String {
        let excluded = excludedTagIDs.sorted().map(String.init).joined(separator: ",")
        return "\(section.rawValue)-\(period)-\(typeFilter)-\(selectedTagID ?? -1)-\(excluded)-\(selectedTrendCategoryID ?? -1)"
    }

    var body: some View {
        NavigationStack {
            List {
                if model.identity?.authenticated != true {
                    SignedOutStateSection()
                } else {
                    Section {
                        InsightsSectionPicker(section: $section)
                    }

                    if section != .durables, hasAppliedFilters {
                        InsightsFilterSummarySection(
                            labels: activeFilterLabels,
                            onOpen: {
                                resetDraftFiltersToApplied()
                                presentingFilters = true
                            },
                            onClear: {
                                clearFilters()
                            }
                        )
                    }

                    switch section {
                    case .charts:
                        if let insights = model.insights {
                            InsightsChartsSection(insights: insights)
                            InsightsBreakdownSection(title: "Expenses", rows: insights.expenseBreakdown, color: ExpensesTheme.expense(for: scheme))
                            InsightsBreakdownSection(title: "Income", rows: insights.incomeBreakdown, color: ExpensesTheme.income(for: scheme))
                            InsightsTrendSection(
                                insights: insights,
                                selectedTrendCategoryID: $selectedTrendCategoryID
                            )
                            InsightsBudgetSection(
                                insights: insights,
                                hasViewExclusions: !excludedTagIDs.isEmpty
                            )
                        } else if model.showsInsightsInitialLoading {
                            LoadingStateSection(title: "Loading insights")
                        } else if model.showsInsightsLoadFailed {
                            UnavailableStateSection(title: "Couldn't load insights", systemImage: "exclamationmark.triangle", message: model.lastError?.message ?? "Pull to refresh to try again.")
                        } else {
                            ContentUnavailableView("No insights loaded", systemImage: "chart.xyaxis.line")
                        }
                    case .net:
                        if let flow = model.insightsFlow {
                            InsightsNetSection(flow: flow)
                        } else if model.isLoading {
                            LoadingStateSection(title: "Loading net view")
                        } else if model.showsInsightsFlowLoadFailed {
                            UnavailableStateSection(title: "Couldn't load income and spending", systemImage: "exclamationmark.triangle", message: model.lastError?.message ?? "Pull to refresh to try again.")
                        } else {
                            ContentUnavailableView("No income or spending loaded", systemImage: "chart.bar.xaxis")
                        }
                    case .durables:
                        if let durablePurchases = model.durablePurchases {
                            DurablePurchasesSection(items: durablePurchases.items)
                        } else if model.isLoading {
                            LoadingStateSection(title: "Loading durable purchases")
                        } else if model.showsDurablePurchasesLoadFailed {
                            UnavailableStateSection(title: "Couldn't load durable purchases", systemImage: "exclamationmark.triangle", message: model.lastError?.message ?? "Pull to refresh to try again.")
                        } else {
                            ContentUnavailableView("No durable purchases loaded", systemImage: "shippingbox")
                        }
                    }
                }
            }
            .navigationTitle("Insights")
            .expensesScreenStyle()
            .toolbar {
                if section != .durables {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            resetDraftFiltersToApplied()
                            presentingFilters = true
                        } label: {
                            Label("Filters", systemImage: hasAppliedFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $presentingFilters, onDismiss: resetDraftFiltersToApplied) {
                InsightsFiltersSheet(
                    period: $draftPeriod,
                    typeFilter: $draftTypeFilter,
                    selectedTagID: $draftTagID,
                    excludedTagIDs: $draftExcludedTagIDs,
                    tags: model.insights?.tags ?? [],
                    onApply: applyFilters,
                    onClear: clearFilters
                )
                .presentationDetents([.medium, .large])
            }
            .task(id: reloadKey) {
                await loadSelectedSection()
            }
            .refreshable {
                await loadSelectedSection()
            }
            .animation(.easeInOut(duration: 0.18), value: model.showsInsightsInitialLoading)
        }
    }

    private func loadSelectedSection() async {
        switch section {
        case .charts:
            await model.loadInsights(
                period: period,
                type: apiTypeFilter,
                tagID: selectedTagID,
                excludedTagIDs: excludedTagIDs.sorted(),
                trendCategoryID: selectedTrendCategoryID
            )
        case .net:
            await model.loadInsightsFlow(
                period: period,
                type: apiTypeFilter,
                tagID: selectedTagID,
                excludedTagIDs: excludedTagIDs.sorted()
            )
        case .durables:
            await model.loadDurablePurchases()
        }
    }

    private var apiTypeFilter: String? {
        typeFilter.isEmpty ? nil : typeFilter
    }

    private var hasAppliedFilters: Bool {
        period != "all" || !typeFilter.isEmpty || selectedTagID != nil || !excludedTagIDs.isEmpty
    }

    private var activeFilterLabels: [String] {
        var labels: [String] = []
        if period != "all" {
            labels.append(periodTitle(period))
        }
        if !typeFilter.isEmpty {
            labels.append(typeFilter == "income" ? "Income" : "Expenses")
        }
        if let selectedTagID,
           let tag = model.insights?.tags.first(where: { $0.id == selectedTagID }) {
            labels.append(tag.name)
        }
        labels.append(contentsOf: excludedTagIDs.sorted().compactMap { id in
            model.insights?.tags.first(where: { $0.id == id }).map { "Excluding: \($0.name)" }
        })
        return labels
    }

    private func applyFilters() {
        period = draftPeriod
        typeFilter = draftTypeFilter
        selectedTagID = draftTagID
        if let selectedTagID {
            draftExcludedTagIDs.remove(selectedTagID)
        }
        excludedTagIDs = draftExcludedTagIDs
    }

    private func clearFilters() {
        draftPeriod = "all"
        draftTypeFilter = ""
        draftTagID = nil
        draftExcludedTagIDs = []
        period = "all"
        typeFilter = ""
        selectedTagID = nil
        excludedTagIDs = []
    }

    private func resetDraftFiltersToApplied() {
        draftPeriod = period
        draftTypeFilter = typeFilter
        draftTagID = selectedTagID
        draftExcludedTagIDs = excludedTagIDs
    }
}

private struct InsightsSectionPicker: View {
    @Binding var section: InsightsViewSection

    var body: some View {
        Picker("View", selection: $section) {
            ForEach(InsightsViewSection.allCases) { item in
                Text(item.title).tag(item)
            }
        }
        .pickerStyle(.segmented)
        .sensoryFeedback(.selection, trigger: section)
    }
}

private enum InsightsViewSection: String, CaseIterable, Identifiable {
    case charts
    case net
    case durables

    var id: String { rawValue }

    var title: String {
        switch self {
        case .charts:
            "Charts"
        case .net:
            "Net"
        case .durables:
            "Durables"
        }
    }
}

private struct InsightsFiltersSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var period: String
    @Binding var typeFilter: String
    @Binding var selectedTagID: Int?
    @Binding var excludedTagIDs: Set<Int>
    let tags: [TransactionTag]
    var onApply: () -> Void
    var onClear: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Picker("Period", selection: $period) {
                    Text("All time").tag("all")
                    Text("This month").tag("this_month")
                    Text("Last month").tag("last_month")
                    Text("This year").tag("this_year")
                }
                Picker("Type", selection: $typeFilter) {
                    Text("All").tag("")
                    Text("Expenses").tag("expense")
                    Text("Income").tag("income")
                }
                Picker("Tag", selection: $selectedTagID) {
                    Text("All tags").tag(Optional<Int>.none)
                    ForEach(tags) { tag in
                        Text(tag.name).tag(Optional(tag.id))
                    }
                }
                TagExclusionSection(
                    tags: tags,
                    selectedIDs: $excludedTagIDs,
                    includedTagID: selectedTagID
                )
            }
            .pickerStyle(.navigationLink)
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") {
                        onClear()
                        dismiss()
                    }
                    .disabled(period == "all" && typeFilter.isEmpty && selectedTagID == nil && excludedTagIDs.isEmpty)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onApply()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
            .onChange(of: selectedTagID) { _, newValue in
                if let newValue {
                    excludedTagIDs.remove(newValue)
                }
            }
        }
    }
}

private struct InsightsFilterSummarySection: View {
    let labels: [String]
    var onOpen: () -> Void
    var onClear: () -> Void

    var body: some View {
        Section {
            HStack(spacing: 10) {
                Button(action: onOpen) {
                    Label(labels.joined(separator: " · "), systemImage: "line.3.horizontal.decrease.circle.fill")
                        .lineLimit(1)
                }
                .buttonStyle(.plain)

                Spacer(minLength: 8)

                Button(action: onClear) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear filters")
            }
            .font(.callout.weight(.medium))
        }
    }
}

private func periodTitle(_ period: String) -> String {
    switch period {
    case "this_month":
        "This month"
    case "last_month":
        "Last month"
    case "this_year":
        "This year"
    default:
        "All time"
    }
}

private struct InsightsChartsSection: View {
    @Environment(\.colorScheme) private var scheme

    let insights: InsightsResponse

    var body: some View {
        Section("Monthly Trend") {
            if insights.series.isEmpty {
                Text("No monthly data for this period.")
                    .foregroundStyle(.secondary)
            } else {
                Chart {
                    ForEach(insights.series.suffix(12)) { point in
                        LineMark(
                            x: .value("Month", point.label),
                            y: .value("Income", Double(point.incomeCents) / 100),
                            series: .value("Series", "Income")
                        )
                        .foregroundStyle(ExpensesTheme.income(for: scheme))
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                        .interpolationMethod(.monotone)

                        LineMark(
                            x: .value("Month", point.label),
                            y: .value("Expenses", Double(point.expenseCents) / 100),
                            series: .value("Series", "Expenses")
                        )
                        .foregroundStyle(ExpensesTheme.expense(for: scheme))
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                        .interpolationMethod(.monotone)
                    }
                }
                .chartLegend(.hidden)
                .chartXAxis(.hidden)
                .chartYAxis {
                    AxisMarks(position: .trailing) {
                        AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                            .foregroundStyle(Color(.separator))
                        AxisValueLabel(format: .currency(code: "EUR").precision(.fractionLength(0)))
                            .font(.caption2)
                            .foregroundStyle(Color(.secondaryLabel))
                    }
                }
                .frame(height: 220)

                HStack(spacing: 16) {
                    ChartLegendLabel(title: "Income", color: ExpensesTheme.income(for: scheme))
                    ChartLegendLabel(title: "Expenses", color: ExpensesTheme.expense(for: scheme))
                }
            }
        }

        Section("Movement") {
            InsightDeltaRows(title: "Increases", rows: insights.deltas.increases, color: ExpensesTheme.expense(for: scheme))
            InsightDeltaRows(title: "Decreases", rows: insights.deltas.decreases, color: ExpensesTheme.income(for: scheme))
        }

        Section("Top Tags") {
            if insights.topTags.isEmpty {
                Text("No tag spending for this filter.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(insights.topTags) { tag in
                    LabeledContent(tag.name, value: AppFormatters.euros(tag.amountCents))
                }
            }
        }
    }

}

private struct InsightsBreakdownSection: View {
    let title: String
    let rows: [BreakdownItem]
    let color: Color

    var body: some View {
        Section(title) {
            if rows.isEmpty {
                Text("No data.")
                    .foregroundStyle(.secondary)
            } else {
                CategoryRingChart(title: title, rows: rows, tint: color)
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(row.name)
                                .font(.body.weight(.medium))
                            Spacer()
                            Text(AppFormatters.euros(row.amountCents))
                                .font(.body.monospacedDigit())
                        }
                        ProgressView(value: min(100, max(0, row.percent)), total: 100)
                            .tint(color)
                    }
                }
            }
        }
    }
}

private struct InsightsTrendSection: View {
    @Environment(\.colorScheme) private var scheme

    let insights: InsightsResponse
    @Binding var selectedTrendCategoryID: Int?

    private var expenseCategories: [InsightsCategory] {
        insights.categories.filter { $0.type == "expense" }
    }

    private var trendCategorySelection: Binding<Int?> {
        Binding(
            get: { selectedTrendCategoryID ?? insights.trendCategoryID },
            set: { selectedTrendCategoryID = $0 }
        )
    }

    var body: some View {
        Section("Selected Category Trend") {
            if expenseCategories.isEmpty {
                Text("No expense categories available.")
                    .foregroundStyle(.secondary)
            } else {
                Picker("Category", selection: trendCategorySelection) {
                    ForEach(expenseCategories) { category in
                        Text(category.name).tag(Optional(category.id))
                    }
                }
            }

            if insights.trend.isEmpty {
                Text("No trend data.")
                    .foregroundStyle(.secondary)
            } else {
                Chart {
                    ForEach(insights.trend) { point in
                        BarMark(
                            x: .value("Month", point.label),
                            y: .value("Amount", point.amountCents)
                        )
                        .foregroundStyle(ExpensesTheme.accent(for: scheme))
                        .cornerRadius(6)
                    }
                }
                .chartLegend(.hidden)
                .chartXAxis(.hidden)
                .frame(height: 220)
            }
        }
    }
}

private struct ChartLegendLabel: View {
    let title: String
    let color: Color

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
    }
}

private struct InsightsBudgetSection: View {
    let insights: InsightsResponse
    let hasViewExclusions: Bool

    var body: some View {
        Section("Budget Pulse") {
            if hasViewExclusions {
                Text("Budget figures stay based on your full budget activity.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if insights.budgetEffective.isEmpty {
                Text("No budgets for \(insights.budgetMonth).")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(insights.budgetEffective) { budget in
                    let progress = insights.budgetProgress[progressKey(budget.scopeCategoryID)]
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(budget.scopeLabel)
                                .font(.body.weight(.medium))
                            Spacer()
                            Text(AppFormatters.euros(budget.amountCents))
                        }
                        if let progress {
                            ProgressView(
                                value: Double(progress.spentCents),
                                total: Double(max(budget.amountCents, 1))
                            )
                            .tint(progress.remainingCents < 0 ? .red : .blue)
                            Text("Spent \(AppFormatters.euros(progress.spentCents)) · remaining \(AppFormatters.euros(progress.remainingCents))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func progressKey(_ categoryID: Int?) -> String {
        categoryID.map(String.init) ?? "null"
    }
}

private struct InsightDeltaRows: View {
    let title: String
    let rows: [InsightsDeltaItem]
    let color: Color

    var body: some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(rows) { row in
                    LabeledContent(row.categoryName, value: signedEuros(row.deltaCents))
                        .foregroundStyle(color)
                }
            }
        }
    }

    private func signedEuros(_ amount: Int) -> String {
        "\(amount >= 0 ? "+" : "")\(AppFormatters.euros(amount))"
    }
}

private struct InsightsNetSection: View {
    @Environment(\.colorScheme) private var scheme

    let flow: InsightsFlowResponse

    @State private var selectedStepID: String?
    @State private var detailStepID = "result"
    @State private var presentingData = false

    private let maxIncomeSteps = 3
    private let maxExpenseSteps = 5

    private var steps: [CashFlowWaterfallStep] {
        let incomeNodes = flow.nodes.filter { $0.type == "income" && $0.amountCents > 0 }
        let expenseNodes = flow.nodes.filter { $0.type == "expense" && $0.amountCents > 0 }
        let changes = collapsedSteps(incomeNodes, kind: .income, maximum: maxIncomeSteps)
            + collapsedSteps(expenseNodes, kind: .expense, maximum: maxExpenseSteps)

        var runningBalance = 0
        var result = changes.map { step in
            let start = runningBalance
            runningBalance += step.amountCents
            return CashFlowWaterfallStep(
                id: step.id,
                label: step.label,
                kind: step.kind,
                amountCents: step.amountCents,
                startCents: start,
                endCents: runningBalance,
                members: step.members
            )
        }
        result.append(
            CashFlowWaterfallStep(
                id: "result",
                label: "Net",
                kind: .result,
                amountCents: runningBalance,
                startCents: 0,
                endCents: runningBalance,
                members: []
            )
        )
        return result
    }

    private var totalIncome: Int {
        flow.nodes.filter { $0.type == "income" }.reduce(0) { $0 + $1.amountCents }
    }

    private var totalSpending: Int {
        flow.nodes.filter { $0.type == "expense" }.reduce(0) { $0 + $1.amountCents }
    }

    private var detailStep: CashFlowWaterfallStep? {
        steps.first { $0.id == detailStepID } ?? steps.last
    }

    private var periodLabel: String {
        if flow.period.slug == "all" {
            return "All time"
        }
        return "\(flow.period.start.formatted(date: .abbreviated, time: .omitted))–\(flow.period.end.formatted(date: .abbreviated, time: .omitted))"
    }

    var body: some View {
        Group {
            if steps.count <= 1 {
                Section {
                    ContentUnavailableView("No income or spending data", systemImage: "chart.bar.xaxis")
                }
            } else {
                Section {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .top, spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Income & spending")
                                    .font(.title3.weight(.bold))
                                Text("\(periodLabel) · Recorded totals")
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                            }

                            Spacer(minLength: 8)

                            Button {
                                presentingData = true
                            } label: {
                                Image(systemName: "tablecells")
                                    .frame(width: 32, height: 32)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("View chart data")
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            selectedStepID = nil
                        }

                        HStack(spacing: 14) {
                            CashFlowLegendLabel(title: "Income", color: ExpensesTheme.income(for: scheme))
                            CashFlowLegendLabel(title: "Spending", color: ExpensesTheme.expense(for: scheme))
                            CashFlowLegendLabel(title: "Net", color: ExpensesTheme.accent(for: scheme))
                        }

                        CashFlowWaterfallChart(
                            steps: steps,
                            selectedStepID: $selectedStepID
                        )
                    }
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowBackground(Color.clear)
                .onChange(of: selectedStepID) { _, selectedID in
                    if let selectedID {
                        detailStepID = selectedID
                    }
                }

                if let detailStep {
                    Section {
                        CashFlowStepDetails(
                            step: detailStep,
                            totalIncome: totalIncome,
                            totalSpending: totalSpending
                        )
                        .onTapGesture {
                            selectedStepID = nil
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                }

                Text("Expenses are not assigned to specific income sources.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
        }
        .sheet(isPresented: $presentingData) {
            CashFlowDataSheet(steps: steps)
        }
        .onChange(of: flow) { _, _ in
            selectedStepID = nil
            detailStepID = "result"
        }
    }

    private func collapsedSteps(
        _ nodes: [InsightsFlowNode],
        kind: CashFlowWaterfallStep.Kind,
        maximum: Int
    ) -> [CashFlowWaterfallStep] {
        let sorted = nodes.sorted {
            $0.amountCents == $1.amountCents
                ? $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending
                : $0.amountCents > $1.amountCents
        }
        if sorted.count <= maximum {
            return sorted.map { node in
                CashFlowWaterfallStep(
                    id: node.id,
                    label: node.label,
                    kind: kind,
                    amountCents: kind == .expense ? -node.amountCents : node.amountCents,
                    startCents: 0,
                    endCents: 0,
                    members: [node]
                )
            }
        }

        let visible = sorted.prefix(maximum - 1).map { node in
            CashFlowWaterfallStep(
                id: node.id,
                label: node.label,
                kind: kind,
                amountCents: kind == .expense ? -node.amountCents : node.amountCents,
                startCents: 0,
                endCents: 0,
                members: [node]
            )
        }
        let remainder = Array(sorted.dropFirst(maximum - 1))
        let remainderAmount = remainder.reduce(0) { $0 + $1.amountCents }
        return visible + [
            CashFlowWaterfallStep(
                id: "\(kind.rawValue):other",
                label: kind == .income ? "Other income" : "Other spending",
                kind: kind,
                amountCents: kind == .expense ? -remainderAmount : remainderAmount,
                startCents: 0,
                endCents: 0,
                members: remainder
            )
        ]
    }
}

private struct CashFlowWaterfallStep: Identifiable, Equatable {
    enum Kind: String {
        case income
        case expense
        case result
    }

    let id: String
    let label: String
    let kind: Kind
    let amountCents: Int
    let startCents: Int
    let endCents: Int
    let members: [InsightsFlowNode]
}

private struct CashFlowConnector: Identifiable {
    var id: String { "\(fromID)-\(toID)" }
    let fromID: String
    let toID: String
    let balanceCents: Int
}

private struct CashFlowAxis {
    let minimum: Int
    let maximum: Int
    let ticks: [Int]
}

private struct CashFlowWaterfallChart: View {
    @Environment(\.colorScheme) private var scheme

    let steps: [CashFlowWaterfallStep]
    @Binding var selectedStepID: String?

    private var connectors: [CashFlowConnector] {
        zip(steps, steps.dropFirst()).map { current, next in
            CashFlowConnector(fromID: current.id, toID: next.id, balanceCents: current.endCents)
        }
    }

    private var axis: CashFlowAxis {
        cashFlowAxis(for: steps)
    }

    var body: some View {
        Chart {
            ForEach(connectors) { connector in
                RuleMark(
                    x: .value("Balance", connector.balanceCents),
                    yStart: .value("From", connector.fromID),
                    yEnd: .value("To", connector.toID)
                )
                .foregroundStyle(Color.secondary.opacity(0.38))
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }

            ForEach(steps) { step in
                if selectedStepID == step.id {
                    BarMark(
                        xStart: .value("Start balance", step.startCents),
                        xEnd: .value("End balance", step.endCents),
                        y: .value("Step", step.id),
                        height: .fixed(20)
                    )
                    .foregroundStyle(Color.primary.opacity(0.82))
                    .cornerRadius(5)

                    PointMark(
                        x: .value("Balance after", step.endCents),
                        y: .value("Step", step.id)
                    )
                    .symbolSize(54)
                    .foregroundStyle(Color.primary.opacity(0.82))
                }

                BarMark(
                    xStart: .value("Start balance", step.startCents),
                    xEnd: .value("End balance", step.endCents),
                    y: .value("Step", step.id),
                    height: .fixed(14)
                )
                .foregroundStyle(color(for: step.kind))
                .cornerRadius(4)
                .accessibilityLabel(step.label)
                .accessibilityValue("\(signedEuros(step.amountCents)); balance after \(signedEuros(step.endCents))")

                PointMark(
                    x: .value("Balance after", step.endCents),
                    y: .value("Step", step.id)
                )
                .symbolSize(24)
                .foregroundStyle(color(for: step.kind))
                .accessibilityHidden(true)
            }
        }
        .chartLegend(.hidden)
        .chartXScale(domain: axis.minimum ... axis.maximum)
        .chartYScale(domain: Array(steps.map(\.id).reversed()))
        .chartXAxis {
            AxisMarks(position: .top, values: axis.ticks) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                    .foregroundStyle(Color.secondary.opacity(0.28))
                AxisValueLabel {
                    if let cents = value.as(Int.self) {
                        Text(shortEuros(cents))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: steps.map(\.id)) { value in
                AxisValueLabel {
                    if let id = value.as(String.self),
                       let step = steps.first(where: { $0.id == id }) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(step.label)
                                .font(.caption.weight(.semibold))
                                .lineLimit(2)
                            Text(signedEuros(step.amountCents))
                                .font(.caption2.monospacedDigit().weight(.semibold))
                                .foregroundStyle(color(for: step.kind))
                        }
                        .frame(width: 94, alignment: .leading)
                    }
                }
            }
        }
        .chartYSelection(value: $selectedStepID)
        .frame(height: CGFloat(steps.count * 58 + 26))
    }

    private func color(for kind: CashFlowWaterfallStep.Kind) -> Color {
        switch kind {
        case .income:
            ExpensesTheme.income(for: scheme)
        case .expense:
            ExpensesTheme.expense(for: scheme)
        case .result:
            ExpensesTheme.accent(for: scheme)
        }
    }
}

private struct CashFlowLegendLabel: View {
    let title: String
    let color: Color

    var body: some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 8, height: 8)
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

private struct CashFlowStepDetails: View {
    @Environment(\.colorScheme) private var scheme

    let step: CashFlowWaterfallStep
    let totalIncome: Int
    let totalSpending: Int

    private var share: Int {
        let base = step.kind == .income ? totalIncome : totalSpending
        guard base > 0 else { return 0 }
        return Int((Double(abs(step.amountCents)) / Double(base) * 100).rounded())
    }

    var body: some View {
        GlassSurface(padding: 16) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(color)
                        .frame(width: 36, height: 36)
                        .background(color.opacity(0.13), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(step.label)
                            .font(.headline)
                            .lineLimit(1)
                        Text(kindLabel.uppercased())
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }

                Text(signedEuros(step.amountCents))
                    .font(.system(size: 30, weight: .semibold, design: .monospaced))
                    .foregroundStyle(color)

                if step.kind == .result {
                    VStack(spacing: 0) {
                        CashFlowDetailRow(title: "Income", value: signedEuros(totalIncome))
                        Divider()
                        CashFlowDetailRow(title: "Spending", value: signedEuros(-totalSpending))
                    }
                } else {
                    HStack(spacing: 8) {
                        CashFlowMetric(
                            title: step.kind == .income ? "Share of income" : "Share of spending",
                            value: "\(share)%"
                        )
                        CashFlowMetric(title: "Balance after", value: signedEuros(step.endCents))
                    }

                    if step.members.count > 1 {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("BREAKDOWN")
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                                .padding(.bottom, 4)
                            ForEach(step.members.prefix(5)) { member in
                                CashFlowDetailRow(
                                    title: member.label,
                                    value: signedEuros(step.kind == .expense ? -member.amountCents : member.amountCents)
                                )
                                if member.id != step.members.prefix(5).last?.id {
                                    Divider()
                                }
                            }
                            if step.members.count > 5 {
                                Text("\(step.members.count - 5) more in the data view")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .padding(.top, 8)
                            }
                        }
                    }
                }
            }
        }
    }

    private var color: Color {
        switch step.kind {
        case .income:
            ExpensesTheme.income(for: scheme)
        case .expense:
            ExpensesTheme.expense(for: scheme)
        case .result:
            ExpensesTheme.accent(for: scheme)
        }
    }

    private var icon: String {
        switch step.kind {
        case .income: "arrow.up.right"
        case .expense: "basket"
        case .result: "checkmark.circle"
        }
    }

    private var kindLabel: String {
        switch step.kind {
        case .income: "Income source"
        case .expense: "Expense group"
        case .result: "Period result"
        }
    }
}

private struct CashFlowMetric: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.monospacedDigit().weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(11)
        .background(Color.secondary.opacity(0.09), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct CashFlowDetailRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack(spacing: 12) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(value)
                .font(.caption.monospacedDigit().weight(.semibold))
        }
        .frame(minHeight: 40)
    }
}

private struct CashFlowDataSheet: View {
    @Environment(\.dismiss) private var dismiss

    let steps: [CashFlowWaterfallStep]

    var body: some View {
        NavigationStack {
            List {
                ForEach(steps) { step in
                    if step.members.count > 1 {
                        DisclosureGroup {
                            ForEach(step.members) { member in
                                LabeledContent(
                                    member.label,
                                    value: signedEuros(
                                        step.kind == .expense ? -member.amountCents : member.amountCents
                                    )
                                )
                                .font(.caption)
                            }
                        } label: {
                            CashFlowDataRow(step: step)
                        }
                    } else {
                        CashFlowDataRow(step: step)
                    }
                }

                Section {
                    Text("Expenses are not assigned to specific income sources.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Chart data")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .themeAccentTint()
    }
}

private struct CashFlowDataRow: View {
    let step: CashFlowWaterfallStep

    var body: some View {
        LabeledContent {
            VStack(alignment: .trailing, spacing: 3) {
                Text(signedEuros(step.amountCents))
                    .font(.body.monospacedDigit().weight(.semibold))
                Text("Balance \(signedEuros(step.endCents))")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        } label: {
            Text(step.label)
                .font(.body.weight(.medium))
        }
    }
}

private func cashFlowAxis(for steps: [CashFlowWaterfallStep]) -> CashFlowAxis {
    let rawMinimum = min(0, steps.flatMap { [$0.startCents, $0.endCents] }.min() ?? 0)
    let rawMaximum = max(0, steps.flatMap { [$0.startCents, $0.endCents] }.max() ?? 0)
    let span = max(100, rawMaximum - rawMinimum)
    let roughStep = Double(span) / 4
    let magnitude = pow(10, floor(log10(roughStep)))
    let normalized = roughStep / magnitude
    let multiplier = normalized <= 1 ? 1.0 : normalized <= 2 ? 2.0 : normalized <= 5 ? 5.0 : 10.0
    let tickSize = max(100, Int(multiplier * magnitude))
    var minimum = Int(floor(Double(rawMinimum) / Double(tickSize))) * tickSize
    var maximum = Int(ceil(Double(rawMaximum) / Double(tickSize))) * tickSize
    if minimum == maximum {
        maximum += tickSize
    }
    var ticks = Array(stride(from: minimum, through: maximum, by: tickSize))
    if ticks.count < 2 {
        minimum = min(0, minimum - tickSize)
        maximum = max(tickSize, maximum + tickSize)
        ticks = [minimum, maximum]
    }
    return CashFlowAxis(minimum: minimum, maximum: maximum, ticks: ticks)
}

private func signedEuros(_ cents: Int) -> String {
    if cents == 0 {
        return AppFormatters.euros(0)
    }
    return "\(cents > 0 ? "+" : "−")\(AppFormatters.euros(abs(cents)))"
}

private func shortEuros(_ cents: Int) -> String {
    let euros = abs(Double(cents) / 100)
    let sign = cents < 0 ? "−" : ""
    if euros >= 1000 {
        let thousands = euros / 1000
        let formatted = thousands.formatted(.number.precision(.fractionLength(thousands >= 10 ? 0 : 1)))
        return "\(sign)\(formatted)k €"
    }
    return "\(sign)\(euros.formatted(.number.precision(.fractionLength(0)))) €"
}

private struct DurablePurchasesSection: View {
    let items: [DashboardDurablePurchase]

    var body: some View {
        Section("Durable Purchases") {
            if items.isEmpty {
                Text("No durable purchases.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(item.title ?? item.category?.name ?? "Durable purchase")
                                .font(.body.weight(.medium))
                            Spacer()
                            Text(AppFormatters.euros(item.remainingCents))
                                .font(.body.monospacedDigit())
                        }
                        ProgressView(value: min(100, max(0, item.percentAmortized)), total: 100)
                            .tint(item.fullyAmortized ? .green : .blue)
                        Text("\(item.daysOwned) of \(item.expectedLifespanDays) days · paid for itself on \(AppFormatters.day(item.paidForItselfOn))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }
}

#Preview("Net chart") {
    List {
        InsightsNetSection(
            flow: InsightsFlowResponse(
                period: Period(
                    slug: "this_month",
                    start: Date.now.addingTimeInterval(-14 * 86_400),
                    end: .now
                ),
                filters: InsightsFilters(type: nil, tagID: nil, excludedTagIDs: []),
                nodes: [
                    InsightsFlowNode(id: "income:1", label: "Salary", type: "income", amountCents: 325_000, categoryID: 1),
                    InsightsFlowNode(id: "income:2", label: "Bank transfer", type: "income", amountCents: 145_000, categoryID: 2),
                    InsightsFlowNode(id: "expense:3", label: "Groceries", type: "expense", amountCents: 121_000, categoryID: 3),
                    InsightsFlowNode(id: "expense:4", label: "Food and dining", type: "expense", amountCents: 71_000, categoryID: 4),
                    InsightsFlowNode(id: "expense:5", label: "Travel", type: "expense", amountCents: 61_500, categoryID: 5),
                    InsightsFlowNode(id: "expense:6", label: "Health", type: "expense", amountCents: 40_500, categoryID: 6),
                    InsightsFlowNode(id: "savings", label: "Net savings", type: "savings", amountCents: 176_000, categoryID: nil)
                ],
                links: []
            )
        )
    }
    .expensesScreenStyle()
}

#Preview("Net chart empty") {
    List {
        InsightsNetSection(
            flow: InsightsFlowResponse(
                period: Period(slug: "all", start: .now, end: .now),
                filters: InsightsFilters(type: nil, tagID: nil, excludedTagIDs: []),
                nodes: [],
                links: []
            )
        )
    }
    .expensesScreenStyle()
}

#Preview {
    InsightsView()
        .environment(AppModel())
}
