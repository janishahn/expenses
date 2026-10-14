import SwiftUI
import UniformTypeIdentifiers

/// Choose an account and a Commerzbank CSV file, check the preview, then import the
/// new rows. A file with an invalid row imports nothing.
struct ImportStatementSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let accounts: [BankAccount]
    let onImported: () async -> Void

    @State private var choice: String
    @State private var newName = ""
    @State private var fileURL: URL?
    @State private var choosingFile = false
    @State private var preview: BankStatementPreviewResponse?
    @State private var reading = false
    @State private var importing = false
    @State private var nameError: String?
    @State private var fileError: String?
    @State private var error: String?

    private static let newAccount = "\u{0}new"
    private static let csvTypes: [UTType] = [.commaSeparatedText, .text, UTType(filenameExtension: "csv") ?? .commaSeparatedText]

    private struct PreviewInput: Hashable {
        let account: String
        let file: URL?
    }

    init(accounts: [BankAccount], onImported: @escaping () async -> Void) {
        self.accounts = accounts
        self.onImported = onImported
        let latest = accounts.max { ($0.lastImportAt ?? .distantPast) < ($1.lastImportAt ?? .distantPast) }
        _choice = State(initialValue: latest?.label ?? Self.newAccount)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Account", selection: $choice) {
                        ForEach(accounts) { account in
                            Text(account.label).tag(account.label)
                        }
                        Text("New Account…").tag(Self.newAccount)
                    }
                    if choice == Self.newAccount {
                        TextField("Name", text: $newName)
                            .fieldError(nameError)
                    }
                    Button {
                        choosingFile = true
                    } label: {
                        LabeledContent {
                            if reading {
                                ProgressView()
                            }
                        } label: {
                            Label(fileURL?.lastPathComponent ?? "Choose CSV file", systemImage: "doc")
                                .lineLimit(1)
                        }
                    }
                    .fieldError(fileError)
                }
                .expensesRowBackground()

                if let preview {
                    if preview.errors.isEmpty {
                        previewSections(preview)
                    } else {
                        Section("Problems") {
                            ForEach(preview.errors.prefix(5), id: \.self) { problem in
                                FieldError(problem)
                            }
                            if preview.errors.count > 5 {
                                Text("\(preview.errors.count - 5) more problem\(preview.errors.count == 6 ? "" : "s")")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .expensesRowBackground()
                    }
                }

                if let error {
                    Section {
                        FieldError(error)
                    }
                    .expensesRowBackground()
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .expensesScreenStyle()
            .navigationTitle("Import Statement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(importing ? "Importing…" : "Import", role: .confirm) {
                        Task { await commit() }
                    }
                    .disabled(importing)
                }
            }
            .fileImporter(isPresented: $choosingFile, allowedContentTypes: Self.csvTypes) { result in
                switch result {
                case let .success(url):
                    fileURL = url
                case let .failure(failure):
                    error = failure.localizedDescription
                }
            }
            .task(id: PreviewInput(account: accountLabel, file: fileURL)) {
                await readPreview()
            }
            .onChange(of: accountLabel) {
                nameError = nil
            }
            .onChange(of: fileURL) {
                fileError = nil
            }
        }
        .interactiveDismissDisabled(importing)
    }

    @ViewBuilder
    private func previewSections(_ preview: BankStatementPreviewResponse) -> some View {
        let days = preview.rows.map { AppFormatters.localDay($0.bookingDate) }
        Section {
            LabeledContent("Rows") {
                if let first = days.min(), let last = days.max() {
                    Text("\(preview.rows.count) · \(AppFormatters.shortDay(first)) – \(AppFormatters.shortDay(last))")
                } else {
                    Text("0")
                }
            }
            LabeledContent(
                "New",
                value: preview.duplicateCount > 0
                    ? "\(preview.newCount) · \(preview.duplicateCount) already imported"
                    : "\(preview.newCount)"
            )
        }
        .expensesRowBackground()

        let fresh = preview.rows.filter { !$0.duplicate }
        Section("New rows") {
            if fresh.isEmpty {
                Text("Every row in this file was imported before.")
                    .foregroundStyle(.secondary)
            }
            ForEach(fresh.prefix(3)) { row in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.title)
                            .lineLimit(1)
                        Text(AppFormatters.shortDay(AppFormatters.localDay(row.bookingDate)))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    BankAmount(cents: row.amountCents, currency: row.currency)
                }
            }
            if fresh.count > 3 {
                Text("\(fresh.count - 3) more row\(fresh.count == 4 ? "" : "s")")
                    .foregroundStyle(.secondary)
            }
        }
        .expensesRowBackground()
    }

    private var accountLabel: String {
        choice == Self.newAccount ? newName.trimmingCharacters(in: .whitespacesAndNewlines) : choice
    }

    // The preview follows the account and the file, since duplicates are found per account.
    private func readPreview() async {
        preview = nil
        error = nil
        guard let fileURL, !accountLabel.isEmpty else {
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else {
            return
        }
        reading = true
        let result = await model.previewCommerzbankCSV(fileURL: fileURL, accountLabel: accountLabel)
        reading = false
        guard !Task.isCancelled else {
            return
        }
        if let result {
            preview = result
        } else {
            error = model.lastError?.message ?? "Couldn't read this file."
        }
    }

    private func commit() async {
        nameError = accountLabel.isEmpty ? "Enter an account name." : nil
        fileError = fileURL == nil ? "Choose a CSV file." : nil
        guard nameError == nil, let fileURL, let preview else {
            return
        }
        if !preview.errors.isEmpty {
            fileError = "This file can't be imported."
            return
        }
        if preview.newCount == 0 {
            fileError = "No new rows to import."
            return
        }
        importing = true
        defer { importing = false }
        guard await model.commitCommerzbankCSV(fileURL: fileURL, accountLabel: accountLabel) != nil else {
            error = model.lastError?.message ?? "Couldn't import this file."
            return
        }
        dismiss()
        await onImported()
    }
}

