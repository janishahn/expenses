import Charts
import SwiftUI

struct DashboardView: View {
    @Environment(AppModel.self) private var model
    @Binding var path: [Int]
    let openBudgets: () -> Void
    let openTransactions: () -> Void
    @State private var selectedPeriod: DashboardPeriod = .thisMonth
    @State private var excludedTagIDs: Set<Int> = []
    @State private var draftExcludedTagIDs: Set<Int> = []
    @State private var presentingFilters = false
    @AppStorage("expenses.dashboardIncognito") private var hidesAmounts = false

    private var reloadKey: String {
        let excluded = excludedTagIDs.sorted().map(String.init).joined(separator: ",")
        return "\(selectedPeriod.rawValue)-\(excluded)"
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if model.identity?.authenticated != true {
                    SignedOutStateSection()
                } else {
                    if !excludedTagIDs.isEmpty {
                        Section {
                            HStack(spacing: 10) {
                                Button {
                                    draftExcludedTagIDs = excludedTagIDs
                                    presentingFilters = true
                                } label: {
                                    Label(excludedTagLabels.joined(separator: " · "), systemImage: "line.3.horizontal.decrease.circle.fill")
                                        .lineLimit(1)
                                }
                                .buttonStyle(.plain)

                                Spacer(minLength: 8)

                                Button {
                                    excludedTagIDs = []
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundStyle(.secondary)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Clear tag exclusions")
                            }
                            .font(.callout.weight(.medium))
                        } footer: {
                            Text("Available balance and budgets stay based on all activity.")
                        }
                        .expensesRowBackground()
                    }

                    if let dashboard = model.dashboard {
                        let pace = budgetPace(for: dashboard.period)
                        let categoriesByID = Dictionary(uniqueKeysWithValues: dashboard.categories.map { ($0.id, $0) })

                        Section {
                            DashboardSummary(dashboard: dashboard, pace: pace)
                        }
                        .expensesRowBackground()

                        Section {
                            let budgets = dashboard.categoryBudgetPulse ?? []
                            if budgets.isEmpty {
                                Text("No category budgets this month")
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(budgets) { budget in
                                    Button(action: openBudgets) {
                                        CategoryBudgetRow(
                                            budget: budget,
                                            iconKey: categoriesByID[budget.scopeCategoryID]?.icon,
                                            pace: pace
                                        )
                                    }
                                    .tint(.primary)
                                }
                            }
                        } header: {
                            SectionLink(title: "Budgets", destination: "Budgets", action: openBudgets)
                        }
                        .expensesRowBackground()

                        Section {
                            if dashboard.recent.isEmpty {
                                Text("No transactions in this period")
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(dashboard.recent.prefix(7)) { transaction in
                                    Button {
                                        path.append(transaction.id)
                                    } label: {
                                        LedgerRow(
                                            transaction: transaction,
                                            category: transaction.category.map { categoriesByID[$0.id] ?? $0 }
                                        )
                                    }
                                    .tint(.primary)
                                }
                            }
                        } header: {
                            SectionLink(title: "Recent", destination: "Transactions", action: openTransactions)
                        }
                        .expensesRowBackground()

                        BalanceSection(history: model.dashboardBalanceHistory, forecast: model.dashboardForecast)
                        SpendingBandsSection(bands: model.dashboardSpendingBands)
                        CategoryShareSection(donut: dashboard.donut)

                        Section("Durable purchases") {
                            let durable = dashboard.durablePurchases ?? []
                            if durable.isEmpty {
                                Text("No durable purchases are being tracked")
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(durable) { item in
                                    Button {
                                        path.append(item.transactionID)
                                    } label: {
                                        HStack(spacing: 12) {
                                            CategoryGlyph(categoryID: item.category?.id, iconKey: item.category?.icon)
                                            Text(item.title ?? "Untitled")
                                                .lineLimit(1)
                                            Spacer(minLength: 8)
                                            Text("\(item.daysOwned.formatted()) of \(item.expectedLifespanDays.formatted()) days")
                                                .font(.subheadline)
                                                .monospacedDigit()
                                                .foregroundStyle(.secondary)
                                        }
                                        .contentShape(Rectangle())
                                    }
                                    .tint(.primary)
                                }
                            }
                        }
                        .expensesRowBackground()
                    } else if model.showsDashboardInitialLoading {
                        LoadingStateSection(title: "Loading dashboard")
                    } else if model.showsDashboardLoadFailed {
                        UnavailableStateSection(title: "Couldn't load dashboard", systemImage: "exclamationmark.triangle", message: model.lastError?.message ?? "Pull to refresh to try again.")
                    } else {
                        ContentUnavailableView("No dashboard loaded", systemImage: "chart.line.uptrend.xyaxis")
                    }
                }
            }
            .headerProminence(.increased)
            .redacted(reason: hidesAmounts ? .privacy : [])
            .navigationTitle("Dashboard")
            .navigationSubtitle(periodSubtitle)
            .expensesScreenStyle()
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Menu {
                        Picker("Period", selection: $selectedPeriod) {
                            ForEach(DashboardPeriod.allCases) { period in
                                Text(period.title).tag(period)
                            }
                        }
                    } label: {
                        Label("Period", systemImage: "calendar")
                    }

                    Button {
                        draftExcludedTagIDs = excludedTagIDs
                        presentingFilters = true
                    } label: {
                        Label(
                            "Exclude tags",
                            systemImage: excludedTagIDs.isEmpty
                                ? "line.3.horizontal.decrease"
                                : "line.3.horizontal.decrease.circle.fill"
                        )
                    }

                    Button {
                        withAnimation(.snappy(duration: 0.18)) {
                            hidesAmounts.toggle()
                        }
                    } label: {
                        Label(hidesAmounts ? "Show amounts" : "Hide amounts", systemImage: hidesAmounts ? "eye" : "eye.slash")
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: selectedPeriod)
            .sheet(isPresented: $presentingFilters, onDismiss: resetDraftFilters) {
                DashboardFiltersSheet(
                    excludedTagIDs: $draftExcludedTagIDs,
                    tags: currentTags,
                    onApply: {
                        excludedTagIDs = draftExcludedTagIDs
                    },
                    onClear: {
                        draftExcludedTagIDs = []
                        excludedTagIDs = []
                    }
                )
                .presentationDetents([.medium, .large])
            }
            .refreshable {
                async let period: Void = loadPeriodData()
                async let balance: Void = model.loadDashboardBalance()
                _ = await (period, balance)
            }
            .task {
                await model.loadDashboardBalance()
            }
            .task(id: reloadKey) {
                await loadPeriodData()
            }
            .navigationDestination(for: Int.self) { id in
                TransactionDetailView(transactionID: id)
            }
            .animation(.easeInOut(duration: 0.18), value: model.showsDashboardInitialLoading)
        }
    }

    private var periodSubtitle: String {
        let month = Date.FormatStyle.dateTime.month(.wide).year()
        switch selectedPeriod {
        case .thisMonth:
            return Date.now.formatted(month)
        case .lastMonth:
            return Calendar.current.date(byAdding: .month, value: -1, to: .now)!.formatted(month)
        case .all:
            return selectedPeriod.title
        }
    }

    private var currentTags: [TransactionTag] {
        model.dashboard?.tags ?? model.tags?.tags.map { TransactionTag(id: $0.id, name: $0.name) } ?? []
    }

    private var excludedTagLabels: [String] {
        excludedTagIDs.sorted().compactMap { id in
            currentTags.first(where: { $0.id == id }).map { "Excluding: \($0.name)" }
        }
    }

    private func loadPeriodData() async {
        let excluded = excludedTagIDs.sorted()
        async let summary: Void = model.loadDashboard(period: selectedPeriod.rawValue, excludedTagIDs: excluded)
        async let bands: Void = model.loadDashboardSpendingBands(period: selectedPeriod.rawValue, excludedTagIDs: excluded)
        _ = await (summary, bands)
    }

    // Even spending pace through the budget month: today, or the final day of last month.
    private func budgetPace(for period: Period) -> Double {
        var calendar = Calendar(identifier: .gregorian)
        var asOf = Date.now
        if period.slug == "last_month" {
            // Date-only API values decode as midnight UTC.
            calendar.timeZone = .gmt
            asOf = period.end
        }
        let day = calendar.component(.day, from: asOf)
        let days = calendar.range(of: .day, in: .month, for: asOf)!.count
        return Double(day) / Double(days)
    }

    private func resetDraftFilters() {
        draftExcludedTagIDs = excludedTagIDs
    }
}

