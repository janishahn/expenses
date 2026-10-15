import SwiftUI

/// Recurring rules as monthly commitments, or as an audit of what the expenses cost
/// over time.
struct RecurringView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var audit = false
    @State private var adding = false

    var body: some View {
        List {
            if let recurring = model.recurring {
                content(recurring)
            } else if model.showsRecurringLoadFailed {
                UnavailableStateSection(
                    title: "Couldn't load recurring rules",
                    systemImage: "exclamationmark.triangle",
                    message: model.lastError?.message
                ) {
                    await model.loadRecurring()
                }
            } else {
                LoadingStateSection(title: "Loading recurring rules")
            }
        }
        .refreshable {
            await model.loadRecurring()
        }
        .navigationTitle("Recurring")
        .expensesScreenStyle()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add rule", systemImage: "plus") {
                    adding = true
                }
                .disabled(model.recurring == nil)
            }
        }
        .sheet(isPresented: $adding) {
            if let recurring = model.recurring {
                AddRecurringRuleSheet(categories: recurring.categories)
            }
        }
        .task {
            await model.loadRecurring()
        }
    }

    @ViewBuilder
    private func content(_ recurring: RecurringResponse) -> some View {
        let expenses = recurring.rules.filter { $0.type == .expense }
        if recurring.rules.isEmpty {
            empty("No recurring rules yet")
        } else {
            Section {
                Picker("View", selection: $audit) {
                    Text("Commitments").tag(false)
                    Text("Audit").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .sensoryFeedback(.selection, trigger: audit)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())

            if !audit {
                commitments(recurring)
            } else if expenses.isEmpty {
                empty("No recurring expenses")
            } else {
                auditSections(recurring.stats, expenses: expenses.sorted { $0.monthlyEquivalentCents > $1.monthlyEquivalentCents })
            }
        }
    }

    private func empty(_ title: String) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: "repeat")
        } actions: {
            Button("Add rule") {
                adding = true
            }
        }
        .listRowBackground(Color.clear)
    }

    @ViewBuilder
    private func commitments(_ recurring: RecurringResponse) -> some View {
        let stats = recurring.stats
        let net = stats.netMonthly
        Section {
            MetricGrid {
                GridRow {
                    Metric("Income per month") {
                        AmountText(stats.totalMonthlyIncome)
                            .foregroundStyle(ExpensesTheme.income(for: scheme))
                    } detail: {
                        Text(rules(stats.ruleCounts.income))
                    }
                    Metric("Expenses per month") {
                        AmountText(stats.totalMonthlyExpenses)
                    } detail: {
                        Text(rules(stats.ruleCounts.expense))
                    }
                }
                GridRow {
                    Metric("Covered") {
                        Text((stats.coverageRatio / 100).formatted(.percent.precision(.fractionLength(0))))
                    } detail: {
                        HStack(spacing: 4) {
                            AmountText(abs(net), decimals: false)
                                .foregroundStyle(net >= 0 ? ExpensesTheme.income(for: scheme) : .secondary)
                            Text(net >= 0 ? "left per month" : "short per month")
                        }
                    }
                }
            }
            .padding(.vertical, 6)
        }
        .expensesRowBackground()

        ruleSection("Expenses", rules: recurring.rules.filter { $0.type == .expense }, perMonth: stats.totalMonthlyExpenses)
        ruleSection("Income", rules: recurring.rules.filter { $0.type == .income }, perMonth: stats.totalMonthlyIncome)
    }

    @ViewBuilder
    private func ruleSection(_ title: String, rules: [RecurringRule], perMonth: Int) -> some View {
        if !rules.isEmpty {
            Section {
                ForEach(rules) { rule in
                    NavigationLink {
                        RecurringRuleView(ruleID: rule.id)
                    } label: {
                        RecurringRuleRow(rule: rule)
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                }
            } header: {
                AdaptiveRow {
                    Text(title)
                } trailing: {
                    HStack(spacing: 4) {
                        AmountText(perMonth)
                        Text("per month")
                    }
                }
            }
            .expensesRowBackground()
        }
    }

    @ViewBuilder
    private func auditSections(_ stats: RecurringStats, expenses: [RecurringRule]) -> some View {
        Section {
            MetricGrid {
                GridRow {
                    Metric("Per month") {
                        AmountText(stats.totalMonthlyExpenses)
                    } detail: {
                        Text(expenses.count == 1 ? "1 expense rule" : "\(expenses.count) expense rules")
                    }
                    Metric("Per year") {
                        AmountText(stats.totalMonthlyExpenses * 12)
                    } detail: {
                        EmptyView()
                    }
                }
                GridRow {
                    Metric("Over 5 years") {
                        AmountText(stats.totalMonthlyExpenses * 60, decimals: false)
                    } detail: {
                        EmptyView()
                    }
                }
            }
            .padding(.vertical, 6)
        }
        .expensesRowBackground()

        AnnualMixSection(rules: expenses, totalCents: stats.totalMonthlyExpenses * 12)

        Section {
            ForEach(expenses) { rule in
                NavigationLink {
                    RecurringRuleView(ruleID: rule.id)
                } label: {
                    TrailingRow {
                        CategoryGlyph(categoryID: rule.categoryID, iconKey: rule.category?.icon, name: rule.category?.name)
                    } content: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(rule.label)
                            HStack(spacing: 4) {
                                AmountText(rule.monthlyEquivalentCents * 12, decimals: false)
                                Text("per year")
                            }
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        }
                    } trailing: {
                        AmountText(rule.monthlyEquivalentCents)
                    }
                }
                .navigationLinkIndicatorVisibility(.hidden)
            }
        } header: {
            HStack {
                Text("True cost")
                Spacer()
                Text("Per month")
            }
        }
        .expensesRowBackground()
    }

    private func rules(_ count: Int) -> String {
        count == 1 ? "1 rule" : "\(count) rules"
    }
}