/// The add sheet filled from a bank row. The amount and type come from the row.
struct CreateFromBankRowSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let row: BankStatementRow
    let onCreated: () async -> Void

    @State private var title: String
    @State private var date: Date
    @State private var categoryID: Int?
    @State private var tags: [String] = []
    @State private var notes: String
    @State private var receipt: ReceiptUpload?
    @State private var receiptSource: ReceiptSource?
    @State private var choosingDate = false
    @State private var picker: Choice?
    @State private var titleError: String?
    @State private var formError: String?
    @State private var pending = false
    // The created transaction whose receipt didn't upload; the receipt stays to try again.
    @State private var failedReceipt: (transactionID: Int, message: String)?

    private enum Choice: Identifiable {
        case category
        case tags

        var id: Self { self }
    }

    init(row: BankStatementRow, onCreated: @escaping () async -> Void) {
        self.row = row
        self.onCreated = onCreated
        _title = State(initialValue: row.title)
        _date = State(initialValue: AppFormatters.localDay(row.valueDate ?? row.bookingDate))
        _notes = State(initialValue: row.purpose ?? row.rawDescription)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    BankAmount(cents: row.amountCents, currency: row.currency)
                        .font(.system(size: 34, weight: .semibold))

                    TextField("Title", text: $title)
                        .font(.title3)
                        .fieldError(titleError)

                    ChipFlow {
                        Button {
                            choosingDate = true
                        } label: {
                            EntryChip(AppFormatters.shortDay(date), systemImage: "calendar", isSet: true)
                        }
                        .popover(isPresented: $choosingDate) {
                            DatePicker("Date", selection: $date, displayedComponents: .date)
                                .datePickerStyle(.graphical)
                                .labelsHidden()
                                .padding()
                                .frame(width: 340)
                                .presentationCompactAdaptation(.popover)
                        }

                        Button {
                            picker = .category
                        } label: {
                            if let category {
                                EntryChip(category.name, isSet: true) {
                                    CategoryGlyph(categoryID: category.id, iconKey: category.icon, name: category.name)
                                        .frame(width: 18)
                                }
                            } else {
                                EntryChip("Category", systemImage: "square.grid.2x2", isSet: false)
                            }
                        }

                        Button {
                            picker = .tags
                        } label: {
                            EntryChip(tags.isEmpty ? "Tags" : tags.joined(separator: ", "), systemImage: "tag", isSet: !tags.isEmpty)
                        }

                        Menu {
                            ReceiptSourceButtons { receiptSource = $0 }
                            if receipt != nil {
                                Button("Remove Receipt", systemImage: "trash", role: .destructive) {
                                    receipt = nil
                                }
                            }
                        } label: {
                            EntryChip(receipt?.name ?? "Receipt", systemImage: "paperclip", isSet: receipt != nil)
                        }
                    }
                    .buttonStyle(.plain)

                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(2...6)

                    if let formError {
                        FieldError(formError)
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(ExpensesTheme.surface(for: scheme))
            .navigationTitle("Create Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create", role: .confirm) {
                        Task { await submit() }
                    }
                    .disabled(pending)
                }
            }
            .sheet(item: $picker) { picker in
                switch picker {
                case .category:
                    CategoryPickerSheet(
                        title: "Category",
                        categories: model.activeKnownCategories.filter { ($0.type ?? "expense") == row.kind.rawValue },
                        selectedID: categoryID,
                        onSelectNone: { categoryID = nil }
                    ) { category in
                        categoryID = category.id
                    }
                case .tags:
                    TagPickerSheet(title: "Tags", options: model.activeTags.map(\.name), selected: tags) { tags = $0 }
                }
            }
            .receiptPicker($receiptSource) { picked in
                receipt = picked
            } onFailure: { message in
                formError = message
            }
            .alert(
                "Couldn't upload the receipt",
                isPresented: Binding(get: { failedReceipt != nil }, set: { if !$0 { failedReceipt = nil } }),
                presenting: failedReceipt
            ) { failed in
                Button("Discard Receipt", role: .destructive) {
                    Task { await finish() }
                }
                Button("Try Again") {
                    Task { await uploadReceipt(to: failed.transactionID) }
                }
            } message: { failed in
                Text("The transaction was created. \(failed.message)")
            }
        }
        .interactiveDismissDisabled(pending)
        .task {
            await model.loadOrganizeData()
        }
    }

    private var category: CategorySummary? {
        model.knownCategories.first { $0.id == categoryID }
    }

    private func submit() async {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        titleError = trimmedTitle.isEmpty ? "Enter a title." : nil
        guard titleError == nil else {
            return
        }
        pending = true
        defer { pending = false }
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let tagIDs = (model.tags?.tags ?? [])
            .filter { tag in tags.contains { $0.caseInsensitiveCompare(tag.name) == .orderedSame } }
            .map(\.id)
        let body = BankTransactionCreateRequest(
            date: AppFormatters.isoDay(date),
            categoryID: categoryID,
            title: trimmedTitle,
            description: trimmedNotes.isEmpty ? nil : trimmedNotes,
            tagIDs: tagIDs
        )
        guard let id = await model.createTransactionFromBankRow(row, body: body) else {
            formError = model.lastError?.message ?? "Couldn't create the transaction."
            return
        }
        if receipt != nil {
            await uploadReceipt(to: id)
        } else {
            await finish()
        }
    }

    private func uploadReceipt(to transactionID: Int) async {
        guard let receipt else {
            return
        }
        pending = true
        defer { pending = false }
        if await model.uploadReceipt(receipt, transactionID: transactionID) {
            await finish()
        } else {
            failedReceipt = (transactionID, model.lastError?.message ?? "")
        }
    }

    private func finish() async {
        dismiss()
        await onCreated()
    }
}