private struct DashboardFiltersSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var excludedTagIDs: Set<Int>
    let tags: [TransactionTag]
    var onApply: () -> Void
    var onClear: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                TagExclusionSection(
                    tags: tags,
                    selectedIDs: $excludedTagIDs,
                    includedTagID: nil,
                    footer: "These exclusions affect transaction-based totals, charts, and recent activity only."
                )
            }
            .navigationTitle("Dashboard filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") {
                        onClear()
                        dismiss()
                    }
                    .disabled(excludedTagIDs.isEmpty)
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

private enum DashboardPeriod: String, CaseIterable, Identifiable {
    case thisMonth = "this_month"
    case lastMonth = "last_month"
    case all = "all"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .thisMonth:
            "This month"
        case .lastMonth:
            "Last month"
        case .all:
            "All time"
        }
    }
}

// "2026-10" → the locale's short month name.
private func shortMonth(_ month: String) -> String {
    Calendar.current.shortStandaloneMonthSymbols[Int(month.suffix(2))! - 1]
}

private func usedRatio(spent: Int, budget: Int) -> Double {
    if budget > 0 {
        return Double(spent) / Double(budget)
    }
    return spent > 0 ? 1 : 0
}

private struct SectionLink: View {
    let title: String
    let destination: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title)
                Spacer()
                Image(systemName: "chevron.forward")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .tint(.primary)
        .accessibilityHint("Opens \(destination)")
    }
}

