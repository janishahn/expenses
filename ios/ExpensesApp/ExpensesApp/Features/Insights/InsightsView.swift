import Charts
import SwiftUI
import UIKit

/// The period's totals and its income and expenses by month, then the last 12 full
/// months and the current one: recurring spending, amounts by month, daily spending,
/// and budget history.
struct InsightsView: View {
    @Environment(AppModel.self) private var model

    let openTransactions: (TransactionQuery) -> Void
    let openBudgets: (CalendarMonth) -> Void

    // The period and tags; Insights takes no type, category or search.
    @State private var query = TransactionQuery()
    @State private var presentingFilter = false
    @State private var gridKind = GridKind.expense
    @State private var insights: (query: TransactionQuery, result: Result<InsightsResponse, APIErrorInfo>)?
    @State private var grids: [GridKind: Result<InsightsMonthGridResponse, APIErrorInfo>] = [:]
    @State private var split: Result<InsightsRecurringSplitResponse, APIErrorInfo>?
    @State private var calendar: Result<InsightsDayCalendarResponse, APIErrorInfo>?
    @State private var budgetHistory: Result<InsightsBudgetHistoryResponse, APIErrorInfo>?
    // The ledger revision the figures were loaded at; an edit to a transaction or budget reloads them.
    @State private var revision: Int?

    private var tags: [TransactionTag] {
        if case .success(let data) = insights?.result {
            return data.tags
        }
        return []
    }

    var body: some View {
        NavigationStack {
            List {
                switch insights?.result {
                case nil:
                    LoadingStateSection(title: "Loading insights")
                case .failure(let error):
                    UnavailableStateSection(title: "Couldn't load insights", systemImage: "exclamationmark.triangle", message: error.message) {
                        await loadInsights()
                    }
                case .success(let data):
                    MetricsSection(data: data)
                    IncomeExpensesSection(series: data.series)
                    RecurringSection(split: split)
                    MonthGridSection(kind: $gridKind, grid: grids[gridKind])
                    DailySpendingSection(calendar: calendar, openTransactions: openTransactions)
                    BudgetHistorySection(history: budgetHistory, openBudgets: openBudgets)
                }
            }
            .refreshable {
                await reload()
            }
            .headerProminence(.increased)
            .environment(\.defaultMinListRowHeight, 28)
            .navigationTitle("Insights")
            .navigationSubtitle(([query.period.title] + [query.tagSummary(tags)].compactMap { $0 }).joined(separator: " · "))
            .expensesScreenStyle()
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    PeriodMenu(period: $query.period)
                    Button {
                        presentingFilter = true
                    } label: {
                        Label("Filter", systemImage: query.tagIDs.isEmpty ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
                    }
                }
            }
            .sheet(isPresented: $presentingFilter) {
                InsightsFilterSheet(query: $query, tags: tags)
            }
            .navigationDestination(for: MonthGridRoute.self) { route in
                MonthGridRowView(route: route, openTransactions: openTransactions)
            }
            .navigationDestination(for: BudgetHistoryRoute.self) { route in
                if case .success(let data) = budgetHistory, let row = data.rows.first(where: { $0.categoryID == route.categoryID }) {
                    BudgetHistoryRowView(row: row, openBudgets: openBudgets)
                }
            }
            .task(id: query) {
                if insights?.query != query {
                    await loadInsights()
                }
            }
            .task(id: gridKind) {
                if grids[gridKind] == nil {
                    await loadGrid()
                }
            }
            .task(id: model.ledgerRevision) {
                let current = model.ledgerRevision
                if let revision, revision != current {
                    await reload()
                } else if split == nil {
                    await loadWindows()
                }
                if !Task.isCancelled {
                    revision = current
                }
            }
        }
    }

    private func reload() async {
        grids = [:]
        async let insights: Void = loadInsights()
        async let grid: Void = loadGrid()
        async let windows: Void = loadWindows()
        _ = await (insights, grid, windows)
    }

    private func loadInsights() async {
        let query = query
        let result = await model.chart { try await $0.insights(query, token: $1) }
        if !Task.isCancelled {
            insights = (query, result)
        }
    }

    private func loadGrid() async {
        let kind = gridKind
        let result = await model.chart { try await $0.insightsMonthGrid(kind: kind.rawValue, token: $1) }
        if !Task.isCancelled {
            grids[kind] = result
        }
    }

    // The fixed windows, which follow neither the period nor the tags.
    private func loadWindows() async {
        async let split = model.chart { try await $0.insightsRecurringSplit(token: $1) }
        async let calendar = model.chart { try await $0.insightsDayCalendar(token: $1) }
        async let budgetHistory = model.chart { try await $0.insightsBudgetHistory(token: $1) }
        let results = await (split, calendar, budgetHistory)
        guard !Task.isCancelled else {
            return
        }
        (self.split, self.calendar, self.budgetHistory) = results
    }
}

