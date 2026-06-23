import SwiftUI
import UniformTypeIdentifiers

struct ReconciliationView: View {
    @Environment(AppModel.self) private var model
    @State private var accountLabel = "Commerzbank"
    @State private var selectedFileURL: URL?
    @State private var preview: BankStatementPreviewResponse?
    @State private var importResult: BankStatementImportResponse?
    @State private var formError: String?
    @State private var presentingFileImporter = false
    @State private var presentingCommitConfirmation = false

    var body: some View {
        List {
            if model.identity?.authenticated != true {
                SignedOutStateSection()
            } else {
                importSection

                if let preview {
                    previewSection(preview)
                }

                if let importResult {
                    Section("Latest Import") {
                        LabeledContent("Imported", value: "\(importResult.importedCount)")
                        LabeledContent("Duplicates", value: "\(importResult.duplicateCount)")
                    }
                }

                if let reconciliation = model.reconciliation {
                    summarySection(reconciliation.summary)
                    bankRowsSection(reconciliation.rows)
                    onlyInExpensesSection(reconciliation.onlyInExpenses)
                } else if model.isLoading {
                    LoadingStateSection(title: "Loading reconciliation")
                } else {
                    ContentUnavailableView("No reconciliation data loaded", systemImage: "checklist")
                }

                if let formError {
                    Section("Import Error") {
                        Text(formError)
                            .foregroundStyle(.red)
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
        .navigationTitle("Reconcile")
        .expensesScreenStyle()
        .fileImporter(
            isPresented: $presentingFileImporter,
            allowedContentTypes: Self.csvTypes,
            allowsMultipleSelection: false
        ) { result in
            selectCSV(result)
        }
        .confirmationDialog("Import previewed rows?", isPresented: $presentingCommitConfirmation) {
            Button("Import Rows") {
                Task { await commitCSV() }
            }
            Button("Cancel", role: .cancel) {}
        }
        .onChange(of: accountLabel) { _, _ in
            clearPreview()
        }
        .onChange(of: selectedFileURL) { _, _ in
            clearPreview()
        }
        .task {
            await model.loadReconciliation()
        }
        .refreshable {
            await model.loadReconciliation()
        }
        .animation(.easeInOut(duration: 0.18), value: model.isLoading && model.reconciliation == nil)
    }

    private var importSection: some View {
        Section("Commerzbank CSV") {
            TextField("Account label", text: $accountLabel)
            Button {
                presentingFileImporter = true
            } label: {
                Label(selectedFileURL?.lastPathComponent ?? "Choose CSV", systemImage: "doc.badge.plus")
            }
            Button {
                Task { await previewCSV() }
            } label: {
                Label("Preview Import", systemImage: "eye")
            }
            .disabled(selectedFileURL == nil || model.isLoading)

            Button(role: .destructive) {
                presentingCommitConfirmation = true
            } label: {
                Label("Commit Import", systemImage: "tray.and.arrow.down")
            }
            .disabled(preview?.newCount ?? 0 == 0 || selectedFileURL == nil || model.isLoading)

            if model.isLoading {
                ProgressView()
            }
        }
    }

    private func previewSection(_ preview: BankStatementPreviewResponse) -> some View {
        Section("Preview") {
            LabeledContent("Account", value: preview.accountLabel)
            LabeledContent("New rows", value: "\(preview.newCount)")
            LabeledContent("Duplicates", value: "\(preview.duplicateCount)")
            if !preview.errors.isEmpty {
                ForEach(preview.errors, id: \.self) { error in
                    Text(error)
                        .foregroundStyle(.red)
                }
            }
            ForEach(preview.rows.prefix(8)) { row in
                PreviewRow(row: row)
            }
        }
    }

    private func summarySection(_ summary: BankReconciliationSummary) -> some View {
        Section("Status") {
            LabeledContent("Bank rows", value: "\(summary.rowCount)")
            LabeledContent("Unresolved", value: "\(summary.unresolvedCount)")
            LabeledContent("Suggested", value: "\(summary.suggestedCount)")
            LabeledContent("Matched", value: "\(summary.matchedCount)")
            LabeledContent("Reviewed", value: "\(summary.reviewedCount)")
            LabeledContent("Only in expenses", value: "\(summary.onlyInExpensesCount)")
            LabeledContent("Bank total", value: AppFormatters.euros(summary.bankTotalCents))
        }
    }

    private func bankRowsSection(_ rows: [BankStatementRow]) -> some View {
        Section("Bank Queue") {
            if rows.isEmpty {
                Text("No bank rows imported.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(rows) { row in
                    BankStatementRowCard(
                        row: row,
                        onAccept: { Task { await model.acceptBankRowSuggestion(row) } },
                        onCreateTransaction: { Task { await model.createTransactionFromBankRow(row) } },
                        onReview: { Task { await model.markBankRowReviewed(row) } },
                        onReopen: { Task { await model.reopenBankRow(row) } }
                    )
                }
            }
        }
    }

    private func onlyInExpensesSection(_ transactions: [BankReconciliationTransaction]) -> some View {
        Section("Only In Expenses") {
            if transactions.isEmpty {
                Text("No unmatched expense transactions.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(transactions) { transaction in
                    ReconciliationTransactionRow(transaction: transaction)
                }
            }
        }
    }

    private func selectCSV(_ result: Result<[URL], Error>) {
        formError = nil
        do {
            selectedFileURL = try result.get().first
        } catch {
            formError = error.localizedDescription
        }
    }

    private func previewCSV() async {
        guard let selectedFileURL else {
            formError = "Choose a CSV file first."
            return
        }
        formError = nil
        importResult = nil
        preview = await model.previewCommerzbankCSV(
            fileURL: selectedFileURL,
            accountLabel: cleanedAccountLabel
        )
    }

    private func commitCSV() async {
        guard let selectedFileURL else {
            formError = "Choose a CSV file first."
            return
        }
        formError = nil
        importResult = await model.commitCommerzbankCSV(
            fileURL: selectedFileURL,
            accountLabel: cleanedAccountLabel
        )
        if importResult != nil {
            preview = nil
        }
    }

    private func clearPreview() {
        preview = nil
        importResult = nil
    }

    private var cleanedAccountLabel: String {
        let label = accountLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        return label.isEmpty ? "Commerzbank" : label
    }

    private static let csvTypes: [UTType] = [
        .commaSeparatedText,
        .text,
        UTType(filenameExtension: "csv") ?? .commaSeparatedText,
    ]
}

private struct PreviewRow: View {
    let row: BankStatementPreviewRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(row.payee ?? row.bookingText ?? "Bank row")
                    .font(.body.weight(.medium))
                Spacer()
                Text(AppFormatters.euros(row.amountCents))
                    .font(.body.weight(.semibold))
            }
            Text("\(AppFormatters.day(row.bookingDate)) · \(row.currency)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(row.purpose ?? row.rawDescription)
                .font(.caption)
                .lineLimit(2)
                .foregroundStyle(.secondary)
            if row.duplicate {
                Label("Duplicate", systemImage: "doc.on.doc")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
    }
}

private struct BankStatementRowCard: View {
    let row: BankStatementRow
    var onAccept: () -> Void
    var onCreateTransaction: () -> Void
    var onReview: () -> Void
    var onReopen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.payee ?? row.bookingText ?? "Bank row")
                        .font(.body.weight(.medium))
                    Text("\(AppFormatters.day(row.bookingDate)) · \(row.accountLabel)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(AppFormatters.euros(row.amountCents))
                    .font(.body.weight(.semibold))
            }

            HStack {
                Text(statusLabel)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(statusColor.opacity(0.15), in: Capsule())
                    .foregroundStyle(statusColor)
                if row.candidateCount > 1 {
                    Text("\(row.candidateCount) candidates")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let purpose = row.purpose, !purpose.isEmpty {
                Text(purpose)
                    .font(.caption)
                    .lineLimit(2)
                    .foregroundStyle(.secondary)
            }

            if let suggestedTransaction = row.suggestedTransaction {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Suggested match")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ReconciliationTransactionRow(transaction: suggestedTransaction)
                    if suggestedTransaction.dateDeltaDays != 0 {
                        Text("\(abs(suggestedTransaction.dateDeltaDays)) day posting delay")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            actions
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private var actions: some View {
        if row.status == "reviewed" {
            Button {
                onReopen()
            } label: {
                Label("Reopen", systemImage: "arrow.uturn.backward")
            }
        } else {
            ControlGroup {
                if row.status == "suggested" {
                    Button {
                        onAccept()
                    } label: {
                        Label("Accept", systemImage: "checkmark")
                    }
                }
                if row.status != "matched" {
                    Button {
                        onCreateTransaction()
                    } label: {
                        Label("Create", systemImage: "plus")
                    }
                }
                Button {
                    onReview()
                } label: {
                    Label("Review", systemImage: "checkmark.seal")
                }
            }
        }
    }

    private var statusLabel: String {
        switch row.status {
        case "matched":
            "Matched"
        case "suggested":
            "Suggested"
        case "ambiguous":
            "Ambiguous"
        case "missing":
            "Missing"
        case "reviewed":
            "Reviewed"
        default:
            row.status.capitalized
        }
    }

    private var statusColor: Color {
        switch row.status {
        case "matched":
            .green
        case "suggested":
            .blue
        case "ambiguous":
            .orange
        case "missing":
            .red
        case "reviewed":
            .secondary
        default:
            .secondary
        }
    }
}

private struct ReconciliationTransactionRow: View {
    let transaction: BankReconciliationTransaction

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text(transaction.title ?? "Transaction #\(transaction.id)")
                    .font(.body)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(AppFormatters.euros(transaction.signedAmountCents))
                .font(.body.weight(.medium))
        }
    }

    private var detail: String {
        let category = transaction.category ?? "Uncategorized"
        return "\(AppFormatters.day(transaction.date)) · \(category)"
    }
}

#Preview {
    ReconciliationView()
        .environment(AppModel())
}
