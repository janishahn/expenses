import Charts
import SwiftUI

struct DashboardView: View {
    @Environment(AppModel.self) private var model
    @State private var selectedPeriod: DashboardPeriod = .thisMonth

    var body: some View {
        NavigationStack {
            List {
                if model.identity?.authenticated != true {
                    SignedOutStateSection()
                } else {
                    DashboardPeriodPicker(selectedPeriod: $selectedPeriod)
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)

                    if let dashboard = model.dashboard {
                        Section {
                            DashboardOverviewCard(kpis: dashboard.kpis)
                        }

                        if dashboard.budgetPace != nil || dashboard.categoryBudgetPulse?.isEmpty == false {
                            Section("Budgets") {
                                if let pace = dashboard.budgetPace {
                                    BudgetPaceCompactRow(pace: pace)
                                }
                                if let categoryBudgetPulse = dashboard.categoryBudgetPulse {
                                    ForEach(categoryBudgetPulse) { budget in
                                        CategoryBudgetPulseRow(budget: budget)
                                    }
                                }
                            }
                        }

                        Section("Recent") {
                            let categoriesByID = Dictionary(uniqueKeysWithValues: dashboard.categories.map { ($0.id, $0) })
                            ForEach(dashboard.recent) { transaction in
                                let category = transaction.category.map { categoriesByID[$0.id] ?? $0 }
                                NavigationLink(value: transaction.id) {
                                    TransactionRow(transaction: transaction, category: category)
                                }
                            }
                        }

                        if let durable = dashboard.durablePurchases, !durable.isEmpty {
                            Section("Durable purchases") {
                                ForEach(durable) { item in
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(item.title ?? "Purchase")
                                            .font(.headline)
                                        Text("\(Int(item.percentAmortized.rounded()))% amortized")
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }

                        DashboardBreakdownSection(donut: dashboard.donut)
                    } else if model.showsDashboardInitialLoading {
                        LoadingStateSection(title: "Loading dashboard")
                    } else {
                        ContentUnavailableView("No dashboard loaded", systemImage: "chart.line.uptrend.xyaxis")
                    }
                }
            }
            .navigationTitle("Dashboard")
            .expensesScreenStyle()
            .refreshable {
                await model.loadDashboard(period: selectedPeriod.rawValue)
            }
            .task(id: selectedPeriod) {
                await model.loadDashboard(period: selectedPeriod.rawValue)
            }
            .navigationDestination(for: Int.self) { id in
                TransactionDetailView(transactionID: id)
            }
            .animation(.easeInOut(duration: 0.18), value: model.showsDashboardInitialLoading)
        }
    }
}

private struct DashboardPeriodPicker: View {
    @Binding var selectedPeriod: DashboardPeriod

    var body: some View {
        Picker("Range", selection: $selectedPeriod) {
            ForEach(DashboardPeriod.allCases) { period in
                Text(period.title).tag(period)
            }
        }
        .pickerStyle(.segmented)
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

private struct BudgetPaceCompactRow: View {
    @Environment(\.colorScheme) private var scheme

    let pace: DashboardBudgetPace

    private var projectedRatio: Double {
        Double(max(pace.projectedCents, 0)) / Double(max(pace.budgetCents, 1))
    }

    private var velocityLabel: String {
        "\(pace.velocityRatio.formatted(.number.precision(.fractionLength(2))))x"
    }

    private var statusColor: Color {
        pace.velocityRatio > 1 ? ExpensesTheme.expense(for: scheme) : ExpensesTheme.income(for: scheme)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .lastTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Projected")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(AppFormatters.euros(pace.projectedCents))
                            .font(.headline.monospacedDigit())
                            .lineLimit(1)
                            .minimumScaleFactor(0.72)
                        Text("of \(AppFormatters.euros(pace.budgetCents))")
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.72)
                    }
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 3) {
                    Text(velocityLabel)
                        .font(.callout.weight(.semibold).monospacedDigit())
                        .foregroundStyle(statusColor)
                    Text("Velocity")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }

            ProgressView(value: min(1, projectedRatio))
                .tint(statusColor)
        }
        .padding(.vertical, 2)
    }
}

private struct CategoryBudgetPulseRow: View {
    @Environment(\.colorScheme) private var scheme

    let budget: DashboardCategoryBudgetPulse

    private var usedRatio: Double {
        Double(budget.spentCents) / Double(max(budget.amountCents, 1))
    }

    private var percentLabel: String {
        usedRatio.formatted(.percent.precision(.fractionLength(0)))
    }

    private var remainingLabel: String {
        let prefix = budget.remainingCents < 0 ? "Over" : "Left"
        return "\(prefix) \(AppFormatters.euros(abs(budget.remainingCents)))"
    }

