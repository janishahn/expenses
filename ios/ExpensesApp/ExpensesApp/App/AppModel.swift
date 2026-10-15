import Foundation
import Observation

enum ExpensesAppStorage {
    static let baseURLKey = "expenses.baseURL"
    static let mobileKeychainService = "expenses.mobile"
    static let tokenKey = "mobileSessionToken"
    // The stored session's username, which the lock screen fills in.
    static let sessionUsernameKey = "expenses.sessionUsername"
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
    // Privacy mode hides every amount on screen, as the web's privacy toggle does.
    var amountsHidden: Bool {
        didSet {
            UserDefaults.standard.set(amountsHidden, forKey: Self.amountsHiddenKey)
        }
    }
    var status: MobileStatus?
    var llmEnabled: Bool { status?.llmEnabled ?? false }
    // A mobile session token is stored. The app shows sign-in until there is one.
    private(set) var hasSession = false
    var identity: MobileAuthIdentity?
    var dashboard: DashboardResponse?
    var dashboardPeriod = "this_month"
    var dashboardExcludedTagIDs: [Int] = []
    // Dashboard charts load beside the summary. nil means not loaded yet; a
    // failure stays inside its chart instead of replacing the dashboard.
    var dashboardBalanceHistory: Result<BalanceHistoryResponse, APIErrorInfo>?
    var dashboardForecast: Result<ForecastResponse, APIErrorInfo>?
    var dashboardSpendingBands: Result<CategoryBandsResponse, APIErrorInfo>?
    // Counts edits to transactions, so the Dashboard charts reload with its summary.
    private(set) var ledgerRevision = 0
    // Each list keeps its query, and the rows of every page loaded so far.
    var transactionQuery = TransactionQuery()
    var transactions: TransactionsResponse?
    var uncategorizedQuery = TransactionQuery()
    var uncategorizedTransactions: UncategorizedTransactionsResponse?
    // Every uncategorized transaction, whatever the Uncategorized screen's search.
    var uncategorizedCount = 0
    var deletedTransactions: DeletedTransactionsResponse?
    // The Categories and Tags screens' periods, which set their usage and sums.
    var categoriesPeriod = PeriodSelection.all
    var categories: CategoriesResponse?
    var tagsPeriod = PeriodSelection.all
    var tags: TagsResponse?
    var templates: TemplatesResponse?
    var rules: RulesResponse?
    var ruleSuggestions: [RuleSuggestion] = []
    var budgets: BudgetsResponse?
    var mobileSessions: MobileSessionsResponse?
    var settings: SettingsResponse?
    var aiSettings: AISettingsResponse?
    var recurring: RecurringResponse?
    var selectedTransaction: TransactionDetail?
    var transactionReimbursements: TransactionReimbursementsResponse?
    var reimbursementExpenseSearch: ReimbursementExpenseSearchResponse?
    var lastError: APIErrorInfo?
    var isLoading = false
    var isMiningRuleSuggestions = false
    var assistantTurns: [AssistantTurn] = []
    var isAssistantStreaming = false
    private var assistantMessageHistory: [JSONValue] = []
    private var assistantStreamTask: Task<Void, Never>?
    private var assistantTurnSeq = 0
    private var dashboardLoadState: PrimaryLoadState = .idle
    private var transactionsLoadState: PrimaryLoadState = .idle
    // The query the loaded rows belong to. A next page appends only to its own query.
    private(set) var loadedTransactionQuery: TransactionQuery?
    private var loadedUncategorizedQuery: TransactionQuery?
    private var budgetsLoadState: PrimaryLoadState = .idle
    private var recurringLoadState: PrimaryLoadState = .idle
    private var dashboardLoadID = 0
    private var transactionsLoadID = 0

    private var apiClient: ExpensesAPIClient
    private let keychain = KeychainStore(service: ExpensesAppStorage.mobileKeychainService)

    private static let appearancePreferenceKey = "expenses.appearancePreference"
    private static let amountsHiddenKey = "expenses.amountsHidden"

