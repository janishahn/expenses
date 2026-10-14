import Charts
import SwiftUI

/// The period's totals and its income and expenses by month, then the last 12 full
/// months and the current one: recurring spending, amounts by month, daily spending,
/// and budget history.
struct InsightsView: View {
    @Environment(AppModel.self) private var model

    let openTransactions: (TransactionQuery) -> Void
    let openBudgets: () -> Void

    // The period and tags; Insights takes no type, category or search.
    @State private var query = TransactionQuery()
    @State private var presentingFilter = false
    @State private var gridKind = GridKind.expense
    @State private var insights: (query: TransactionQuery, result: Result<InsightsResponse, APIErrorInfo>)?
    @State private var grids: [GridKind: Result<InsightsMonthGridResponse, APIErrorInfo>] = [:]
    @State private var split: Result<InsightsRecurringSplitResponse, APIErrorInfo>?
    @State private var calendar: Result<InsightsDayCalendarResponse, APIErrorInfo>?
    @State private var budgetHistory: Result<InsightsBudgetHistoryResponse, APIErrorInfo>?

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
                    UnavailableStateSection(title: "Couldn't load insights", systemImage: "exclamationmark.triangle", message: error.message)
                case .success(let data):
                    MetricsSection(data: data)
                    IncomeExpensesSection(series: data.series)
                    RecurringSection(split: split)
                    MonthGridSection(kind: $gridKind, grid: grids[gridKind])
                    DailySpendingSection(calendar: calendar, openTransactions: openTransactions)
                    BudgetHistorySection(history: budgetHistory, openBudgets: openBudgets)
                }
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
            .task {
                if split == nil {
                    await loadWindows()
                }
            }
            .refreshable {
                grids = [:]
                async let insights: Void = loadInsights()
                async let grid: Void = loadGrid()
                async let windows: Void = loadWindows()
                _ = await (insights, grid, windows)
            }
        }
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
        (self.split, self.calendar, self.budgetHistory) = await (split, calendar, budgetHistory)
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
                ToolbarItem(placement: .cancellationAction) {
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
        .themeAccentTint()
    }
}

private struct MetricsSection: View {
    @Environment(\.colorScheme) private var scheme

    let data: InsightsResponse

    var body: some View {
        let spent = data.expenseCents
        let saved = data.incomeCents - spent
        let months = data.monthCount
        Section {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 16) {
                GridRow {
                    Metric("Income") {
                        AmountText(data.incomeCents)
                    } detail: {
                        if months > 1 {
                            Text("\(months) months")
                        }
                    }
                    Metric("Spent") {
                        AmountText(spent)
                    } detail: {
                        if months > 1 {
                            HStack(spacing: 4) {
                                AmountText(Int((Double(spent) / Double(months)).rounded()))
                                Text("per month")
                            }
                        }
                    }
                }
                GridRow {
                    Metric("Saved") {
                        AmountText(saved, signed: saved < 0)
                            .foregroundStyle(saved > 0 ? ExpensesTheme.income(for: scheme) : .primary)
                    } detail: {
                        if data.incomeCents > 0 {
                            Text("\(percent(saved, of: data.incomeCents)) of income")
                        }
                    }
                    Metric("Recurring") {
                        Text(spent > 0 ? percent(data.recurringCents, of: spent) : "–")
                    } detail: {
                        if spent > 0 {
                            Text("of spending")
                        }
                    }
                }
            }
            .padding(.vertical, 6)
        }
        .expensesRowBackground()
    }
}

