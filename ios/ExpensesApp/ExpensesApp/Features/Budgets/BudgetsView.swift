import Charts
import SwiftUI

/// A budget's period: a month, or a year for an annual budget.
enum BudgetKind: Hashable {
    case month
    case year
}

/// A budget on the Budgets screen; a nil scope is all expense categories.
struct BudgetKey: Hashable {
    let kind: BudgetKind
    let scopeCategoryID: Int?
}

extension BudgetsResponse {
    var budgetMonth: CalendarMonth {
        CalendarMonth(year: year, month: month)
    }

    var overall: BudgetScope? {
        budgets.first { $0.scopeCategoryID == nil }
    }

    var categoryBudgets: [BudgetScope] {
        budgets.filter { $0.scopeCategoryID != nil }
    }

    func budget(_ key: BudgetKey) -> BudgetScope? {
        (key.kind == .month ? budgets : yearlyBudgets).first { $0.scopeCategoryID == key.scopeCategoryID }
    }

    func progress(_ scope: Int?) -> BudgetProgress? {
        progress.first { $0.scopeCategoryID == scope }
    }

    func spent(_ kind: BudgetKind, _ budget: BudgetScope) -> Int {
        switch kind {
        case .month:
            progress(budget.scopeCategoryID)?.spentCents ?? 0
        case .year:
            yearlySpent.first { $0.scopeCategoryID == budget.scopeCategoryID }?.spentCents ?? 0
        }
    }

    func category(_ id: Int?) -> BudgetCategory? {
        categories.first { $0.id == id }
    }

    /// The template behind a scope's budget: the latest one that covers the period.
    func activeTemplate(_ kind: BudgetKind, scope: Int?) -> BudgetTemplateRow? {
        activeTemplates(kind).first { $0.category?.id == scope }
    }

    var inactiveTemplates: [BudgetTemplateRow] {
        let active = Set((activeTemplates(.month) + activeTemplates(.year)).map(\.id))
        return templates.filter { !active.contains($0.id) }
    }

    private func activeTemplates(_ kind: BudgetKind) -> [BudgetTemplateRow] {
        let day = kind == .month ? budgetMonth.start : CalendarMonth(year: yearValue, month: 1).start
        let frequency = kind == .month ? "monthly" : "yearly"
        var scopes = Set<Int?>()
        return templates
            .filter { $0.frequency == frequency && $0.startsOn <= day && ($0.endsOn.map { $0 >= day } ?? true) }
            .sorted { $0.startsOn > $1.startsOn }
            .filter { scopes.insert($0.category?.id).inserted }
    }
}

struct BudgetsView: View {
    @Environment(AppModel.self) private var model
    @State private var month = CalendarMonth.current
    @State private var comparing = false
    @State private var showsInactive = false
    @State private var adding = false
    @State private var overallPace: (request: PaceRequest, result: Result<BudgetBurndownResponse, APIErrorInfo>)?
    @State private var removing: BudgetTemplateRow?
    @State private var failure: String?

    private struct PaceRequest: Equatable {
        let month: CalendarMonth
        let comparing: Bool
        let budgetCents: Int
    }

