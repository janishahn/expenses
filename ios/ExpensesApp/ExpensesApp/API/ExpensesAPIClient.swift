import Foundation

struct ExpensesAPIClient {
    var baseURL: URL?
    var session: URLSession = .shared

    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = BackendDateParser.parse(value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid backend date: \(value)"
            )
        }
        return decoder
    }()

    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    func mobileStatus() async throws -> MobileStatus {
        try await request(path: "/api/mobile/status")
    }

    func mobileSetup(_ body: MobileAuthRequest, setupToken: String?) async throws -> MobileAuthIdentity {
        try await request(
            path: "/api/mobile/auth/setup",
            method: "POST",
            extraHeaders: setupToken.map { ["X-Setup-Token": $0] },
            body: body
        )
    }

    func mobileSignup(_ body: MobileAuthRequest) async throws -> MobileAuthIdentity {
        try await request(path: "/api/mobile/auth/signup", method: "POST", body: body)
    }

    func mobileLogin(_ body: MobileAuthRequest) async throws -> MobileAuthIdentity {
        try await request(path: "/api/mobile/auth/login", method: "POST", body: body)
    }

    func mobileMe(token: String) async throws -> MobileAuthIdentity {
        try await request(path: "/api/mobile/auth/me", bearerToken: token)
    }

    func mobileAdminElevation(password: String, token: String) async throws -> AdminElevationResponse {
        try await request(
            path: "/api/mobile/auth/admin-elevation",
            method: "POST",
            bearerToken: token,
            body: AdminElevationRequest(password: password)
        )
    }

    func mobileLogout(token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/mobile/auth/logout",
            method: "POST",
            bearerToken: token
        )
    }

    func mobileSessions(token: String) async throws -> MobileSessionsResponse {
        try await request(path: "/api/mobile/auth/sessions", bearerToken: token)
    }

    func revokeMobileSession(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/mobile/auth/sessions/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func settings(token: String) async throws -> SettingsResponse {
        try await request(path: "/api/settings", bearerToken: token)
    }

    func createOrRotateIngestToken(token: String) async throws -> IngestTokenCreateResponse {
        try await request(path: "/api/settings/ingest-token", method: "POST", bearerToken: token)
    }

    func revokeIngestToken(token: String) async throws {
        let _: EmptyResponse = try await request(path: "/api/settings/ingest-token", method: "DELETE", bearerToken: token)
    }

    func saveBalanceAnchor(id: Int?, body: BalanceAnchorRequest, token: String) async throws -> IDResponse {
        if let id {
            try await request(
                path: "/api/settings/balance-anchors/\(id)",
                method: "PUT",
                bearerToken: token,
                body: body
            )
        } else {
            try await request(path: "/api/settings/balance-anchors", method: "POST", bearerToken: token, body: body)
        }
    }

    func deleteBalanceAnchor(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/settings/balance-anchors/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func previewCSV(filename: String, data: Data, token: String) async throws -> CSVPreviewResponse {
        try await fileUpload(
            path: "/api/import/csv/preview",
            filename: filename,
            mimeType: "text/csv",
            data: data,
            token: token
        )
    }

    func commitCSV(filename: String, data: Data, token: String) async throws -> CSVCommitResponse {
        try await fileUpload(
            path: "/api/import/csv/commit",
            filename: filename,
            mimeType: "text/csv",
            data: data,
            token: token
        )
    }

    func dashboard(period: String = "this_month", token: String) async throws -> DashboardResponse {
        try await request(path: "/api/dashboard?period=\(period)", bearerToken: token)
    }

    func transactions(
        query: String?,
        type: String?,
        categoryID: Int?,
        tagID: Int?,
        period: String = "all",
        token: String
    ) async throws -> TransactionsResponse {
        try await request(
            path: transactionListPath(
                base: "/api/transactions",
                query: query,
                type: type,
                categoryID: categoryID,
                tagID: tagID,
                period: period
            ),
            bearerToken: token
        )
    }

    func uncategorizedTransactions(
        query: String?,
        type: String?,
        categoryID: Int?,
        tagID: Int?,
        period: String = "all",
        token: String
    ) async throws -> UncategorizedTransactionsResponse {
        try await request(
            path: transactionListPath(
                base: "/api/transactions/uncategorized",
                query: query,
                type: type,
                categoryID: categoryID,
                tagID: tagID,
                period: period
            ),
            bearerToken: token
        )
    }

    func transactionDetail(id: Int, token: String) async throws -> TransactionDetail {
        try await request(path: "/api/transactions/\(id)", bearerToken: token)
    }

    func transactionReimbursements(id: Int, token: String) async throws -> TransactionReimbursementsResponse {
        try await request(path: "/api/transactions/\(id)/reimbursements", bearerToken: token)
    }

    func searchReimbursementExpenses(
        reimbursementID: Int,
        query: String,
        token: String
    ) async throws -> ReimbursementExpenseSearchResponse {
        var components = URLComponents()
        components.path = "/api/reimbursements/\(reimbursementID)/expense-search"
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        return try await request(
            path: components.string ?? "/api/reimbursements/\(reimbursementID)/expense-search",
            bearerToken: token
        )
    }

    func saveReimbursementAllocation(
        reimbursementID: Int,
        body: ReimbursementAllocationRequest,
        token: String
    ) async throws -> AllocationIDResponse {
        try await request(
            path: "/api/reimbursements/\(reimbursementID)/allocations",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func deleteReimbursementAllocation(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/reimbursements/allocations/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func deletedTransactions(token: String) async throws -> DeletedTransactionsResponse {
        try await request(path: "/api/transactions/deleted", bearerToken: token)
    }

    func spendingChatStream(
        _ body: AssistantStreamRequest,
        token: String
    ) -> AsyncThrowingStream<AssistantStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let producer = Task {
                do {
                    let baseURL = try validatedBaseURL()
                    guard let url = URL(string: "/api/ai/spending-chat/stream", relativeTo: baseURL) else {
                        throw APIErrorInfo(message: "Request URL is invalid.")
                    }
                    var request = URLRequest(url: url)
                    request.httpMethod = "POST"
                    request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
                    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = try encoder.encode(body)

                    let (bytes, response) = try await session.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else {
                        throw APIErrorInfo(message: "Backend returned an invalid response.")
                    }
                    guard (200..<300).contains(http.statusCode) else {
                        var data = Data()
                        for try await byte in bytes {
                            data.append(byte)
                        }
                        throw APIErrorInfo(
                            message: parseErrorMessage(data) ?? "Request failed.",
                            statusCode: http.statusCode,
                            requestID: http.value(forHTTPHeaderField: "X-Request-ID")
                        )
                    }
                    for try await line in bytes.lines {
                        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                        if trimmed.isEmpty {
                            continue
                        }
                        continuation.yield(
                            try decoder.decode(AssistantStreamEvent.self, from: Data(trimmed.utf8))
                        )
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in
                producer.cancel()
            }
        }
    }

    func transactionSuggestions(transactionID: Int? = nil, token: String) async throws -> [TransactionSuggestion] {
        if let transactionID {
            try await request(path: "/api/ai/transaction-suggestions?transaction_id=\(transactionID)", bearerToken: token)
        } else {
            try await request(path: "/api/ai/transaction-suggestions", bearerToken: token)
        }
    }

    func triageTransaction(id: Int, token: String) async throws -> TransactionSuggestion? {
        try await request(path: "/api/ai/transactions/\(id)/triage", method: "POST", bearerToken: token)
    }

    func acceptTransactionSuggestion(id: Int, token: String) async throws -> IDResponse {
        try await request(path: "/api/ai/transaction-suggestions/\(id)/accept", method: "POST", bearerToken: token)
    }

    func rejectTransactionSuggestion(id: Int, token: String) async throws -> IDResponse {
        try await request(path: "/api/ai/transaction-suggestions/\(id)/reject", method: "POST", bearerToken: token)
    }

    func restoreTransaction(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/transactions/\(id)/restore",
            method: "POST",
            bearerToken: token
        )
    }

    func permanentlyDeleteTransaction(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/transactions/\(id)/permanent",
            method: "DELETE",
            bearerToken: token
        )
    }

    func categories(token: String) async throws -> CategoriesResponse {
        try await request(path: "/api/categories?period=all", bearerToken: token)
    }

    func tags(token: String) async throws -> TagsResponse {
        try await request(path: "/api/tags?period=all", bearerToken: token)
    }

    func templates(token: String) async throws -> TemplatesResponse {
        try await request(path: "/api/templates", bearerToken: token)
    }

    func rules(token: String) async throws -> RulesResponse {
        try await request(path: "/api/rules", bearerToken: token)
    }

    func createRule(_ body: RuleMutationRequest, token: String) async throws -> IDResponse {
        try await request(path: "/api/rules", method: "POST", bearerToken: token, body: body)
    }

    func updateRule(id: Int, body: RuleMutationRequest, token: String) async throws -> IDResponse {
        try await request(path: "/api/rules/\(id)", method: "PUT", bearerToken: token, body: body)
    }

    func toggleRule(id: Int, body: RuleToggleRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/rules/\(id)/toggle",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func deleteRule(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/rules/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func previewRule(_ body: RuleMutationRequest, token: String) async throws -> RulePreview {
        try await request(path: "/api/rules/preview", method: "POST", bearerToken: token, body: body)
    }

    func ruleSuggestions(token: String) async throws -> [RuleSuggestion] {
        try await request(path: "/api/ai/rules/suggestions", bearerToken: token)
    }

    func mineRuleSuggestions(token: String) async throws -> [RuleSuggestion] {
        try await request(path: "/api/ai/rules/mine", method: "POST", bearerToken: token)
    }

    func acceptRuleSuggestion(id: Int, token: String) async throws -> IDResponse {
        try await request(path: "/api/ai/rules/suggestions/\(id)/accept", method: "POST", bearerToken: token)
    }

    func rejectRuleSuggestion(id: Int, token: String) async throws -> IDResponse {
        try await request(path: "/api/ai/rules/suggestions/\(id)/reject", method: "POST", bearerToken: token)
    }

    func budgets(view: String, token: String) async throws -> BudgetsResponse {
        try await request(path: "/api/budgets?view=\(view)", bearerToken: token)
    }

    func budgetBurndown(
        month: String,
        scope: String,
        compareMonth: String?,
        token: String
    ) async throws -> BudgetBurndownResponse {
        var components = URLComponents()
        components.path = "/api/budgets/burndown"
        var items = [
            URLQueryItem(name: "month", value: month),
            URLQueryItem(name: "scope", value: scope),
        ]
        if let compareMonth {
            items.append(URLQueryItem(name: "compare_month", value: compareMonth))
        }
        components.queryItems = items
        return try await request(path: components.string ?? "/api/budgets/burndown", bearerToken: token)
    }

    func digest(weekOf: String?, token: String) async throws -> DigestResponse {
        if let weekOf {
            try await request(path: "/api/digest?week_of=\(weekOf)", bearerToken: token)
        } else {
            try await request(path: "/api/digest", bearerToken: token)
        }
    }

    func forecast(horizon: Int, mode: String, token: String) async throws -> ForecastResponse {
        try await request(path: "/api/forecast?horizon=\(horizon)&mode=\(mode)", bearerToken: token)
    }

    func forecastScenario(
        horizon: Int,
        mode: String,
        modifications: [ForecastScenarioModificationRequest],
        token: String
    ) async throws -> ForecastScenarioResponse {
        try await request(
            path: "/api/forecast/scenario?mode=\(mode)",
            method: "POST",
            bearerToken: token,
            body: ForecastScenarioRequest(horizon: horizon, modifications: modifications)
        )
    }

    func insights(
        period: String,
        type: String?,
        tagID: Int?,
        trendCategoryID: Int?,
        token: String
    ) async throws -> InsightsResponse {
        try await request(
            path: insightsPath(
                base: "/api/insights",
                period: period,
                type: type,
                tagID: tagID,
                trendCategoryID: trendCategoryID
            ),
            bearerToken: token
        )
    }

    func insightsFlow(period: String, type: String?, tagID: Int?, token: String) async throws -> InsightsFlowResponse {
        try await request(path: insightsPath(base: "/api/insights/flow", period: period, type: type, tagID: tagID), bearerToken: token)
    }

    func durablePurchases(token: String) async throws -> DurablePurchasesResponse {
        try await request(path: "/api/durable-purchases", bearerToken: token)
    }

    func generateReportPDF(_ body: ReportOptionsRequest, token: String) async throws -> AttachmentDownload {
        let (data, response) = try await dataRequest(
            path: "/api/reports/pdf",
            method: "POST",
            bearerToken: token,
            contentType: "application/json",
            bodyData: encoder.encode(body)
        )
        return AttachmentDownload(
            data: data,
            filename: filename(from: response) ?? "expense_report.pdf",
            mimeType: response.value(forHTTPHeaderField: "Content-Type") ?? "application/pdf"
        )
    }

    func exportUserCSV(token: String) async throws -> AttachmentDownload {
        let (data, response) = try await dataRequest(
            path: "/api/export/csv",
            bearerToken: token
        )
        return AttachmentDownload(
            data: data,
            filename: filename(from: response) ?? "expenses_export.csv",
            mimeType: response.value(forHTTPHeaderField: "Content-Type") ?? "text/csv"
        )
    }

    func reconciliation(token: String) async throws -> BankReconciliationResponse {
        try await request(path: "/api/reconciliation", bearerToken: token)
    }

    func previewCommerzbankCSV(
        accountLabel: String,
        filename: String,
        data: Data,
        token: String
    ) async throws -> BankStatementPreviewResponse {
        try await commerzbankCSVUpload(
            path: "/api/reconciliation/commerzbank-csv/preview",
            accountLabel: accountLabel,
            filename: filename,
            data: data,
            token: token
        )
    }

    func commitCommerzbankCSV(
        accountLabel: String,
        filename: String,
        data: Data,
        token: String
    ) async throws -> BankStatementImportResponse {
        try await commerzbankCSVUpload(
            path: "/api/reconciliation/commerzbank-csv/commit",
            accountLabel: accountLabel,
            filename: filename,
            data: data,
            token: token
        )
    }

    func acceptBankRowSuggestion(rowID: Int, token: String) async throws -> BankRowActionResponse {
        try await request(
            path: "/api/reconciliation/bank-rows/\(rowID)/accept-suggestion",
            method: "POST",
            bearerToken: token
        )
    }

    func markBankRowReviewed(rowID: Int, token: String) async throws -> BankRowActionResponse {
        try await request(
            path: "/api/reconciliation/bank-rows/\(rowID)/review",
            method: "POST",
            bearerToken: token
        )
    }

    func reopenBankRow(rowID: Int, token: String) async throws -> BankRowActionResponse {
        try await request(
            path: "/api/reconciliation/bank-rows/\(rowID)/reopen",
            method: "POST",
            bearerToken: token
        )
    }

    func createTransactionFromBankRow(rowID: Int, token: String) async throws -> BankRowActionResponse {
        try await request(
            path: "/api/reconciliation/bank-rows/\(rowID)/create-transaction",
            method: "POST",
            bearerToken: token
        )
    }

    func adminInfo(token: String) async throws -> AdminInfo {
        try await request(path: "/api/admin/info", bearerToken: token)
    }

    func adminSystemHealth(token: String) async throws -> AdminSystemHealth {
        try await request(path: "/api/admin/system-health", bearerToken: token)
    }

    func adminLogs(
        filter: AdminLogFilter,
        search: String,
        cursor: String?,
        token: String
    ) async throws -> AdminLogsResponse {
        try await request(
            path: adminLogsPath(filter: filter, search: search, cursor: cursor),
            bearerToken: token
        )
    }

    func downloadAdminDatabase(token: String) async throws -> AttachmentDownload {
        let (data, response) = try await dataRequest(path: "/api/admin/download-db", bearerToken: token)
        return AttachmentDownload(
            data: data,
            filename: filename(from: response) ?? "expenses_backup.db",
            mimeType: response.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
        )
    }

    func exportAdminCSV(token: String) async throws -> AttachmentDownload {
        let (data, response) = try await dataRequest(path: "/api/admin/export-csv", bearerToken: token)
        return AttachmentDownload(
            data: data,
            filename: filename(from: response) ?? "expenses_admin_export.csv",
            mimeType: response.value(forHTTPHeaderField: "Content-Type") ?? "text/csv"
        )
    }

    func purgeDeleted(days: Int, token: String) async throws -> AdminPurgeDeletedResponse {
        try await request(
            path: "/api/admin/purge-deleted",
            method: "POST",
            bearerToken: token,
            body: AdminPurgeDeletedRequest(days: days)
        )
    }

    func rebuildRollups(token: String) async throws -> AdminRebuildRollupsResponse {
        try await request(path: "/api/admin/rebuild-rollups", method: "POST", bearerToken: token)
    }

    func recurringCatchUp(token: String) async throws -> AdminRecurringCatchUpResponse {
        try await request(path: "/api/admin/recurring-catch-up", method: "POST", bearerToken: token)
    }

    func previewLegacySQLite(filename: String, data: Data, token: String) async throws -> LegacySQLitePreviewResponse {
        try await fileUpload(
            path: "/api/import/sqlite/preview",
            filename: filename,
            mimeType: "application/octet-stream",
            data: data,
            token: token
        )
    }

    func commitLegacySQLite(_ body: LegacySQLiteCommitRequest, token: String) async throws -> LegacySQLiteCommitResponse {
        try await request(path: "/api/import/sqlite/commit", method: "POST", bearerToken: token, body: body)
    }

    func saveBudgetOverride(_ body: BudgetOverrideRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/budgets/overrides",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func deleteBudgetOverride(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/budgets/overrides/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func saveBudgetTemplate(_ body: BudgetTemplateRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/budgets/templates",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func deleteBudgetTemplate(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/budgets/templates/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func recurring(token: String) async throws -> RecurringResponse {
        try await request(path: "/api/recurring", bearerToken: token)
    }

    func recurringOccurrences(ruleID: Int, token: String) async throws -> RecurringOccurrencesResponse {
        try await request(path: "/api/recurring/\(ruleID)/occurrences", bearerToken: token)
    }

    func previewRecurring(_ body: RecurringPreviewRequest, token: String) async throws -> RecurringPreviewResponse {
        try await request(path: "/api/recurring/preview", method: "POST", bearerToken: token, body: body)
    }

    func createRecurringRule(_ body: RecurringRuleRequest, token: String) async throws -> IDResponse {
        try await request(path: "/api/recurring", method: "POST", bearerToken: token, body: body)
    }

    func updateRecurringRule(id: Int, body: RecurringRuleRequest, token: String) async throws -> IDResponse {
        try await request(path: "/api/recurring/\(id)", method: "PUT", bearerToken: token, body: body)
    }

    func toggleRecurringRule(id: Int, body: RecurringToggleRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/recurring/\(id)/toggle",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func deleteRecurringRule(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/recurring/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func createCategory(_ body: CategoryCreateRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/categories",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func updateCategory(id: Int, body: CategoryUpdateRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/categories/\(id)",
            method: "PUT",
            bearerToken: token,
            body: body
        )
    }

    func archiveCategory(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/categories/\(id)/archive",
            method: "POST",
            bearerToken: token
        )
    }

    func restoreCategory(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/categories/\(id)/restore",
            method: "POST",
            bearerToken: token
        )
    }

    func previewCategoryMerge(_ body: CategoryMergeRequest, token: String) async throws -> MergeResponse {
        try await request(
            path: "/api/categories/merge/preview",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func mergeCategories(_ body: CategoryMergeRequest, token: String) async throws -> MergeResponse {
        try await request(
            path: "/api/categories/merge",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func createTag(_ body: TagMutationRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/tags",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func updateTag(id: Int, body: TagMutationRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/tags/\(id)",
            method: "PUT",
            bearerToken: token,
            body: body
        )
    }

    func deleteTag(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/tags/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func previewTagMerge(_ body: TagMergeRequest, token: String) async throws -> MergeResponse {
        try await request(
            path: "/api/tags/merge/preview",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func mergeTags(_ body: TagMergeRequest, token: String) async throws -> MergeResponse {
        try await request(
            path: "/api/tags/merge",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func createTemplate(_ body: TemplateMutationRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/templates",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func updateTemplate(id: Int, body: TemplateMutationRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/templates/\(id)",
            method: "PUT",
            bearerToken: token,
            body: body
        )
    }

    func deleteTemplate(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/templates/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func reorderTemplates(_ body: TemplateReorderRequest, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/templates/reorder",
            method: "POST",
            bearerToken: token,
            body: body
        )
    }

    func createTransaction(_ body: TransactionMutationRequest, token: String) async throws -> IDResponse {
        try await request(path: "/api/transactions", method: "POST", bearerToken: token, body: body)
    }

    func updateTransaction(id: Int, body: TransactionMutationRequest, token: String) async throws -> IDResponse {
        try await request(path: "/api/transactions/\(id)", method: "PUT", bearerToken: token, body: body)
    }

    func deleteTransaction(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/transactions/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func transactionAttachments(id: Int, token: String) async throws -> ReceiptAttachmentsResponse {
        try await request(path: "/api/transactions/\(id)/attachments", bearerToken: token)
    }

    func uploadAttachment(
        transactionID: Int,
        filename: String,
        mimeType: String,
        data: Data,
        token: String
    ) async throws -> ReceiptAttachment {
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append(
            "Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n"
                .data(using: .utf8)!
        )
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        return try await request(
            path: "/api/transactions/\(transactionID)/attachments",
            method: "POST",
            bearerToken: token,
            contentType: "multipart/form-data; boundary=\(boundary)",
            bodyData: body
        )
    }

    func downloadAttachment(_ attachment: ReceiptAttachment, token: String) async throws -> AttachmentDownload {
        let (data, response) = try await dataRequest(
            path: "/api/attachments/\(attachment.id)/download",
            bearerToken: token
        )
        return AttachmentDownload(
            data: data,
            filename: filename(from: response) ?? attachment.originalFilename,
            mimeType: response.value(forHTTPHeaderField: "Content-Type") ?? attachment.mimeType
        )
    }

    func deleteAttachment(id: Int, token: String) async throws {
        let _: EmptyResponse = try await request(
            path: "/api/attachments/\(id)",
            method: "DELETE",
            bearerToken: token
        )
    }

    func previewBulkEdit(_ body: BulkEditRequest, token: String) async throws -> BulkEditResponse {
        try await request(path: "/api/transactions/bulk/preview", method: "POST", bearerToken: token, body: body)
    }

    func applyBulkEdit(_ body: BulkEditRequest, token: String) async throws -> BulkEditResponse {
        try await request(path: "/api/transactions/bulk/apply", method: "POST", bearerToken: token, body: body)
    }

    private func commerzbankCSVUpload<ResponseBody: Decodable>(
        path: String,
        accountLabel: String,
        filename: String,
        data: Data,
        token: String
    ) async throws -> ResponseBody {
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"account_label\"\r\n\r\n".data(using: .utf8)!)
        body.append(accountLabel.data(using: .utf8)!)
        body.append("\r\n--\(boundary)\r\n".data(using: .utf8)!)
        body.append(
            "Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n"
                .data(using: .utf8)!
        )
        body.append("Content-Type: text/csv\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        return try await request(
            path: path,
            method: "POST",
            bearerToken: token,
            contentType: "multipart/form-data; boundary=\(boundary)",
            bodyData: body
        )
    }

    private func insightsPath(
        base: String,
        period: String,
        type: String?,
        tagID: Int?,
        trendCategoryID: Int? = nil
    ) -> String {
        var components = URLComponents()
        components.path = base
        var items = [URLQueryItem(name: "period", value: period)]
        if let type, !type.isEmpty {
            items.append(URLQueryItem(name: "type", value: type))
        }
        if let tagID {
            items.append(URLQueryItem(name: "tag", value: String(tagID)))
        }
        if let trendCategoryID {
            items.append(URLQueryItem(name: "trend_category", value: String(trendCategoryID)))
        }
        components.queryItems = items
        return components.string ?? "\(base)?period=\(period)"
    }

    private func transactionListPath(
        base: String,
        query: String?,
        type: String?,
        categoryID: Int?,
        tagID: Int?,
        period: String
    ) -> String {
        var components = URLComponents()
        components.path = base
        var items = [
            URLQueryItem(name: "period", value: period),
            URLQueryItem(name: "limit", value: "50"),
        ]
        let trimmedQuery = query?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmedQuery.isEmpty {
            items.append(URLQueryItem(name: "q", value: trimmedQuery))
        }
        if let type, !type.isEmpty {
            items.append(URLQueryItem(name: "type", value: type))
        }
        if let categoryID {
            items.append(URLQueryItem(name: "category", value: String(categoryID)))
        }
        if let tagID {
            items.append(URLQueryItem(name: "tag", value: String(tagID)))
        }
        components.queryItems = items
        return components.string ?? "\(base)?period=\(period)&limit=50"
    }

    private func adminLogsPath(filter: AdminLogFilter, search: String, cursor: String?) -> String {
        var components = URLComponents()
        components.path = "/api/admin/logs"
        var items = [URLQueryItem(name: "limit", value: "40")]
        if let cursor {
            items.append(URLQueryItem(name: "cursor", value: cursor))
        }
        switch filter {
        case .errors:
            items.append(URLQueryItem(name: "error_only", value: "true"))
        case .ingest:
            items.append(URLQueryItem(name: "path", value: "/api/ingest"))
        case .imports:
            items.append(URLQueryItem(name: "q", value: "import_"))
        case .scheduler:
            items.append(URLQueryItem(name: "q", value: "scheduler_"))
        case .all:
            break
        }
        let trimmedSearch = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedSearch.isEmpty {
            items.append(URLQueryItem(name: "q", value: trimmedSearch))
        }
        components.queryItems = items
        return components.string ?? "/api/admin/logs?limit=40"
    }

    private func fileUpload<ResponseBody: Decodable>(
        path: String,
        filename: String,
        mimeType: String,
        data: Data,
        token: String
    ) async throws -> ResponseBody {
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append(
            "Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n"
                .data(using: .utf8)!
        )
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        return try await request(
            path: path,
            method: "POST",
            bearerToken: token,
            contentType: "multipart/form-data; boundary=\(boundary)",
            bodyData: body
        )
    }

    private func request<ResponseBody: Decodable, RequestBody: Encodable>(
        path: String,
        method: String = "GET",
        bearerToken: String? = nil,
        extraHeaders: [String: String]? = nil,
        body: RequestBody
    ) async throws -> ResponseBody {
        try await request(
            path: path,
            method: method,
            bearerToken: bearerToken,
            extraHeaders: extraHeaders,
            bodyData: encoder.encode(body)
        )
    }

    private func request<ResponseBody: Decodable>(
        path: String,
        method: String = "GET",
        bearerToken: String? = nil
    ) async throws -> ResponseBody {
        try await request(
            path: path,
            method: method,
            bearerToken: bearerToken,
            bodyData: nil
        )
    }

    private func request<ResponseBody: Decodable>(
        path: String,
        method: String,
        bearerToken: String?,
        extraHeaders: [String: String]? = nil,
        bodyData: Data?
    ) async throws -> ResponseBody {
        try await request(
            path: path,
            method: method,
            bearerToken: bearerToken,
            extraHeaders: extraHeaders,
            contentType: bodyData == nil ? nil : "application/json",
            bodyData: bodyData
        )
    }

    private func request<ResponseBody: Decodable>(
        path: String,
        method: String,
        bearerToken: String?,
        extraHeaders: [String: String]? = nil,
        contentType: String?,
        bodyData: Data?
    ) async throws -> ResponseBody {
        let baseURL = try validatedBaseURL()
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIErrorInfo(message: "Request URL is invalid.")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        extraHeaders?.forEach { name, value in
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let bodyData {
            request.httpBody = bodyData
            request.setValue(contentType ?? "application/octet-stream", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIErrorInfo(message: "Backend returned an invalid response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIErrorInfo(
                message: parseErrorMessage(data) ?? "Request failed.",
                statusCode: http.statusCode,
                requestID: http.value(forHTTPHeaderField: "X-Request-ID")
            )
        }
        if ResponseBody.self == EmptyResponse.self {
            return EmptyResponse() as! ResponseBody
        }
        return try decoder.decode(ResponseBody.self, from: data)
    }

    private func dataRequest(
        path: String,
        method: String = "GET",
        bearerToken: String,
        contentType: String? = nil,
        bodyData: Data? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        let baseURL = try validatedBaseURL()
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIErrorInfo(message: "Request URL is invalid.")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        if let bodyData {
            request.httpBody = bodyData
            request.setValue(contentType ?? "application/octet-stream", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIErrorInfo(message: "Backend returned an invalid response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIErrorInfo(
                message: parseErrorMessage(data) ?? "Request failed.",
                statusCode: http.statusCode,
                requestID: http.value(forHTTPHeaderField: "X-Request-ID")
            )
        }
        return (data, http)
    }

    private func validatedBaseURL() throws -> URL {
        guard let baseURL else {
            throw APIErrorInfo(message: "Backend URL is invalid.")
        }
        let scheme = baseURL.scheme?.lowercased()
        if scheme == "https" {
            return baseURL
        }
        guard scheme == "http" else {
            throw APIErrorInfo(message: "Backend URL must use HTTPS or local HTTP.")
        }
        let host = baseURL.host?.lowercased() ?? ""
        if host == "localhost" || host == "127.0.0.1" || host == "::1" {
            return baseURL
        }
        throw APIErrorInfo(message: "HTTPS is required for non-local backend URLs.")
    }

    private func filename(from response: HTTPURLResponse) -> String? {
        guard let disposition = response.value(forHTTPHeaderField: "Content-Disposition") else {
            return nil
        }
        let rawFilename: String
        if let range = disposition.range(of: "filename*=UTF-8''") {
            let encoded = String(disposition[range.upperBound...])
            rawFilename = encoded.removingPercentEncoding ?? encoded
        } else {
            guard let range = disposition.range(of: "filename=\"") else {
                return nil
            }
            let remainder = disposition[range.upperBound...]
            guard let end = remainder.firstIndex(of: "\"") else {
                return nil
            }
            rawFilename = String(remainder[..<end])
        }
        return sanitizedFilename(rawFilename)
    }

    private func sanitizedFilename(_ raw: String) -> String? {
        let basename = raw.components(separatedBy: CharacterSet(charactersIn: "/\\")).last ?? ""
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " ._-"))
        let cleaned = basename.unicodeScalars
            .map { allowed.contains($0) ? String($0) : "_" }
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty || cleaned == "." || cleaned == ".." {
            return nil
        }
        return String(cleaned.prefix(120))
    }

    private func parseErrorMessage(_ data: Data) -> String? {
        guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return String(data: data, encoding: .utf8)
        }
        if let detail = payload["detail"] as? String {
            return detail
        }
        return nil
    }
}

private struct EmptyResponse: Decodable {}

private enum BackendDateParser {
    private static let iso8601Fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let iso8601 = ISO8601DateFormatter()
    private static let fractional = formatter("yyyy-MM-dd'T'HH:mm:ss.SSSSSS")
    private static let seconds = formatter("yyyy-MM-dd'T'HH:mm:ss")
    private static let dateOnly = formatter("yyyy-MM-dd")

    static func parse(_ value: String) -> Date? {
        iso8601Fractional.date(from: value)
            ?? iso8601.date(from: value)
            ?? fractional.date(from: value)
            ?? seconds.date(from: value)
            ?? dateOnly.date(from: value)
    }

    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = format
        return formatter
    }
}