/// Tags to include or exclude. Changes apply as they are made.
private struct InsightsFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var query: TransactionQuery
    let tags: [TransactionTag]

    var body: some View {
        NavigationStack {
            Form {
                TagFilterSection(mode: $query.tagMode, ids: $query.tagIDs, tags: tags)
            }
            .navigationTitle("Filter")
            .navigationBarTitleDisplayMode(.inline)
            .expensesScreenStyle()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear") {
                        query.tagIDs = []
                    }
                    .disabled(query.tagIDs.isEmpty)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", role: .confirm) {
                        dismiss()
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: query)
        }
        .presentationDetents([.medium, .large])
    }
}

private struct MetricsSection: View {
    @Environment(\.colorScheme) private var scheme

    let data: InsightsResponse

    var body: some View {
        Section {
            // At large text sizes the four figures stack.
            ViewThatFits(in: .horizontal) {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 16) {
                    GridRow {
                        income
                        spent
                    }
                    GridRow {
                        saved
                        recurring
                    }
                }
                VStack(alignment: .leading, spacing: 16) {
                    income
                    spent
                    saved
                    recurring
                }
            }
            .padding(.vertical, 6)
        }
        .expensesRowBackground()
    }

    private var income: some View {
        Metric("Income") {
            AmountText(data.incomeCents)
        } detail: {
            if data.monthCount > 1 {
                Text("\(data.monthCount) months")
            }
        }
    }

    private var spent: some View {
        Metric("Spent") {
            AmountText(data.expenseCents)
        } detail: {
            if data.monthCount > 1 {
                HStack(spacing: 4) {
                    AmountText(Int((Double(data.expenseCents) / Double(data.monthCount)).rounded()))
                    Text("per month")
                }
            }
        }
    }

    private var saved: some View {
        let saved = data.incomeCents - data.expenseCents
        return Metric("Saved") {
            AmountText(saved, signed: saved < 0)
                .foregroundStyle(saved > 0 ? ExpensesTheme.income(for: scheme) : .primary)
        } detail: {
            if data.incomeCents > 0 {
                Text("\(percent(saved, of: data.incomeCents)) of income")
            }
        }
    }

    private var recurring: some View {
        Metric("Recurring") {
            Text(data.expenseCents > 0 ? percent(data.recurringCents, of: data.expenseCents) : "–")
        } detail: {
            if data.expenseCents > 0 {
                Text("of spending")
            }
        }
    }
}