    var body: some View {
        List {
            if let budgets = model.budgets {
                content(budgets)
            } else if model.showsBudgetsLoadFailed {
                UnavailableStateSection(
                    title: "Couldn't load budgets",
                    systemImage: "exclamationmark.triangle",
                    message: model.lastError?.message
                )
            } else {
                LoadingStateSection(title: "Loading budgets")
            }
        }
        .navigationTitle("Budgets")
        .navigationSubtitle(month.title)
        .expensesScreenStyle()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Button("Previous Month", systemImage: "chevron.backward") {
                        month = month.adding(-1)
                    }
                    Button("Next Month", systemImage: "chevron.forward") {
                        month = month.adding(1)
                    }
                    Button("This Month", systemImage: "calendar") {
                        month = .current
                    }
                    .disabled(month == .current)
                } label: {
                    Label("Month", systemImage: "calendar")
                }
                .sensoryFeedback(.selection, trigger: month)
                Button {
                    adding = true
                } label: {
                    Label("Add budget", systemImage: "plus")
                }
                .disabled(model.budgets == nil)
                Menu {
                    Toggle("Compare Previous Month", systemImage: "clock.arrow.circlepath", isOn: $comparing)
                        .disabled(model.budgets?.overall == nil)
                    Toggle("Show Ended and Future Budgets", systemImage: "calendar.badge.clock", isOn: $showsInactive)
                } label: {
                    Label("More", systemImage: "ellipsis")
                }
            }
        }
        .navigationDestination(for: BudgetKey.self) { key in
            BudgetDetailView(key: key)
        }
        .sheet(isPresented: $adding) {
            if let budgets = model.budgets {
                AddBudgetSheet(budgets: budgets)
            }
        }
        .alert(
            "Remove the \(removing.map(Self.label) ?? "") budget?",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            presenting: removing
        ) { template in
            Button("Cancel", role: .cancel) {}
            Button("Remove", role: .destructive) {
                Task {
                    if !(await model.deleteBudgetTemplate(id: template.id)) {
                        failure = model.lastError?.message ?? "Unable to remove the budget."
                    }
                }
            }
        }
        .failureAlert("Couldn't remove the budget", message: $failure)
        .task(id: month) {
            await model.loadBudgets(month: month.value)
        }
        .task(id: paceRequest) {
            guard let paceRequest else {
                return
            }
            let result = await model.chart {
                try await $0.budgetBurndown(
                    month: paceRequest.month.value,
                    scope: "overall",
                    compareMonth: paceRequest.comparing ? paceRequest.month.adding(-1).value : nil,
                    token: $1
                )
            }
            if !Task.isCancelled {
                overallPace = (paceRequest, result)
            }
        }
        .refreshable {
            await model.loadBudgets(month: month.value)
        }
    }

    // The overall pace follows the loaded month and reloads when its budget changes.
    private var paceRequest: PaceRequest? {
        guard let budgets = model.budgets, budgets.budgetMonth == month, let overall = budgets.overall else {
            return nil
        }
        return PaceRequest(month: month, comparing: comparing, budgetCents: overall.amountCents)
    }

    @ViewBuilder
    private func content(_ budgets: BudgetsResponse) -> some View {
        let inactive = showsInactive ? budgets.inactiveTemplates : []
        if budgets.budgets.isEmpty && budgets.yearlyBudgets.isEmpty && inactive.isEmpty {
            Section {
                ContentUnavailableView {
                    Label("No budgets for \(budgets.budgetMonth.title)", systemImage: "target")
                } actions: {
                    Button("Add budget") {
                        adding = true
                    }
                }
            }
            .listRowBackground(Color.clear)
        } else {
            if !budgets.budgets.isEmpty {
                summary(budgets)
            }
            if budgets.overall != nil {
                Section("Overall pace") {
                    if let overallPace, overallPace.request.month == budgets.budgetMonth {
                        switch overallPace.result {
                        case .success(let data):
                            PaceChart(data: data, month: budgets.budgetMonth, height: 150)
                                .padding(.vertical, 8)
                        case .failure:
                            ChartMessage(text: "The pace chart is unavailable.")
                        }
                    } else {
                        ChartMessage(text: "Loading…")
                    }
                }
                .expensesRowBackground()
            }
            budgetSection(budgets, kind: .month)
            budgetSection(budgets, kind: .year)
            if !inactive.isEmpty {
                Section("Ended and future") {
                    ForEach(inactive) { template in
                        inactiveRow(template)
                    }
                }
                .expensesRowBackground()
            }
        }
    }

    private func summary(_ budgets: BudgetsResponse) -> some View {
        let overall = budgets.overall
        let categoryBudgets = budgets.categoryBudgets
        let allocation = overall?.amountCents ?? categoryBudgets.reduce(0) { $0 + $1.amountCents }
        let spent = budgets.progress(nil)?.spentCents ?? categoryBudgets.reduce(0) { $0 + budgets.spent(.month, $1) }
        let head = VStack(alignment: .leading, spacing: 0) {
            Text(overall == nil ? "Category budgets" : "Overall budget")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                AmountText(spent)
                    .font(.title.weight(.semibold))
                HStack(spacing: 4) {
                    Text("of")
                    AmountText(allocation)
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            .padding(.vertical, 1)
            BudgetBar(spentCents: spent, budgetCents: allocation, pace: budgets.budgetMonth.pace)
                .padding(.top, 10)
        }
        .padding(.vertical, 6)
        return Section {
            if overall != nil {
                NavigationLink(value: BudgetKey(kind: .month, scopeCategoryID: nil)) {
                    head
                }
                .navigationLinkIndicatorVisibility(.hidden)
            } else {
                head
            }
        }
        .expensesRowBackground()
    }

    private func budgetSection(_ budgets: BudgetsResponse, kind: BudgetKind) -> some View {
        let rows = kind == .month ? budgets.categoryBudgets : budgets.yearlyBudgets
        let period = kind == .month ? budgets.budgetMonth.title : String(budgets.yearValue)
        return Section {
            if rows.isEmpty {
                Text(kind == .month ? "No category budgets for \(period)" : "No annual budgets for \(period)")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(rows) { budget in
                    let category = budgets.category(budget.scopeCategoryID)
                    NavigationLink(value: BudgetKey(kind: kind, scopeCategoryID: budget.scopeCategoryID)) {
                        HStack(spacing: 12) {
                            ScopeGlyph(categoryID: budget.scopeCategoryID, iconKey: category?.icon, name: budget.scopeLabel)
                            VStack(spacing: 8) {
                                HStack(spacing: 8) {
                                    Text(budget.scopeLabel)
                                        .lineLimit(1)
                                    Spacer(minLength: 8)
                                    SpentAgainst(spentCents: budgets.spent(kind, budget), budgetCents: budget.amountCents)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                BudgetBar(
                                    spentCents: budgets.spent(kind, budget),
                                    budgetCents: budget.amountCents,
                                    pace: kind == .month ? budgets.budgetMonth.pace : nil
                                )
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                }
            }
        } header: {
            HStack {
                Text(kind == .month ? "Monthly" : "Annual · \(period)")
                Spacer()
                if !rows.isEmpty {
                    SpentAgainst(
                        spentCents: rows.reduce(0) { $0 + budgets.spent(kind, $1) },
                        budgetCents: rows.reduce(0) { $0 + $1.amountCents }
                    )
                    .fontWeight(.regular)
                }
            }
        }
        .expensesRowBackground()
    }

    private func inactiveRow(_ template: BudgetTemplateRow) -> some View {
        let yearly = template.frequency == "yearly"
        let period = { (date: Date) in
            date.formatted(yearly ? Date.FormatStyle(timeZone: .gmt).year() : Date.FormatStyle(timeZone: .gmt).month(.abbreviated).year())
        }
        return HStack(spacing: 12) {
            ScopeGlyph(categoryID: template.category?.id, iconKey: template.category?.icon, name: Self.label(template))
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.label(template))
                    .lineLimit(1)
                HStack(spacing: 4) {
                    AmountText(template.amountCents, decimals: false)
                    Text("per \(yearly ? "year" : "month") · \(period(template.startsOn))\(template.endsOn.map { " – \(period($0))" } ?? " onward")")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                removing = template
            } label: {
                Image(systemName: "trash")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Remove the \(Self.label(template)) budget")
        }
        .opacity(0.75)
        .swipeActions(edge: .trailing) {
            Button("Remove", role: .destructive) {
                removing = template
            }
        }
    }

    private static func label(_ template: BudgetTemplateRow) -> String {
        template.category?.name ?? "All expense categories"
    }
}

/// "120 € of 300 €": spent against a budget, in whole euros.
struct SpentAgainst: View {
    let spentCents: Int
    let budgetCents: Int

    var body: some View {
        HStack(spacing: 4) {
            AmountText(spentCents, decimals: false)
            Text("of")
            AmountText(budgetCents, decimals: false)
        }
    }
}

/// A budget scope's glyph. All expense categories have no category, so they show the
/// grid that stands for every category.
struct ScopeGlyph: View {
    @Environment(\.colorScheme) private var scheme

    let categoryID: Int?
    let iconKey: String?
    let name: String

    var body: some View {
        if let categoryID {
            CategoryGlyph(categoryID: categoryID, iconKey: iconKey, name: name)
        } else {
            Image(systemName: "square.grid.2x2")
                .font(.callout)
                .foregroundStyle(ExpensesTheme.category(nil, for: scheme))
                .frame(width: 26)
                .accessibilityHidden(true)
        }
    }
}

/// Cumulative spending by day against an even pace to the budget, with the previous
/// month when it was loaded for comparison.
struct PaceChart: View {
    @Environment(AppModel.self) private var model

    let data: BudgetBurndownResponse
    let month: CalendarMonth
    let height: CGFloat

    private struct Point: Identifiable {
        let series: String
        let day: Int
        let cents: Int
        var id: String { "\(series)-\(day)" }
    }

    var body: some View {
        let elapsed = month.daysElapsed
        let even = (1...data.daysInMonth).map { day in
            Point(series: "Even pace", day: day, cents: Int((Double(data.budgetAmountCents) * Double(day) / Double(data.daysInMonth)).rounded()))
        }
        let actual = data.dailySeries.filter { $0.day <= elapsed }.map { Point(series: "Actual", day: $0.day, cents: $0.cumulativeCents) }
        let previous = data.compareDailySeries.filter { $0.day <= data.daysInMonth }.map {
            Point(series: "Previous month", day: $0.day, cents: $0.cumulativeCents)
        }
        VStack(alignment: .leading, spacing: 10) {
            Chart {
                ForEach(even) { point in
                    line(point)
                        .foregroundStyle(Color.secondary)
                        .lineStyle(StrokeStyle(lineWidth: 1.25, dash: [4, 3]))
                }
                ForEach(previous) { point in
                    line(point)
                        .foregroundStyle(Color.secondary)
                        .lineStyle(StrokeStyle(lineWidth: 1.25))
                }
                ForEach(actual) { point in
                    line(point)
                        .foregroundStyle(Color.primary)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                }
                if elapsed > 0 && elapsed < data.daysInMonth {
                    RuleMark(x: .value("Day", elapsed))
                        .foregroundStyle(Color.secondary.opacity(0.6))
                        .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
                }
            }
            .chartXScale(domain: 1...data.daysInMonth, range: .plotDimension(padding: 8))
            .chartXAxis {
                AxisMarks(values: [1, 10, 20, 30].filter { $0 <= data.daysInMonth }) { _ in
                    AxisValueLabel()
                }
            }
            .chartYAxis {
                AxisMarks(values: .automatic(desiredCount: 3)) { _ in
                    AxisGridLine()
                }
            }
            .frame(height: height)

            HStack(spacing: 14) {
                ChartLegendItem(title: "Actual", color: .primary, mark: .line)
                ChartLegendItem(title: "Even pace", color: .secondary, mark: .dash)
                if !previous.isEmpty {
                    ChartLegendItem(title: "Previous month", color: .secondary, mark: .line)
                }
            }
        }
    }

    private func line(_ point: Point) -> some ChartContent {
        LineMark(x: .value("Day", point.day), y: .value("Amount", point.cents), series: .value("Series", point.series))
            .accessibilityLabel("\(point.series), \(month.day(point.day).formatted(Date.FormatStyle(timeZone: .gmt).month(.abbreviated).day()))")
            .accessibilityValue(model.amountString(point.cents))
    }
}
