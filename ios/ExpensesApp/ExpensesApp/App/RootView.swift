import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    @State private var selectedPrimaryDestination: AppDestination = .dashboard
    @State private var quickAddSheet: QuickAddSheet?
    @State private var budgetQuickAddTrigger = 0
    @State private var categoryQuickAddTrigger = 0
    @State private var ruleQuickAddTrigger = 0
    @State private var recurringQuickAddTrigger = 0

    private var selectedDestination: AppDestination {
        selectedPrimaryDestination
    }

    var body: some View {
        ZStack {
            primaryTabs

            quickAddButton
                .opacity(selectedDestination.showsFloatingQuickAdd ? 1 : 0)
                .allowsHitTesting(selectedDestination.showsFloatingQuickAdd)
                .animation(.snappy(duration: 0.18), value: selectedDestination)
        }
        .tint(ExpensesTheme.accent(for: scheme))
        .preferredColorScheme(colorScheme(for: model.appearancePreference))
        .sheet(item: $quickAddSheet) { sheet in
            switch sheet {
            case .transaction:
                TransactionFormView(mode: .create, categories: model.knownCategories)
            }
        }
        .task {
            await model.testConnection()
            await model.loadCurrentSession()
        }
    }

    private var primaryTabs: some View {
        TabView(selection: $selectedPrimaryDestination) {
            destinationView(.dashboard)
                .tabItem {
                    Label("Dashboard", systemImage: "chart.pie")
                }
                .tag(AppDestination.dashboard)

            destinationView(.transactions)
                .tabItem {
                    Label("Transactions", systemImage: "list.bullet.rectangle")
                }
                .tag(AppDestination.transactions)

            destinationView(.digest)
                .tabItem {
                    Label("Digest", systemImage: "newspaper")
                }
                .tag(AppDestination.digest)

            destinationView(.insights)
                .tabItem {
                    Label("Insights", systemImage: "chart.xyaxis.line")
                }
                .tag(AppDestination.insights)

            moreTab
                .tabItem {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .tag(AppDestination.more)
        }
    }

    @ViewBuilder
    private func destinationView(_ destination: AppDestination) -> some View {
        switch destination {
        case .dashboard:
            DashboardView()
        case .transactions:
            TransactionsView()
        case .budgets:
            BudgetsView(quickAddTrigger: $budgetQuickAddTrigger)
        case .insights:
            InsightsView()
        case .forecast:
            ForecastView()
        case .digest:
            DigestView()
        case .categories:
            CategoriesView(quickAddTrigger: $categoryQuickAddTrigger)
        case .rules:
            RulesView(quickAddTrigger: $ruleQuickAddTrigger)
        case .reports:
            ReportsView()
        case .reconcile:
            ReconciliationView()
        case .admin:
            AdminView()
        case .recurring:
            RecurringView(quickAddTrigger: $recurringQuickAddTrigger)
        case .organize:
            OrganizeView()
        case .account:
            AuthView()
        case .diagnostics:
            DiagnosticsView()
        case .more:
            EmptyView()
        }
    }

    private var moreTab: some View {
        NavigationStack {
            List {
                moreDestinationSection("Planning", destinations: AppDestination.planningDestinations)
                moreDestinationSection("Manage", destinations: AppDestination.manageDestinations)
                moreDestinationSection("Tools", destinations: AppDestination.toolsDestinations)
                moreDestinationSection("Account", destinations: AppDestination.accountDestinations)
            }
            .navigationTitle("More")
            .navigationBarTitleDisplayMode(.inline)
            .expensesScreenStyle()
        }
    }

    private func moreDestinationSection(_ title: String, destinations: [AppDestination]) -> some View {
        Section(title) {
            ForEach(destinations) { destination in
                NavigationLink {
                    destinationView(destination)
                } label: {
                    MoreDestinationRow(destination: destination)
                }
            }
        }
    }

    private var quickAddButton: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                Button {
                    performQuickAdd()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 24, weight: .medium))
                        .frame(width: 54, height: 54)
                        .contentShape(RoundedRectangle(cornerRadius: 27, style: .continuous))
                }
                .buttonStyle(.plain)
                .foregroundStyle(ExpensesTheme.accent(for: scheme))
                .background {
                    RoundedRectangle(cornerRadius: 27, style: .continuous)
                        .fill(.ultraThinMaterial)
                        .shadow(color: .black.opacity(scheme == .dark ? 0.24 : 0.12), radius: 18, y: 8)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 27, style: .continuous)
                        .stroke(.white.opacity(scheme == .dark ? 0.12 : 0.42), lineWidth: 0.8)
                }
                .glassEffect(
                    .regular.tint(ExpensesTheme.accent(for: scheme).opacity(scheme == .dark ? 0.035 : 0.055)).interactive(),
                    in: .rect(cornerRadius: 27)
                )
                .accessibilityLabel("Quick Add")
                .disabled(model.identity?.authenticated != true)
                .opacity(model.identity?.authenticated == true ? 1 : 0.48)
                .padding(.trailing, 18)
                .padding(.bottom, 66)
            }
        }
        .ignoresSafeArea(.keyboard)
    }

    private func performQuickAdd() {
        switch selectedDestination {
        case .budgets:
            budgetQuickAddTrigger += 1
        case .categories:
            categoryQuickAddTrigger += 1
        case .rules:
            ruleQuickAddTrigger += 1
        case .recurring:
            recurringQuickAddTrigger += 1
        default:
            quickAddSheet = .transaction
        }
    }

    private func colorScheme(for preference: String) -> ColorScheme? {
        switch preference {
        case "light":
            .light
        case "dark":
            .dark
        default:
            nil
        }
    }
}

