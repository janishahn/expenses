import SwiftUI

/// Known account balances. They set the balances that Dashboard and Forecast show.
struct BalanceSnapshotsView: View {
    @Environment(AppModel.self) private var model

    @State private var editing: Editing?
    @State private var loadError: String?

    private enum Editing: Identifiable {
        case new
        case anchor(BalanceAnchor)

        var id: String {
            switch self {
            case .new:
                "new"
            case let .anchor(anchor):
                "anchor-\(anchor.id)"
            }
        }
    }

    var body: some View {
        List {
            if let settings = model.settings {
                Section {
                    LabeledContent("Current balance") {
                        AmountText(settings.currentBalance)
                            .foregroundStyle(.primary)
                    }
                }
                .expensesRowBackground()

                if settings.balanceAnchors.isEmpty {
                    UnavailableStateSection(title: "No balance snapshots", systemImage: "scalemass")
                } else {
                    Section {
                        ForEach(settings.balanceAnchors) { anchor in
                            Button {
                                editing = .anchor(anchor)
                            } label: {
                                TrailingRow {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(AppFormatters.dateTime(anchor.asOfAt))
                                        if let note = anchor.note, !note.isEmpty {
                                            Text(note)
                                                .font(.subheadline)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                } trailing: {
                                    AmountText(anchor.balanceCents)
                                }
                                .contentShape(Rectangle())
                            }
                            .tint(.primary)
                        }
                    }
                    .expensesRowBackground()
                }
            } else if let loadError {
                UnavailableStateSection(title: "Couldn't load balance snapshots", systemImage: "exclamationmark.triangle", message: loadError) {
                    await load()
                }
            } else {
                LoadingStateSection(title: "Loading balance snapshots")
            }
        }
        .refreshable {
            await load()
        }
        .navigationTitle("Balance Snapshots")
        .expensesScreenStyle()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Add snapshot", systemImage: "plus") {
                    editing = .new
                }
            }
        }
        .sheet(item: $editing) { editing in
            switch editing {
            case .new:
                SnapshotSheet(anchor: nil)
            case let .anchor(anchor):
                SnapshotSheet(anchor: anchor)
            }
        }
        .task {
            await load()
        }
    }

    private func load() async {
        await model.loadAccountSettings()
        loadError = model.settings == nil ? model.lastError?.message ?? "The server didn't respond." : nil
    }
}

private struct SnapshotSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let anchor: BalanceAnchor?

    @State private var asOf: Date
    @State private var balance: String
    @State private var note: String
    @State private var choosingDate = false
    @State private var balanceError: String?
    @State private var formError: String?
    @State private var saving = false
    @State private var deleting = false
    @FocusState private var balanceFocused: Bool

    init(anchor: BalanceAnchor?) {
        self.anchor = anchor
        _asOf = State(initialValue: anchor?.asOfAt ?? .now)
        _balance = State(initialValue: anchor.map { Self.balanceInput($0.balanceCents) } ?? "")
        _note = State(initialValue: anchor?.note ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    EntryAmountField(text: $balance, income: false, keyboard: .numbersAndPunctuation)
                        .focused($balanceFocused)
                        .fieldError(balanceError)

                    ChipFlow {
                        Button {
                            choosingDate = true
                        } label: {
                            EntryChip(AppFormatters.dateTime(asOf), systemImage: "calendar", isSet: true)
                        }
                        .buttonStyle(.plain)
                        .popover(isPresented: $choosingDate) {
                            DatePicker("As of", selection: $asOf)
                                .datePickerStyle(.graphical)
                                .labelsHidden()
                                .padding()
                                .frame(width: 340)
                                .presentationCompactAdaptation(.popover)
                        }
                        .accessibilityLabel("As of")
                        .accessibilityValue(AppFormatters.dateTime(asOf))
                    }

                    TextField("Note", text: $note, axis: .vertical)

                    if let formError {
                        FieldError(formError)
                    }

                    if anchor != nil {
                        Button("Delete snapshot", role: .destructive) {
                            deleting = true
                        }
                        .disabled(saving)
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(ExpensesTheme.surface(for: scheme))
            .navigationTitle(anchor == nil ? "New Snapshot" : "Edit Snapshot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    DiscardButton(hasChanges: hasChanges)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(anchor == nil ? "Add" : "Save", role: .confirm) {
                        Task { await submit() }
                    }
                    .disabled(saving)
                }
            }
            .alert("Delete this balance snapshot?", isPresented: $deleting) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    Task { await delete() }
                }
            }
        }
        .interactiveDismissDisabled(hasChanges || saving)
        .task {
            if anchor == nil {
                balanceFocused = true
            }
        }
    }

    // A new snapshot's date is a default, so it alone is no input to lose.
    private var hasChanges: Bool {
        balance != (anchor.map { Self.balanceInput($0.balanceCents) } ?? "") || note != (anchor?.note ?? "")
            || anchor.map { asOf != $0.asOfAt } == true
    }

    /// "1234,56" or "-1234,56"; a balance can be overdrawn.
    private static func balanceInput(_ cents: Int) -> String {
        (cents < 0 ? "-" : "") + AppFormatters.amountInput(abs(cents))
    }

    private func submit() async {
        let trimmed = balance.trimmingCharacters(in: .whitespaces)
        let negative = trimmed.hasPrefix("-") || trimmed.hasPrefix("−")
        let cents = AppFormatters.parseAmountCents(negative ? String(trimmed.dropFirst()) : trimmed).map { negative ? -$0 : $0 }
        balanceError = cents == nil ? "Enter a valid balance." : nil
        formError = nil
        guard let cents else {
            return
        }
        saving = true
        defer { saving = false }
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let request = BalanceAnchorRequest(
            asOfAt: AppFormatters.isoDateTime(asOf),
            balanceCents: cents,
            note: trimmedNote.isEmpty ? nil : trimmedNote
        )
        if await model.saveBalanceAnchor(id: anchor?.id, body: request) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Couldn't save the snapshot."
        }
    }

    private func delete() async {
        guard let anchor else {
            return
        }
        formError = nil
        saving = true
        defer { saving = false }
        if await model.deleteBalanceAnchor(anchor) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Couldn't delete the snapshot."
        }
    }
}
