import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    @State private var selectedPrimaryDestination: AppDestination = .dashboard
    @State private var morePath: [AppDestination] = []
    @State private var dashboardPath: [Int] = []
    @State private var transactionsPath: [TransactionsRoute] = []
    @State private var transactionsSelecting = false
    @State private var budgetsMonth = CalendarMonth.current
    @State private var budgetsPath: [BudgetKey] = []

    var body: some View {
        Group {
            if model.hasSession {
                primaryTabs
            } else {
                SignInView()
            }
        }
        .preferredColorScheme(colorScheme(for: model.appearancePreference))
        .onChange(of: model.hasSession) { _, hasSession in
            // The next session starts on the Dashboard, not where the last one ended.
            if !hasSession {
                selectedPrimaryDestination = .dashboard
                morePath = []
                dashboardPath = []
                transactionsPath = []
                transactionsSelecting = false
                budgetsMonth = .current
                budgetsPath = []
            }
        }
        .task {
            await model.testConnection()
            await model.loadCurrentSession()
        }
    }

    private var primaryTabs: some View {
        TabView(selection: $selectedPrimaryDestination) {
            Tab("Dashboard", systemImage: "square.grid.2x2", value: .dashboard) {
                destinationView(.dashboard)
            }

            Tab("Transactions", systemImage: "list.bullet", value: .transactions) {
                destinationView(.transactions)
            }

            Tab("Budgets", systemImage: "target", value: .budgets) {
                NavigationStack(path: $budgetsPath) {
                    destinationView(.budgets)
                }
            }

            Tab("Insights", systemImage: "chart.xyaxis.line", value: .insights) {
                destinationView(.insights)
            }

            Tab("More", systemImage: "line.3.horizontal", value: .more) {
                moreTab
            }
        }
    }

    // Opens the Transactions tab at its root on this query.
    private func openTransactions(_ query: TransactionQuery) {
        model.transactionQuery = query
        transactionsPath = []
        transactionsSelecting = false
        selectedPrimaryDestination = .transactions
    }

    // Opens the Budgets tab at its root on this month.
    private func openBudgets(_ month: CalendarMonth) {
        budgetsMonth = month
        budgetsPath = []
        selectedPrimaryDestination = .budgets
    }

    @ViewBuilder
    private func destinationView(_ destination: AppDestination) -> some View {
        switch destination {
        case .dashboard:
            DashboardView(
                path: $dashboardPath,
                openBudgets: { openBudgets(.current) },
                openTransactions: { openTransactions(TransactionQuery()) }
            )
        case .transactions:
            TransactionsView(path: $transactionsPath, selecting: $transactionsSelecting)
        case .budgets:
            BudgetsView(month: $budgetsMonth)
        case .insights:
            InsightsView(openTransactions: openTransactions, openBudgets: openBudgets)
        case .forecast:
            ForecastView()
        case .uncategorized:
            UncategorizedView()
        case .whatIf:
            WhatIfView(options: ForecastOptions())
        case .digest:
            DigestView(openTransactions: openTransactions, openBudgets: { openBudgets(.current) })
        case .reports:
            ReportsView()
        case .reconcile:
            ReconciliationView()
        case .admin:
            AdminView()
        case .recurring:
            RecurringView()
        case .templates:
            TemplatesView()
        case .rules:
            RulesView()
        case .categories:
            CategoriesView(openTransactions: openTransactions)
        case .tags:
            TagsView(openTransactions: openTransactions)
        case .settings:
            SettingsView()
        case .assistant:
            AssistantView()
        case .more:
            EmptyView()
        }
    }

    private var moreTab: some View {
        NavigationStack(path: $morePath) {
            List {
                moreDestinationSection(nil, destinations: model.uncategorizedCount > 0 ? [.forecast, .uncategorized] : [.forecast])
                moreDestinationSection("Manage", destinations: [.recurring, .templates, .rules, .categories, .tags])
                moreDestinationSection("Tools", destinations: toolsDestinations)
                moreDestinationSection(nil, destinations: model.identity?.user?.isAdmin == true ? [.settings, .admin] : [.settings])
            }
            .navigationTitle("More")
            .expensesScreenStyle()
            .task {
                await model.loadUncategorizedCount()
            }
            .navigationDestination(for: AppDestination.self) { destination in
                destinationView(destination)
            }
        }
        .toolbar(morePath.last?.hidesTabBar == true ? .hidden : .visible, for: .tabBar)
    }

    private var toolsDestinations: [AppDestination] {
        model.llmEnabled ? [.whatIf, .reconcile, .reports, .digest, .assistant] : [.whatIf, .reconcile, .reports, .digest]
    }

    private func moreDestinationSection(_ title: String?, destinations: [AppDestination]) -> some View {
        Section {
            ForEach(destinations) { destination in
                NavigationLink(value: destination) {
                    Label(destination.title, systemImage: destination.systemImage)
                        .badge(destination == .uncategorized ? model.uncategorizedCount : 0)
                }
                .navigationLinkIndicatorVisibility(.hidden)
            }
        } header: {
            if let title {
                Text(title)
            }
        }
        .expensesRowBackground()
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

private enum AppDestination: String, CaseIterable, Identifiable {
    case dashboard
    case transactions
    case budgets
    case insights
    case more
    case forecast
    case uncategorized
    case whatIf
    case digest
    case reports
    case reconcile
    case admin
    case recurring
    case templates
    case rules
    case categories
    case tags
    case settings
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
        case .uncategorized:
            "Uncategorized"
        case .whatIf:
            "What If"
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
        case .templates:
            "Templates"
        case .rules:
            "Rules"
        case .categories:
            "Categories"
        case .tags:
            "Tags"
        case .settings:
            "Settings"
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
        case .uncategorized:
            "tray"
        case .whatIf:
            "flask"
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
        case .templates:
            "bolt"
        case .rules:
            "wand.and.stars"
        case .categories:
            "square.on.circle"
        case .tags:
            "tag"
        case .settings:
            "gearshape"
        case .assistant:
            "bubble.left.and.bubble.right"
        }
    }

    var hidesTabBar: Bool {
        self == .assistant
    }
}

#Preview {
    RootView()
        .environment(AppModel())
}