    init() {
        let storedURL = UserDefaults.standard.string(forKey: ExpensesAppStorage.baseURLKey)
        let initialBaseURLString = storedURL ?? ExpensesAppStorage.defaultLocalBackendURL
        baseURLString = initialBaseURLString
        appearancePreference = UserDefaults.standard.string(forKey: Self.appearancePreferenceKey) ?? "system"
        amountsHidden = UserDefaults.standard.bool(forKey: Self.amountsHiddenKey)
        apiClient = ExpensesAPIClient(baseURL: URL(string: initialBaseURLString))
        hasSession = token != nil
    }

    var token: String? {
        try? keychain.readString(account: ExpensesAppStorage.tokenKey)
    }

    var sessionUsername: String? {
        UserDefaults.standard.string(forKey: ExpensesAppStorage.sessionUsernameKey)
    }

    var knownCategories: [CategorySummary] {
        if let categories {
            return categories.categories.map {
                CategorySummary(id: $0.id, name: $0.name, type: $0.type.rawValue, icon: $0.icon)
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
                .map { CategorySummary(id: $0.id, name: $0.name, type: $0.type.rawValue, icon: $0.icon) }
        }
        return knownCategories
    }

    // Tags to choose from; archived ones stay on the Tags screen.
    var activeTags: [TagRow] {
        tags?.tags.filter { $0.archivedAt == nil } ?? []
    }

    var showsDashboardInitialLoading: Bool {
        dashboard == nil && dashboardLoadState.showsInitialPlaceholder
    }

    // A cold load (no cached content) that failed — distinct from a successful
    // load that returned empty data, which leaves the response non-nil.
    var showsDashboardLoadFailed: Bool { dashboard == nil && dashboardLoadState == .failed }
    var showsTransactionsLoadFailed: Bool { transactions == nil && transactionsLoadState == .failed }
    // Budgets may still hold another month, so the screen checks the month it shows.
    var showsBudgetsLoadFailed: Bool { budgetsLoadState == .failed }
    var showsRecurringLoadFailed: Bool { recurring == nil && recurringLoadState == .failed }

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

    func loadAISettings() async throws -> AISettingsResponse {
        guard let token else { throw APIErrorInfo(message: "Sign in to Expenses first.") }
        let response = try await apiClient.aiSettings(token: token)
        guard self.token == token else { throw CancellationError() }
        aiSettings = response
        return response
    }

    func saveAISettings(_ features: [AIFeatureSettings]) async throws -> AISettingsResponse {
        guard let token else { throw APIErrorInfo(message: "Sign in to Expenses first.") }
        let response = try await apiClient.saveAISettings(features, token: token)
        guard self.token == token else { throw CancellationError() }
        aiSettings = response
        return response
    }

    func aiModels(provider: String) async throws -> [AIModelOption] {
        guard let token else { throw APIErrorInfo(message: "Sign in to Expenses first.") }
        return try await apiClient.aiModels(provider: provider, token: token).models
    }

    func createChatGPTPairing() async throws -> ChatGPTPairingResponse {
        guard let token else { throw APIErrorInfo(message: "Sign in to Expenses first.") }
        return try await apiClient.createChatGPTPairing(token: token)
    }

    func disconnectChatGPT() async throws -> ChatGPTDisconnectResponse {
        guard let token else { throw APIErrorInfo(message: "Sign in to Expenses first.") }
        let response = try await apiClient.disconnectChatGPT(token: token)
        _ = try await loadAISettings()
        return response
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

    func saveAutoCategorization(enabled: Bool, threshold: Double) async -> Bool {
        guard let token else { return false }
        isLoading = true
        lastError = nil
        defer {
            if self.token == token { isLoading = false }
        }
        do {
            _ = try await apiClient.saveAutoCategorization(
                AutoCategorizationUpdate(enabled: enabled, threshold: threshold), token: token
            )
            guard self.token == token else { return false }
            let response = try await apiClient.settings(token: token)
            guard self.token == token else { return false }
            settings = response
            return true
        } catch let error as APIErrorInfo {
            guard self.token == token else { return false }
            isLoading = false
            handleAPIError(error)
        } catch {
            guard self.token == token else { return false }
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return false
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
            return try await apiClient.previewCSV(
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

    func loadDashboard(period: String? = nil, excludedTagIDs: [Int]? = nil) async {
        guard let token else {
            return
        }
        if let period {
            dashboardPeriod = period
        }
        if let excludedTagIDs {
            dashboardExcludedTagIDs = Array(Set(excludedTagIDs)).sorted()
        }
        dashboardLoadID += 1
        let loadID = dashboardLoadID
        let requestPeriod = dashboardPeriod
        let requestExcludedTagIDs = dashboardExcludedTagIDs
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
            let response = try await apiClient.dashboard(
                period: requestPeriod,
                excludedTagIDs: requestExcludedTagIDs,
                token: token
            )
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

    // Month-end balances and the forecast do not depend on the dashboard period.
    func loadDashboardBalance() async {
        guard let token else {
            return
        }
        let client = apiClient
        async let history = Self.chartResult { try await client.balanceHistory(months: 6, token: token) }
        async let forecast = Self.chartResult { try await client.forecast(horizon: 6, mode: "full", token: token) }
        let (historyResult, forecastResult) = await (history, forecast)
        guard !Task.isCancelled else {
            return
        }
        dashboardBalanceHistory = historyResult
        dashboardForecast = forecastResult
    }

    func loadDashboardSpendingBands(period: String, excludedTagIDs: [Int]) async {
        guard let token else {
            return
        }
        let client = apiClient
        let result = await Self.chartResult {
            try await client.categorySpendingBands(period: period, excludedTagIDs: excludedTagIDs, months: 6, token: token)
        }
        guard !Task.isCancelled else {
            return
        }
        dashboardSpendingBands = result
    }

    private nonisolated static func chartResult<Response>(
        _ load: () async throws -> Response
    ) async -> Result<Response, APIErrorInfo> {
        do {
            return .success(try await load())
        } catch let error as APIErrorInfo {
            return .failure(error)
        } catch {
            return .failure(APIErrorInfo(message: error.localizedDescription))
        }
    }

    /// Loads the first page for `transactionQuery`, or with `nextPage` the page after
    /// the loaded ones.
    func loadTransactions(nextPage: Bool = false) async {
        guard let token else {
            return
        }
        let query = transactionQuery
        if nextPage && (loadedTransactionQuery != query || transactions?.hasMore != true) {
            return
        }
        transactionsLoadID += 1
        let loadID = transactionsLoadID
        let page = nextPage ? (transactions?.page ?? 0) + 1 : 1
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
            var response = try await apiClient.transactions(query, page: page, token: token)
            guard loadID == transactionsLoadID else {
                return
            }
            await waitForInitialLoadTransitionIfNeeded(hadContent: hadContent)
            guard loadID == transactionsLoadID else {
                return
            }
            if nextPage, let transactions {
                response.items = transactions.items + response.items
            }
            transactions = response
            loadedTransactionQuery = query
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

    /// Loads the first page for `uncategorizedQuery`, or with `nextPage` the page after
    /// the loaded ones.
    @discardableResult
    func loadUncategorizedTransactions(nextPage: Bool = false) async -> Bool {
        guard let token else {
            return false
        }
        let query = uncategorizedQuery
        if nextPage && (loadedUncategorizedQuery != query || uncategorizedTransactions?.hasMore != true) {
            return true
        }
        let page = nextPage ? (uncategorizedTransactions?.page ?? 0) + 1 : 1
        return await runRequestReturningSuccess {
            var response = try await apiClient.uncategorizedTransactions(query, page: page, token: token)
            // A newer search replaces this one.
            guard query == uncategorizedQuery else {
                return
            }
            if nextPage, let uncategorizedTransactions {
                response.items = uncategorizedTransactions.items + response.items
            }
            uncategorizedTransactions = response
            loadedUncategorizedQuery = query
        }
    }

    func loadUncategorizedCount() async {
        guard let token else {
            return
        }
        await runRequest {
            uncategorizedCount = try await apiClient.uncategorizedTransactions(TransactionQuery(), page: 1, limit: 1, token: token).total
        }
    }

    /// Files transactions under a category, as accepting a suggestion or choosing one does.
    func categorize(_ transactionIDs: [Int], categoryID: Int) async -> Bool {
        guard let token else {
            return false
        }
        let request = BulkEditRequest(
            selection: BulkSelectionRequest(mode: "ids", transactionIDs: transactionIDs, query: nil),
            operation: BulkOperationRequest(setCategoryID: categoryID, tagPatch: nil, lifecycle: "none")
        )
        return await runRequestReturningSuccess {
            _ = try await apiClient.applyBulkEdit(request, token: token)
            if var uncategorizedTransactions {
                uncategorizedTransactions.items.removeAll { transactionIDs.contains($0.id) }
                uncategorizedTransactions.total -= transactionIDs.count
                self.uncategorizedTransactions = uncategorizedTransactions
            }
            // Later rows move up a page once these leave, so paging starts again.
            await loadUncategorizedTransactions()
            try await reloadPrimaryData()
        }
    }

    /// Keeps the transaction uncategorized and stops suggesting that category for it.
    func dismissCategorySuggestion(_ row: UncategorizedTransaction) async -> Bool {
        guard let token, let suggestion = row.suggestion else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.dismissCategorySuggestion(
                transactionID: row.id,
                categoryID: suggestion.categoryID,
                token: token
            )
            await loadUncategorizedTransactions()
        }
    }

    func exportTransactionsCSV() async -> AttachmentDownload? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.exportTransactionsCSV(transactionQuery, token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
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
        assistantTurns.append(
            AssistantTurn(
                id: assistantTurnSeq,
                role: .assistant,
                content: "",
                progressNarration: "",
                tools: [],
                isStreaming: true,
                isStopped: false,
                errorMessage: nil
            )
        )
        streamAssistantReply(to: trimmed, turnID: assistantTurnSeq, token: token)
    }

    /// Asks the question before a stopped or failed answer again, in that answer's place.
    func retryAssistantTurn(_ turnID: Int) {
        guard !isAssistantStreaming, let token,
              let index = assistantTurns.firstIndex(where: { $0.id == turnID }),
              index > 0, assistantTurns[index - 1].role == .user
        else {
            return
        }
        assistantTurns[index].content = ""
        assistantTurns[index].progressNarration = ""
        assistantTurns[index].tools = []
        assistantTurns[index].isStreaming = true
        assistantTurns[index].isStopped = false
        assistantTurns[index].errorMessage = nil
        streamAssistantReply(to: assistantTurns[index - 1].content, turnID: turnID, token: token)
    }

    private func streamAssistantReply(to question: String, turnID assistantTurnID: Int, token: String) {
        isAssistantStreaming = true
        let request = AssistantStreamRequest(
            messages: [AssistantStreamMessage(role: "user", content: question)],
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
        case let .toolCallStart(toolCallID, toolName, arguments):
            assistantTurns[index].tools.append(
                AssistantToolActivity(id: toolCallID, toolName: toolName, arguments: arguments)
            )
        case let .toolCallEnd(toolCallID, success, summary):
            if let toolIndex = assistantTurns[index].tools.firstIndex(where: { $0.id == toolCallID }) {
                assistantTurns[index].tools[toolIndex].status = success ? .success : .failed
                assistantTurns[index].tools[toolIndex].summary = summary
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

    /// Loads the first page of Trash, or with `nextPage` the page after the loaded ones.
    @discardableResult
    func loadDeletedTransactions(nextPage: Bool = false) async -> Bool {
        guard let token else {
            return false
        }
        let loaded = nextPage ? deletedTransactions?.transactions ?? [] : []
        if nextPage && loaded.count >= deletedTransactions?.total ?? 0 {
            return true
        }
        return await runRequestReturningSuccess {
            var response = try await apiClient.deletedTransactions(page: loaded.count / 50 + 1, token: token)
            response.transactions = loaded + response.transactions
            deletedTransactions = response
        }
    }

    /// The number restored, or nil when the request failed.
    func restoreDeletedTransactions(_ ids: [Int]) async -> Int? {
        guard let token else {
            return nil
        }
        var restored: Int?
        _ = await runRequestReturningSuccess {
            restored = try await apiClient.restoreDeletedTransactions(ids: ids, token: token).restored
            try await reloadPrimaryData()
            await loadDeletedTransactions()
        }
        return restored
    }

    /// The number deleted forever, or nil when the request failed.
    func purgeDeletedTransactions(_ ids: [Int]) async -> Int? {
        guard let token else {
            return nil
        }
        var deleted: Int?
        _ = await runRequestReturningSuccess {
            deleted = try await apiClient.purgeDeletedTransactions(ids: ids, token: token).deleted
            await loadDeletedTransactions()
        }
        return deleted
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

    @discardableResult
    func loadOrganizeData() async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await reloadOrganizeData(token: token)
        }
    }

    func loadCategories() async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            categories = try await apiClient.categories(period: categoriesPeriod, token: token)
        }
    }

    func loadTags() async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            tags = try await apiClient.tags(period: tagsPeriod, token: token)
        }
    }

    func loadTemplates() async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            templates = try await apiClient.templates(token: token)
            if categories == nil {
                categories = try await apiClient.categories(period: categoriesPeriod, token: token)
            }
            if tags == nil {
                tags = try await apiClient.tags(period: tagsPeriod, token: token)
            }
        }
    }

    func loadRules() async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            rules = try await apiClient.rules(token: token)
            if llmEnabled {
                ruleSuggestions = try await apiClient.ruleSuggestions(token: token)
            }
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
            try await reloadTransactions(token: token)
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
        defer { isMiningRuleSuggestions = false }
        return await runRequestReturningSuccess {
            ruleSuggestions = try await apiClient.mineRuleSuggestions(token: token)
        }
    }

    func acceptRuleSuggestion(_ suggestion: RuleSuggestion) async -> Bool {
        guard let token else {
            return false
        }
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
        return await runRequestReturningSuccess {
            _ = try await apiClient.rejectRuleSuggestion(id: suggestion.id, token: token)
            ruleSuggestions = try await apiClient.ruleSuggestions(token: token)
        }
    }

    func deleteRule(id: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteRule(id: id, token: token)
            rules = try await apiClient.rules(token: token)
        }
    }

