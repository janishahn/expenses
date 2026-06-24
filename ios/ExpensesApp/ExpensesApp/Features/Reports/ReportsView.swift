import SwiftUI

struct ReportsView: View {
    @Environment(AppModel.self) private var model
    @State private var startDate = ReportsView.monthStart()
    @State private var endDate = ReportsView.monthEnd()
    @State private var enabledSections = Set(["summary", "category_breakdown", "recent_transactions"])
    @State private var transactionType = ""
    @State private var transactionsSort = "newest"
    @State private var showRunningBalance = false
    @State private var includeCategorySubtotals = false
    @State private var includeCents = true
    @State private var notes = ""
    @State private var categoryMode = "all"
    @State private var selectedCategoryIDs: Set<Int> = []
    @State private var statusText: String?
    @State private var formError: String?
    @State private var lastDocument: PreviewDocument?
    @State private var previewDocument: PreviewDocument?
    @State private var shareURL: URL?

    private let reportSections: [(key: String, label: String)] = [
        ("summary", "Summary"),
        ("category_breakdown", "Category breakdown"),
        ("top_categories", "Top categories"),
        ("trend", "Trend"),
        ("recent_transactions", "Transactions"),
        ("recurring_upcoming", "Recurring upcoming"),
    ]

    private var activeCategories: [CategoryListItem] {
        model.categories?.categories.filter { $0.archivedAt == nil } ?? []
    }

    var body: some View {
        Form {
            if model.identity?.authenticated != true {
                SignedOutStateSection()
            } else {
                Section("Date Range") {
                    DatePicker("Start", selection: $startDate, displayedComponents: .date)
                    DatePicker("End", selection: $endDate, displayedComponents: .date)
                }

                Section("Sections") {
                    ForEach(reportSections, id: \.key) { section in
                        Toggle(section.label, isOn: sectionBinding(section.key))
                    }
                }

                Section("Transactions") {
                    Picker("Type", selection: $transactionType) {
                        Text("All").tag("")
                        Text("Income").tag("income")
                        Text("Expenses").tag("expense")
                    }
                    Picker("Sort", selection: $transactionsSort) {
                        Text("Newest first").tag("newest")
                        Text("Oldest first").tag("oldest")
                    }
                    .disabled(showRunningBalance)
                    Toggle("Show running balance", isOn: $showRunningBalance)
                    Toggle("Include category subtotals", isOn: $includeCategorySubtotals)
                    Toggle("Include cents", isOn: $includeCents)
                }

                Section("Categories") {
                    Picker("Mode", selection: $categoryMode) {
                        Text("All active").tag("all")
                        Text("Selected").tag("selected")
                    }
                    if categoryMode == "selected" {
                        if activeCategories.isEmpty {
                            Text("No active categories.")
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(activeCategories) { category in
                                Toggle(
                                    category.name,
                                    isOn: categoryBinding(category.id)
                                )
                            }
                        }
                    }
                }

                Section("Notes") {
                    TextField("Optional report notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section {
                    Button {
                        Task { await generateReport() }
                    } label: {
                        Label("Generate PDF", systemImage: "doc.richtext")
                    }
                    .disabled(model.isLoading)

                    Button {
                        Task { await exportCSV() }
                    } label: {
                        Label("Export CSV", systemImage: "tablecells")
                    }
                    .disabled(model.isLoading)

                    if model.isLoading {
                        ProgressView()
                    }
                }

                if let formError {
                    Section {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }

                if let statusText {
                    Section("Latest File") {
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

                if let lastError = model.lastError {
                    Section("Error") {
                        Text(lastError.message)
                            .foregroundStyle(.red)
                        if let requestID = lastError.requestID {
                            LabeledContent("Request ID", value: requestID)
                        }
                    }
                }
            }
        }
        .navigationTitle("Reports")
        .expensesScreenStyle()
        .task {
            if model.categories == nil {
                await model.loadOrganizeData()
            }
        }
        .refreshable {
            await model.loadOrganizeData()
        }
        .sheet(item: $previewDocument) { document in
            DocumentPreviewView(url: document.url)
        }
    }

    private func sectionBinding(_ key: String) -> Binding<Bool> {
        Binding(
            get: { enabledSections.contains(key) },
            set: { enabled in
                if enabled {
                    enabledSections.insert(key)
                } else {
                    enabledSections.remove(key)
                }
            }
        )
    }

    private func categoryBinding(_ id: Int) -> Binding<Bool> {
        Binding(
            get: { selectedCategoryIDs.contains(id) },
            set: { selected in
                if selected {
                    selectedCategoryIDs.insert(id)
                } else {
                    selectedCategoryIDs.remove(id)
                }
            }
        )
    }

    private func generateReport() async {
        formError = nil
        statusText = nil
        guard startDate <= endDate else {
            formError = "End date must be after start date."
            return
        }
        guard !enabledSections.isEmpty else {
            formError = "Select at least one report section."
            return
        }

        let activeIDs = Set(activeCategories.map(\.id))
        let selectedActiveIDs = selectedCategoryIDs.intersection(activeIDs).sorted()
        if categoryMode == "selected", selectedActiveIDs.isEmpty {
            formError = "Select at least one category."
            return
        }
        let categoryIDs = categoryMode == "selected" && !selectedActiveIDs.isEmpty && selectedActiveIDs.count < activeIDs.count
            ? selectedActiveIDs
            : nil
        let request = ReportOptionsRequest(
            start: Self.dateString(startDate),
            end: Self.dateString(endDate),
            sections: reportSections.map(\.key).filter { enabledSections.contains($0) },
            includeCents: includeCents,
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : notes.trimmingCharacters(in: .whitespacesAndNewlines),
            transactionType: transactionType.isEmpty ? nil : transactionType,
            categoryIDs: categoryIDs,
            transactionsSort: showRunningBalance ? "oldest" : transactionsSort,
            showRunningBalance: showRunningBalance,
            includeCategorySubtotals: includeCategorySubtotals
        )

        guard let download = await model.generateReportPDF(request) else {
            return
        }
        store(download)
    }

    private func exportCSV() async {
        formError = nil
        statusText = nil
        guard let download = await model.exportUserCSV() else {
            return
        }
        store(download)
    }

    private func store(_ download: AttachmentDownload) {
        do {
            let url = try writeTemporaryFile(download)
            let document = PreviewDocument(url: url)
            lastDocument = document
            previewDocument = document
            shareURL = url
            statusText = download.filename
        } catch {
            formError = error.localizedDescription
        }
    }

    private func writeTemporaryFile(_ download: AttachmentDownload) throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ExpensesReports", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let filename = Self.safeFilename(download.filename, fallback: "expense_report.pdf")
        let url = directory.appendingPathComponent(filename)
        try download.data.write(to: url, options: .atomic)
        return url
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

    private static func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func monthStart() -> Date {
        let calendar = Calendar(identifier: .gregorian)
        let components = calendar.dateComponents([.year, .month], from: Date())
        return calendar.date(from: components) ?? Date()
    }

    private static func monthEnd() -> Date {
        let calendar = Calendar(identifier: .gregorian)
        let start = monthStart()
        let nextMonth = calendar.date(byAdding: .month, value: 1, to: start) ?? start
        return calendar.date(byAdding: .day, value: -1, to: nextMonth) ?? start
    }
}

#Preview {
    ReportsView()
        .environment(AppModel())
}