private struct IncomeExpensesSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var selected: Int?
    // Room for the first and last month's label at every text size.
    @ScaledMetric(relativeTo: .caption2) private var edge = 14.0

    let series: [InsightsMonthlySeriesPoint]

    var body: some View {
        Section("Income and expenses") {
            if series.isEmpty {
                ChartMessage(text: "No transactions in this period.")
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    chart
                    ChartLegend {
                        ChartLegendItem(title: "Income", color: ExpensesTheme.income(for: scheme), mark: .line)
                        ChartLegendItem(title: "Expenses", color: .primary, mark: .line)
                        ChartLegendItem(title: "Saved", color: savedColor, mark: .area)
                        if series[..<cut].contains(where: { $0.expenseCents > $0.incomeCents }) {
                            ChartLegendItem(title: "Overspent", color: overspentColor, mark: .area)
                        }
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .expensesRowBackground()
    }

    private var savedColor: Color {
        ExpensesTheme.income(for: scheme).opacity(scheme == .dark ? 0.12 : 0.1)
    }

    private var overspentColor: Color {
        ExpensesTheme.expense(for: scheme).opacity(scheme == .dark ? 0.12 : 0.1)
    }

    /// The month in progress: its lines are dashed and it has no band.
    private var partial: Int? {
        guard let point = series.last, CalendarMonth(year: point.year, month: point.month) == .current else {
            return nil
        }
        return series.count - 1
    }

    private var cut: Int {
        partial ?? series.count
    }

    /// The full months, plus a point where the lines cross, so the saved and overspent bands meet there.
    private var bandPoints: [(x: Double, income: Double, expenses: Double)] {
        var points: [(x: Double, income: Double, expenses: Double)] = []
        for (index, point) in series[..<cut].enumerated() {
            let income = Double(point.incomeCents)
            let expenses = Double(point.expenseCents)
            if let previous = points.last {
                let before = previous.income - previous.expenses
                let after = income - expenses
                if before * after < 0 {
                    let share = before / (before - after)
                    let value = previous.income + share * (income - previous.income)
                    points.append((previous.x + share, value, value))
                }
            }
            points.append((Double(index), income, expenses))
        }
        return points
    }

    private var chart: some View {
        let months = series.map { CalendarMonth(year: $0.year, month: $0.month) }
        let last = series.count - 1
        let income = ExpensesTheme.income(for: scheme)
        // The latest month keeps its label; one month sits in the middle.
        let labeled = Array(stride(from: last % 3, through: last, by: 3))
        return Chart {
            ForEach(bandPoints, id: \.x) { point in
                AreaMark(
                    x: .value("Month", point.x),
                    yStart: .value("Expenses", point.expenses),
                    yEnd: .value("Income", max(point.income, point.expenses)),
                    series: .value("Band", "Saved")
                )
                .foregroundStyle(savedColor)
                .accessibilityHidden(true)
                AreaMark(
                    x: .value("Month", point.x),
                    yStart: .value("Income", point.income),
                    yEnd: .value("Expenses", max(point.income, point.expenses)),
                    series: .value("Band", "Overspent")
                )
                .foregroundStyle(overspentColor)
                .accessibilityHidden(true)
            }
            line("Income", values: series.map(\.incomeCents), color: income, months: months)
            line("Expenses", values: series.map(\.expenseCents), color: .primary, months: months)
            ForEach(Array(series.enumerated()), id: \.offset) { index, point in
                if series.count == 1 || index == selected {
                    PointMark(x: .value("Month", index), y: .value("Amount", point.incomeCents))
                        .foregroundStyle(income)
                        .symbolSize(30)
                        .accessibilityHidden(true)
                    PointMark(x: .value("Month", index), y: .value("Amount", point.expenseCents))
                        .foregroundStyle(Color.primary)
                        .symbolSize(30)
                        .accessibilityHidden(true)
                }
            }
            if let selected {
                RuleMark(x: .value("Month", selected))
                    .foregroundStyle(Color.secondary.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                        // Annotations render outside this view's environment.
                        tooltip(series[selected], month: months[selected], partial: selected == partial)
                            .environment(model)
                    }
                    .accessibilityHidden(true)
            }
        }
        .chartXSelection(value: Binding(get: { selected }, set: { selected = $0.map { min(max($0, 0), last) } }))
        .chartXScale(domain: series.count == 1 ? -1...1 : 0...last, range: .plotDimension(padding: edge))
        .chartXAxis {
            AxisMarks(values: labeled) { value in
                AxisValueLabel(anchor: .top) {
                    if let index = value.as(Int.self) {
                        Text(months[index].shortTitle)
                    }
                }
            }
        }
        .amountYAxis()
        .frame(height: 170)
    }

    /// One line, solid through the full months and dashed into the month in progress.
    @ChartContentBuilder
    private func line(_ name: String, values: [Int], color: Color, months: [CalendarMonth]) -> some ChartContent {
        ForEach(0..<cut, id: \.self) { index in
            LineMark(x: .value("Month", index), y: .value("Amount", values[index]), series: .value("Series", name))
                .foregroundStyle(color)
                .accessibilityLabel("\(months[index].title), \(name.lowercased())")
                .accessibilityValue(model.amountString(values[index]))
        }
        if let partial {
            ForEach(max(partial - 1, 0)...partial, id: \.self) { index in
                LineMark(x: .value("Month", index), y: .value("Amount", values[index]), series: .value("Series", "\(name) so far"))
                    .foregroundStyle(color)
                    .lineStyle(StrokeStyle(lineWidth: 2, dash: [4, 4]))
                    .accessibilityLabel("\(months[index].title) so far, \(name.lowercased())")
                    .accessibilityValue(model.amountString(values[index]))
                    .accessibilityHidden(index < partial)
            }
        }
    }

    private func tooltip(_ point: InsightsMonthlySeriesPoint, month: CalendarMonth, partial: Bool) -> some View {
        let saved = point.incomeCents - point.expenseCents
        let share = point.incomeCents > 0 ? " (\(percent(abs(saved), of: point.incomeCents)))" : ""
        return ChartTooltip(title: partial ? "\(month.title) so far" : month.title) {
            TooltipRow(label: "Income", color: ExpensesTheme.income(for: scheme)) {
                AmountText(point.incomeCents)
            }
            TooltipRow(label: "Expenses", color: .primary) {
                AmountText(point.expenseCents)
            }
            TooltipRow(label: "\(saved < 0 ? "Overspent" : "Saved")\(share)", color: nil) {
                AmountText(abs(saved))
            }
        }
    }
}

private struct RecurringSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var selected: String?

    let split: Result<InsightsRecurringSplitResponse, APIErrorInfo>?

    var body: some View {
        Section {
            switch split {
            case nil:
                ChartMessage(text: "Loading…")
            case .failure:
                ChartMessage(text: "Recurring spending is unavailable.")
            case .success(let data):
                VStack(alignment: .leading, spacing: 10) {
                    chart(data.rows)
                    ChartLegend {
                        ChartLegendItem(title: "Recurring", color: ExpensesTheme.recurring(for: scheme), mark: .area)
                        ChartLegendItem(title: "Other", color: otherColor, mark: .area)
                    }
                }
                .padding(.vertical, 8)
            }
        } header: {
            HStack(alignment: .firstTextBaseline) {
                Text("Recurring spending")
                Spacer()
                // The full months only; the current one is still under way.
                if case .success(let data) = split {
                    let full = data.rows.dropLast()
                    let recurring = full.reduce(0) { $0 + $1.recurringCents }
                    let spent = recurring + full.reduce(0) { $0 + $1.otherCents }
                    if spent > 0 {
                        Text("\(percent(recurring, of: spent)) of spending")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .expensesRowBackground()
    }

    private var otherColor: Color {
        Color.primary.opacity(0.55)
    }

    private func chart(_ rows: [InsightsRecurringSplitRow]) -> some View {
        let current = rows.last?.month
        return Chart {
            ForEach(rows, id: \.month) { row in
                let month = CalendarMonth(row.month)
                let opacity = selected == nil || selected == row.month ? 1.0 : 0.4
                BarMark(x: .value("Month", row.month), y: .value("Amount", row.recurringCents), width: .ratio(0.62))
                    .foregroundStyle(ExpensesTheme.recurring(for: scheme).opacity(opacity))
                    .accessibilityLabel("\(month.title), recurring")
                    .accessibilityValue(model.amountString(row.recurringCents))
                BarMark(x: .value("Month", row.month), y: .value("Amount", row.otherCents), width: .ratio(0.62))
                    .foregroundStyle(otherColor.opacity(opacity))
                    .accessibilityLabel("\(month.title), other")
                    .accessibilityValue(model.amountString(row.otherCents))
            }
            if let selected, let row = rows.first(where: { $0.month == selected }) {
                RuleMark(x: .value("Month", selected))
                    .foregroundStyle(.clear)
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                        let month = CalendarMonth(row.month)
                        ChartTooltip(title: row.month == current ? "\(month.title) so far" : month.title) {
                            TooltipRow(label: "Recurring", color: ExpensesTheme.recurring(for: scheme)) {
                                AmountText(row.recurringCents)
                            }
                            TooltipRow(label: "Other", color: otherColor) {
                                AmountText(row.otherCents)
                            }
                        }
                        .environment(model)
                    }
                    .accessibilityHidden(true)
            }
        }
        .chartXSelection(value: $selected)
        .chartXAxis {
            AxisMarks(values: rows.map(\.month)) { value in
                AxisValueLabel {
                    if let month = value.as(String.self) {
                        Text(CalendarMonth(month).shortTitle.prefix(1))
                    }
                }
            }
        }
        .amountYAxis()
        .frame(height: 150)
    }
}

private enum GridKind: String {
    case expense
    case income
    case tag
}

private struct MonthGridRoute: Hashable {
    let kind: GridKind
    let months: [String]
    let row: InsightsMonthGridRow
}

/// One line per category or tag, one cell per month, shaded from the line's lowest to
/// its highest full month. The current month is outlined and left out of the shading.
private struct MonthGridSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @Binding var kind: GridKind

    let grid: Result<InsightsMonthGridResponse, APIErrorInfo>?

    var body: some View {
        Section("By month") {
            Picker("Rows", selection: $kind) {
                Text("Expenses").tag(GridKind.expense)
                Text("Income").tag(GridKind.income)
                Text("Tags").tag(GridKind.tag)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .sensoryFeedback(.selection, trigger: kind)

            switch grid {
            case nil:
                ChartMessage(text: "Loading…")
            case .failure:
                ChartMessage(text: "The month grid is unavailable.")
            case .success(let data) where data.rows.isEmpty:
                ChartMessage(text: kind == .tag ? "No tagged spending in these months." : "Nothing in these months.")
            case .success(let data):
                MonthHeads(months: data.months, total: "Total")
                ForEach(data.rows) { row in
                    NavigationLink(value: MonthGridRoute(kind: kind, months: data.months, row: row)) {
                        line(row)
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                    .listRowInsets(gridRowInsets)
                }
                ChipFlow(spacing: 10) {
                    HStack(spacing: 4) {
                        Text("Lowest")
                        ForEach([0.1, 0.26, 0.42, 0.58, 0.75], id: \.self) { share in
                            RoundedRectangle(cornerRadius: 2)
                                .fill(Color.primary.opacity(share))
                                .frame(width: 10, height: 10)
                        }
                        Text("Highest")
                    }
                    HStack(spacing: 4) {
                        InProgressMark()
                            .frame(width: 10, height: 10)
                        Text("In progress")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.vertical, 4)
                .accessibilityHidden(true)
            }
        }
        .listRowSeparator(.hidden)
        .expensesRowBackground()
    }

    private func line(_ row: InsightsMonthGridRow) -> some View {
        let full = row.valuesCents.dropLast()
        let low = full.min() ?? 0
        let high = full.max() ?? 0
        let color = kind == .tag ? Color.primary : ExpensesTheme.category(row.id, for: scheme)
        let total = row.valuesCents.reduce(0, +)
        return GridLine(count: row.valuesCents.count) {
            HStack(spacing: 5) {
                if kind != .tag {
                    Image(systemName: categorySymbolName(for: resolvedCategoryIconKey(row.icon, name: row.name)))
                        .font(.caption2)
                        .foregroundStyle(color)
                        .glyphColumn(14, relativeTo: .caption2)
                }
                Text(row.name)
                    .lineLimit(1)
            }
        } cell: { index in
            let value = row.valuesCents[index]
            let shade = high > low ? 0.1 + 0.65 * min(1, max(0, Double(value - low) / Double(high - low))) : 0.16
            RoundedRectangle(cornerRadius: 3)
                .fill(value == 0 ? Color.primary.opacity(0.08) : color.opacity(shade))
                .overlay {
                    if index == row.valuesCents.count - 1 {
                        InProgressMark()
                    }
                }
                .frame(height: 20)
        } total: {
            AmountText(total, decimals: false)
        }
        .font(.footnote)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.name)
        .accessibilityValue("\(model.amountString(total, decimals: false)) in \(row.valuesCents.count) months")
    }
}

/// A category's or tag's months, newest first. Each opens its transactions.
private struct MonthGridRowView: View {
    let route: MonthGridRoute
    let openTransactions: (TransactionQuery) -> Void

    var body: some View {
        let values = route.row.valuesCents
        let full = values.dropLast()
        let last = values.count - 1
        List {
            Section {
                LabeledContent("Total") {
                    AmountText(values.reduce(0, +))
                        .foregroundStyle(.primary)
                }
                LabeledContent("Average, last \(full.count) full months") {
                    AmountText(Int((Double(full.reduce(0, +)) / Double(max(full.count, 1))).rounded()))
                        .foregroundStyle(.primary)
                }
            }
            .expensesRowBackground()

            Section("Months") {
                ForEach((0...last).reversed(), id: \.self) { index in
                    let month = CalendarMonth(route.months[index])
                    Button {
                        var query = TransactionQuery(period: month.period)
                        if route.kind == .tag {
                            query.tagIDs = [route.row.id]
                        } else {
                            query.categoryID = route.row.id
                        }
                        openTransactions(query)
                    } label: {
                        LabeledContent(index == last ? "\(month.title) so far" : month.title) {
                            AmountText(values[index])
                                .foregroundStyle(.primary)
                        }
                    }
                    .tint(.primary)
                    .accessibilityHint("Opens the transactions")
                }
            }
            .expensesRowBackground()
        }
        .navigationTitle(route.row.name)
        .expensesScreenStyle()
    }
}

/// Spending by day in week columns, Monday first, in five ink levels. The weeks scroll
/// and start at the latest one; a chosen day shows its amount and opens its transactions.
private struct DailySpendingSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    // A date, so the choice stays on its day when a refresh moves the weeks.
    @State private var selected: Date?

    let calendar: Result<InsightsDayCalendarResponse, APIErrorInfo>?
    let openTransactions: (TransactionQuery) -> Void

    private static let cell: CGFloat = 12
    private static let gap: CGFloat = 3
    private static let levels = [0.11, 0.24, 0.46, 0.82]
    // Heavier days tick harder while scrubbing, so a busy week feels bumpier.
    private static let tickIntensities = [0.3, 0.45, 0.6, 0.8, 1.0]

    var body: some View {
        Section {
            switch calendar {
            case nil:
                ChartMessage(text: "Loading…")
            case .failure:
                ChartMessage(text: "Daily spending is unavailable.")
            case .success(let data):
                let days = DayGrid(data)
                let index = days.dates.indices.first { days.dates[$0] == selected && days.amounts[$0] != nil } ?? days.today
                grid(days, selected: index)
                    .padding(.vertical, 6)
                dayRow(days, index: index)
                levelLegend
                weekdays(data)
            }
        } header: {
            HStack(alignment: .firstTextBaseline) {
                Text("Daily spending")
                Spacer()
                Text("without recurring")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .expensesRowBackground()
    }

    private static func level(_ cents: Int) -> Int {
        cents <= 0 ? 0 : cents < 2500 ? 1 : cents < 6000 ? 2 : cents < 12000 ? 3 : 4
    }

    private func color(_ cents: Int) -> Color {
        let level = Self.level(cents)
        return Color.primary.opacity(level == 0 ? 0.08 : Self.levels[level - 1])
    }

    // The day under a point in the grid, clamped to the grid; future days keep the selection.
    private func select(_ days: DayGrid, at point: CGPoint) {
        let step = Self.cell + Self.gap
        let week = min(max(Int(point.x / step), 0), days.weeks - 1)
        let index = week * 7 + min(max(Int(point.y / step), 0), 6)
        if days.amounts[index] != nil {
            selected = days.dates[index]
        }
    }

    private func grid(_ days: DayGrid, selected: Int) -> some View {
        HStack(alignment: .top, spacing: 6) {
            VStack(alignment: .leading, spacing: Self.gap) {
                Color.clear
                    .frame(height: 14)
                ForEach(["Mon", "", "Wed", "", "Fri", "", ""].indices, id: \.self) { row in
                    Text(["Mon", "", "Wed", "", "Fri", "", ""][row])
                        .frame(height: Self.cell)
                }
            }
            .fixedSize(horizontal: true, vertical: false)
            ScrollView(.horizontal) {
                VStack(alignment: .leading, spacing: Self.gap) {
                    HStack(spacing: Self.gap) {
                        ForEach(0..<days.weeks, id: \.self) { week in
                            Color.clear
                                .frame(width: Self.cell, height: 14)
                                .overlay(alignment: .leading) {
                                    if let label = days.monthLabels[week] {
                                        Text(label)
                                            .fixedSize()
                                    }
                                }
                        }
                    }
                    HStack(spacing: Self.gap) {
                        ForEach(0..<days.weeks, id: \.self) { week in
                            VStack(spacing: Self.gap) {
                                ForEach(0..<7, id: \.self) { weekday in
                                    let index = week * 7 + weekday
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(days.amounts[index].map(color) ?? .clear)
                                        .frame(width: Self.cell, height: Self.cell)
                                        .overlay {
                                            if index == selected {
                                                RoundedRectangle(cornerRadius: 3)
                                                    .stroke(Color.primary, lineWidth: 1.5)
                                                    .padding(-2)
                                            }
                                        }
                                }
                            }
                        }
                    }
                    .contentShape(Rectangle())
                    .gesture(SpatialTapGesture().onEnded { tap in
                        select(days, at: tap.location)
                    })
                    .gesture(DayScrub { select(days, at: $0) })
                }
                .padding(2)
            }
            .defaultScrollAnchor(.trailing)
            .scrollIndicators(.hidden)
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .sensoryFeedback(trigger: selected) { _, index in
            .impact(weight: .medium, intensity: Self.tickIntensities[Self.level(days.amounts[index] ?? 0)])
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Daily spending")
        .accessibilityValue(dayDescription(days, index: selected))
        .accessibilityAdjustableAction { direction in
            let next = selected + (direction == .increment ? 1 : -1)
            if days.amounts.indices.contains(next), days.amounts[next] != nil {
                self.selected = days.dates[next]
            }
        }
    }

    private func dayTitle(_ days: DayGrid, index: Int) -> String {
        index == days.today ? "Today" : AppFormatters.bookingDay(days.dates[index])
    }

    private func dayDescription(_ days: DayGrid, index: Int) -> String {
        let cents = days.amounts[index] ?? 0
        return "\(dayTitle(days, index: index)), \(cents > 0 ? model.amountString(cents) : "nothing")"
    }

    private func dayRow(_ days: DayGrid, index: Int) -> some View {
        let cents = days.amounts[index] ?? 0
        return Button {
            let day = AppFormatters.localDay(days.dates[index])
            openTransactions(TransactionQuery(period: .custom(start: day, end: day)))
        } label: {
            LabeledContent(dayTitle(days, index: index)) {
                if cents > 0 {
                    AmountText(cents)
                        .foregroundStyle(.primary)
                } else {
                    Text("Nothing")
                }
            }
        }
        .tint(.primary)
        .accessibilityHint("Opens the transactions")
    }

    private var levelLegend: some View {
        let labels = [
            "None",
            "Under \(AppFormatters.euros(2500, decimals: false))",
            "\(AppFormatters.euros(2500, decimals: false))–\(AppFormatters.euros(6000, decimals: false))",
            "\(AppFormatters.euros(6000, decimals: false))–\(AppFormatters.euros(12000, decimals: false))",
            "\(AppFormatters.euros(12000, decimals: false)) or more",
        ]
        return ChipFlow(spacing: 10) {
            ForEach(labels.indices, id: \.self) { level in
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.primary.opacity(level == 0 ? 0.08 : Self.levels[level - 1]))
                        .frame(width: 10, height: 10)
                    Text(labels[level])
                }
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.vertical, 4)
        .accessibilityHidden(true)
    }

    private func weekdays(_ data: InsightsDayCalendarResponse) -> some View {
        let symbols = Calendar.current.standaloneWeekdaySymbols
        let names = Array(symbols[1...] + symbols[..<1])
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Average by weekday")
                    .foregroundStyle(.secondary)
                Spacer()
                Text("Weekends \(data.weekendShare.formatted(.percent.precision(.fractionLength(0))))")
            }
            .font(.subheadline)
            Chart {
                ForEach(names.indices, id: \.self) { index in
                    BarMark(x: .value("Weekday", names[index]), y: .value("Average", data.weekdayAvgCents[index]), width: .ratio(0.7))
                        .foregroundStyle(index >= 5 ? Color.primary.opacity(0.55) : ExpensesTheme.recurring(for: scheme))
                        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 3, topTrailingRadius: 3))
                        .accessibilityLabel(names[index])
                        .accessibilityValue(model.amountString(data.weekdayAvgCents[index]))
                }
            }
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let name = value.as(String.self) {
                            Text(name.prefix(1))
                        }
                    }
                }
            }
            .chartYAxis(.hidden)
            .frame(height: 80)
        }
        .padding(.vertical, 6)
    }
}

