import SwiftUI

/// One bank row. An open row lists its candidates and searches every transaction;
/// picking one with another amount offers to set it to the bank amount.
struct BankRowView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let row: BankStatementRow
    let resolved: Bool
    let onChange: () async -> Void

    @State private var selected: BankReconciliationTransaction?
    @State private var search = ""
    @State private var found: [BankReconciliationTransaction]?
    @State private var setAmount = true
    @State private var selectionError: String?
    @State private var prompt: BankRowPrompt?
    @State private var failure: String?
    @State private var pending = false

    init(row: BankStatementRow, resolved: Bool, onChange: @escaping () async -> Void) {
        self.row = row
        self.resolved = resolved
        self.onChange = onChange
        _selected = State(initialValue: row.status == .suggested ? row.candidates.first : nil)
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(row.title)
                        .font(.title2.weight(.semibold))
                    BankAmount(cents: row.amountCents, currency: row.currency)
                        .font(.largeTitle.weight(.semibold))
                }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))

            Section {
                LabeledContent("Booked", value: AppFormatters.day(AppFormatters.localDay(row.bookingDate)))
                LabeledContent("Account", value: row.accountLabel)
                if resolved, let resolution = row.resolution {
                    LabeledContent("Outcome", value: resolution.title)
                    if resolution == .ignored {
                        LabeledContent("Reason", value: row.ignoreReason ?? "None")
                    }
                    if let resolvedAt = row.resolvedAt {
                        LabeledContent("Resolved", value: AppFormatters.day(resolvedAt))
                    }
                }
            }
            .expensesRowBackground()

            if resolved, row.resolution != .ignored, let transaction = row.suggestedTransaction {
                Section("Transaction") {
                    NavigationLink {
                        TransactionDetailView(transactionID: transaction.id)
                    } label: {
                        candidateLabel(transaction)
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                }
                .expensesRowBackground()
            }

            Section("Purpose") {
                Text(row.purpose ?? row.rawDescription)
                    .textSelection(.enabled)
            }
            .expensesRowBackground()

            if !resolved {
                matchSection
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .modifier(CandidateSearch(enabled: !resolved, text: $search, prompt: row.candidates.isEmpty ? "Find a transaction" : "Find another transaction"))
        .toolbar {
            if resolved {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Reopen") {
                        if row.resolution == .created {
                            prompt = .reopen(row)
                        } else {
                            Task { await run { await model.reopenBankRow(row, trashCreatedTransaction: false) } }
                        }
                    }
                    .disabled(pending)
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if matchIsPrimary {
                            Button("Create Transaction…", systemImage: "plus.circle") {
                                prompt = .create(row)
                            }
                        }
                        BankRowIgnoreMenu { reason in
                            Task { await run { await model.ignoreBankRow(row, reason: reason) } }
                        } otherReason: {
                            prompt = .ignore(row)
                        }
                    } label: {
                        Label("More actions", systemImage: "ellipsis")
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if matchIsPrimary {
                        Button("Match") {
                            Task { await match() }
                        }
                        .disabled(pending)
                    } else {
                        Button("Create…") {
                            prompt = .create(row)
                        }
                    }
                }
            }
        }
        .task(id: search) {
            await findCandidates()
        }
        .onChange(of: selected) {
            selectionError = nil
            setAmount = true
        }
        .bankRowPrompt($prompt, failure: $failure) {
            await onChange()
            dismiss()
        }
        .failureAlert("Couldn't update the bank row", message: $failure)
    }

    private var matchSection: some View {
        Section {
            if listed.isEmpty, found == nil {
                Text("No transaction with this amount within 5 days")
                    .foregroundStyle(.secondary)
            }
            ForEach(listed) { candidate in
                SelectableRow(isSelected: selected?.id == candidate.id) {
                    selected = candidate
                } label: {
                    candidateLabel(candidate)
                }
            }
            if found?.isEmpty == true {
                Text("No matching transactions")
                    .foregroundStyle(.secondary)
            }
            if let selected, canSetAmount {
                Toggle(isOn: $setAmount) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Set to bank amount")
                        HStack(spacing: 4) {
                            Text("Was")
                            AmountText(selected.amountCents)
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    }
                }
            }
            if let selectionError {
                FieldError(selectionError)
            }
        } header: {
            Text("Match")
        }
        .expensesRowBackground()
        .sensoryFeedback(.selection, trigger: selected)
    }

    private func candidateLabel(_ transaction: BankReconciliationTransaction) -> some View {
        LedgerRow(
            title: transaction.displayTitle,
            detail: "\(AppFormatters.shortDay(AppFormatters.localDay(transaction.date))) · \(transaction.dayDistance)",
            categoryID: transaction.categoryID,
            iconKey: transaction.categoryIcon,
            categoryName: transaction.category,
            amountCents: transaction.amountCents,
            income: transaction.type == .income
        )
    }

    // The candidates, then search results; a chosen result stays listed while the search changes.
    private var listed: [BankReconciliationTransaction] {
        var listed = row.candidates + (found ?? [])
        if let selected, !listed.contains(where: { $0.id == selected.id }) {
            listed.insert(selected, at: 0)
        }
        return listed
    }

    private var matchIsPrimary: Bool {
        !row.candidates.isEmpty || selected != nil
    }

    // Transactions are kept in euros, so only a euro statement amount can replace theirs.
    private var canSetAmount: Bool {
        guard let selected else {
            return false
        }
        return selected.amountCents != abs(row.amountCents) && selected.type == row.kind && row.currency == "EUR"
    }

    private func findCandidates() async {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            found = nil
            return
        }
        try? await Task.sleep(for: .milliseconds(250))
        let rowID = row.id
        let result = await model.chart { try await $0.bankRowCandidates(rowID: rowID, query: query, token: $1) }
        guard !Task.isCancelled else {
            return
        }
        switch result {
        case let .success(items):
            found = items.filter { item in !row.candidates.contains { $0.id == item.id } }
        case let .failure(error):
            failure = error.message
        }
    }

    private func match() async {
        guard let selected else {
            selectionError = "Choose a transaction."
            return
        }
        await run { await model.matchBankRow(row, transactionID: selected.id, updateAmountToBank: canSetAmount && setAmount) }
    }

    private func run(_ action: () async -> Bool) async {
        pending = true
        defer { pending = false }
        if await action() {
            await onChange()
            dismiss()
        } else {
            failure = model.lastError?.message ?? "The bank row could not be updated."
        }
    }
}

// Search belongs to an open row only.
private struct CandidateSearch: ViewModifier {
    let enabled: Bool
    @Binding var text: String
    let prompt: String

    func body(content: Content) -> some View {
        if enabled {
            content.searchable(text: $text, prompt: prompt)
        } else {
            content
        }
    }
}
