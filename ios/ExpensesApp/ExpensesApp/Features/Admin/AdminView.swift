import UIKit
import SwiftUI
import UniformTypeIdentifiers

struct AdminView: View {
    @Environment(AppModel.self) private var model
    @State private var password = ""
    @State private var purgeDays = "30"
    @State private var statusText: String?
    @State private var formError: String?
    @State private var selectedAction: AdminAction?
    @State private var lastDocument: PreviewDocument?
    @State private var previewDocument: PreviewDocument?
    @State private var shareURL: URL?
    @State private var logFilter: AdminLogFilter = .errors
    @State private var logSearch = ""
    @State private var selectedLog: AdminLogEntry?
    @State private var showSQLiteImporter = false
    @State private var importRecurringRules = true
    @State private var recurringAutoPost = false
    @State private var linkRecurringTransactions = true
    @State private var preserveTimeInTitle = false
    @State private var mappingSelections: [Int: String] = [:]

    private var isElevated: Bool {
        guard let elevatedUntil = model.identity?.session?.elevatedUntil else {
            return false
        }
        return elevatedUntil > Date()
    }

    var body: some View {
        Form {
            if model.identity?.authenticated != true {
                SignedOutStateSection()
            } else if model.identity?.user?.isAdmin != true {
                UnavailableStateSection(
                    title: "Admin only",
                    systemImage: "person.badge.key",
                    message: "This account does not have admin access."
                )
            } else {
                elevationSection

                if isElevated {
                    if model.adminInfo == nil && model.isLoading {
                        LoadingStateSection(title: "Loading admin")
                    } else {
                        healthSection
                        filesSection
                        maintenanceSection
                        importSection
                        systemInfoSection
                        logsSection
                    }
                }

                if let statusText {
                    Section("Latest Result") {
                        Text(statusText)
                        if let lastDocument {
                            Button {
                                previewDocument = lastDocument
                            } label: {
                                Label("Preview", systemImage: "doc.viewfinder")
                            }
                        }
                        if let shareURL {
                            ShareLink(item: shareURL) {
                                Label("Share", systemImage: "square.and.arrow.up")
                            }
                        }
                    }
                }

                if let formError {
                    Section("Error") {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                } else if let lastError = model.lastError {
                    ErrorDetailsView(error: lastError)
                }
            }
        }
        .navigationTitle("Admin")
        .expensesScreenStyle()
        .task {
            if isElevated {
                await model.loadAdmin()
            }
        }
        .refreshable {
            if isElevated {
                await model.loadAdmin()
            }
        }
        .animation(.easeInOut(duration: 0.18), value: model.isLoading && model.adminInfo == nil)
        .fileImporter(
            isPresented: $showSQLiteImporter,
            allowedContentTypes: [.data]
        ) { result in
            handleSQLiteImport(result)
        }
        .sheet(item: $previewDocument) { document in
            DocumentPreviewView(url: document.url)
                .ignoresSafeArea()
        }
        .sheet(item: $selectedLog) { entry in
            AdminLogDetailView(entry: entry)
        }
        .confirmationDialog(
            selectedAction?.title ?? "Confirm",
            isPresented: selectedActionPresented,
            titleVisibility: .visible
        ) {
            if let selectedAction {
                Button(selectedAction.confirmLabel, role: selectedAction.role) {
                    Task { await perform(selectedAction) }
                }
            }
        } message: {
            if let selectedAction {
                Text(selectedAction.message)
            }
        }
        .onChange(of: logFilter) { _, _ in
            Task { await model.loadAdminLogs(filter: logFilter, search: logSearch, cursor: nil) }
        }
    }

    private var selectedActionPresented: Binding<Bool> {
        Binding(
            get: { selectedAction != nil },
            set: { isPresented in
                if !isPresented {
                    selectedAction = nil
                }
            }
        )
    }

    private var elevationSection: some View {
        Section("Admin Access") {
            if isElevated {
                LabeledContent("Elevated until", value: model.identity?.session?.elevatedUntil?.formatted() ?? "-")
            } else {
                SecureField("Password", text: $password)
                Button {
                    Task { await elevate() }
                } label: {
                    Label("Elevate admin session", systemImage: "person.badge.key")
                }
                .disabled(password.isEmpty || model.isLoading)
            }
        }
    }

    private var healthSection: some View {
        Section("System Health") {
            if let health = model.adminSystemHealth {
                LabeledContent("Status", value: health.status.capitalized)
                LabeledContent("CPU load", value: "\(Int(health.cpuLoadPercent.rounded()))%")
                LabeledContent("CPU temperature", value: health.cpuTempCelsius.map { "\(Int($0.rounded())) C" } ?? "N/A")
                LabeledContent("RAM", value: "\(Self.bytes(health.ramUsedBytes)) / \(Self.bytes(health.ramTotalBytes))")
                LabeledContent("Disk", value: "\(Self.bytes(health.diskUsedBytes)) / \(Self.bytes(health.diskTotalBytes))")
                LabeledContent("Database", value: Self.bytes(health.dbSizeBytes))
                LabeledContent("Receipts", value: Self.bytes(health.receiptsSizeBytes))
            } else {
                Text("No health sample loaded.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var filesSection: some View {
        Section("Backup And Export") {
            Button {
                Task { await storeDownload(await model.downloadAdminDatabase(), folder: "AdminBackups") }
            } label: {
                Label("Download database backup", systemImage: "externaldrive.badge.timemachine")
            }
            .disabled(model.isLoading)

            Button {
                Task { await storeDownload(await model.exportAdminCSV(), folder: "AdminExports") }
            } label: {
                Label("Export all transactions CSV", systemImage: "tablecells")
            }
            .disabled(model.isLoading)
        }
    }

    private var maintenanceSection: some View {
        Section("Maintenance") {
            HStack {
                TextField("Days", text: $purgeDays)
                    .keyboardType(.numberPad)
                Button("Purge deleted", role: .destructive) {
                    selectedAction = .purge
                }
            }
            Button {
                selectedAction = .rebuild
            } label: {
                Label("Rebuild monthly rollups", systemImage: "arrow.triangle.2.circlepath")
            }
            Button {
                selectedAction = .catchUp
            } label: {
                Label("Run recurring catch-up", systemImage: "repeat")
            }
        }
    }

    private var importSection: some View {
        Section("Legacy SQLite Import") {
            Button {
                showSQLiteImporter = true
            } label: {
                Label("Preview .db import", systemImage: "tray.and.arrow.down")
            }
            .disabled(model.isLoading)

            if let preview = model.legacySQLitePreview {
                AdminImportPreviewView(
                    preview: preview,
                    importRecurringRules: $importRecurringRules,
                    recurringAutoPost: $recurringAutoPost,
                    linkRecurringTransactions: $linkRecurringTransactions,
                    preserveTimeInTitle: $preserveTimeInTitle,
                    mappingSelections: $mappingSelections
                )
                Button("Commit import", role: .destructive) {
                    selectedAction = .commitImport
                }
                .disabled(model.isLoading)
            }
        }
    }

    private var systemInfoSection: some View {
        Section("System Information") {
            if let info = model.adminInfo {
                LabeledContent("App version", value: info.appVersion)
                LabeledContent("Environment", value: info.environment)
                LabeledContent("Users", value: String(info.usersCount))
                LabeledContent("Database path", value: info.dbPath)
                LabeledContent("DB size", value: String(format: "%.2f MB", info.dbSizeMB))
                LabeledContent("DB modified", value: info.dbModified?.formatted() ?? "-")
                LabeledContent("Log path", value: info.logPath)
                LabeledContent("Log size", value: String(format: "%.2f MB", info.logSizeMB))
                LabeledContent("Log modified", value: info.logModified?.formatted() ?? "-")
                LabeledContent("Retained logs", value: String(info.logRetainedFiles))
            } else {
                Text("No admin info loaded.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var logsSection: some View {
        Section("Application Logs") {
            Picker("Filter", selection: $logFilter) {
                ForEach(AdminLogFilter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            TextField("Search text or request ID", text: $logSearch)
                .textInputAutocapitalization(.never)
                .onSubmit {
                    Task { await model.loadAdminLogs(filter: logFilter, search: logSearch, cursor: nil) }
                }

            if let logs = model.adminLogs {
                ForEach(logs.entries) { entry in
                    Button {
                        selectedLog = entry
                    } label: {
                        AdminLogRow(entry: entry)
                    }
                    .buttonStyle(.plain)
                }
                if let nextCursor = logs.nextCursor {
                    Button("Load older logs") {
                        Task { await model.loadAdminLogs(filter: logFilter, search: logSearch, cursor: nextCursor) }
                    }
                }
            } else {
                Text("No logs loaded.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func elevate() async {
        formError = nil
        guard await model.elevateAdmin(password: password) else {
            return
        }
        password = ""
        await model.loadAdmin()
    }

    private func perform(_ action: AdminAction) async {
        formError = nil
        statusText = nil
        lastDocument = nil
        shareURL = nil
        switch action {
        case .purge:
            guard let days = Int(purgeDays), days >= 1 else {
                formError = "Days must be at least 1."
                return
            }
            if let response = await model.purgeDeleted(days: days) {
                statusText = "Purged \(response.count) transactions and \(response.attachmentsCount) attachments."
            }
        case .rebuild:
            if let response = await model.rebuildRollups() {
                statusText = "Rebuilt rollups for \(response.rebuiltUsers) users."
            }
        case .catchUp:
            if let response = await model.recurringCatchUp() {
                if response.updated {
                    statusText = "Catch-up advanced \(response.advancedRules) rules."
                } else {
                    statusText = "Catch-up ran. \(response.overdueRules) overdue rules remain."
                }
            }
        case .commitImport:
            await commitImport()
        }
    }

    private func handleSQLiteImport(_ result: Result<URL, Error>) {
        formError = nil
        statusText = nil
        lastDocument = nil
        shareURL = nil
        switch result {
        case let .success(url):
            Task {
                guard let preview = await model.previewLegacySQLite(fileURL: url) else {
                    return
                }
                importRecurringRules = preview.preview.recurringCount > 0
                recurringAutoPost = false
                linkRecurringTransactions = true
                preserveTimeInTitle = preview.preview.nonMidnightTransactionTimes > 0
                mappingSelections = Dictionary(
                    uniqueKeysWithValues: preview.preview.mappingRows.map { row in
                        let value = row.suggestedCategoryID.map { "existing:\($0)" } ?? "create"
                        return (row.idx, value)
                    }
                )
            }
        case let .failure(error):
            formError = error.localizedDescription
        }
    }

    private func commitImport() async {
        guard let preview = model.legacySQLitePreview else {
            formError = "Preview a legacy database first."
            return
        }
        let request = LegacySQLiteCommitRequest(
            token: preview.token,
            options: LegacySQLiteImportOptions(
                importRecurringRules: importRecurringRules,
                recurringAutoPost: recurringAutoPost,
                linkRecurringTransactions: linkRecurringTransactions,
                preserveTimeInTitle: preserveTimeInTitle
            ),
            mappingTargets: preview.preview.mappingRows.map { row in
                let value = mappingSelections[row.idx] ?? "create"
                if value == "discard" {
                    return LegacySQLiteMappingTarget(
                        legacyType: row.legacyType,
                        legacyCategory: row.legacyCategory,
                        target: "discard",
                        existingCategoryID: nil
                    )
                }
                if value.hasPrefix("existing:") {
                    return LegacySQLiteMappingTarget(
                        legacyType: row.legacyType,
                        legacyCategory: row.legacyCategory,
                        target: "existing",
                        existingCategoryID: Int(String(value.dropFirst("existing:".count)))
                    )
                }
                return LegacySQLiteMappingTarget(
                    legacyType: row.legacyType,
                    legacyCategory: row.legacyCategory,
                    target: "create",
                    existingCategoryID: nil
                )
            }
        )
        if let response = await model.commitLegacySQLite(request) {
            statusText = response.result
                .sorted { $0.key < $1.key }
                .map { "\($0.key.replacingOccurrences(of: "_", with: " ")): \($0.value)" }
                .joined(separator: " · ")
        }
    }

    private func storeDownload(_ download: AttachmentDownload?, folder: String) async {
        guard let download else {
            return
        }
        do {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(folder, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let filename = Self.safeFilename(download.filename, fallback: "expenses_download")
            let url = directory.appendingPathComponent(filename)
            try download.data.write(to: url, options: .atomic)
            let document = PreviewDocument(url: url)
            lastDocument = document
            previewDocument = document
            shareURL = url
            statusText = filename
        } catch {
            formError = error.localizedDescription
        }
    }

    private static func safeFilename(_ raw: String, fallback: String) -> String {
        let basename = raw.components(separatedBy: CharacterSet(charactersIn: "/\\")).last ?? ""
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " ._-"))
        let cleaned = basename.unicodeScalars
            .map { allowed.contains($0) ? String($0) : "_" }
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty || cleaned == "." || cleaned == ".." {
            return fallback
        }
        return String(cleaned.prefix(120))
    }

    private static func bytes(_ value: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .file)
    }
}

private struct AdminLogRow: View {
    let entry: AdminLogEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(entry.level)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(levelColor)
                Text(entry.event)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(entry.timestamp)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(entry.path ?? entry.route ?? "-")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if let requestID = entry.requestID {
                Text(requestID)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }

    private var levelColor: Color {
        switch entry.level {
        case "ERROR", "CRITICAL":
            .red
        case "WARNING":
            .orange
        default:
            .secondary
        }
    }
}

private struct AdminLogDetailView: View {
    let entry: AdminLogEntry

    var body: some View {
        NavigationStack {
            Form {
                Section("Summary") {
                    LabeledContent("Event", value: entry.event)
                    LabeledContent("Level", value: entry.level)
                    LabeledContent("Timestamp", value: entry.timestamp)
                    LabeledContent("Request ID", value: entry.requestID ?? "-")
                    LabeledContent("Path", value: entry.path ?? "-")
                    if let statusCode = entry.statusCode {
                        LabeledContent("Status", value: String(statusCode))
                    }
                }

                if let rawBody = entry.rawBody {
                    Section("Captured Body") {
                        Text(rawBody)
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                    }
                }

                Section("Payload") {
                    Text(entry.prettyPayload())
                        .font(.footnote.monospaced())
                        .textSelection(.enabled)
                    if let requestID = entry.requestID {
                        Button {
                            UIPasteboard.general.string = requestID
                        } label: {
                            Label("Copy Request ID", systemImage: "doc.on.doc")
                        }
                    }
                    Button {
                        UIPasteboard.general.string = entry.prettyPayload()
                    } label: {
                        Label("Copy Payload", systemImage: "doc.on.doc")
                    }
                    ShareLink(item: entry.prettyPayload()) {
                        Label("Share Log JSON", systemImage: "square.and.arrow.up")
                    }
                }
            }
            .navigationTitle("Log Entry")
        }
    }
}

private struct AdminImportPreviewView: View {
    let preview: LegacySQLitePreviewResponse
    @Binding var importRecurringRules: Bool
    @Binding var recurringAutoPost: Bool
    @Binding var linkRecurringTransactions: Bool
    @Binding var preserveTimeInTitle: Bool
    @Binding var mappingSelections: [Int: String]

    var body: some View {
        LabeledContent("Transactions", value: String(preview.preview.transactionsCount))
        LabeledContent("Recurring rules", value: String(preview.preview.recurringCount))
        if let minDate = preview.preview.minTransactionDate, let maxDate = preview.preview.maxTransactionDate {
            LabeledContent("Date range", value: "\(AppFormatters.day(minDate)) - \(AppFormatters.day(maxDate))")
        }
        ForEach(preview.preview.warnings, id: \.self) { warning in
            Text(warning)
                .foregroundStyle(.orange)
        }

        Toggle("Import recurring rules", isOn: $importRecurringRules)
            .sensoryFeedback(.selection, trigger: importRecurringRules)
        Toggle("Auto-post imported recurring rules", isOn: $recurringAutoPost)
            .disabled(!importRecurringRules)
            .sensoryFeedback(.selection, trigger: recurringAutoPost)
        Toggle("Link recurring transactions", isOn: $linkRecurringTransactions)
            .disabled(!importRecurringRules)
            .sensoryFeedback(.selection, trigger: linkRecurringTransactions)
        Toggle("Preserve non-midnight times in titles", isOn: $preserveTimeInTitle)
            .sensoryFeedback(.selection, trigger: preserveTimeInTitle)

        ForEach(preview.preview.mappingRows) { row in
            Picker(
                "\(row.legacyCategory) (\(row.transactionCount))",
                selection: mappingBinding(row)
            ) {
                Text("Create category").tag("create")
                ForEach(preview.categories) { category in
                    Text("Use \(category.name)").tag("existing:\(category.id)")
                }
                Text("Discard").tag("discard")
            }
        }
    }

    private func mappingBinding(_ row: LegacySQLiteMappingRow) -> Binding<String> {
        Binding(
            get: {
                mappingSelections[row.idx] ?? row.suggestedCategoryID.map { "existing:\($0)" } ?? "create"
            },
            set: { mappingSelections[row.idx] = $0 }
        )
    }
}

private enum AdminAction: String, Identifiable {
    case purge
    case rebuild
    case catchUp
    case commitImport

    var id: String { rawValue }

    var title: String {
        switch self {
        case .purge:
            "Purge deleted transactions?"
        case .rebuild:
            "Rebuild rollups?"
        case .catchUp:
            "Run recurring catch-up?"
        case .commitImport:
            "Commit legacy import?"
        }
    }

    var confirmLabel: String {
        switch self {
        case .purge:
            "Purge"
        case .rebuild:
            "Rebuild"
        case .catchUp:
            "Run"
        case .commitImport:
            "Commit Import"
        }
    }

    var message: String {
        switch self {
        case .purge:
            "This permanently removes old soft-deleted transactions and their attachments."
        case .rebuild:
            "Monthly aggregates will be recalculated from the transaction ledger."
        case .catchUp:
            "Overdue recurring auto-post rules will run now."
        case .commitImport:
            "The previewed legacy database import will be written to the tracker."
        }
    }

    var role: ButtonRole? {
        switch self {
        case .purge, .commitImport:
            .destructive
        case .rebuild, .catchUp:
            nil
        }
    }
}

#Preview {
    AdminView()
        .environment(AppModel())
}