/// Touch and hold, then drag to scrub through the days. UIKit's long press fails as soon
/// as the finger moves before the hold ends, so a quick drag still scrolls the weeks.
private struct DayScrub: UIGestureRecognizerRepresentable {
    let onChange: (CGPoint) -> Void

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let recognizer = UILongPressGestureRecognizer()
        recognizer.minimumPressDuration = 0.25
        return recognizer
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        if recognizer.state == .began || recognizer.state == .changed {
            onChange(context.converter.localLocation)
        }
    }
}

/// The calendar's days in week columns, Monday first. Days outside the response's range
/// have no amount.
private struct DayGrid {
    // UTC midnight, as `bookingDay` formats it.
    let dates: [Date]
    let amounts: [Int?]
    let monthLabels: [String?]
    let today: Int

    var weeks: Int {
        dates.count / 7
    }

    init(_ data: InsightsDayCalendarResponse) {
        let calendar = CalendarMonth.calendar
        func day(_ value: String) -> Date {
            let parts = value.split(separator: "-").map { Int($0)! }
            return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))!
        }
        let start = day(data.start)
        let end = day(data.end)
        // Weekday 1 is Sunday.
        let lead = (calendar.component(.weekday, from: start) + 5) % 7
        let first = calendar.date(byAdding: .day, value: -lead, to: start)!
        let span = calendar.dateComponents([.day], from: first, to: end).day!
        let count = (span / 7 + 1) * 7
        var amounts: [Int?] = (0..<count).map { $0 >= lead && $0 <= span ? 0 : nil }
        for entry in data.days {
            amounts[calendar.dateComponents([.day], from: first, to: day(entry.date)).day!] = entry.amountCents
        }
        let dates = (0..<count).map { calendar.date(byAdding: .day, value: $0, to: first)! }
        var labels = [String?](repeating: nil, count: count / 7)
        for index in lead...span where calendar.component(.day, from: dates[index]) == 1 {
            labels[index / 7] = dates[index].formatted(Date.FormatStyle(timeZone: .gmt).month(.abbreviated))
        }
        self.dates = dates
        self.amounts = amounts
        self.monthLabels = labels
        today = span
    }
}