    private var statusColor: Color {
        budget.remainingCents < 0 ? ExpensesTheme.expense(for: scheme) : ExpensesTheme.income(for: scheme)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(budget.scopeLabel)
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                Text(percentLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Text(remainingLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(budget.remainingCents < 0 ? statusColor : .secondary)
                    .lineLimit(1)
            }
            ProgressView(value: min(1, usedRatio))
                .tint(statusColor)
        }
        .padding(.vertical, 1)
    }
}

private struct DashboardOverviewCard: View {
    @Environment(\.colorScheme) private var scheme
    @AppStorage("expenses.dashboardIncognito") private var hidesOverviewAmounts = false

    let kpis: DashboardKPIs

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Balance", systemImage: "equal.circle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(AppFormatters.euros(kpis.balance))
                        .font(.system(size: 31, weight: .semibold).monospacedDigit())
                        .foregroundStyle(kpis.balance >= 0 ? ExpensesTheme.income(for: scheme) : ExpensesTheme.expense(for: scheme))
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                        .blur(radius: hidesOverviewAmounts ? 8 : 0)
                        .opacity(hidesOverviewAmounts ? 0.58 : 1)
                        .accessibilityLabel(hidesOverviewAmounts ? "Hidden balance" : AppFormatters.euros(kpis.balance))
                }
                Spacer(minLength: 0)
                Button {
                    withAnimation(.snappy(duration: 0.18)) {
                        hidesOverviewAmounts.toggle()
                    }
                } label: {
                    Image(systemName: hidesOverviewAmounts ? "eye.slash" : "eye")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 38, height: 38)
                        .background(.thinMaterial, in: Circle())
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .accessibilityLabel(hidesOverviewAmounts ? "Show values" : "Hide values")
                .sensoryFeedback(.selection, trigger: hidesOverviewAmounts)
            }

            Divider()

            HStack(alignment: .top, spacing: 14) {
                OverviewMetric(
                    title: "Income",
                    value: AppFormatters.euros(kpis.income),
                    systemImage: "arrow.down.left",
                    color: ExpensesTheme.income(for: scheme),
                    hidesValue: hidesOverviewAmounts
                )

                Divider()
                    .frame(height: 48)

                OverviewMetric(
                    title: "Expenses",
                    value: AppFormatters.euros(kpis.expenses),
                    systemImage: "arrow.up.right",
                    color: ExpensesTheme.expense(for: scheme),
                    hidesValue: hidesOverviewAmounts
                )
            }
        }
        .padding(.vertical, 8)
    }
}

private struct OverviewMetric: View {
    let title: String
    let value: String
    let systemImage: String
    let color: Color
    let hidesValue: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(color)
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Text(value)
                .font(.headline.monospacedDigit())
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .blur(radius: hidesValue ? 6 : 0)
                .opacity(hidesValue ? 0.58 : 1)
                .accessibilityLabel(hidesValue ? "Hidden \(title.lowercased())" : value)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct DashboardBreakdownSection: View {
    let donut: DashboardDonut

    var body: some View {
        Section("Breakdown") {
            if donut.hasAnyTransactions != true {
                Text("Add transactions to see category rings.")
                    .foregroundStyle(.secondary)
            } else {
                if let expenses = donut.expenseBreakdown, !expenses.isEmpty {
                    CategoryRingChart(title: "Expenses", rows: expenses, tint: .red)
                }
                if let income = donut.incomeBreakdown, !income.isEmpty {
                    CategoryRingChart(title: "Income", rows: income, tint: .green)
                }
            }
        }
    }
}

struct CategoryRingChart: View {
    let title: String
    let rows: [BreakdownItem]
    let tint: Color

    private var palette: [Color] {
        [
            tint,
            .orange,
            .yellow,
            .teal,
            .blue,
            .purple,
            .pink,
            .indigo,
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title)
                .font(.headline)

            HStack(alignment: .center, spacing: 18) {
                Chart {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        SectorMark(
                            angle: .value("Amount", row.amountCents),
                            innerRadius: .ratio(0.68),
                            angularInset: 1.4
                        )
                        .foregroundStyle(palette[index % palette.count])
                    }
                }
                .chartLegend(.hidden)
                .frame(width: 136, height: 136)

                VStack(alignment: .leading, spacing: 9) {
                    ForEach(Array(rows.prefix(5).enumerated()), id: \.element.id) { index, row in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(palette[index % palette.count])
                                .frame(width: 8, height: 8)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.name)
                                    .font(.subheadline.weight(.medium))
                                    .lineLimit(1)
                                Text("\(row.percent.formatted(.number.precision(.fractionLength(1))))%")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.vertical, 4)
    }
}
