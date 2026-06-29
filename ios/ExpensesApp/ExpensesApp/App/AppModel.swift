import Foundation
import Observation

enum ExpensesAppStorage {
    static let baseURLKey = "expenses.baseURL"
    static let mobileKeychainService = "expenses.mobile"
    static let tokenKey = "mobileSessionToken"
    static let defaultLocalBackendURL = "http://localhost:8000"
}

@MainActor
@Observable
final class AppModel {
    var baseURLString: String {
        didSet {
            UserDefaults.standard.set(baseURLString, forKey: ExpensesAppStorage.baseURLKey)
            rebuildClient()
            if baseURLString != oldValue {
                clearStoredSession()
                clearUserScopedState()
                status = nil
            }
        }
    }
    var appearancePreference: String {
        didSet {
            UserDefaults.standard.set(appearancePreference, forKey: Self.appearancePreferenceKey)
        }
    }
    var status: MobileStatus?
    var llmEnabled: Bool { status?.llmEnabled ?? false }
    var identity: MobileAuthIdentity?
    var dashboard: DashboardResponse?
    var dashboardPeriod = "this_month"
    var transactions: TransactionsResponse?
    var uncategorizedTransactions: UncategorizedTransactionsResponse?
    var deletedTransactions: DeletedTransactionsResponse?
    var categories: CategoriesResponse?
    var tags: TagsResponse?
    var templates: TemplatesResponse?
    var rules: RulesResponse?
    var transactionSuggestions: [TransactionSuggestion] = []
    var ruleSuggestions: [RuleSuggestion] = []
    var budgets: BudgetsResponse?
    var budgetBurndown: BudgetBurndownResponse?
    var digest: DigestResponse?
    var forecast: ForecastResponse?
    var forecastScenario: ForecastScenarioResponse?
    var insights: InsightsResponse?
    var insightsFlow: InsightsFlowResponse?
    var durablePurchases: DurablePurchasesResponse?
    var reconciliation: BankReconciliationResponse?
    var adminInfo: AdminInfo?
    var adminSystemHealth: AdminSystemHealth?
    var adminLogs: AdminLogsResponse?
    var legacySQLitePreview: LegacySQLitePreviewResponse?
    var mobileSessions: MobileSessionsResponse?
    var settings: SettingsResponse?
    var csvPreview: CSVPreviewResponse?
    var recurring: RecurringResponse?
    var recurringOccurrences: RecurringOccurrencesResponse?
    var selectedTransaction: TransactionDetail?
    var transactionReimbursements: TransactionReimbursementsResponse?
    var reimbursementExpenseSearch: ReimbursementExpenseSearchResponse?
    var lastError: APIErrorInfo?
    var isLoading = false
    var isMiningRuleSuggestions = false
    var ruleMiningStatus: RuleMiningStatus = .idle
    var assistantTurns: [AssistantTurn] = []
    var isAssistantStreaming = false
    private var assistantMessageHistory: [JSONValue] = []
    private var assistantStreamTask: Task<Void, Never>?
    private var assistantTurnSeq = 0
    private var dashboardLoadState: PrimaryLoadState = .idle
    private var transactionsLoadState: PrimaryLoadState = .idle
    private var digestLoadState: PrimaryLoadState = .idle
    private var insightsLoadState: PrimaryLoadState = .idle
    private var dashboardLoadID = 0
    private var transactionsLoadID = 0
    private var digestLoadID = 0
    private var insightsLoadID = 0

    private var apiClient: ExpensesAPIClient
    private let keychain = KeychainStore(service: ExpensesAppStorage.mobileKeychainService)

    private static let appearancePreferenceKey = "expenses.appearancePreference"

    init() {
        let storedURL = UserDefaults.standard.string(forKey: ExpensesAppStorage.baseURLKey)
        let initialBaseURLString = storedURL ?? ExpensesAppStorage.defaultLocalBackendURL
        baseURLString = initialBaseURLString
        appearancePreference = UserDefaults.standard.string(forKey: Self.appearancePreferenceKey) ?? "system"
        apiClient = ExpensesAPIClient(baseURL: URL(string: initialBaseURLString))
    }

    var token: String? {
        try? keychain.readString(account: ExpensesAppStorage.tokenKey)
    }

    var hasStoredToken: Bool {
        token != nil
    }

    var knownCategories: [CategorySummary] {
        if let categories {
            return categories.categories.map {
                CategorySummary(id: $0.id, name: $0.name, type: $0.type, icon: $0.icon)
            }
        }
        if let transactions {
            return transactions.categories
        }
        return dashboard?.categories ?? []
    }

    var activeKnownCategories: [CategorySummary] {
        if let categories {
            return categories.categories
                .filter { $0.archivedAt == nil }
                .map { CategorySummary(id: $0.id, name: $0.name, type: $0.type, icon: $0.icon) }
        }
        return knownCategories
    }

    var showsDashboardInitialLoading: Bool {
        dashboard == nil && dashboardLoadState.showsInitialPlaceholder
    }

    var showsTransactionsInitialLoading: Bool {
        transactions == nil && transactionsLoadState.showsInitialPlaceholder
    }

    var showsDigestInitialLoading: Bool {
        digest == nil && digestLoadState.showsInitialPlaceholder
    }

    var showsInsightsInitialLoading: Bool {
        insights == nil && insightsLoadState.showsInitialPlaceholder
    }

    func testConnection() async {
        await runRequest {
            status = try await apiClient.mobileStatus()
        }
    }

