import Charts
import SwiftUI

struct InsightsView: View {
    @Environment(AppModel.self) private var model
    @State private var section: InsightsViewSection = .charts
    @State private var presentingFilters = false
    @State private var period = "all"
    @State private var typeFilter = ""
    @State private var selectedTagID: Int?
    @State private var selectedTrendCategoryID: Int?
    @State private var draftPeriod = "all"
    @State private var draftTypeFilter = ""
    @State private var draftTagID: Int?

    private var reloadKey: String {
        "\(section.rawValue)-\(period)-\(typeFilter)-\(selectedTagID ?? -1)-\(selectedTrendCategoryID ?? -1)"
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
                            InsightsBreakdownSection(title: "Expenses", rows: insights.expenseBreakdown, color: .red)
                            InsightsBreakdownSection(title: "Income", rows: insights.incomeBreakdown, color: .green)
                            InsightsTrendSection(
                                insights: insights,
                                selectedTrendCategoryID: $selectedTrendCategoryID
                            )
                            InsightsBudgetSection(insights: insights)
                        } else if model.showsInsightsInitialLoading {
                            LoadingStateSection(title: "Loading insights")
                        } else {
                            ContentUnavailableView("No insights loaded", systemImage: "chart.xyaxis.line")
                        }
                    case .flow:
                        if let flow = model.insightsFlow {
                            InsightsFlowSection(flow: flow)
                        } else if model.isLoading {
                            LoadingStateSection(title: "Loading flow")
                        } else {
                            ContentUnavailableView("No flow loaded", systemImage: "point.3.connected.trianglepath.dotted")
                        }
                    case .durables:
                        if let durablePurchases = model.durablePurchases {
                            DurablePurchasesSection(items: durablePurchases.items)
                        } else if model.isLoading {
                            LoadingStateSection(title: "Loading durable purchases")
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
                trendCategoryID: selectedTrendCategoryID
            )
        case .flow:
            await model.loadInsightsFlow(period: period, type: apiTypeFilter, tagID: selectedTagID)
        case .durables:
            await model.loadDurablePurchases()
        }
    }

    private var apiTypeFilter: String? {
        typeFilter.isEmpty ? nil : typeFilter
    }

    private var hasAppliedFilters: Bool {
        period != "all" || !typeFilter.isEmpty || selectedTagID != nil
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
        return labels
    }

    private func applyFilters() {
        period = draftPeriod
        typeFilter = draftTypeFilter
        selectedTagID = draftTagID
    }

    private func clearFilters() {
        draftPeriod = "all"
        draftTypeFilter = ""
        draftTagID = nil
        period = "all"
        typeFilter = ""
        selectedTagID = nil
    }

    private func resetDraftFiltersToApplied() {
        draftPeriod = period
        draftTypeFilter = typeFilter
        draftTagID = selectedTagID
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
    case flow
    case durables

    var id: String { rawValue }

    var title: String {
        switch self {
        case .charts:
            "Charts"
        case .flow:
            "Flow"
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
                    .disabled(period == "all" && typeFilter.isEmpty && selectedTagID == nil)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onApply()
                        dismiss()
                    }
                    .fontWeight(.semibold)
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
                            y: .value("Income", point.incomeCents),
                            series: .value("Series", "Income")
                        )
                        .foregroundStyle(ExpensesTheme.income(for: scheme))
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                        .interpolationMethod(.monotone)

                        LineMark(
                            x: .value("Month", point.label),
                            y: .value("Expenses", point.expenseCents),
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
                            .foregroundStyle(.secondary.opacity(0.18))
                        AxisValueLabel()
                            .font(.caption2)
                            .foregroundStyle(.secondary)
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
            InsightDeltaRows(title: "Increases", rows: insights.deltas.increases, color: .red)
            InsightDeltaRows(title: "Decreases", rows: insights.deltas.decreases, color: .green)
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

    var body: some View {
        Section("Budget Pulse") {
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

private struct InsightsFlowSection: View {
    let flow: InsightsFlowResponse

    private var sourceNodes: [InsightsFlowNode] {
        flow.nodes.filter { $0.type == "income" || $0.type == "deficit" }
    }

    private var sinkNodes: [InsightsFlowNode] {
        flow.nodes.filter { $0.type == "expense" || $0.type == "savings" }
    }

    var body: some View {
        Section("Sources") {
            FlowNodeRows(nodes: sourceNodes, color: .green)
        }
        Section("Uses") {
            FlowNodeRows(nodes: sinkNodes, color: .red)
        }
        Section("Links") {
            if flow.links.isEmpty {
                Text("No flow links for this filter.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(flow.links) { link in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(label(for: link.from)) -> \(label(for: link.to))")
                            .font(.body.weight(.medium))
                        Text(AppFormatters.euros(link.amountCents))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func label(for id: String) -> String {
        flow.nodes.first { $0.id == id }?.label ?? id
    }
}

private struct FlowNodeRows: View {
    let nodes: [InsightsFlowNode]
    let color: Color

    private var maxValue: Double {
        Double(nodes.map(\.amountCents).max() ?? 1)
    }

    var body: some View {
        if nodes.isEmpty {
            Text("No data.")
                .foregroundStyle(.secondary)
        } else {
            ForEach(nodes) { node in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(node.label)
                            .font(.body.weight(.medium))
                        Spacer()
                        Text(AppFormatters.euros(node.amountCents))
                            .font(.body.monospacedDigit())
                    }
                    ProgressView(value: Double(node.amountCents), total: maxValue)
                        .tint(color)
                }
            }
        }
    }
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

#Preview {
    InsightsView()
        .environment(AppModel())
}
