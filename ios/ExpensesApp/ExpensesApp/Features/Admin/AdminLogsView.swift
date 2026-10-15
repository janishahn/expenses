import SwiftUI

/// The server log, newest first, filtered by kind and searched by text or request ID.
struct AdminLogsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    private struct Query: Equatable {
        var filter = AdminLogFilter.errors
        var search = ""
    }

    @State private var query = Query()
    @State private var search = ""
    @State private var logs: Result<AdminLogsResponse, APIErrorInfo>?
    @State private var loadingOlder = false
    @State private var olderError: String?

    var body: some View {
        List {
            switch logs {
            case nil:
                LoadingStateSection(title: "Loading logs")
            case .failure(let error) where error.statusCode == 403:
                AdminUnlockSection(title: "Admin access expired") {
                    await load()
                }
            case .failure(let error):
                UnavailableStateSection(title: "Couldn't load logs", systemImage: "exclamationmark.triangle", message: error.message) {
                    await load()
                }
            case .success(let logs) where logs.entries.isEmpty:
                UnavailableStateSection(title: "No matching log entries", systemImage: "doc.text.magnifyingglass")
            case .success(let logs):
                Section {
                    ForEach(logs.entries) { entry in
                        NavigationLink {
                            AdminLogEntryView(entry: entry)
                        } label: {
                            row(entry)
                        }
                        .navigationLinkIndicatorVisibility(.hidden)
                    }
                    if let cursor = logs.nextCursor {
                        Button {
                            Task { await loadOlder(cursor) }
                        } label: {
                            HStack {
                                Text("Load older")
                                Spacer()
                                if loadingOlder {
                                    ProgressView()
                                }
                            }
                        }
                        .disabled(loadingOlder)
                    }
                    if let olderError {
                        FieldError(olderError)
                    }
                }
                .expensesRowBackground()
            }
        }
        .navigationTitle("Logs")
        .navigationSubtitle(query.filter.label)
        .expensesScreenStyle()
        .searchable(text: $search, prompt: "Request ID, event, text")
        // Searching reads the log files, so it runs on submit, not on every key.
        .onSubmit(of: .search) {
            query.search = search
        }
        .onChange(of: search) {
            if search.isEmpty {
                query.search = ""
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Log Type", selection: $query.filter) {
                        ForEach(AdminLogFilter.allCases) { filter in
                            Text(filter.label).tag(filter)
                        }
                    }
                } label: {
                    Label("Log type", systemImage: "line.3.horizontal.decrease")
                }
                .sensoryFeedback(.selection, trigger: query.filter)
            }
        }
        .task(id: query) {
            logs = nil
            await load()
        }
        .refreshable {
            await load()
        }
    }

    private func row(_ entry: AdminLogEntry) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.event)
                    .lineLimit(1)
                Text([entry.timestamp.map(AppFormatters.occurred), entry.path].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(entry.levelLabel)
                .font(.subheadline)
                .foregroundStyle(entry.isError ? ExpensesTheme.expense(for: scheme) : .secondary)
        }
    }

    private func load() async {
        let query = query
        let result = await model.chart { try await $0.adminLogs(filter: query.filter, search: query.search, cursor: nil, token: $1) }
        guard !Task.isCancelled else {
            return
        }
        olderError = nil
        logs = result
    }

    private func loadOlder(_ cursor: String) async {
        olderError = nil
        loadingOlder = true
        defer { loadingOlder = false }
        let query = query
        let result = await model.chart { try await $0.adminLogs(filter: query.filter, search: query.search, cursor: cursor, token: $1) }
        guard query == self.query, case .success(let loaded) = logs else {
            return
        }
        switch result {
        case .success(let older):
            logs = .success(AdminLogsResponse(entries: loaded.entries + older.entries, nextCursor: older.nextCursor))
        case .failure(let error):
            olderError = error.message
        }
    }
}

/// One log entry: its request, the captured body, and the full payload.
private struct AdminLogEntryView: View {
    let entry: AdminLogEntry

    var body: some View {
        List {
            Section {
                LabeledContent("Time", value: entry.timestamp.map { $0.formatted(date: .abbreviated, time: .standard) } ?? "Unknown")
                LabeledContent("Level", value: entry.levelLabel)
                if let logger = entry.logger {
                    LabeledContent("Logger", value: logger)
                }
                LabeledContent("Request ID", value: entry.requestID ?? "None")
                    .textSelection(.enabled)
                if entry.method != nil || entry.path != nil {
                    LabeledContent("Request", value: [entry.method, entry.path].compactMap { $0 }.joined(separator: " "))
                }
                if let statusCode = entry.statusCode {
                    LabeledContent("Status", value: String(statusCode))
                }
                if let duration = entry.durationMS {
                    LabeledContent("Duration", value: "\(Int(duration.rounded()).formatted()) ms")
                }
            }
            .expensesRowBackground()

            if let rawBody = entry.rawBody {
                Section("Captured body") {
                    code(rawBody)
                }
                .expensesRowBackground()
            }

            Section("Payload") {
                code(entry.prettyPayload())
            }
            .expensesRowBackground()
        }
        .navigationTitle(entry.event)
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: entry.prettyPayload()) {
                    Label("Share payload", systemImage: "square.and.arrow.up")
                }
            }
        }
    }

    private func code(_ text: String) -> some View {
        Text(text)
            .font(.footnote.monospaced())
            .textSelection(.enabled)
    }
}

private extension AdminLogEntry {
    var isError: Bool {
        level == "ERROR" || level == "CRITICAL"
    }

    var levelLabel: String {
        switch level {
        case "ERROR", "CRITICAL":
            "Error"
        case "WARNING":
            "Warning"
        case "INFO":
            "Info"
        default:
            level
        }
    }
}