    func loadCurrentSession() async {
        guard let token else {
            identity = nil
            clearUserScopedState()
            return
        }
        await runRequest {
            do {
                identity = try await apiClient.mobileMe(token: token)
            } catch let error as APIErrorInfo where error.statusCode == 401 {
                clearStoredSession()
                clearUserScopedState()
                throw error
            }
        }
        if identity?.authenticated == true {
            Task { await prewarmPrimaryTabs() }
        }
    }

    func setup(
        username: String,
        password: String,
        deviceName: String,
        setupToken: String? = nil
    ) async {
        await authenticate(
            request: .init(
                username: username,
                password: password,
                deviceID: DeviceIdentity.currentID,
                deviceName: deviceName
            ),
            mode: .setup,
            setupToken: setupToken
        )
    }

    func login(username: String, password: String, deviceName: String) async {
        await authenticate(
            request: .init(
                username: username,
                password: password,
                deviceID: DeviceIdentity.currentID,
                deviceName: deviceName
            ),
            mode: .login
        )
    }

    func signup(username: String, password: String, deviceName: String) async {
        await authenticate(
            request: .init(
                username: username,
                password: password,
                deviceID: DeviceIdentity.currentID,
                deviceName: deviceName
            ),
            mode: .signup
        )
    }

    func logout() async {
        guard let token else {
            identity = nil
            clearUserScopedState()
            return
        }
        await runRequest {
            do {
                try await apiClient.mobileLogout(token: token)
            } catch let error as APIErrorInfo {
                if error.statusCode != 401 {
                    throw error
                }
            } catch {
                throw error
            }
            clearStoredSession()
            clearUserScopedState()
        }
    }

    func loadAccountSettings() async {
        guard let token else {
            return
        }
        await runRequest {
            settings = try await apiClient.settings(token: token)
            mobileSessions = try await apiClient.mobileSessions(token: token)
        }
    }