private struct BudgetHistoryRoute: Hashable {
    let categoryID: Int?
}

/// Each budget's months: within, over, or no budget yet.
private struct BudgetHistorySection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    let history: Result<InsightsBudgetHistoryResponse, APIErrorInfo>?
    let openBudgets: (CalendarMonth) -> Void

    var body: some View {
        Section {
            switch history {
            case nil:
                ChartMessage(text: "Loading…")
            case .failure:
                ChartMessage(text: "Budget history is unavailable.")
            case .success(let data) where data.rows.isEmpty:
                ChartMessage(text: "No budgets yet.")
            case .success(let data):
                MonthHeads(months: data.months, total: "Within")
                ForEach(data.rows, id: \.categoryID) { row in
                    NavigationLink(value: BudgetHistoryRoute(categoryID: row.categoryID)) {
                        line(row)
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                    .listRowInsets(gridRowInsets)
                }
                ChipFlow(spacing: 10) {
                    legend("Within") { mark(over: false) }
                    legend("Over") { mark(over: true) }
                    legend("In progress") { InProgressMark() }
                    legend("No budget") { noBudgetMark }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.vertical, 4)
                .accessibilityHidden(true)
            }
        } header: {
            SectionLink(title: "Budget history", destination: "Budgets") {
                openBudgets(.current)
            }
        }
        .listRowSeparator(.hidden)
        .expensesRowBackground()
    }

    private func line(_ row: InsightsBudgetHistoryRow) -> some View {
        // The current month is still under way, so it is not counted.
        let full = row.cells.dropLast().filter { $0.budgetCents != nil }
        let within = full.filter { $0.spentCents <= $0.budgetCents! }.count
        return GridLine(count: row.cells.count) {
            HStack(spacing: 5) {
                if let categoryID = row.categoryID {
                    Image(systemName: categorySymbolName(for: resolvedCategoryIconKey(row.icon, name: row.name)))
                        .font(.caption2)
                        .foregroundStyle(ExpensesTheme.category(categoryID, for: scheme))
                        .glyphColumn(14, relativeTo: .caption2)
                }
                Text(row.name)
                    .lineLimit(1)
            }
        } cell: { index in
            let cell = row.cells[index]
            Group {
                if let budget = cell.budgetCents {
                    mark(over: cell.spentCents > budget)
                } else {
                    noBudgetMark
                }
            }
            .overlay {
                if index == row.cells.count - 1 {
                    InProgressMark()
                }
            }
            .aspectRatio(1, contentMode: .fit)
            .frame(maxWidth: 12)
        } total: {
            Text("\(within) of \(full.count)")
                .monospacedDigit()
        }
        .font(.footnote)
        .frame(minHeight: 20)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.name)
        .accessibilityValue(row.cells.compactMap { cell in
            cell.budgetCents.map { "\(CalendarMonth(cell.month).title): \(model.amountString(cell.spentCents, decimals: false)) of \(model.amountString($0, decimals: false))" }
        }.joined(separator: "; "))
    }

    private func mark(over: Bool) -> some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(over ? ExpensesTheme.expense(for: scheme).opacity(0.8) : ExpensesTheme.recurring(for: scheme))
    }

    private var noBudgetMark: some View {
        RoundedRectangle(cornerRadius: 3)
            .strokeBorder(Color.primary.opacity(0.15))
    }

    private func legend<Mark: View>(_ title: String, @ViewBuilder mark: () -> Mark) -> some View {
        HStack(spacing: 5) {
            mark()
                .frame(width: 10, height: 10)
            Text(title)
        }
    }
}

