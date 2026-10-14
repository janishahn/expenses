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
    @State private var addAnother = false
    @State private var amountError: String?
    @State private var titleError: String?
    @State private var formError: String?
    @State private var tagsLoaded = false
    @State private var pending = false
    @State private var added = 0
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
                                            .frame(width: 18)
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

                    Toggle("Add another", isOn: $addAnother)

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
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
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
            .sensoryFeedback(.success, trigger: added)
        }
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
        var receiptFailed = false
        if let receipt {
            receiptFailed = !(await model.uploadReceipt(receipt, transactionID: id))
        }
        added += 1
        if receiptFailed {
            reset()
            formError = "Transaction added, but the receipt could not be uploaded"
        } else if addAnother {
            reset()
            focus = .amount
        } else {
            dismiss()
        }
    }

    // The date, direction and location carry over to the next entry.
    private func reset() {
        amount = ""
        title = ""
        categoryID = nil
        explicitTags = []
        excludedScheduledTags = []
        isReimbursement = false
        notes = ""
        receipt = nil
        amountError = nil
        titleError = nil
        formError = nil
    }
}
