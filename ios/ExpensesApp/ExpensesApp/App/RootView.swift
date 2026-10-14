import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    @State private var selectedPrimaryDestination: AppDestination = .dashboard
    @State private var morePath: [AppDestination] = []
    @State private var dashboardPath: [Int] = []
    @State private var transactionsPath: [TransactionsRoute] = []
    @State private var transactionsSelecting = false
    @State private var quickAddSheet: QuickAddSheet?
    @State private var quickAddTapTick = 0

    private var selectedDestination: AppDestination {
        selectedPrimaryDestination
    }

    // The Quick Add FAB shows only at the root of the Dashboard and Transactions
    // tabs — it hides once a detail is pushed onto either tab's navigation stack.
    private var showsFloatingQuickAdd: Bool {
        switch selectedDestination {
        case .dashboard:
            dashboardPath.isEmpty
        case .transactions:
            transactionsPath.isEmpty && !transactionsSelecting
        default:
            false
        }
    }

    var body: some View {
        Group {
            if model.hasSession {
                ZStack {
                    primaryTabs

                    quickAddButton
                        .opacity(showsFloatingQuickAdd ? 1 : 0)
                        .allowsHitTesting(showsFloatingQuickAdd)
                        .animation(.snappy(duration: 0.18), value: showsFloatingQuickAdd)
                }
                .sheet(item: $quickAddSheet) { sheet in
                    switch sheet {
                    case .transaction:
                        TransactionFormView(mode: .create, categories: model.knownCategories)
                    }
                }
            } else {
                SignInView()
            }
        }
        .tint(ExpensesTheme.accent(for: scheme))
        .preferredColorScheme(colorScheme(for: model.appearancePreference))
        .onChange(of: model.hasSession) { _, hasSession in
            // The next session starts on the Dashboard, not where the last one ended.
            if !hasSession {
                selectedPrimaryDestination = .dashboard
                morePath = []
                dashboardPath = []
                transactionsPath = []
                transactionsSelecting = false
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
                    Label("Dashboard", systemImage: "square.grid.2x2")
                }
                .tag(AppDestination.dashboard)

            destinationView(.transactions)
                .tabItem {
                    Label("Transactions", systemImage: "list.bullet")
                }
                .tag(AppDestination.transactions)

            NavigationStack {
                destinationView(.budgets)
            }
            .tabItem {
                Label("Budgets", systemImage: "target")
            }
            .tag(AppDestination.budgets)

            destinationView(.insights)
                .tabItem {
                    Label("Insights", systemImage: "chart.xyaxis.line")
                }
                .tag(AppDestination.insights)

            moreTab
                .tabItem {
                    Label("More", systemImage: "line.3.horizontal")
                }
                .tag(AppDestination.more)
        }
    }

    @ViewBuilder
    private func destinationView(_ destination: AppDestination) -> some View {
        switch destination {
        case .dashboard:
            DashboardView(
                path: $dashboardPath,
                openBudgets: { selectedPrimaryDestination = .budgets },
                openTransactions: { selectedPrimaryDestination = .transactions }
            )
        case .transactions:
            TransactionsView(path: $transactionsPath, selecting: $transactionsSelecting)
        case .budgets:
            BudgetsView()
        case .insights:
            InsightsView()
        case .forecast:
            ForecastView()
        case .digest:
            DigestView()
        case .reports:
            ReportsView()
        case .reconcile:
            ReconciliationView()
        case .admin:
            AdminView()
        case .recurring:
            RecurringView()
        case .organize:
            OrganizeView()
        case .account:
            AuthView()
        case .diagnostics:
            DiagnosticsView()
        case .assistant:
            AssistantView()
        case .more:
            EmptyView()
        }
    }

    private var moreTab: some View {
        NavigationStack(path: $morePath) {
            List {
                moreDestinationSection("Planning", destinations: AppDestination.planningDestinations)
                moreDestinationSection("Manage", destinations: AppDestination.manageDestinations)
                moreDestinationSection("Tools", destinations: toolsDestinations)
                moreDestinationSection("Account", destinations: AppDestination.accountDestinations)
            }
            .navigationTitle("More")
            .expensesScreenStyle()
            .navigationDestination(for: AppDestination.self) { destination in
                destinationView(destination)
            }
        }
        .toolbar(morePath.last?.hidesTabBar == true ? .hidden : .visible, for: .tabBar)
    }

    private var toolsDestinations: [AppDestination] {
        AppDestination.toolsDestinations.filter { $0 != .assistant || model.llmEnabled }
    }

    private func moreDestinationSection(_ title: String, destinations: [AppDestination]) -> some View {
        Section(title) {
            ForEach(destinations) { destination in
                NavigationLink(value: destination) {
                    Label(destination.title, systemImage: destination.systemImage)
                }
            }
        }
        .expensesRowBackground()
    }

    private var quickAddButton: some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                Button {
                    performQuickAdd()
                } label: {
                    // The ink tint is light in dark mode, so the glyph takes the page color.
                    Image(systemName: "plus")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(ExpensesTheme.background(for: scheme))
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .accessibilityLabel("Quick Add")
                .sensoryFeedback(.impact(weight: .light), trigger: quickAddTapTick)
                .padding(.trailing, 18)
                .padding(.bottom, 66)
            }
        }
        .ignoresSafeArea(.keyboard)
    }

    private func performQuickAdd() {
        quickAddTapTick += 1
        quickAddSheet = .transaction
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
    case reports
    case reconcile
    case admin
    case recurring
    case organize
    case account
    case diagnostics
    case assistant

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
        case .assistant:
            "Assistant"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard:
            "square.grid.2x2"
        case .transactions:
            "list.bullet"
        case .budgets:
            "target"
        case .insights:
            "chart.xyaxis.line"
        case .more:
            "line.3.horizontal"
        case .forecast:
            "chart.line.uptrend.xyaxis"
        case .digest:
            "newspaper"
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
        case .assistant:
            "bubble.left.and.bubble.right"
        }
    }

    var hidesTabBar: Bool {
        self == .assistant
    }

    static var planningDestinations: [AppDestination] {
        [.forecast]
    }

    static var manageDestinations: [AppDestination] {
        [.recurring, .organize]
    }

    static var toolsDestinations: [AppDestination] {
        [.assistant, .digest, .reconcile, .reports, .diagnostics]
    }

    static var accountDestinations: [AppDestination] {
        [.account, .admin]
    }
}

#Preview {
    RootView()
        .environment(AppModel())
}