    func revokeMobileSession(_ session: MobileSession) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.revokeMobileSession(id: session.id, token: token)
            if identity?.session?.id == session.id {
                try keychain.delete(account: ExpensesAppStorage.tokenKey)
                identity = nil
                mobileSessions = nil
                settings = nil
            } else {
                mobileSessions = try await apiClient.mobileSessions(token: token)
            }
        }
    }

    func createOrRotateIngestToken() async -> IngestTokenCreateResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let response = try await apiClient.createOrRotateIngestToken(token: token)
            settings = try await apiClient.settings(token: token)
            return response
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func revokeIngestToken() async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.revokeIngestToken(token: token)
            settings = try await apiClient.settings(token: token)
        }
    }

    func saveBalanceAnchor(id: Int?, body: BalanceAnchorRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.saveBalanceAnchor(id: id, body: body, token: token)
            settings = try await apiClient.settings(token: token)
        }
    }

    func deleteBalanceAnchor(_ anchor: BalanceAnchor) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteBalanceAnchor(id: anchor.id, token: token)
            settings = try await apiClient.settings(token: token)
        }
    }

    func previewCSV(fileURL: URL) async -> CSVPreviewResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let data = try readSecurityScopedData(from: fileURL)
            let preview = try await apiClient.previewCSV(
                filename: fileURL.lastPathComponent,
                data: data,
                token: token
            )
            csvPreview = preview
            return preview
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func commitCSV(fileURL: URL) async -> CSVCommitResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let data = try readSecurityScopedData(from: fileURL)
            let response = try await apiClient.commitCSV(
                filename: fileURL.lastPathComponent,
                data: data,
                token: token
            )
            csvPreview = nil
            try await reloadPrimaryData()
            settings = try await apiClient.settings(token: token)
            return response
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func elevateAdmin(password: String) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess(clearsSessionOnUnauthorized: false) {
            _ = try await apiClient.mobileAdminElevation(password: password, token: token)
            identity = try await apiClient.mobileMe(token: token)
        }
    }

    func loadDashboard(period: String? = nil) async {
        guard let token else {
            return
        }
        if let period {
            dashboardPeriod = period
        }
        dashboardLoadID += 1
        let loadID = dashboardLoadID
        let requestPeriod = dashboardPeriod
        let hadContent = dashboard != nil
        if !hadContent {
            dashboardLoadState = .loading
        }
        isLoading = true
        lastError = nil
        defer {
            if loadID == dashboardLoadID {
                isLoading = false
            }
        }
        do {
            let response = try await apiClient.dashboard(period: requestPeriod, token: token)
            guard loadID == dashboardLoadID else {
                return
            }
            await waitForInitialLoadTransitionIfNeeded(hadContent: hadContent)
            guard loadID == dashboardLoadID else {
                return
            }
            dashboard = response
            dashboardLoadState = .loaded
        } catch let error as APIErrorInfo {
            guard loadID == dashboardLoadID else {
                return
            }
            if !hadContent {
                dashboardLoadState = .failed
            }
            handleAPIError(error)
        } catch {
            guard loadID == dashboardLoadID else {
                return
            }
            if !hadContent {
                dashboardLoadState = .failed
            }
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
    }

    func loadTransactions(
        query: String? = nil,
        type: String? = nil,
        categoryID: Int? = nil,
        tagID: Int? = nil
    ) async {
        guard let token else {
            return
        }
        transactionsLoadID += 1
        let loadID = transactionsLoadID
        let hadContent = transactions != nil
        if !hadContent {
            transactionsLoadState = .loading
        }
        isLoading = true
        lastError = nil
        defer {
            if loadID == transactionsLoadID {
                isLoading = false
            }
        }
        do {
            let response = try await apiClient.transactions(
                query: query,
                type: type,
                categoryID: categoryID,
                tagID: tagID,
                token: token
            )
            guard loadID == transactionsLoadID else {
                return
            }
            await waitForInitialLoadTransitionIfNeeded(hadContent: hadContent)
            guard loadID == transactionsLoadID else {
                return
            }
            transactions = response
            transactionsLoadState = .loaded
        } catch let error as APIErrorInfo {
            guard loadID == transactionsLoadID else {
                return
            }
            if !hadContent {
                transactionsLoadState = .failed
            }
            handleAPIError(error)
        } catch {
            guard loadID == transactionsLoadID else {
                return
            }
            if !hadContent {
                transactionsLoadState = .failed
            }
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
    }

    func loadUncategorizedTransactions(
        query: String? = nil,
        type: String? = nil,
        categoryID: Int? = nil,
        tagID: Int? = nil
    ) async {
        guard let token else {
            return
        }
        await runRequest {
            uncategorizedTransactions = try await apiClient.uncategorizedTransactions(
                query: query,
                type: type,
                categoryID: categoryID,
                tagID: tagID,
                token: token
            )
            if llmEnabled {
                transactionSuggestions = try await apiClient.transactionSuggestions(token: token)
            }
        }
    }

    func translateSearchQuery(_ query: String) async -> SearchTranslationResult? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.translateSearch(query: query, token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func loadTransactionSuggestions() async {
        guard llmEnabled, let token else {
            return
        }
        await runRequest {
            transactionSuggestions = try await apiClient.transactionSuggestions(token: token)
        }
    }

    func sendAssistantMessage(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isAssistantStreaming, let token else {
            return
        }

        assistantTurnSeq += 1
        assistantTurns.append(
            AssistantTurn(
                id: assistantTurnSeq,
                role: .user,
                content: trimmed,
                progressNarration: "",
                tools: [],
                isStreaming: false,
                isStopped: false,
                errorMessage: nil
            )
        )
        assistantTurnSeq += 1
        let assistantTurnID = assistantTurnSeq
        assistantTurns.append(
            AssistantTurn(
                id: assistantTurnID,
                role: .assistant,
                content: "",
                progressNarration: "",
                tools: [],
                isStreaming: true,
                isStopped: false,
                errorMessage: nil
            )
        )
        isAssistantStreaming = true

        let request = AssistantStreamRequest(
            messages: [AssistantStreamMessage(role: "user", content: trimmed)],
            messageHistory: assistantMessageHistory
        )
        let client = apiClient
        assistantStreamTask = Task {
            do {
                for try await event in client.spendingChatStream(request, token: token) {
                    applyAssistantEvent(event, turnID: assistantTurnID)
                }
                finishAssistantStream(turnID: assistantTurnID, stopped: Task.isCancelled)
            } catch let error as APIErrorInfo {
                if error.statusCode == 401 {
                    handleAPIError(error)
                }
                failAssistantStream(turnID: assistantTurnID, message: error.message)
            } catch {
                if Task.isCancelled || (error as? URLError)?.code == .cancelled {
                    finishAssistantStream(turnID: assistantTurnID, stopped: true)
                } else {
                    failAssistantStream(turnID: assistantTurnID, message: error.localizedDescription)
                }
            }
        }
    }

    func cancelAssistantMessage() {
        assistantStreamTask?.cancel()
    }

    func resetAssistantConversation() {
        assistantStreamTask?.cancel()
        assistantStreamTask = nil
        assistantTurns = []
        assistantMessageHistory = []
        isAssistantStreaming = false
    }

    private func applyAssistantEvent(_ event: AssistantStreamEvent, turnID: Int) {
        guard let index = assistantTurns.firstIndex(where: { $0.id == turnID }) else {
            return
        }
        switch event {
        case let .toolCallStart(toolCallID, toolName):
            assistantTurns[index].tools.append(
                AssistantToolActivity(id: toolCallID, toolName: toolName, status: .running)
            )
        case let .toolCallEnd(toolCallID, success):
            if let toolIndex = assistantTurns[index].tools.firstIndex(where: { $0.id == toolCallID }) {
                assistantTurns[index].tools[toolIndex].status = success ? .success : .failed
            }
        case let .progressNarration(content):
            assistantTurns[index].progressNarration = content
        case let .textChunk(content):
            assistantTurns[index].progressNarration = ""
            assistantTurns[index].content += content
        case let .result(assistantMessage, messageHistory):
            assistantTurns[index].progressNarration = ""
            assistantTurns[index].content = assistantMessage
            assistantMessageHistory = messageHistory
        case let .error(message):
            assistantTurns[index].progressNarration = ""
            assistantTurns[index].errorMessage = message
            assistantTurns[index].isStreaming = false
        case .turnStarted, .textCommit, .done, .unknown:
            break
        }
    }

    private func finishAssistantStream(turnID: Int, stopped: Bool) {
        guard let index = assistantTurns.firstIndex(where: { $0.id == turnID }) else {
            return
        }
        assistantTurns[index].isStreaming = false
        if stopped {
            assistantTurns[index].isStopped = true
        }
        isAssistantStreaming = false
        assistantStreamTask = nil
    }

    private func failAssistantStream(turnID: Int, message: String) {
        guard let index = assistantTurns.firstIndex(where: { $0.id == turnID }) else {
            return
        }
        assistantTurns[index].errorMessage = message
        assistantTurns[index].isStreaming = false
        isAssistantStreaming = false
        assistantStreamTask = nil
    }

    func triageTransaction(_ transaction: TransactionListItem) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.triageTransaction(id: transaction.id, token: token)
            transactionSuggestions = try await apiClient.transactionSuggestions(token: token)
        }
    }

    func acceptTransactionSuggestion(_ suggestion: TransactionSuggestion) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.acceptTransactionSuggestion(id: suggestion.id, token: token)
            transactionSuggestions = try await apiClient.transactionSuggestions(token: token)
            try await reloadPrimaryData()
        }
    }

    func rejectTransactionSuggestion(_ suggestion: TransactionSuggestion) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.rejectTransactionSuggestion(id: suggestion.id, token: token)
            transactionSuggestions = try await apiClient.transactionSuggestions(token: token)
        }
    }

    func loadDeletedTransactions() async {
        guard let token else {
            return
        }
        await runRequest {
            deletedTransactions = try await apiClient.deletedTransactions(token: token)
        }
    }

    func loadTransactionDetail(id: Int) async {
        guard let token else {
            return
        }
        await runRequest {
            selectedTransaction = try await apiClient.transactionDetail(id: id, token: token)
            transactionReimbursements = try await apiClient.transactionReimbursements(id: id, token: token)
            reimbursementExpenseSearch = nil
        }
    }

    func loadTransactionReimbursements(id: Int) async {
        guard let token else {
            return
        }
        await runRequest {
            transactionReimbursements = try await apiClient.transactionReimbursements(id: id, token: token)
        }
    }

    func searchReimbursementExpenses(reimbursementID: Int, query: String) async {
        guard let token else {
            return
        }
        await runRequest {
            reimbursementExpenseSearch = try await apiClient.searchReimbursementExpenses(
                reimbursementID: reimbursementID,
                query: query,
                token: token
            )
        }
    }

    func loadOrganizeData() async {
        guard let token else {
            return
        }
        await runRequest {
            try await reloadOrganizeData(token: token)
        }
    }

    func saveRule(id: Int?, body: RuleMutationRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            if let id {
                _ = try await apiClient.updateRule(id: id, body: body, token: token)
            } else {
                _ = try await apiClient.createRule(body, token: token)
            }
            rules = try await apiClient.rules(token: token)
            transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
        }
    }

    func loadRuleSuggestions() async {
        guard llmEnabled, let token else {
            return
        }
        await runRequest {
            ruleSuggestions = try await apiClient.ruleSuggestions(token: token)
        }
    }

    func mineRuleSuggestions() async -> Bool {
        guard let token else {
            return false
        }
        guard !isMiningRuleSuggestions else {
            return false
        }
        isMiningRuleSuggestions = true
        ruleMiningStatus = .idle
        defer { isMiningRuleSuggestions = false }

        let success = await runRequestReturningSuccess {
            let minedSuggestions = try await apiClient.mineRuleSuggestions(token: token)
            ruleSuggestions = minedSuggestions
            ruleMiningStatus = minedSuggestions.isEmpty ? .noneFound : .idle
        }
        if !success {
            ruleMiningStatus = .idle
        }
        return success
    }

    func acceptRuleSuggestion(_ suggestion: RuleSuggestion) async -> Bool {
        guard let token else {
            return false
        }
        ruleMiningStatus = .idle
        return await runRequestReturningSuccess {
            _ = try await apiClient.acceptRuleSuggestion(id: suggestion.id, token: token)
            rules = try await apiClient.rules(token: token)
            ruleSuggestions = try await apiClient.ruleSuggestions(token: token)
        }
    }

    func rejectRuleSuggestion(_ suggestion: RuleSuggestion) async -> Bool {
        guard let token else {
            return false
        }
        ruleMiningStatus = .idle
        return await runRequestReturningSuccess {
            _ = try await apiClient.rejectRuleSuggestion(id: suggestion.id, token: token)
            ruleSuggestions = try await apiClient.ruleSuggestions(token: token)
        }
    }

    func previewRule(_ body: RuleMutationRequest) async -> RulePreview? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.previewRule(body, token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func toggleRule(_ rule: RuleRow, enabled: Bool) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.toggleRule(
                id: rule.id,
                body: RuleToggleRequest(enabled: enabled),
                token: token
            )
            rules = try await apiClient.rules(token: token)
        }
    }

    func deleteRule(_ rule: RuleRow) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteRule(id: rule.id, token: token)
            rules = try await apiClient.rules(token: token)
        }
    }

    func loadBudgets(view: String) async {
        guard let token else {
            return
        }
        await runRequest {
            budgets = try await apiClient.budgets(view: view, token: token)
            try await reloadBudgetBurndownIfNeeded(view: view, token: token)
        }
    }

    func loadDigest(weekOf: String? = nil) async {
        guard let token else {
            return
        }
        digestLoadID += 1
        let loadID = digestLoadID
        let hadContent = digest != nil
        if !hadContent {
            digestLoadState = .loading
        }
        isLoading = true
        lastError = nil
        defer {
            if loadID == digestLoadID {
                isLoading = false
            }
        }
        do {
            let response = try await apiClient.digest(weekOf: weekOf, token: token)
            guard loadID == digestLoadID else {
                return
            }
            await waitForInitialLoadTransitionIfNeeded(hadContent: hadContent)
            guard loadID == digestLoadID else {
                return
            }
            digest = response
            digestLoadState = .loaded
        } catch let error as APIErrorInfo {
            guard loadID == digestLoadID else {
                return
            }
            if !hadContent {
                digestLoadState = .failed
            }
            handleAPIError(error)
        } catch {
            guard loadID == digestLoadID else {
                return
            }
            if !hadContent {
                digestLoadState = .failed
            }
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
    }

    func loadForecast(horizon: Int, mode: String) async {
        guard let token else {
            return
        }
        await runRequest {
            forecast = try await apiClient.forecast(horizon: horizon, mode: mode, token: token)
            forecastScenario = nil
        }
    }

    func runForecastScenario(
        horizon: Int,
        mode: String,
        modifications: [ForecastScenarioModificationRequest]
    ) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            forecastScenario = try await apiClient.forecastScenario(
                horizon: horizon,
                mode: mode,
                modifications: modifications,
                token: token
            )
        }
    }

    func loadInsights(period: String, type: String?, tagID: Int?, trendCategoryID: Int?) async {
        guard let token else {
            return
        }
        insightsLoadID += 1
        let loadID = insightsLoadID
        let hadContent = insights != nil
        if !hadContent {
            insightsLoadState = .loading
        }
        isLoading = true
        lastError = nil
        defer {
            if loadID == insightsLoadID {
                isLoading = false
            }
        }
        do {
            let response = try await apiClient.insights(
                period: period,
                type: type,
                tagID: tagID,
                trendCategoryID: trendCategoryID,
                token: token
            )
            guard loadID == insightsLoadID else {
                return
            }
            await waitForInitialLoadTransitionIfNeeded(hadContent: hadContent)
            guard loadID == insightsLoadID else {
                return
            }
            insights = response
            insightsLoadState = .loaded
        } catch let error as APIErrorInfo {
            guard loadID == insightsLoadID else {
                return
            }
            if !hadContent {
                insightsLoadState = .failed
            }
            handleAPIError(error)
        } catch {
            guard loadID == insightsLoadID else {
                return
            }
            if !hadContent {
                insightsLoadState = .failed
            }
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
    }

    func loadInsightsFlow(period: String, type: String?, tagID: Int?) async {
        guard let token else {
            return
        }
        await runRequest {
            insightsFlow = try await apiClient.insightsFlow(period: period, type: type, tagID: tagID, token: token)
        }
    }

    func loadDurablePurchases() async {
        guard let token else {
            return
        }
        await runRequest {
            durablePurchases = try await apiClient.durablePurchases(token: token)
        }
    }

    func generateReportPDF(_ body: ReportOptionsRequest) async -> AttachmentDownload? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.generateReportPDF(body, token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func exportUserCSV() async -> AttachmentDownload? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.exportUserCSV(token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func loadReconciliation() async {
        guard let token else {
            return
        }
        await runRequest {
            reconciliation = try await apiClient.reconciliation(token: token)
        }
    }

    func previewCommerzbankCSV(fileURL: URL, accountLabel: String) async -> BankStatementPreviewResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let data = try readSecurityScopedData(from: fileURL)
            return try await apiClient.previewCommerzbankCSV(
                accountLabel: accountLabel,
                filename: fileURL.lastPathComponent,
                data: data,
                token: token
            )
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func commitCommerzbankCSV(fileURL: URL, accountLabel: String) async -> BankStatementImportResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let data = try readSecurityScopedData(from: fileURL)
            let result = try await apiClient.commitCommerzbankCSV(
                accountLabel: accountLabel,
                filename: fileURL.lastPathComponent,
                data: data,
                token: token
            )
            reconciliation = try await apiClient.reconciliation(token: token)
            return result
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func acceptBankRowSuggestion(_ row: BankStatementRow) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.acceptBankRowSuggestion(rowID: row.id, token: token)
            reconciliation = try await apiClient.reconciliation(token: token)
        }
    }

    func markBankRowReviewed(_ row: BankStatementRow) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.markBankRowReviewed(rowID: row.id, token: token)
            reconciliation = try await apiClient.reconciliation(token: token)
        }
    }

    func reopenBankRow(_ row: BankStatementRow) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.reopenBankRow(rowID: row.id, token: token)
            reconciliation = try await apiClient.reconciliation(token: token)
        }
    }

    func createTransactionFromBankRow(_ row: BankStatementRow) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.createTransactionFromBankRow(rowID: row.id, token: token)
            reconciliation = try await apiClient.reconciliation(token: token)
            try await reloadPrimaryData()
        }
    }

    func loadAdmin() async {
        guard let token else {
            return
        }
        await runRequest {
            adminInfo = try await apiClient.adminInfo(token: token)
            adminSystemHealth = try await apiClient.adminSystemHealth(token: token)
            adminLogs = try await apiClient.adminLogs(filter: .errors, search: "", cursor: nil, token: token)
        }
    }

    func loadAdminHealth() async {
        guard let token else {
            return
        }
        await runRequest {
            adminSystemHealth = try await apiClient.adminSystemHealth(token: token)
        }
    }

    func loadAdminLogs(filter: AdminLogFilter, search: String, cursor: String?) async {
        guard let token else {
            return
        }
        await runRequest {
            adminLogs = try await apiClient.adminLogs(filter: filter, search: search, cursor: cursor, token: token)
        }
    }

    func downloadAdminDatabase() async -> AttachmentDownload? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.downloadAdminDatabase(token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func exportAdminCSV() async -> AttachmentDownload? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.exportAdminCSV(token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func purgeDeleted(days: Int) async -> AdminPurgeDeletedResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.purgeDeleted(days: days, token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func rebuildRollups() async -> AdminRebuildRollupsResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.rebuildRollups(token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func recurringCatchUp() async -> AdminRecurringCatchUpResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.recurringCatchUp(token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func previewLegacySQLite(fileURL: URL) async -> LegacySQLitePreviewResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let data = try readSecurityScopedData(from: fileURL)
            let preview = try await apiClient.previewLegacySQLite(
                filename: fileURL.lastPathComponent,
                data: data,
                token: token
            )
            legacySQLitePreview = preview
            return preview
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func commitLegacySQLite(_ request: LegacySQLiteCommitRequest) async -> LegacySQLiteCommitResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let response = try await apiClient.commitLegacySQLite(request, token: token)
            legacySQLitePreview = nil
            try await reloadPrimaryData()
            return response
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func loadRecurring() async {
        guard let token else {
            return
        }
        await runRequest {
            recurring = try await apiClient.recurring(token: token)
        }
    }

    func loadRecurringOccurrences(ruleID: Int) async {
        guard let token else {
            return
        }
        await runRequest {
            recurringOccurrences = try await apiClient.recurringOccurrences(ruleID: ruleID, token: token)
        }
    }

    func previewRecurring(_ body: RecurringPreviewRequest) async -> RecurringPreviewResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.previewRecurring(body, token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func saveRecurringRule(id: Int?, body: RecurringRuleRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            if let id {
                _ = try await apiClient.updateRecurringRule(id: id, body: body, token: token)
            } else {
                _ = try await apiClient.createRecurringRule(body, token: token)
            }
            recurring = try await apiClient.recurring(token: token)
        }
    }

    func toggleRecurringRule(_ rule: RecurringRule, autoPost: Bool) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.toggleRecurringRule(
                id: rule.id,
                body: RecurringToggleRequest(autoPost: autoPost),
                token: token
            )
            recurring = try await apiClient.recurring(token: token)
        }
    }

    func deleteRecurringRule(_ rule: RecurringRule) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteRecurringRule(id: rule.id, token: token)
            recurring = try await apiClient.recurring(token: token)
        }
    }

    func saveBudgetOverride(_ body: BudgetOverrideRequest, view: String) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.saveBudgetOverride(body, token: token)
            budgets = try await apiClient.budgets(view: view, token: token)
            try await reloadBudgetBurndownIfNeeded(view: view, token: token)
            dashboard = try await apiClient.dashboard(period: dashboardPeriod, token: token)
        }
    }

    func deleteBudgetOverride(id: Int, view: String) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteBudgetOverride(id: id, token: token)
            budgets = try await apiClient.budgets(view: view, token: token)
            try await reloadBudgetBurndownIfNeeded(view: view, token: token)
            dashboard = try await apiClient.dashboard(period: dashboardPeriod, token: token)
        }
    }

    func saveBudgetTemplate(_ body: BudgetTemplateRequest, view: String) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.saveBudgetTemplate(body, token: token)
            budgets = try await apiClient.budgets(view: view, token: token)
            try await reloadBudgetBurndownIfNeeded(view: view, token: token)
            dashboard = try await apiClient.dashboard(period: dashboardPeriod, token: token)
        }
    }

    func deleteBudgetTemplate(id: Int, view: String) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteBudgetTemplate(id: id, token: token)
            budgets = try await apiClient.budgets(view: view, token: token)
            try await reloadBudgetBurndownIfNeeded(view: view, token: token)
            dashboard = try await apiClient.dashboard(period: dashboardPeriod, token: token)
        }
    }

    func saveCategory(id: Int?, create: CategoryCreateRequest, update: CategoryUpdateRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            if let id {
                try await apiClient.updateCategory(id: id, body: update, token: token)
            } else {
                try await apiClient.createCategory(create, token: token)
            }
            try await reloadOrganizeData(token: token)
            dashboard = try await apiClient.dashboard(period: dashboardPeriod, token: token)
            transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
        }
    }

    func setCategoryArchived(_ category: CategoryListItem, archived: Bool) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            if archived {
                try await apiClient.archiveCategory(id: category.id, token: token)
            } else {
                try await apiClient.restoreCategory(id: category.id, token: token)
            }
            try await reloadOrganizeData(token: token)
            dashboard = try await apiClient.dashboard(period: dashboardPeriod, token: token)
            transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
        }
    }

    func previewCategoryMerge(sourceID: Int, targetID: Int) async -> [String: Int]? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let response = try await apiClient.previewCategoryMerge(
                CategoryMergeRequest(sourceCategoryID: sourceID, targetCategoryID: targetID),
                token: token
            )
            return response.counts
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func mergeCategories(sourceID: Int, targetID: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.mergeCategories(
                CategoryMergeRequest(sourceCategoryID: sourceID, targetCategoryID: targetID),
                token: token
            )
            try await reloadOrganizeData(token: token)
            dashboard = try await apiClient.dashboard(period: dashboardPeriod, token: token)
            transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
            budgets = try await apiClient.budgets(view: "month", token: token)
        }
    }

    func saveTag(id: Int?, body: TagMutationRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            if let id {
                try await apiClient.updateTag(id: id, body: body, token: token)
            } else {
                try await apiClient.createTag(body, token: token)
            }
            try await reloadOrganizeData(token: token)
            transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
        }
    }

    func previewTagMerge(sourceID: Int, targetID: Int) async -> [String: Int]? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let response = try await apiClient.previewTagMerge(
                TagMergeRequest(sourceTagID: sourceID, targetTagID: targetID),
                token: token
            )
            return response.counts
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func mergeTags(sourceID: Int, targetID: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.mergeTags(
                TagMergeRequest(sourceTagID: sourceID, targetTagID: targetID),
                token: token
            )
            try await reloadOrganizeData(token: token)
            transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
        }
    }

    func deleteTag(_ tag: TagRow) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteTag(id: tag.id, token: token)
            try await reloadOrganizeData(token: token)
            transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
        }
    }

    func saveTemplate(id: Int?, body: TemplateMutationRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            if let id {
                try await apiClient.updateTemplate(id: id, body: body, token: token)
            } else {
                try await apiClient.createTemplate(body, token: token)
            }
            templates = try await apiClient.templates(token: token)
        }
    }

    func deleteTemplate(_ template: TemplateRow) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteTemplate(id: template.id, token: token)
            templates = try await apiClient.templates(token: token)
        }
    }

    func moveTemplate(from source: IndexSet, to destination: Int) async {
        guard let token, var rows = templates?.templates else {
            return
        }
        rows.move(fromOffsets: source, toOffset: destination)
        templates = TemplatesResponse(templates: rows)
        await runRequest {
            try await apiClient.reorderTemplates(
                TemplateReorderRequest(templateIDs: rows.map(\.id)),
                token: token
            )
            templates = try await apiClient.templates(token: token)
        }
    }

    func createTransaction(_ body: TransactionMutationRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.createTransaction(body, token: token)
            try await reloadPrimaryData()
        }
    }

    func updateTransaction(id: Int, body: TransactionMutationRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.updateTransaction(id: id, body: body, token: token)
            selectedTransaction = try await apiClient.transactionDetail(id: id, token: token)
            transactionReimbursements = try await apiClient.transactionReimbursements(id: id, token: token)
            try await reloadPrimaryData()
        }
    }

    func saveReimbursementAllocation(
        reimbursementID: Int,
        expenseID: Int,
        amountCents: Int
    ) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.saveReimbursementAllocation(
                reimbursementID: reimbursementID,
                body: ReimbursementAllocationRequest(
                    expenseTransactionID: expenseID,
                    amountCents: amountCents
                ),
                token: token
            )
            transactionReimbursements = try await apiClient.transactionReimbursements(
                id: reimbursementID,
                token: token
            )
            reimbursementExpenseSearch = nil
            try await reloadPrimaryData()
        }
    }

    func deleteReimbursementAllocation(_ allocationID: Int, transactionID: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteReimbursementAllocation(id: allocationID, token: token)
            transactionReimbursements = try await apiClient.transactionReimbursements(
                id: transactionID,
                token: token
            )
            try await reloadPrimaryData()
        }
    }

    func uploadAttachment(transactionID: Int, fileURL: URL) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            let didStartAccess = fileURL.startAccessingSecurityScopedResource()
            defer {
                if didStartAccess {
                    fileURL.stopAccessingSecurityScopedResource()
                }
            }
            let data = try Data(contentsOf: fileURL)
            _ = try await apiClient.uploadAttachment(
                transactionID: transactionID,
                filename: fileURL.lastPathComponent,
                mimeType: mimeType(for: fileURL),
                data: data,
                token: token
            )
            selectedTransaction = try await apiClient.transactionDetail(id: transactionID, token: token)
            transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
        }
    }

    func uploadAttachmentData(
        transactionID: Int,
        filename: String,
        mimeType: String,
        data: Data
    ) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.uploadAttachment(
                transactionID: transactionID,
                filename: filename,
                mimeType: mimeType,
                data: data,
                token: token
            )
            selectedTransaction = try await apiClient.transactionDetail(id: transactionID, token: token)
            transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
        }
    }

    func deleteAttachment(_ attachment: ReceiptAttachment, transactionID: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteAttachment(id: attachment.id, token: token)
            selectedTransaction = try await apiClient.transactionDetail(id: transactionID, token: token)
            transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
        }
    }

    func downloadAttachment(_ attachment: ReceiptAttachment) async -> URL? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let download = try await apiClient.downloadAttachment(attachment, token: token)
            let safeName = download.filename.replacingOccurrences(of: "/", with: "_")
            let target = FileManager.default.temporaryDirectory
                .appendingPathComponent("\(attachment.id)-\(safeName)")
            try download.data.write(to: target, options: .atomic)
            return target
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func deleteTransaction(id: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteTransaction(id: id, token: token)
            if selectedTransaction?.id == id {
                selectedTransaction = nil
            }
            try await reloadPrimaryData()
        }
    }

    func previewBulkEdit(_ body: BulkEditRequest) async -> BulkEditResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.previewBulkEdit(body, token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func applyBulkEdit(_ body: BulkEditRequest) async -> BulkEditResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let result = try await apiClient.applyBulkEdit(body, token: token)
            try await reloadPrimaryData()
            uncategorizedTransactions = try await apiClient.uncategorizedTransactions(
                query: nil,
                type: nil,
                categoryID: nil,
                tagID: nil,
                token: token
            )
            deletedTransactions = try await apiClient.deletedTransactions(token: token)
            return result
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func restoreTransaction(_ transaction: DeletedTransaction) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.restoreTransaction(id: transaction.id, token: token)
            try await reloadPrimaryData()
            deletedTransactions = try await apiClient.deletedTransactions(token: token)
        }
    }

    func permanentlyDeleteTransaction(_ transaction: DeletedTransaction) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.permanentlyDeleteTransaction(id: transaction.id, token: token)
            deletedTransactions = try await apiClient.deletedTransactions(token: token)
        }
    }

    func resetBaseURL() {
        baseURLString = ExpensesAppStorage.defaultLocalBackendURL
    }

    private func authenticate(
        request: MobileAuthRequest,
        mode: AuthMode,
        setupToken: String? = nil
    ) async {
        await runRequest {
            let response: MobileAuthIdentity
            switch mode {
            case .setup:
                response = try await apiClient.mobileSetup(request, setupToken: setupToken)
            case .signup:
                response = try await apiClient.mobileSignup(request)
            case .login:
                response = try await apiClient.mobileLogin(request)
            }
            if let token = response.token {
                try keychain.save(token, account: ExpensesAppStorage.tokenKey)
            }
            clearUserScopedState()
            identity = response.withoutToken()
        }
        if identity?.authenticated == true {
            Task { await prewarmPrimaryTabs() }
        }
    }

    private func handleAPIError(
        _ error: APIErrorInfo,
        clearsSessionOnUnauthorized: Bool = true
    ) {
        if clearsSessionOnUnauthorized, error.statusCode == 401 {
            clearStoredSession()
            clearUserScopedState()
        }
        lastError = error
    }

    private func runRequest(
        clearsSessionOnUnauthorized: Bool = true,
        _ operation: () async throws -> Void
    ) async {
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            try await operation()
        } catch let error as APIErrorInfo {
            handleAPIError(
                error,
                clearsSessionOnUnauthorized: clearsSessionOnUnauthorized
            )
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
    }

    private func runRequestReturningSuccess(
        clearsSessionOnUnauthorized: Bool = true,
        _ operation: () async throws -> Void
    ) async -> Bool {
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            try await operation()
            return true
        } catch let error as APIErrorInfo {
            handleAPIError(
                error,
                clearsSessionOnUnauthorized: clearsSessionOnUnauthorized
            )
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return false
    }

    private func prewarmPrimaryTabs() async {
        guard identity?.authenticated == true else {
            return
        }
        if dashboard == nil {
            await loadDashboard(period: dashboardPeriod)
        }
        if transactions == nil {
            await loadTransactions()
        }
        if digest == nil {
            await loadDigest()
        }
        if insights == nil {
            await loadInsights(period: "all", type: nil, tagID: nil, trendCategoryID: nil)
        }
    }

    private func waitForInitialLoadTransitionIfNeeded(hadContent: Bool) async {
        guard !hadContent else {
            return
        }
        try? await Task.sleep(nanoseconds: 180_000_000)
    }

    private func reloadPrimaryData() async throws {
        guard let token else {
            return
        }
        dashboard = try await apiClient.dashboard(period: dashboardPeriod, token: token)
        dashboardLoadState = .loaded
        transactions = try await apiClient.transactions(query: nil, type: nil, categoryID: nil, tagID: nil, token: token)
        transactionsLoadState = .loaded
        if llmEnabled {
            transactionSuggestions = try await apiClient.transactionSuggestions(token: token)
        }
        try await reloadOrganizeData(token: token)
    }

    private func reloadOrganizeData(token: String) async throws {
        categories = try await apiClient.categories(token: token)
        tags = try await apiClient.tags(token: token)
        templates = try await apiClient.templates(token: token)
        rules = try await apiClient.rules(token: token)
        if llmEnabled {
            ruleSuggestions = try await apiClient.ruleSuggestions(token: token)
        }
    }

    private func reloadBudgetBurndownIfNeeded(view: String, token: String) async throws {
        guard view == "month", let month = budgets?.monthValue else {
            budgetBurndown = nil
            return
        }
        budgetBurndown = try await apiClient.budgetBurndown(
            month: month,
            scope: "overall",
            compareMonth: Self.previousMonth(month),
            token: token
        )
    }

    private static func previousMonth(_ monthValue: String) -> String? {
        let parts = monthValue.split(separator: "-")
        guard parts.count == 2,
              var year = Int(parts[0]),
              var month = Int(parts[1])
        else {
            return nil
        }
        month -= 1
        if month == 0 {
            month = 12
            year -= 1
        }
        return String(format: "%04d-%02d", year, month)
    }

    private func readSecurityScopedData(from fileURL: URL) throws -> Data {
        let didStartAccess = fileURL.startAccessingSecurityScopedResource()
        defer {
            if didStartAccess {
                fileURL.stopAccessingSecurityScopedResource()
            }
        }
        return try Data(contentsOf: fileURL)
    }

    private func rebuildClient() {
        apiClient = ExpensesAPIClient(baseURL: URL(string: baseURLString))
    }

    private func clearStoredSession() {
        try? keychain.delete(account: ExpensesAppStorage.tokenKey)
        identity = nil
    }

    private func clearUserScopedState() {
        dashboardLoadID += 1
        transactionsLoadID += 1
        digestLoadID += 1
        insightsLoadID += 1
        dashboard = nil
        transactions = nil
        dashboardLoadState = .idle
        transactionsLoadState = .idle
        uncategorizedTransactions = nil
        deletedTransactions = nil
        categories = nil
        tags = nil
        templates = nil
        rules = nil
        transactionSuggestions = []
        ruleSuggestions = []
        ruleMiningStatus = .idle
        assistantStreamTask?.cancel()
        assistantStreamTask = nil
        assistantTurns = []
        assistantMessageHistory = []
        isAssistantStreaming = false
        budgets = nil
        budgetBurndown = nil
        digest = nil
        digestLoadState = .idle
        forecast = nil
        forecastScenario = nil
        insights = nil
        insightsLoadState = .idle
        insightsFlow = nil
        durablePurchases = nil
        reconciliation = nil
        adminInfo = nil
        adminSystemHealth = nil
        adminLogs = nil
        legacySQLitePreview = nil
        mobileSessions = nil
        settings = nil
        csvPreview = nil
        recurring = nil
        recurringOccurrences = nil
        selectedTransaction = nil
        transactionReimbursements = nil
        reimbursementExpenseSearch = nil
    }

    private func mimeType(for fileURL: URL) -> String {
        switch fileURL.pathExtension.lowercased() {
        case "pdf":
            "application/pdf"
        case "jpg", "jpeg":
            "image/jpeg"
        case "png":
            "image/png"
        case "webp":
            "image/webp"
        default:
            "application/octet-stream"
        }
    }
}

private enum AuthMode {
    case setup
    case signup
    case login
}

enum RuleMiningStatus: Equatable {
    case idle
    case noneFound
}

private enum PrimaryLoadState {
    case idle
    case loading
    case loaded
    case failed

    var showsInitialPlaceholder: Bool {
        switch self {
        case .idle, .loading:
            true
        case .loaded, .failed:
            false
        }
    }
}

enum DeviceIdentity {
    static var currentID: String {
        if let existing = UserDefaults.standard.string(forKey: "expenses.deviceID") {
            return existing
        }
        let created = UUID().uuidString
        UserDefaults.standard.set(created, forKey: "expenses.deviceID")
        return created
    }
}
