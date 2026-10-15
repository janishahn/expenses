import SwiftUI

/// One template, edited in place. Each change saves the whole template, and saves run
/// one after another, so each builds on the last.
struct TemplateDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let templateID: Int

    @State private var saves = FieldSaves<Field, TemplateMutationRequest>()
    @State private var nameDraft = ""
    @FocusState private var nameFocused: Bool
    @State private var choosingCategory = false
    @State private var choosingAmount = false
    @State private var choosingTitle = false
    @State private var choosingTags = false
    @State private var deleting = false
    @State private var deleteError: String?

    // In the order entered values apply, so a category chosen after a type change stays.
    private enum Field: CaseIterable, Hashable {
        case name
        case type
        case category
        case amount
        case title
        case tags
    }

    private var template: TemplateRow? {
        model.templates?.templates.first { $0.id == templateID }
    }

    var body: some View {
        List {
            if let template {
                let shown = shown(template)
                head
                properties(template, shown)
            } else if model.templates != nil {
                ContentUnavailableView("This template no longer exists", systemImage: "bolt")
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateSection(title: "Loading template")
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .toolbar {
            if template != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Delete Template", systemImage: "trash", role: .destructive) {
                            deleting = true
                        }
                    } label: {
                        Label("More actions", systemImage: "ellipsis")
                    }
                }
            }
        }
        .sheet(isPresented: $choosingCategory) {
            if let template {
                let shown = shown(template)
                CategoryPickerSheet(title: "Category", categories: categories(shown.type), selectedID: shown.categoryID) { category in
                    if category.id != shown.categoryID || saves.errors[.category] != nil {
                        save(.category) { $0.categoryID = category.id }
                    }
                }
            }
        }
        .sheet(isPresented: $choosingTags) {
            if let template {
                let shown = shown(template)
                TagPickerSheet(title: "Tags", options: model.activeTags.map(\.name), selected: shown.tags) { names in
                    if names != shown.tags || saves.errors[.tags] != nil {
                        save(.tags) { $0.tags = names }
                    }
                }
            }
        }
        .alert("Delete template “\(template?.name ?? "")”?", isPresented: $deleting) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task { await delete() }
            }
        }
        .failureAlert("Couldn't delete the template", message: $deleteError)
        .onChange(of: nameFocused) { _, focused in
            if !focused {
                commitName()
            }
        }
        // Back can close the screen before the field reports losing focus.
        .onDisappear {
            commitName()
        }
        .task {
            if model.templates == nil {
                _ = await model.loadTemplates()
            }
        }
        .onChange(of: template == nil, initial: true) {
            nameDraft = template?.name ?? ""
        }
    }

    // MARK: Sections

    private var head: some View {
        Section {
            TextField("Name", text: $nameDraft, axis: .vertical)
                .focused($nameFocused)
                .detailNameField($nameDraft) { nameFocused = false }
                .fieldError(saves.errors[.name])
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
    }

    private func properties(_ template: TemplateRow, _ shown: TemplateMutationRequest) -> some View {
        Section {
            Picker("Type", selection: Binding(get: { shown.type }, set: { changeType($0, shown) })) {
                Text("Expense").tag(TransactionKind.expense)
                Text("Income").tag(TransactionKind.income)
            }
            .pickerStyle(.menu)
            .fieldError(saves.errors[.type])

            Button {
                choosingCategory = true
            } label: {
                LabeledContent("Category") {
                    if let category = categories(shown.type).first(where: { $0.id == shown.categoryID }) ?? template.category {
                        HStack(spacing: 4) {
                            CategoryGlyph(categoryID: category.id, iconKey: category.icon, name: category.name)
                            Text(category.name)
                                .foregroundStyle(.primary)
                        }
                    } else {
                        Text("Unknown category")
                    }
                }
            }
            .tint(.primary)
            .fieldError(saves.errors[.category])

            Button {
                choosingAmount = true
            } label: {
                LabeledContent("Amount") {
                    if let cents = shown.defaultAmountCents {
                        AmountText(cents, signed: shown.type == .income)
                            .foregroundStyle(shown.type == .income ? ExpensesTheme.income(for: scheme) : .primary)
                    } else {
                        Text("Variable")
                    }
                }
            }
            .tint(.primary)
            .popover(isPresented: $choosingAmount) {
                ValuePopover(
                    title: "Variable amount",
                    text: shown.defaultAmountCents.map(AppFormatters.amountInput) ?? "",
                    keyboard: .decimalPad,
                    confirm: "Save"
                ) { raw in
                    let amount = DefaultAmount(raw)
                    if amount == .invalid {
                        return "Default amount must be a valid number."
                    }
                    if amount.cents != shown.defaultAmountCents || saves.errors[.amount] != nil {
                        save(.amount) { $0.defaultAmountCents = amount.cents }
                    }
                    return nil
                }
            }
            .fieldError(saves.errors[.amount])

            Button {
                choosingTitle = true
            } label: {
                LabeledContent("Title") {
                    Text(shown.title ?? "None")
                        .foregroundStyle(shown.title == nil ? .secondary : .primary)
                        .lineLimit(1)
                }
            }
            .tint(.primary)
            .popover(isPresented: $choosingTitle) {
                ValuePopover(title: "Transaction title", text: shown.title ?? "", confirm: "Save") { raw in
                    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                    let title = trimmed.isEmpty ? nil : trimmed
                    if title != shown.title || saves.errors[.title] != nil {
                        save(.title) { $0.title = title }
                    }
                    return nil
                }
            }
            .fieldError(saves.errors[.title])

            Button {
                choosingTags = true
            } label: {
                LabeledContent("Tags") {
                    Text(shown.tags.isEmpty ? "None" : shown.tags.joined(separator: ", "))
                        .foregroundStyle(shown.tags.isEmpty ? .secondary : .primary)
                        .lineLimit(1)
                }
            }
            .tint(.primary)
            .fieldError(saves.errors[.tags])
        }
        .expensesRowBackground()
    }

    // MARK: Saving

    private func shown(_ template: TemplateRow) -> TemplateMutationRequest {
        saves.shown(TemplateMutationRequest(template))
    }

    private func categories(_ type: TransactionKind) -> [CategorySummary] {
        model.activeKnownCategories.filter { $0.type == type.rawValue }
    }

    private func save(_ field: Field, _ change: @escaping (inout TemplateMutationRequest) -> Void) {
        saves.save(field, stored: { template.map { TemplateMutationRequest($0) } }, commit: { body in
            await model.saveTemplate(id: templateID, body: body) ? nil : model.lastError?.message ?? "Unable to save the change."
        }, change)
    }

    // A template's category must match its type, so a new type takes that type's first
    // category.
    private func changeType(_ next: TransactionKind, _ shown: TemplateMutationRequest) {
        guard next != shown.type else {
            return
        }
        guard let fallback = categories(next).first else {
            saves.errors[.type] = "Add an \(next.rawValue) category first."
            return
        }
        save(.type) {
            $0.type = next
            $0.categoryID = fallback.id
        }
    }

    private func commitName() {
        guard let template else {
            return
        }
        let name = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            saves.errors[.name] = "Name is required."
            return
        }
        nameDraft = name
        if name != shown(template).name || saves.errors[.name] != nil {
            save(.name) { $0.name = name }
        }
    }

    private func delete() async {
        if await model.deleteTemplate(id: templateID) {
            dismiss()
        } else {
            deleteError = model.lastError?.message ?? "Unable to delete template."
        }
    }
}