private enum QuickAddSheet: Identifiable {
    case transaction

    var id: String {
        switch self {
        case .transaction:
            "transaction"
        }
    }
}

private enum AppDestination: String, CaseIterable, Identifiable {
    case dashboard
    case transactions
    case budgets
    case insights
    case more
    case forecast
    case digest
    case categories
    case rules
    case reports
    case reconcile
    case admin
    case recurring
    case organize
    case account
    case diagnostics

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard:
            "Dashboard"
        case .transactions:
            "Transactions"
        case .budgets:
            "Budgets"
        case .insights:
            "Insights"
        case .more:
            "More"
        case .forecast:
            "Forecast"
        case .digest:
            "Digest"
        case .categories:
            "Categories"
        case .rules:
            "Rules"
        case .reports:
            "Reports"
        case .reconcile:
            "Reconcile"
        case .admin:
            "Admin"
        case .recurring:
            "Recurring"
        case .organize:
            "Organize"
        case .account:
            "Account"
        case .diagnostics:
            "Diagnostics"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard:
            "chart.pie"
        case .transactions:
            "list.bullet.rectangle"
        case .budgets:
            "chart.bar"
        case .insights:
            "chart.xyaxis.line"
        case .more:
            "ellipsis.circle"
        case .forecast:
            "chart.line.uptrend.xyaxis"
        case .digest:
            "newspaper"
        case .categories:
            "square.grid.2x2"
        case .rules:
            "wand.and.stars"
        case .reports:
            "doc.text"
        case .reconcile:
            "checklist"
        case .admin:
            "person.badge.key"
        case .recurring:
            "repeat"
        case .organize:
            "slider.horizontal.3"
        case .account:
            "person.crop.circle"
        case .diagnostics:
            "stethoscope"
        }
    }

    var showsFloatingQuickAdd: Bool {
        switch self {
        case .dashboard, .transactions:
            true
        case .budgets, .insights, .more, .forecast, .digest, .categories, .rules, .reports, .reconcile, .admin, .recurring, .organize, .account, .diagnostics:
            false
        }
    }

    static var planningDestinations: [AppDestination] {
        [.budgets, .forecast]
    }

    static var manageDestinations: [AppDestination] {
        [.recurring, .organize]
    }

    static var toolsDestinations: [AppDestination] {
        [.reconcile, .reports, .diagnostics]
    }

    static var accountDestinations: [AppDestination] {
        [.account, .admin]
    }
}

private struct MoreDestinationRow: View {
    @Environment(\.colorScheme) private var scheme

    let destination: AppDestination

    var body: some View {
        HStack(spacing: 12) {
            Label {
                Text(destination.title)
                    .font(.body.weight(.medium))
            } icon: {
                Image(systemName: destination.systemImage)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(ExpensesTheme.accent(for: scheme))
                    .frame(width: 30, height: 30)
                    .background(.thinMaterial, in: Circle())
            }
        }
        .padding(.vertical, 3)
    }
}

#Preview {
    RootView()
        .environment(AppModel())
}