    /// Loads the budgets for `month`, such as "2026-10".
    func loadBudgets(month: String) async {
        guard let token else {
            return
        }
        let loaded = await runRequestReturningSuccess {
            budgets = try await apiClient.budgets(month: month, token: token)
        }
        // A load cancelled for another month leaves the state to that month's load.
        if !Task.isCancelled {
            budgetsLoadState = loaded ? .loaded : .failed
        }
    }

    /// A read-only request for one chart or card, whose failure stays with it.
    func chart<Response>(_ load: (ExpensesAPIClient, String) async throws -> Response) async -> Result<Response, APIErrorInfo> {
        guard let token else {
            return .failure(APIErrorInfo(message: "Sign in to Expenses first."))
        }
        let client = apiClient
        return await Self.chartResult { try await load(client, token) }
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

    func downloadPortableArchive() async -> URL? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            return try await apiClient.downloadPortableArchive(token: token)
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
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
            return try await apiClient.commitCommerzbankCSV(
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

    func acceptBankRowSuggestion(_ row: BankStatementRow) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.acceptBankRowSuggestion(rowID: row.id, token: token)
        }
    }

    /// The number of rows matched. The server skips rows that no longer have exactly one candidate.
    func acceptBankRowSuggestions(_ rows: [BankStatementRow]) async -> Int? {
        guard let token else {
            return nil
        }
        var matched: Int?
        _ = await runRequestReturningSuccess {
            matched = try await apiClient.acceptBankRowSuggestions(rowIDs: rows.map(\.id), token: token).matches.count
        }
        return matched
    }

