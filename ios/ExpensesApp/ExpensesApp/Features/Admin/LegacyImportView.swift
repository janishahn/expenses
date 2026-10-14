import SwiftUI

/// A database from the earlier app: read, mapped to categories, then imported.
struct LegacyImportView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    @State private var choosingFile = false
    @State private var fileName: String?
    @State private var preview: LegacySQLitePreviewResponse?
    @State private var reading = false
    @State private var importing = false
    @State private var confirmingImport = false
    @State private var error: String?
    @State private var imported: String?
    @State private var importRecurringRules = true
    @State private var recurringAutoPost = false
    @State private var linkRecurringTransactions = true
    @State private var preserveTimeInTitle = false
    // "discard", "create", or "existing:<category id>" for each mapping row.
    @State private var mapping: [Int: String] = [:]

    var body: some View {
        List {
            Section("Database") {
                Button {
                    choosingFile = true
                } label: {
                    HStack {
                        Label(fileName ?? "Choose database file", systemImage: "doc.badge.plus")
                        Spacer()
                        if reading {
                            ProgressView()
                        }
                    }
                }
                .disabled(reading || importing)
                if let error {
                    FieldError(error)
                }
                if let imported {
                    Label {
                        Text(imported)
                    } icon: {
                        Image(systemName: "checkmark.circle")
                            .foregroundStyle(ExpensesTheme.income(for: scheme))
                    }
                }
            }
            .expensesRowBackground()

            if let preview {
                previewSections(preview)
            }
        }
        .navigationTitle("Legacy SQLite Import")
        .expensesScreenStyle()
        .toolbar {
            if preview != nil {
                ToolbarItem(placement: .confirmationAction) {
                    Button(importing ? "Importing…" : "Import") {
                        confirmingImport = true
                    }
                    .disabled(importing)
                }
            }
        }
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.data]) { result in
            switch result {
            case let .success(url):
                Task { await read(url) }
            case let .failure(failure):
                error = failure.localizedDescription
            }
        }
        .alert(importTitle, isPresented: $confirmingImport) {
            Button("Cancel", role: .cancel) {}
            Button("Import") {
                Task { await commit() }
            }
        } message: {
            Text("Running the import again can duplicate one-time transactions.")
        }
    }

    @ViewBuilder
    private func previewSections(_ preview: LegacySQLitePreviewResponse) -> some View {
        let data = preview.preview
        Section {
            Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 16) {
                GridRow {
                    Metric("Transactions") {
                        Text(data.transactionsCount.formatted())
                    } detail: {
                        if data.nonMidnightTransactionTimes > 0 {
                            Text("\(data.nonMidnightTransactionTimes.formatted()) with a time of day")
                        }
                    }
                    Metric("Recurring rules") {
                        Text(data.recurringCount.formatted())
                    } detail: {}
                }
                GridRow {
                    Metric("Dates") {
                        Text(data.minTransactionDate.map(day) ?? "None")
                    } detail: {
                        if let last = data.maxTransactionDate, last != data.minTransactionDate {
                            Text("to \(day(last))")
                        }
                    }
                    Metric("Categories") {
                        Text(data.mappingRows.count.formatted())
                    } detail: {}
                }
            }
            .monospacedDigit()
            .padding(.vertical, 6)
        }
        .expensesRowBackground()

        if !data.warnings.isEmpty {
            Section("Warnings") {
                ForEach(data.warnings, id: \.self) { warning in
                    Label(warning, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(ExpensesTheme.expense(for: scheme))
                }
            }
            .expensesRowBackground()
        }

        Section("Options") {
            Toggle("Import recurring rules", isOn: $importRecurringRules)
            Toggle("Post imported rules automatically", isOn: $recurringAutoPost)
                .disabled(!importRecurringRules)
            Toggle("Link “(Recurring)” transactions to rules", isOn: $linkRecurringTransactions)
                .disabled(!importRecurringRules)
            Toggle("Add the time of day to titles", isOn: $preserveTimeInTitle)
        }
        .expensesRowBackground()

        Section("Category mapping") {
            ForEach(data.mappingRows) { row in
                Picker(selection: binding(row)) {
                    Text("Discard all").tag("discard")
                    Text("Create “\(row.legacyCategory)”").tag("create")
                    ForEach(preview.categories.filter { $0.type == row.legacyType }) { category in
                        Text(category.id == row.suggestedCategoryID ? "\(category.name) (suggested)" : category.name)
                            .tag("existing:\(category.id)")
                    }
                } label: {
                    Text(row.legacyCategory)
                    Text("\(row.legacyType == "income" ? "Income" : "Expense") · \(row.transactionCount == 1 ? "1 transaction" : "\(row.transactionCount) transactions")")
                } currentValueLabel: {
                    Text(target(row, in: preview.categories))
                }
                .pickerStyle(.menu)
            }
        }
        .expensesRowBackground()

        if !data.recurringRows.isEmpty {
            Section("Recurring rules") {
                ForEach(data.recurringRows) { row in
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.description)
                            Text(recurringDetail(row))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        AmountText(row.amountCents, signed: row.legacyType == "income")
                            .foregroundStyle(row.legacyType == "income" ? ExpensesTheme.income(for: scheme) : .primary)
                            .fixedSize()
                    }
                }
            }
            .expensesRowBackground()
        }
    }

    // The row's target, short enough to sit beside the category name.
    private func target(_ row: LegacySQLiteMappingRow, in categories: [LegacySQLiteCategory]) -> String {
        switch mapping[row.idx] ?? "create" {
        case "discard":
            "Discard"
        case "create":
            "New category"
        case let value:
            categories.first { "existing:\($0.id)" == value }?.name ?? "New category"
        }
    }

    private var importTitle: String {
        let count = preview?.preview.transactionsCount ?? 0
        return count == 1 ? "Import 1 transaction?" : "Import \(count.formatted()) transactions?"
    }

    private func binding(_ row: LegacySQLiteMappingRow) -> Binding<String> {
        Binding(get: { mapping[row.idx] ?? "create" }, set: { mapping[row.idx] = $0 })
    }

    // Days decode as UTC midnight.
    private func day(_ date: Date) -> String {
        AppFormatters.shortDay(AppFormatters.localDay(date))
    }

    private func recurringDetail(_ row: LegacySQLiteRecurringRow) -> String {
        let repeats = row.interval == 1 ? row.recurrenceType : "\(row.recurrenceType) / \(row.interval)"
        let next = row.computedNextOccurrence.map { "next \(day($0))" }
        return [row.legacyCategory, repeats, next].compactMap { $0 }.joined(separator: " · ")
    }

    private func read(_ url: URL) async {
        error = nil
        imported = nil
        preview = nil
        fileName = url.lastPathComponent
        reading = true
        defer { reading = false }
        guard let loaded = await model.previewLegacySQLite(fileURL: url) else {
            error = model.lastError?.message ?? "Couldn't read the database."
            return
        }
        importRecurringRules = loaded.preview.recurringCount > 0
        recurringAutoPost = false
        linkRecurringTransactions = true
        preserveTimeInTitle = loaded.preview.nonMidnightTransactionTimes > 0
        mapping = Dictionary(uniqueKeysWithValues: loaded.preview.mappingRows.map { row in
            (row.idx, row.suggestedCategoryID.map { "existing:\($0)" } ?? "create")
        })
        preview = loaded
    }

    private func commit() async {
        guard let preview else {
            return
        }
        error = nil
        importing = true
        defer { importing = false }
        let request = LegacySQLiteCommitRequest(
            token: preview.token,
            options: LegacySQLiteImportOptions(
                importRecurringRules: importRecurringRules,
                recurringAutoPost: recurringAutoPost,
                linkRecurringTransactions: linkRecurringTransactions,
                preserveTimeInTitle: preserveTimeInTitle
            ),
            mappingTargets: preview.preview.mappingRows.map { row in
                let value = mapping[row.idx] ?? "create"
                let existingID = value.hasPrefix("existing:") ? Int(value.dropFirst("existing:".count)) : nil
                return LegacySQLiteMappingTarget(
                    legacyType: row.legacyType,
                    legacyCategory: row.legacyCategory,
                    target: existingID != nil ? "existing" : value,
                    existingCategoryID: existingID
                )
            }
        )
        guard let response = await model.commitLegacySQLite(request) else {
            error = model.lastError?.message ?? "Couldn't import the database."
            return
        }
        let counts = response.result
            .sorted { $0.key < $1.key }
            .map { "\($0.key.replacingOccurrences(of: "_", with: " ")): \($0.value)" }
        imported = counts.isEmpty ? "Import completed" : "Imported. \(counts.joined(separator: " · "))"
        fileName = nil
        self.preview = nil
    }
}
