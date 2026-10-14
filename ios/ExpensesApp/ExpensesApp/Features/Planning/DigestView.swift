import SwiftUI

/// One week's spending: how it compares, where it went, budgets at the week's end, and
/// what stood out or posted on its own.
struct DigestView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    // Nil is the current week, as the server picks it.
    @State private var weekOf: String?
    @State private var digest: Result<DigestResponse, APIErrorInfo>?

    let openTransactions: (TransactionQuery) -> Void
    let openBudgets: () -> Void

    var body: some View {
        List {
            switch digest {
            case nil:
                LoadingStateSection(title: "Loading digest")
            case .failure(let error):
                UnavailableStateSection(title: "Couldn't load the digest", systemImage: "exclamationmark.triangle", message: error.message)
            case .success(let data):
                metricsSection(data)
                categoriesSection(data)
                budgetsSection(data)
                unusualSection(data)
                autoPostedSection(data)
            }
        }
        .headerProminence(.increased)
        .navigationTitle("Digest")
        .navigationSubtitle(weekTitle)
        .expensesScreenStyle()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Previous week", systemImage: "chevron.backward") {
                    step(by: -1)
                }
                .disabled(weekStart == nil)
                Button("Next week", systemImage: "chevron.forward") {
                    step(by: 1)
                }
                .disabled(weekStart == nil)
            }
        }
        .task(id: weekOf) {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    private var loaded: DigestResponse? {
        try? digest?.get()
    }

    // The week asked for, so quick steps add up and a week that failed to load can still
    // be left; the current week is known once it loads.
    private var weekStart: Date? {
        weekOf.map { try! Date($0, strategy: .iso8601.year().month().day()) } ?? loaded?.weekStart
    }

    private var weekTitle: String {
        guard let weekStart else {
            return "This week"
        }
        let end = CalendarMonth.calendar.date(byAdding: .day, value: 6, to: weekStart)!
        return (weekStart..<end).formatted(Date.IntervalFormatStyle(timeZone: .gmt).day().month(.abbreviated).year())
    }

    private func step(by weeks: Int) {
        guard let weekStart else {
            return
        }
        let start = CalendarMonth.calendar.date(byAdding: .day, value: 7 * weeks, to: weekStart)!
        weekOf = start.formatted(.iso8601.year().month().day())
    }

    private func load() async {
        let weekOf = weekOf
        let result = await model.chart { try await $0.digest(weekOf: weekOf, token: $1) }
        guard !Task.isCancelled else {
            return
        }
        digest = result
    }

    private func metricsSection(_ data: DigestResponse) -> some View {
        let headline = data.headline
        let budgets = data.budgetPulse.count
        let overPace = data.budgetPulse.filter { $0.paceState == "over" }.count
        return Section {
            Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 16) {
                GridRow {
                    Metric("Spent") {
                        AmountText(headline.totalSpentCents)
                    } detail: {
                        Text(headline.transactionCount == 1 ? "1 transaction" : "\(headline.transactionCount) transactions")
                    }
                    Metric("vs last week") {
                        AmountText(headline.vsLastWeekCents, signed: true)
                    } detail: {
                        HStack(spacing: 4) {
                            AmountText(headline.totalSpentCents - headline.vsLastWeekCents)
                            Text("last week")
                        }
                    }
                }
                GridRow {
                    Metric("vs 4-week average") {
                        AmountText(headline.vsFourWeekAvgCents, signed: true)
                    } detail: {
                        HStack(spacing: 4) {
                            AmountText(headline.totalSpentCents - headline.vsFourWeekAvgCents)
                            Text("average")
                        }
                    }
                    Metric("Budgets on pace") {
                        Text(budgets == 0 ? "None" : "\(budgets - overPace) of \(budgets)")
                    } detail: {
                        if budgets > 0 {
                            Text("\(overPace) over pace")
                        }
                    }
                }
            }
            .padding(.vertical, 6)
        }
        .expensesRowBackground()
    }

    private func categoriesSection(_ data: DigestResponse) -> some View {
        Section("Top categories") {
            if data.topCategories.isEmpty {
                Text("No spending this week.")
                    .foregroundStyle(.secondary)
            } else {
                WeekShareBar(categories: data.topCategories, totalCents: data.headline.totalSpentCents)
                    .padding(.vertical, 6)
                ForEach(data.topCategories) { category in
                    Button {
                        var query = TransactionQuery(period: .custom(start: AppFormatters.localDay(data.weekStart), end: AppFormatters.localDay(data.weekEnd)))
                        query.categoryID = category.categoryID
                        openTransactions(query)
                    } label: {
                        HStack(spacing: 12) {
                            CategoryGlyph(categoryID: category.categoryID, iconKey: category.icon, name: category.name)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(category.name)
                                    .lineLimit(1)
                                HStack(spacing: 4) {
                                    if category.isAboveTrailing50 {
                                        Image(systemName: "arrow.up.right")
                                            .accessibilityLabel("Above its average")
                                    }
                                    Text("avg")
                                    AmountText(category.trailingWeeklyAvgCents, decimals: false)
                                }
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            AmountText(category.amountCents, decimals: false)
                        }
                        .contentShape(Rectangle())
                    }
                    .tint(.primary)
                }
            }
        }
        .expensesRowBackground()
    }

    private func budgetsSection(_ data: DigestResponse) -> some View {
        // Budgets of the month the week ends in, with even pace as of the week's last day.
        let end = CalendarMonth.calendar.dateComponents([.year, .month, .day], from: data.weekEnd)
        let pace = Double(end.day!) / Double(CalendarMonth(year: end.year!, month: end.month!).days)
        return Section {
            if data.budgetPulse.isEmpty {
                Text("No budgets this month.")
                    .foregroundStyle(.secondary)
            }
            ForEach(data.budgetPulse) { budget in
                Button(action: openBudgets) {
                    BudgetPulseRow(
                        categoryID: budget.scopeCategoryID,
                        iconKey: model.knownCategories.first { $0.id == budget.scopeCategoryID }?.icon,
                        label: budget.scopeLabel,
                        spentCents: budget.spentCents,
                        budgetCents: budget.amountCents,
                        pace: pace
                    )
                }
                .tint(.primary)
            }
        } header: {
            SectionLink(title: "Budgets", destination: "Budgets", action: openBudgets)
        }
        .expensesRowBackground()
    }

    private func unusualSection(_ data: DigestResponse) -> some View {
        Section("Unusual") {
            if data.unusualTransactions.isEmpty {
                Text("Nothing unusual this week.")
                    .foregroundStyle(.secondary)
            }
            ForEach(data.unusualTransactions) { item in
                NavigationLink {
                    TransactionDetailView(transactionID: item.id)
                } label: {
                    HStack(spacing: 12) {
                        CategoryGlyph(categoryID: item.category?.id, iconKey: item.category?.icon, name: item.category?.name)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title.isEmpty ? item.category?.name ?? "Untitled" : item.title)
                                .lineLimit(1)
                            HStack(spacing: 4) {
                                Text("avg")
                                AmountText(item.trailingAvgCents, decimals: false)
                            }
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        AmountText(item.amountCents)
                    }
                }
                .navigationLinkIndicatorVisibility(.hidden)
            }
        }
        .expensesRowBackground()
    }

    private func autoPostedSection(_ data: DigestResponse) -> some View {
        Section("Auto-posted") {
            if data.recurringPostings.isEmpty {
                Text("Nothing auto-posted this week.")
                    .foregroundStyle(.secondary)
            }
            ForEach(data.recurringPostings) { item in
                NavigationLink {
                    if let ruleID = item.ruleID {
                        RecurringRuleView(ruleID: ruleID)
                    } else {
                        TransactionDetailView(transactionID: item.transactionID)
                    }
                } label: {
                    LedgerRow(
                        title: item.ruleName.isEmpty ? "Recurring" : item.ruleName,
                        detail: AppFormatters.bookingDay(item.date),
                        categoryID: item.category?.id,
                        iconKey: item.category?.icon,
                        categoryName: item.category?.name,
                        amountCents: item.amountCents,
                        income: item.type == "income"
                    )
                }
                .navigationLinkIndicatorVisibility(.hidden)
            }
        }
        .expensesRowBackground()
    }
}

/// The week's spending split by its top categories, with everything else as Other.
private struct WeekShareBar: View {
    @Environment(\.colorScheme) private var scheme

    let categories: [DigestCategory]
    let totalCents: Int

    private struct Segment: Identifiable {
        let id: Int?
        let name: String
        let cents: Int
    }

    var body: some View {
        let top = categories.reduce(0) { $0 + $1.amountCents }
        let total = max(totalCents, top)
        let segments = categories.map { Segment(id: $0.categoryID, name: $0.name, cents: $0.amountCents) }
            + (total > top ? [Segment(id: nil, name: "Other", cents: total - top)] : [])
        GeometryReader { geometry in
            let width = geometry.size.width - CGFloat(segments.count - 1) * 2
            HStack(spacing: 2) {
                ForEach(segments) { segment in
                    Rectangle()
                        .fill(ExpensesTheme.category(segment.id, for: scheme))
                        .frame(width: width * CGFloat(segment.cents) / CGFloat(total))
                }
            }
        }
        .frame(height: 10)
        .clipShape(.capsule)
        .accessibilityElement()
        .accessibilityLabel("Spending this week by category")
        .accessibilityValue(segments.map { "\($0.name) \(percent($0.cents, of: total))" }.joined(separator: ", "))
    }
}