private struct DashboardSummary: View {
    @Environment(\.colorScheme) private var scheme

    let dashboard: DashboardResponse
    let pace: Double

    var body: some View {
        let kpis = dashboard.kpis
        let net = kpis.income - kpis.expenses
        VStack(alignment: .leading, spacing: 0) {
            Text("Spent")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(AppFormatters.euros(kpis.expenses))
                .font(.title.weight(.semibold))
                .monospacedDigit()
                .padding(.vertical, 1)
                .privacySensitive()
            if let deltas = dashboard.deltas {
                Text("\(AppFormatters.signedEuros(deltas.expenses, decimals: false)) vs previous")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .privacySensitive()
            }

            if let budget = dashboard.budgetPace {
                Divider()
                    .padding(.vertical, 12)
                overallBudget(budget)
            }

            Divider()
                .padding(.vertical, 12)

            HStack(alignment: .top, spacing: 0) {
                metric("Balance", AppFormatters.euros(kpis.balance), .primary)
                metric("Cash in", AppFormatters.euros(kpis.income), .primary)
                metric("Net", AppFormatters.signedEuros(net), net >= 0 ? ExpensesTheme.income(for: scheme) : .primary)
            }
        }
        .padding(.vertical, 6)
    }

    private func overallBudget(_ budget: DashboardBudgetPace) -> some View {
        let over = budget.remainingCents < 0
        return VStack(spacing: 0) {
            HStack {
                Text("Overall budget")
                Spacer()
                Text("\(AppFormatters.euros(budget.spentCents, decimals: false)) of \(AppFormatters.euros(budget.budgetCents, decimals: false))")
                    .monospacedDigit()
                    .privacySensitive()
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)

            BudgetBar(ratio: usedRatio(spent: budget.spentCents, budget: budget.budgetCents), over: over, pace: pace)
                .padding(.vertical, 9)

            HStack {
                if over {
                    Text("\(Text(AppFormatters.euros(-budget.remainingCents, decimals: false)).foregroundStyle(ExpensesTheme.expense(for: scheme))) over")
                        .foregroundStyle(.secondary)
                } else if budget.daysRemaining > 0 {
                    Text("\(AppFormatters.euros(budget.remainingCents, decimals: false)) left · \(AppFormatters.euros(budget.dailyRemainingCents, decimals: false))/day")
                        .foregroundStyle(.secondary)
                } else {
                    Text("\(AppFormatters.euros(budget.remainingCents, decimals: false)) left")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                // A finished month has no projection left to make.
                if budget.daysRemaining > 0 {
                    Text("Likely \(AppFormatters.euros(budget.projectedCents, decimals: false))")
                        .foregroundStyle(budget.projectedCents > budget.budgetCents ? ExpensesTheme.expense(for: scheme) : .secondary)
                }
            }
            .font(.subheadline)
            .monospacedDigit()
            .privacySensitive()
        }
    }

    private func metric(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .privacySensitive()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BudgetBar: View {
    @Environment(\.colorScheme) private var scheme

    let ratio: Double
    let over: Bool
    let pace: Double

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.08))
                Capsule()
                    .fill(over ? ExpensesTheme.expense(for: scheme) : Color.primary.opacity(0.55))
                    .frame(width: geometry.size.width * min(max(ratio, 0), 1))
                Rectangle()
                    .fill(Color.primary)
                    .frame(width: 1.5, height: 11)
                    .offset(x: geometry.size.width * pace - 0.75)
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

private struct CategoryBudgetRow: View {
    @Environment(\.colorScheme) private var scheme

    let budget: DashboardCategoryBudgetPulse
    let iconKey: String?
    let pace: Double

    var body: some View {
        let over = budget.remainingCents < 0
        HStack(spacing: 12) {
            CategoryGlyph(categoryID: budget.scopeCategoryID, iconKey: iconKey)
            VStack(spacing: 8) {
                HStack {
                    Text(budget.scopeLabel)
                        .lineLimit(1)
                    Spacer()
                    Group {
                        if over {
                            Text("\(Text(AppFormatters.euros(-budget.remainingCents, decimals: false)).foregroundStyle(ExpensesTheme.expense(for: scheme))) over")
                        } else {
                            Text("\(AppFormatters.euros(budget.remainingCents, decimals: false)) left")
                        }
                    }
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .privacySensitive()
                }
                BudgetBar(ratio: usedRatio(spent: budget.spentCents, budget: budget.amountCents), over: over, pace: pace)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

private struct LedgerRow: View {
    @Environment(\.colorScheme) private var scheme

    let transaction: TransactionListItem
    let category: CategorySummary?

    var body: some View {
        let income = transaction.type == "income"
        HStack(spacing: 12) {
            CategoryGlyph(categoryID: category?.id, iconKey: category?.icon)
            Text(transaction.title ?? "Untitled")
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(income ? AppFormatters.signedEuros(transaction.amountCents) : AppFormatters.euros(transaction.amountCents))
                .monospacedDigit()
                .foregroundStyle(income ? ExpensesTheme.income(for: scheme) : .primary)
                .privacySensitive()
        }
        .contentShape(Rectangle())
    }
}

private struct ChartMessage: View {
    let text: String

    var body: some View {
        Text(text)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 120)
    }
}

private struct BalanceSection: View {
    let history: Result<BalanceHistoryResponse, APIErrorInfo>?
    let forecast: Result<ForecastResponse, APIErrorInfo>?

    private struct Point: Identifiable {
        let index: Int
        let cents: Int
        var id: Int { index }
    }

    private struct RangePoint: Identifiable {
        let index: Int
        let low: Int
        let high: Int
        var id: Int { index }
    }

    // Without a forecast the chart shows only the actual balances, as on the web.
    private var projected: [ForecastMonth] {
        if case .success(let response) = forecast {
            return response.months
        }
        return []
    }

    var body: some View {
        Section {
            switch history {
            case nil:
                ChartMessage(text: "Loading…")
            case .failure:
                ChartMessage(text: "Balance history is unavailable.")
            case .success(let response) where response.months.isEmpty:
                ChartMessage(text: "No balance history yet.")
            case .success(let response):
                chart(actual: response.months)
            }
        } header: {
            HStack(alignment: .firstTextBaseline) {
                Text("Balance")
                if case .success(let response) = history, !response.months.isEmpty, let final = projected.last {
                    Text("likely \(AppFormatters.euros(final.endBalanceCents, decimals: false)) in \(shortMonth(final.month))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .privacySensitive()
                }
            }
        }
        .expensesRowBackground()
    }

    private func chart(actual: [BalanceHistoryPoint]) -> some View {
        let todayIndex = actual.count - 1
        let today = actual[todayIndex].balanceCents
        let labels = actual.enumerated().map { index, point in
            index == todayIndex ? "Today" : shortMonth(point.month)
        } + projected.map { shortMonth($0.month) }
        let actualPoints = actual.enumerated().map { Point(index: $0.offset, cents: $0.element.balanceCents) }
        // The likely line and its 80 % range start from today's balance.
        let likelyPoints = projected.isEmpty ? [] : [Point(index: todayIndex, cents: today)]
            + projected.enumerated().map { Point(index: actual.count + $0.offset, cents: $0.element.endBalanceCents) }
        let projectedRanges = projected.enumerated().compactMap { offset, month -> RangePoint? in
            guard let low = month.endBalanceP10Cents, let high = month.endBalanceP90Cents else {
                return nil
            }
            return RangePoint(index: actual.count + offset, low: low, high: high)
        }
        let ranges = !projected.isEmpty && projectedRanges.count == projected.count
            ? [RangePoint(index: todayIndex, low: today, high: today)] + projectedRanges
            : []

        return Chart {
            ForEach(ranges) { range in
                AreaMark(
                    x: .value("Month", range.index),
                    yStart: .value("Low", range.low),
                    yEnd: .value("High", range.high)
                )
                .foregroundStyle(Color.primary.opacity(0.07))
                .accessibilityLabel("\(labels[range.index]) 80% range")
                .accessibilityValue("\(AppFormatters.euros(range.low)) to \(AppFormatters.euros(range.high))")
            }
            ForEach(actualPoints) { point in
                LineMark(x: .value("Month", point.index), y: .value("Balance", point.cents), series: .value("Series", "Actual"))
                    .foregroundStyle(Color.primary)
                    .accessibilityLabel(labels[point.index])
                    .accessibilityValue(AppFormatters.euros(point.cents))
            }
            ForEach(likelyPoints) { point in
                LineMark(x: .value("Month", point.index), y: .value("Balance", point.cents), series: .value("Series", "Likely"))
                    .foregroundStyle(Color.secondary)
                    .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                    .accessibilityLabel("\(labels[point.index]) likely")
                    .accessibilityValue(AppFormatters.euros(point.cents))
            }
            if !projected.isEmpty {
                RuleMark(x: .value("Month", todayIndex))
                    .foregroundStyle(Color.secondary.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
            }
        }
        .chartXScale(domain: 0...max(labels.count - 1, 1), range: .plotDimension(padding: 12))
        .chartYScale(domain: .automatic(includesZero: false))
        .chartXAxis {
            AxisMarks(values: Array(stride(from: todayIndex % 3, to: labels.count, by: 3))) { value in
                AxisValueLabel(anchor: .top) {
                    if let index = value.as(Int.self) {
                        Text(labels[index])
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
        .padding(.vertical, 8)
    }
}

private struct SpendingBandsSection: View {
    @Environment(\.colorScheme) private var scheme

    let bands: Result<CategoryBandsResponse, APIErrorInfo>?

    private struct LegendEntry: Identifiable {
        let categoryID: Int?
        let name: String
        let totalCents: Int
        var id: Int? { categoryID }
    }

    var body: some View {
        Section("Spending by category") {
            switch bands {
            case nil:
                ChartMessage(text: "Loading…")
            case .failure:
                ChartMessage(text: "Spending is unavailable.")
            case .success(let response) where !response.months.contains(where: { $0.totalCents > 0 }):
                ChartMessage(text: "No spending in these months.")
            case .success(let response):
                VStack(alignment: .leading, spacing: 10) {
                    rows(response.months)
                    legend(response.months)
                }
                .padding(.vertical, 8)
            }
        }
        .expensesRowBackground()
    }

    // One stacked track per month, scaled to the largest month, as on the web.
    private func rows(_ months: [CategoryBandMonth]) -> some View {
        let largest = CGFloat(max(1, months.map(\.totalCents).max() ?? 0))
        return Grid(horizontalSpacing: 12, verticalSpacing: 10) {
            ForEach(months.reversed()) { month in
                let segments = month.segments.filter { $0.amountCents > 0 }
                GridRow {
                    Text(shortMonth(month.month))
                        .foregroundStyle(.secondary)
                        .gridColumnAlignment(.leading)
                        .accessibilityLabel("\(shortMonth(month.month)), \(AppFormatters.euros(month.totalCents))")
                        .accessibilityValue(segments.map { "\($0.name) \(AppFormatters.euros($0.amountCents))" }.joined(separator: ", "))
                    GeometryReader { geometry in
                        let width = geometry.size.width - CGFloat(max(segments.count - 1, 0))
                        HStack(spacing: 1) {
                            ForEach(segments, id: \.categoryID) { segment in
                                Rectangle()
                                    .fill(ExpensesTheme.category(segment.categoryID, for: scheme))
                                    .frame(width: width * CGFloat(segment.amountCents) / largest)
                            }
                        }
                        .clipShape(.rect(cornerRadius: 3))
                    }
                    .frame(height: 14)
                    .accessibilityHidden(true)
                    Text(AppFormatters.euros(month.totalCents))
                        .monospacedDigit()
                        .gridColumnAlignment(.trailing)
                        .privacySensitive()
                        .accessibilityHidden(true)
                }
            }
        }
        .font(.subheadline)
    }

    private func legend(_ months: [CategoryBandMonth]) -> some View {
        var entries: [Int?: LegendEntry] = [:]
        for segment in months.flatMap(\.segments) {
            let total = (entries[segment.categoryID]?.totalCents ?? 0) + segment.amountCents
            entries[segment.categoryID] = LegendEntry(categoryID: segment.categoryID, name: segment.name, totalCents: total)
        }
        let sorted = entries.values.sorted { $0.totalCents > $1.totalCents }
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(sorted) { entry in
                HStack(spacing: 6) {
                    Circle()
                        .fill(ExpensesTheme.category(entry.categoryID, for: scheme))
                        .frame(width: 8, height: 8)
                    Text(entry.name)
                        .lineLimit(1)
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
    }
}

private struct CategoryShareSection: View {
    @Environment(\.colorScheme) private var scheme
    @State private var showsIncome = false

    let donut: DashboardDonut

    var body: some View {
        let items = (showsIncome ? donut.incomeBreakdown : donut.expenseBreakdown) ?? []
        let total = items.reduce(0) { $0 + $1.amountCents }
        Section("Category share") {
            Picker("Type", selection: $showsIncome) {
                Text("Expenses").tag(false)
                Text("Income").tag(true)
            }
            .pickerStyle(.segmented)

            if items.isEmpty {
                ChartMessage(text: showsIncome ? "No income in this period." : "No spending in this period.")
            } else {
                HStack(spacing: 18) {
                    Chart(items) { item in
                        SectorMark(angle: .value("Amount", item.amountCents), innerRadius: .ratio(0.64), angularInset: 1)
                            .foregroundStyle(ExpensesTheme.category(item.categoryID, for: scheme))
                            .accessibilityLabel(item.name)
                            .accessibilityValue(AppFormatters.euros(item.amountCents))
                    }
                    .chartLegend(.hidden)
                    .frame(width: 112, height: 112)
                    .overlay {
                        Text(AppFormatters.euros(total, decimals: false))
                            .font(.footnote.weight(.semibold))
                            .monospacedDigit()
                            .privacySensitive()
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(items.prefix(5)) { item in
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(ExpensesTheme.category(item.categoryID, for: scheme))
                                    .frame(width: 8, height: 8)
                                Text(item.name)
                                    .lineLimit(1)
                                Spacer()
                                Text((item.percent / 100).formatted(.percent.precision(.fractionLength(0))))
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }
                            .font(.subheadline)
                        }
                        if items.count > 5 {
                            Text("\(items.count - 5) more")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.vertical, 6)
            }
        }
        .expensesRowBackground()
    }
}