    func ignoreOpenBankRows(account: String?) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.ignoreOpenBankRows(account: account, token: token)
        }
    }

    func ignoreBankRow(_ row: BankStatementRow, reason: String) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.ignoreBankRow(rowID: row.id, reason: reason, token: token)
        }
    }

    // The shown outcome goes along, so the server leaves a row changed elsewhere since as it is.
    func reopenBankRow(_ row: BankStatementRow, trashCreatedTransaction: Bool) async -> Bool {
        guard let token else {
            return false
        }
        let body = BankRowReopenRequest(
            trashCreatedTransaction: trashCreatedTransaction,
            expectedResolution: row.resolution,
            expectedTransactionID: row.suggestedTransaction?.id
        )
        return await runRequestReturningSuccess {
            _ = try await apiClient.reopenBankRow(rowID: row.id, body: body, token: token)
            if trashCreatedTransaction {
                try await reloadLedger(token: token)
            }
        }
    }

    func matchBankRow(_ row: BankStatementRow, transactionID: Int, updateAmountToBank: Bool) async -> Bool {
        guard let token else {
            return false
        }
        let body = BankRowMatchRequest(transactionID: transactionID, updateAmountToBank: updateAmountToBank)
        return await runRequestReturningSuccess {
            _ = try await apiClient.matchBankRow(rowID: row.id, body: body, token: token)
            if updateAmountToBank {
                try await reloadLedger(token: token)
            }
        }
    }

    /// The new transaction's id, also when refreshing the ledger afterwards fails.
    func createTransactionFromBankRow(_ row: BankStatementRow, body: BankTransactionCreateRequest) async -> Int? {
        guard let token else {
            return nil
        }
        var created: Int?
        _ = await runRequestReturningSuccess {
            created = try await apiClient.createTransactionFromBankRow(rowID: row.id, body: body, token: token).transactionID
            try await reloadLedger(token: token)
        }
        return created
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
            return try await apiClient.previewLegacySQLite(
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

    func commitLegacySQLite(_ request: LegacySQLiteCommitRequest) async -> LegacySQLiteCommitResponse? {
        guard let token else {
            return nil
        }
        isLoading = true
        lastError = nil
        defer { isLoading = false }
        do {
            let response = try await apiClient.commitLegacySQLite(request, token: token)
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
        recurringLoadState = recurring != nil ? .loaded : .failed
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

    func deleteRecurringRule(id: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteRecurringRule(id: id, token: token)
            recurring = try await apiClient.recurring(token: token)
        }
    }

    func saveBudgetOverride(_ body: BudgetOverrideRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.saveBudgetOverride(body, token: token)
            try await reloadBudgetViews(token: token)
        }
    }

    func deleteBudgetOverride(id: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteBudgetOverride(id: id, token: token)
            try await reloadBudgetViews(token: token)
        }
    }

    func saveBudgetTemplate(_ body: BudgetTemplateRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.saveBudgetTemplate(body, token: token)
            try await reloadBudgetViews(token: token)
        }
    }

    func applyBudgetTemplateFrom(_ body: BudgetTemplateRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.applyBudgetTemplateFrom(body, token: token)
            try await reloadBudgetViews(token: token)
        }
    }

    func deleteBudgetTemplate(id: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteBudgetTemplate(id: id, token: token)
            try await reloadBudgetViews(token: token)
        }
    }

    func createCategory(_ body: CategoryCreateRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.createCategory(body, token: token)
            categories = try await apiClient.categories(period: categoriesPeriod, token: token)
        }
    }

    // Names and icons also show on the Dashboard, in transactions, and in rules.
    func updateCategory(id: Int, body: CategoryUpdateRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.updateCategory(id: id, body: body, token: token)
            try await reloadOrganizeData(token: token)
            dashboard = try await apiClient.dashboard(period: dashboardPeriod, excludedTagIDs: dashboardExcludedTagIDs, token: token)
            try await reloadTransactions(token: token)
        }
    }

    func setCategoryArchived(id: Int, archived: Bool) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            if archived {
                try await apiClient.archiveCategory(id: id, token: token)
            } else {
                try await apiClient.restoreCategory(id: id, token: token)
            }
            categories = try await apiClient.categories(period: categoriesPeriod, token: token)
        }
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
            dashboard = try await apiClient.dashboard(period: dashboardPeriod, excludedTagIDs: dashboardExcludedTagIDs, token: token)
            try await reloadTransactions(token: token)
            if let month = budgets?.monthValue {
                budgets = try await apiClient.budgets(month: month, token: token)
            }
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
            try await reloadTransactions(token: token)
        }
    }

    func setTagArchived(id: Int, archived: Bool) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            if archived {
                try await apiClient.archiveTag(id: id, token: token)
            } else {
                try await apiClient.restoreTag(id: id, token: token)
            }
            tags = try await apiClient.tags(period: tagsPeriod, token: token)
        }
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
            try await reloadTransactions(token: token)
        }
    }

    func deleteTag(id: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteTag(id: id, token: token)
            try await reloadOrganizeData(token: token)
            try await reloadTransactions(token: token)
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

    func deleteTemplate(id: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteTemplate(id: id, token: token)
            templates = try await apiClient.templates(token: token)
        }
    }

    // The new order shows at once and goes back if it does not save.
    func moveTemplate(from source: IndexSet, to destination: Int) async -> Bool {
        guard let token, let previous = templates?.templates else {
            return false
        }
        var rows = previous
        rows.move(fromOffsets: source, toOffset: destination)
        templates = TemplatesResponse(templates: rows)
        let saved = await runRequestReturningSuccess {
            try await apiClient.reorderTemplates(
                TemplateReorderRequest(templateIDs: rows.map(\.id)),
                token: token
            )
        }
        if !saved {
            templates = TemplatesResponse(templates: previous)
        }
        return saved
    }

    /// Returns the new transaction's id.
    func createTransaction(_ body: TransactionMutationRequest) async -> Int? {
        guard let token else {
            return nil
        }
        var createdID: Int?
        _ = await runRequestReturningSuccess {
            createdID = try await apiClient.createTransaction(body, token: token).id
            try await reloadPrimaryData()
        }
        return createdID
    }

    func updateTransaction(id: Int, body: TransactionMutationRequest) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            _ = try await apiClient.updateTransaction(id: id, body: body, token: token)
            let detail = try await apiClient.transactionDetail(id: id, token: token)
            let reimbursements = try await apiClient.transactionReimbursements(id: id, token: token)
            // A save can finish after another transaction opened; that one keeps its detail.
            if selectedTransaction?.id == id {
                selectedTransaction = detail
                transactionReimbursements = reimbursements
            }
            try await reloadLedger(token: token)
        }
    }

    /// Tracks the transaction as a durable purchase, or stops tracking it when `body` is nil.
    func saveDurablePurchase(transactionID: Int, _ body: DurablePurchaseRequest?) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            if let body {
                try await apiClient.saveDurablePurchase(transactionID: transactionID, body: body, token: token)
            } else {
                try await apiClient.deleteDurablePurchase(transactionID: transactionID, token: token)
            }
            selectedTransaction = try await apiClient.transactionDetail(id: transactionID, token: token)
        }
    }

    /// An image receipt's preview, or nil when there is none, as for a PDF.
    func attachmentThumbnail(_ attachment: ReceiptAttachment) async -> Data? {
        guard let token else {
            return nil
        }
        return try? await apiClient.attachmentThumbnail(id: attachment.id, token: token)
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

    func uploadAttachment(transactionID: Int, fileURL: URL, replacing: Int? = nil) async -> Bool {
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
                replacing: replacing,
                token: token
            )
            selectedTransaction = try await apiClient.transactionDetail(id: transactionID, token: token)
            try await reloadTransactions(token: token)
        }
    }

    func uploadAttachmentData(
        transactionID: Int,
        filename: String,
        mimeType: String,
        data: Data,
        replacing: Int? = nil
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
                replacing: replacing,
                token: token
            )
            selectedTransaction = try await apiClient.transactionDetail(id: transactionID, token: token)
            try await reloadTransactions(token: token)
        }
    }

    func deleteAttachment(_ attachment: ReceiptAttachment, transactionID: Int) async -> Bool {
        guard let token else {
            return false
        }
        return await runRequestReturningSuccess {
            try await apiClient.deleteAttachment(id: attachment.id, token: token)
            selectedTransaction = try await apiClient.transactionDetail(id: transactionID, token: token)
            try await reloadTransactions(token: token)
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
            return result
        } catch let error as APIErrorInfo {
            handleAPIError(error)
        } catch {
            lastError = APIErrorInfo(message: error.localizedDescription)
        }
        return nil
    }

    func resetBaseURL() {
        baseURLString = ExpensesAppStorage.defaultLocalBackendURL
    }

    private func authenticate(
        request: MobileAuthRequest,
        mode: AuthMode,
        setupToken: String? = nil
    ) async {
        // A 401 here means wrong credentials, so the lock screen keeps the stored session.
        await runRequest(clearsSessionOnUnauthorized: false) {
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
                UserDefaults.standard.set(response.user?.username, forKey: ExpensesAppStorage.sessionUsernameKey)
                hasSession = true
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
        try await reloadLedger(token: token)
        try await reloadOrganizeData(token: token)
    }

    // The views an edit to one transaction changes.
    private func reloadLedger(token: String) async throws {
        ledgerRevision += 1
        dashboard = try await apiClient.dashboard(period: dashboardPeriod, excludedTagIDs: dashboardExcludedTagIDs, token: token)
        dashboardLoadState = .loaded
        try await reloadTransactions(token: token)
        uncategorizedCount = try await apiClient.uncategorizedTransactions(TransactionQuery(), page: 1, limit: 1, token: token).total
    }

    // The first page for the current query, after a change made elsewhere.
    private func reloadTransactions(token: String) async throws {
        let query = transactionQuery
        transactionsLoadID += 1
        let loadID = transactionsLoadID
        let response = try await apiClient.transactions(query, page: 1, token: token)
        // A newer load, such as for another period, replaces this one.
        guard loadID == transactionsLoadID else {
            return
        }
        transactions = response
        loadedTransactionQuery = query
        transactionsLoadState = .loaded
    }

    private func reloadOrganizeData(token: String) async throws {
        categories = try await apiClient.categories(period: categoriesPeriod, token: token)
        tags = try await apiClient.tags(period: tagsPeriod, token: token)
        templates = try await apiClient.templates(token: token)
        rules = try await apiClient.rules(token: token)
        if llmEnabled {
            ruleSuggestions = try await apiClient.ruleSuggestions(token: token)
        }
    }

    // Budgets also show on the Dashboard.
    private func reloadBudgetViews(token: String) async throws {
        if let month = budgets?.monthValue {
            budgets = try await apiClient.budgets(month: month, token: token)
        }
        dashboard = try await apiClient.dashboard(period: dashboardPeriod, excludedTagIDs: dashboardExcludedTagIDs, token: token)
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
        UserDefaults.standard.removeObject(forKey: ExpensesAppStorage.sessionUsernameKey)
        identity = nil
        hasSession = false
    }

    private func clearUserScopedState() {
        aiSettings = nil
        dashboardLoadID += 1
        transactionsLoadID += 1
        dashboard = nil
        dashboardExcludedTagIDs = []
        dashboardBalanceHistory = nil
        dashboardForecast = nil
        dashboardSpendingBands = nil
        transactionQuery = TransactionQuery()
        transactions = nil
        loadedTransactionQuery = nil
        dashboardLoadState = .idle
        transactionsLoadState = .idle
        uncategorizedQuery = TransactionQuery()
        uncategorizedTransactions = nil
        loadedUncategorizedQuery = nil
        uncategorizedCount = 0
        deletedTransactions = nil
        categoriesPeriod = .all
        categories = nil
        tagsPeriod = .all
        tags = nil
        templates = nil
        rules = nil
        ruleSuggestions = []
        assistantStreamTask?.cancel()
        assistantStreamTask = nil
        assistantTurns = []
        assistantMessageHistory = []
        isAssistantStreaming = false
        budgets = nil
        budgetsLoadState = .idle
        mobileSessions = nil
        settings = nil
        recurring = nil
        recurringLoadState = .idle
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

private enum PrimaryLoadState: Equatable {
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
