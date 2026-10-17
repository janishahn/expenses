import CoreLocation
import SwiftUI

/// Adds a transaction: amount and title first, everything else as chips.
struct AddTransactionSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var type = TransactionKind.expense
    @State private var occurredAt = Date()
    @State private var amount = ""
    @State private var title = ""
    @State private var categoryID: Int?
    @State private var explicitTags: [String] = []
    @State private var excludedScheduledTags: [String] = []
    @State private var isReimbursement = false
    @State private var notes = ""
    @State private var receipt: ReceiptUpload?
    @State private var receiptSource: ReceiptSource?
    @State private var coordinate: CLLocationCoordinate2D?
    @State private var locating = false
    @State private var locationProvider = LocationProvider()
    @State private var amountError: String?
    @State private var titleError: String?
    @State private var formError: String?
    @State private var tagsLoaded = false
    @State private var pending = false
    @State private var added = 0
    // The added transaction whose receipt didn't upload; the receipt stays to try again.
    @State private var failedReceipt: (transactionID: Int, message: String)?
    @State private var choosingDate = false
    @State private var picker: Choice?
    @FocusState private var focus: Focus?

    private enum Focus {
        case amount
        case title
        case notes
    }

    private enum Choice: Identifiable {
        case category
        case tags

        var id: Self { self }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let templates = model.templates?.templates, !templates.isEmpty {
                        ScrollView(.horizontal) {
                            HStack(spacing: 8) {
                                ForEach(templates) { template in
                                    Button {
                                        apply(template)
                                    } label: {
                                        EntryChip(template.name, isSet: false) {
                                            CategoryGlyph(
                                                categoryID: template.categoryID,
                                                iconKey: template.category?.icon,
                                                name: template.category?.name ?? template.name
                                            )
                                            .glyphColumn(18)
                                        }
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        .scrollIndicators(.hidden)
                        .scrollClipDisabled()
                    }

                    EntryAmountField(text: $amount, income: type == .income)
                        .focused($focus, equals: .amount)
                        .fieldError(amountError)

                    TextField("Title", text: $title)
                        .font(.title3)
                        .focused($focus, equals: .title)
                        .submitLabel(.next)
                        .onSubmit {
                            focus = .notes
                        }
                        .fieldError(titleError)

                    ChipFlow {
                        Button {
                            choosingDate = true
                        } label: {
                            EntryChip(AppFormatters.occurred(occurredAt), systemImage: "calendar", isSet: true)
                        }
                        .accessibilityLabel("Date")
                        .accessibilityValue(AppFormatters.occurred(occurredAt))
                        .popover(isPresented: $choosingDate) {
                            DatePicker("Date", selection: $occurredAt)
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
                                        .glyphColumn(18)
                                }
                            } else {
                                EntryChip("Category", systemImage: "square.on.circle", isSet: false)
                            }
                        }
                        .accessibilityLabel("Category")
                        .accessibilityValue(category?.name ?? "")

                        Button {
                            picker = .tags
                        } label: {
                            EntryChip(tags.isEmpty ? "Tags" : tags.joined(separator: ", "), systemImage: "tag", isSet: !tags.isEmpty)
                        }
                        .accessibilityLabel("Tags")
                        .accessibilityValue(tags.joined(separator: ", "))

                        if type == .income {
                            Button {
                                isReimbursement.toggle()
                            } label: {
                                EntryChip("Reimbursement", systemImage: "arrow.uturn.backward", isSet: isReimbursement)
                            }
                            .accessibilityAddTraits(isReimbursement ? .isSelected : [])
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
                        .accessibilityLabel("Receipt")
                        .accessibilityValue(receipt?.name ?? "")

                        Button {
                            if coordinate == nil {
                                Task { await locate() }
                            } else {
                                coordinate = nil
                            }
                        } label: {
                            EntryChip(
                                locating ? "Locating…" : "Location",
                                systemImage: coordinate == nil ? "location" : "location.fill",
                                isSet: coordinate != nil
                            )
                        }
                        .disabled(locating)
                        .accessibilityAddTraits(coordinate != nil ? .isSelected : [])
                    }
                    .buttonStyle(.plain)

                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(2...6)
                        .focused($focus, equals: .notes)

                    if let formError {
                        FieldError(formError)
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(ExpensesTheme.surface(for: scheme))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    DiscardButton(hasChanges: hasInput)
                }
                ToolbarItem(placement: .principal) {
                    Picker("Type", selection: typeSelection) {
                        Text("Expense").tag(TransactionKind.expense)
                        Text("Income").tag(TransactionKind.income)
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", role: .confirm) {
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
                        categories: model.activeKnownCategories.filter { ($0.type ?? "expense") == type.rawValue },
                        selectedID: categoryID,
                        onSelectNone: { categoryID = nil }
                    ) { category in
                        categoryID = category.id
                    }
                case .tags:
                    TagPickerSheet(title: "Tags", options: model.activeTags.map(\.name), selected: tags, onApply: changeTags)
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
                    dismiss()
                }
                Button("Try Again") {
                    Task { await uploadReceipt(to: failed.transactionID) }
                }
            } message: { failed in
                Text("The transaction was added. \(failed.message)")
            }
            .sensoryFeedback(.success, trigger: added)
        }
        .interactiveDismissDisabled(hasInput || pending)
        .task {
            focus = .amount
            tagsLoaded = await model.loadOrganizeData()
        }
    }

    // Changing the direction clears the category, which belongs to one direction.
    private var typeSelection: Binding<TransactionKind> {
        Binding(
            get: { type },
            set: { next in
                type = next
                categoryID = nil
                if next == .expense {
                    isReimbursement = false
                }
            }
        )
    }

    // The date and direction are defaults, so they alone are no input to lose.
    private var hasInput: Bool {
        !amount.isEmpty || !title.isEmpty || !notes.isEmpty || categoryID != nil || !explicitTags.isEmpty
            || isReimbursement || receipt != nil || coordinate != nil
    }

    private var category: CategorySummary? {
        model.knownCategories.first { $0.id == categoryID }
    }

    // Tags scheduled for the chosen day join automatically unless removed.
    private var scheduledTags: [String] {
        let day = AppFormatters.isoDay(occurredAt)
        return model.activeTags.compactMap { tag in
            guard let period = tag.autoAttachPeriod, period.start <= day, period.end >= day else {
                return nil
            }
            return tag.name
        }
    }

    private var tags: [String] {
        var tags = explicitTags.filter { !Self.contains(excludedScheduledTags, $0) }
        for name in scheduledTags where !Self.contains(excludedScheduledTags, name) && !Self.contains(tags, name) {
            tags.append(name)
        }
        return tags
    }

    private func changeTags(_ next: [String]) {
        let current = tags
        let removed = current.filter { !Self.contains(next, $0) }
        let added = next.filter { !Self.contains(current, $0) }
        explicitTags = explicitTags.filter { !Self.contains(removed, $0) } + added.filter { !Self.contains(explicitTags, $0) }
        excludedScheduledTags = excludedScheduledTags.filter { !Self.contains(added, $0) }
            + removed.filter { Self.contains(scheduledTags, $0) }
    }

    private static func contains(_ names: [String], _ name: String) -> Bool {
        names.contains { $0.caseInsensitiveCompare(name) == .orderedSame }
    }

    private func apply(_ template: TemplateRow) {
        type = template.type
        categoryID = template.categoryID
        title = template.title ?? ""
        notes = ""
        explicitTags = template.tags
        amountError = nil
        titleError = nil
        formError = nil
        if type != .income {
            isReimbursement = false
        }
        amount = template.defaultAmountCents.map(AppFormatters.amountInput) ?? ""
        focus = .amount
    }

    private func locate() async {
        locating = true
        defer { locating = false }
        do {
            coordinate = try await locationProvider.currentCoordinate()
        } catch {
            formError = error.localizedDescription
        }
    }

    private func submit() async {
        let cents = AppFormatters.parseAmountCents(amount)
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        amountError = amount.trimmingCharacters(in: .whitespaces).isEmpty
            ? "Enter an amount."
            : cents == nil ? "Enter a valid amount." : nil
        titleError = trimmedTitle.isEmpty ? "Enter a title." : nil
        formError = tagsLoaded ? nil : "Wait for tags to load before adding the transaction"
        if !tagsLoaded {
            Task { tagsLoaded = await model.loadOrganizeData() }
        }
        guard let cents, amountError == nil, titleError == nil, formError == nil else {
            return
        }

        pending = true
        defer { pending = false }
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = TransactionMutationRequest(
            occurredAt: occurredAt,
            // A new transaction takes the device's clock time, as on the web the browser's.
            timeZone: .current,
            type: type,
            isReimbursement: isReimbursement,
            amountCents: cents,
            categoryID: categoryID,
            title: trimmedTitle,
            description: trimmedNotes.isEmpty ? nil : trimmedNotes,
            location: coordinate.map { .set(latitude: $0.latitude, longitude: $0.longitude) } ?? .keep,
            tags: tags
        )
        guard let id = await model.createTransaction(body) else {
            formError = model.lastError?.message ?? "Unable to add transaction."
            return
        }
        added += 1
        if receipt != nil {
            await uploadReceipt(to: id)
        } else {
            dismiss()
        }
    }

    private func uploadReceipt(to transactionID: Int) async {
        guard let receipt else {
            return
        }
        pending = true
        defer { pending = false }
        if await model.uploadReceipt(receipt, transactionID: transactionID) {
            dismiss()
        } else {
            failedReceipt = (transactionID, model.lastError?.message ?? "")
        }
    }
}

extension View {
    /// The floating add button at the bottom trailing edge of a tab's root list. It
    /// sits in the safe area, above the tab bar, and leaves with the root on a push.
    func quickAddButton(shown: Bool = true) -> some View {
        safeAreaInset(edge: .bottom, alignment: .trailing) {
            if shown {
                QuickAddButton()
            }
        }
    }
}

private struct QuickAddButton: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isSearching) private var isSearching
    @State private var adding = false

    var body: some View {
        // Hidden while searching, so it doesn't ride above the keyboard.
        if !isSearching {
            Button {
                adding = true
            } label: {
                // The ink tint is light in dark mode, so the glyph takes the page color.
                Image(systemName: "plus")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(ExpensesTheme.background(for: scheme))
                    .frame(minWidth: 40, minHeight: 40)
            }
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.circle)
            .dynamicTypeSize(...DynamicTypeSize.accessibility1)
            .accessibilityLabel("Quick Add")
            .padding(.trailing, 18)
            .padding(.bottom, 8)
            .sheet(isPresented: $adding) {
                AddTransactionSheet()
            }
        }
    }
}