/// A rule in a list: its category glyph, name, how often and when next, and amount.
private struct RecurringRuleRow: View {
    @Environment(\.colorScheme) private var scheme

    let rule: RecurringRule

    var body: some View {
        TrailingRow {
            CategoryGlyph(categoryID: rule.categoryID, iconKey: rule.category?.icon, name: rule.category?.name)
        } content: {
            VStack(alignment: .leading, spacing: 2) {
                Text(rule.label)
                Text("\(rule.intervalUnit.repeats(rule.intervalCount)) · Next \(AppFormatters.shortDay(AppFormatters.localDay(rule.nextOccurrence)))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } trailing: {
            AmountText(rule.amountCents, currencyCode: rule.currencyCode, signed: rule.type == .income)
                .foregroundStyle(rule.type == .income ? ExpensesTheme.income(for: scheme) : .primary)
        }
        .contentShape(Rectangle())
    }
}

/// What the recurring expenses cost per year, by category.
private struct AnnualMixSection: View {
    let rules: [RecurringRule]
    let totalCents: Int

    var body: some View {
        let slices = Dictionary(grouping: rules, by: \.categoryID)
            .map { id, rules in
                let cents = rules.reduce(0) { $0 + $1.monthlyEquivalentCents * 12 }
                return CategoryShare(
                    id: String(id),
                    categoryID: id,
                    name: rules[0].category?.name ?? "Uncategorized",
                    cents: cents,
                    share: totalCents > 0 ? percent(cents, of: totalCents) : "–"
                )
            }
            .sorted { $0.cents > $1.cents }
        Section("Annual mix") {
            CategoryShareDonut(slices: slices) {
                VStack(spacing: 0) {
                    AmountText(totalCents, decimals: false)
                        .font(.footnote.weight(.semibold))
                    Text("per year")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .expensesRowBackground()
    }
}