private struct IncomeExpensesSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var selected: Int?

    let series: [InsightsMonthlySeriesPoint]

    var body: some View {
        Section("Income and expenses") {
            if series.isEmpty {
                ChartMessage(text: "No transactions in this period.")
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    chart
                    HStack(spacing: 14) {
                        ChartLegendItem(title: "Income", color: ExpensesTheme.income(for: scheme), mark: .line)
                        ChartLegendItem(title: "Expenses", color: .primary, mark: .line)
                        ChartLegendItem(title: "Saved", color: savedColor, mark: .area)
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

    private var chart: some View {
        let months = series.map { CalendarMonth(year: $0.year, month: $0.month) }
        let last = series.count - 1
        let income = ExpensesTheme.income(for: scheme)
        // The latest month keeps its label; one month sits in the middle.
        let labeled = Array(stride(from: last % 3, through: last, by: 3))
        return Chart {
            ForEach(Array(series.enumerated()), id: \.offset) { index, point in
                // Saved: the band where income is above expenses.
                AreaMark(
                    x: .value("Month", index),
                    yStart: .value("Expenses", point.expenseCents),
                    yEnd: .value("Income", max(point.incomeCents, point.expenseCents))
                )
                .foregroundStyle(savedColor)
                .accessibilityHidden(true)
                LineMark(x: .value("Month", index), y: .value("Amount", point.incomeCents), series: .value("Series", "Income"))
                    .foregroundStyle(income)
                    .accessibilityLabel("\(months[index].title), income")
                    .accessibilityValue(model.amountString(point.incomeCents))
                LineMark(x: .value("Month", index), y: .value("Amount", point.expenseCents), series: .value("Series", "Expenses"))
                    .foregroundStyle(Color.primary)
                    .accessibilityLabel("\(months[index].title), expenses")
                    .accessibilityValue(model.amountString(point.expenseCents))
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
                        tooltip(series[selected], month: months[selected], current: selected == last)
                            .environment(model)
                    }
                    .accessibilityHidden(true)
            }
        }
        .chartXSelection(value: Binding(get: { selected }, set: { selected = $0.map { min(max($0, 0), last) } }))
        .chartXScale(domain: series.count == 1 ? -1...1 : 0...last, range: .plotDimension(padding: 14))
        .chartXAxis {
            AxisMarks(values: labeled) { value in
                AxisValueLabel(anchor: .top) {
                    if let index = value.as(Int.self) {
                        Text(months[index].shortTitle)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { _ in
                AxisGridLine()
            }
        }
        .frame(height: 170)
    }

    private func tooltip(_ point: InsightsMonthlySeriesPoint, month: CalendarMonth, current: Bool) -> some View {
        let saved = point.incomeCents - point.expenseCents
        return ChartTooltip(title: current ? "\(month.title) so far" : month.title) {
            TooltipRow(label: "Income", color: ExpensesTheme.income(for: scheme)) {
                AmountText(point.incomeCents)
            }
            TooltipRow(label: "Expenses", color: .primary) {
                AmountText(point.expenseCents)
            }
            TooltipRow(label: "Saved", color: nil) {
                AmountText(saved, signed: saved < 0)
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
                    HStack(spacing: 14) {
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
        .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { _ in
                AxisGridLine()
            }
        }
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
                        .frame(width: 14)
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
                LabeledContent("Average per month") {
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
    @State private var selected: Int?

    let calendar: Result<InsightsDayCalendarResponse, APIErrorInfo>?
    let openTransactions: (TransactionQuery) -> Void

    private static let cell: CGFloat = 12
    private static let gap: CGFloat = 3
    private static let levels = [0.11, 0.24, 0.46, 0.82]

    var body: some View {
        Section {
            switch calendar {
            case nil:
                ChartMessage(text: "Loading…")
            case .failure:
                ChartMessage(text: "Daily spending is unavailable.")
            case .success(let data):
                let days = DayGrid(data)
                let index = selected ?? days.today
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

    private func color(_ cents: Int) -> Color {
        let level = cents <= 0 ? 0 : cents < 2500 ? 1 : cents < 6000 ? 2 : cents < 12000 ? 3 : 4
        return Color.primary.opacity(level == 0 ? 0.08 : Self.levels[level - 1])
    }

    private func grid(_ days: DayGrid, selected: Int) -> some View {
        let step = Self.cell + Self.gap
        return HStack(alignment: .top, spacing: 6) {
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
                        let index = Int(tap.location.x / step) * 7 + min(Int(tap.location.y / step), 6)
                        if days.amounts.indices.contains(index), days.amounts[index] != nil {
                            self.selected = index
                        }
                    })
                }
                .padding(2)
            }
            .defaultScrollAnchor(.trailing)
            .scrollIndicators(.hidden)
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .sensoryFeedback(.selection, trigger: selected)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Daily spending")
        .accessibilityValue(dayDescription(days, index: selected))
        .accessibilityAdjustableAction { direction in
            let next = selected + (direction == .increment ? 1 : -1)
            if days.amounts.indices.contains(next), days.amounts[next] != nil {
                self.selected = next
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

/// Each budget's months: within, over, or no budget yet.
private struct BudgetHistorySection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    let history: Result<InsightsBudgetHistoryResponse, APIErrorInfo>?
    let openBudgets: () -> Void

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
                    line(row)
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
            SectionLink(title: "Budget history", destination: "Budgets", action: openBudgets)
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
                        .frame(width: 14)
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

private let gridRowInsets = EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)

/// A grid line: a name, one cell per month, and a total, in fixed columns so that the
/// lines of a grid align.
private struct GridLine<Name: View, Cell: View, Total: View>: View {
    let count: Int
    @ViewBuilder let name: Name
    @ViewBuilder let cell: (Int) -> Cell
    @ViewBuilder let total: Total

    var body: some View {
        HStack(spacing: 3) {
            name
                .frame(width: 96, alignment: .leading)
            ForEach(0..<count, id: \.self) { index in
                cell(index)
                    .frame(maxWidth: .infinity)
            }
            total
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(width: 58, alignment: .trailing)
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