/// A budget's months, newest first. Each month with a budget opens that month's budgets.
private struct BudgetHistoryRowView: View {
    let row: InsightsBudgetHistoryRow
    let openBudgets: (CalendarMonth) -> Void

    var body: some View {
        let last = row.cells.count - 1
        List {
            Section("Months") {
                ForEach(row.cells.indices.reversed(), id: \.self) { index in
                    let cell = row.cells[index]
                    let month = CalendarMonth(cell.month)
                    let title = index == last ? "\(month.title) so far" : month.title
                    if let budget = cell.budgetCents {
                        Button {
                            openBudgets(month)
                        } label: {
                            LabeledContent(title) {
                                SpentAgainst(spentCents: cell.spentCents, budgetCents: budget)
                                    .foregroundStyle(.primary)
                            }
                        }
                        .tint(.primary)
                        .accessibilityHint("Opens the budgets")
                    } else {
                        LabeledContent(title, value: "No budget")
                    }
                }
            }
            .expensesRowBackground()
        }
        .navigationTitle(row.name)
        .expensesScreenStyle()
    }
}

private let gridRowInsets = EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)

/// A grid line: a name, one cell per month, and a total, in fixed columns so that the
/// lines of a grid align.
private struct GridLine<Name: View, Cell: View, Total: View>: View {
    @Environment(\.dynamicTypeSize) private var typeSize

    let count: Int
    @ViewBuilder let name: Name
    @ViewBuilder let cell: (Int) -> Cell
    @ViewBuilder let total: Total

    var body: some View {
        // At accessibility sizes the name and total take a line above the months.
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                AdaptiveRow {
                    name
                } trailing: {
                    total
                }
                cells
            }
        } else {
            HStack(spacing: 3) {
                name
                    .frame(width: 96, alignment: .leading)
                cells
                total
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(width: 58, alignment: .trailing)
            }
        }
    }

    private var cells: some View {
        HStack(spacing: 3) {
            ForEach(0..<count, id: \.self) { index in
                cell(index)
                    .frame(maxWidth: .infinity)
            }
        }
    }
}

/// The month initials over a grid, and its total column's name.
private struct MonthHeads: View {
    let months: [String]
    let total: String

    var body: some View {
        GridLine(count: months.count) {
            Color.clear
        } cell: { index in
            Text(CalendarMonth(months[index]).shortTitle.prefix(1))
        } total: {
            Text(total)
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .listRowInsets(gridRowInsets)
        .accessibilityHidden(true)
    }
}

/// The dashed outline of a month that is still under way.
private struct InProgressMark: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 3)
            .strokeBorder(Color.secondary, style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
    }
}
