import SwiftUI

/// A template's default amount as typed. An empty field keeps the template variable.
enum DefaultAmount: Equatable {
    case variable
    case cents(Int)
    case invalid

    init(_ raw: String) {
        if raw.trimmingCharacters(in: .whitespaces).isEmpty {
            self = .variable
        } else if let cents = AppFormatters.parseAmountCents(raw) {
            self = .cents(cents)
        } else {
            self = .invalid
        }
    }

    var cents: Int? {
        if case .cents(let cents) = self {
            return cents
        }
        return nil
    }
}

/// Quick-add shortcuts, in the order the add sheet shows them.
struct TemplatesView: View {
    @Environment(AppModel.self) private var model
    @State private var adding = false
    @State private var loadFailed = false
    @State private var reorderError: String?

    var body: some View {
        List {
            if let templates = model.templates?.templates {
                if templates.isEmpty {
                    ContentUnavailableView {
                        Label("No templates yet", systemImage: "bolt")
                    } actions: {
                        Button("Add template") {
                            adding = true
                        }
                    }
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(templates) { template in
                            NavigationLink {
                                TemplateDetailView(templateID: template.id)
                            } label: {
                                TemplateListRow(template: template)
                            }
                            .navigationLinkIndicatorVisibility(.hidden)
                        }
                        .onMove { source, destination in
                            Task {
                                if !(await model.moveTemplate(from: source, to: destination)) {
                                    reorderError = model.lastError?.message ?? "Unable to reorder templates."
                                }
                            }
                        }
                    }
                    .expensesRowBackground()
                }
            } else if loadFailed {
                UnavailableStateSection(title: "Couldn't load templates", systemImage: "exclamationmark.triangle", message: model.lastError?.message) {
                    loadFailed = !(await model.loadTemplates())
                }
            } else {
                LoadingStateSection(title: "Loading templates")
            }
        }
        .refreshable {
            loadFailed = !(await model.loadTemplates())
        }
        .navigationTitle("Templates")
        .expensesScreenStyle()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if model.templates?.templates.isEmpty == false {
                    EditButton()
                }
                Button("Add template", systemImage: "plus") {
                    adding = true
                }
            }
        }
        .sheet(isPresented: $adding) {
            AddTemplateSheet()
        }
        .failureAlert("Couldn't reorder the templates", message: $reorderError)
        .task {
            loadFailed = !(await model.loadTemplates())
        }
    }
}

/// A template in the list: its category glyph, name, title and tags, and amount.
private struct TemplateListRow: View {
    @Environment(\.colorScheme) private var scheme

    let template: TemplateRow

    var body: some View {
        let detail = ([template.title] + [template.tags.isEmpty ? nil : template.tags.joined(separator: ", ")])
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
        TrailingRow {
            CategoryGlyph(categoryID: template.category?.id, iconKey: template.category?.icon, name: template.category?.name)
        } content: {
            VStack(alignment: .leading, spacing: 2) {
                Text(template.name)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        } trailing: {
            if let cents = template.defaultAmountCents {
                AmountText(cents, signed: template.type == .income)
                    .foregroundStyle(template.type == .income ? ExpensesTheme.income(for: scheme) : .primary)
            } else {
                Text("Variable")
                    .foregroundStyle(.tertiary)
            }
        }
        .contentShape(Rectangle())
    }
}

/// Adds a template: an optional default amount, a name, the title it fills in, and
/// chips for its category and tags.
private struct AddTemplateSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var type = TransactionKind.expense
    @State private var amount = ""
    @State private var name = ""
    @State private var title = ""
    @State private var categoryID: Int?
    @State private var tags: [String] = []
    @State private var choosingTags = false
    @State private var amountError: String?
    @State private var nameError: String?
    @State private var formError: String?
    @State private var saving = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    EntryAmountField(text: $amount, income: type == .income, prompt: "Variable amount")
                        .fieldError(amountError)

                    TextField("Name", text: $name)
                        .font(.title3)
                        .focused($nameFocused)
                        .fieldError(nameError)

                    TextField("Transaction title", text: $title)

                    ChipFlow {
                        categoryChip

                        Button {
                            choosingTags = true
                        } label: {
                            EntryChip(tags.isEmpty ? "Tags" : tags.joined(separator: ", "), systemImage: "tag", isSet: !tags.isEmpty)
                        }
                        .accessibilityLabel("Tags")
                        .accessibilityValue(tags.joined(separator: ", "))
                    }
                    .buttonStyle(.plain)

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
                    .disabled(saving)
                }
            }
            .sheet(isPresented: $choosingTags) {
                TagPickerSheet(title: "Tags", options: model.activeTags.map(\.name), selected: tags) { tags = $0 }
            }
        }
        .interactiveDismissDisabled(hasInput || saving)
        .task {
            nameFocused = true
            if categoryID == nil {
                categoryID = typed.first?.id
            }
        }
    }

    // The type and its first category are defaults, so they alone are no input to lose.
    private var hasInput: Bool {
        !amount.isEmpty || !name.isEmpty || !title.isEmpty || !tags.isEmpty
    }

    // A new type starts on that type's first category.
    private var typeSelection: Binding<TransactionKind> {
        Binding(
            get: { type },
            set: { next in
                type = next
                categoryID = typed.first?.id
            }
        )
    }

    private var typed: [CategorySummary] {
        model.activeKnownCategories.filter { $0.type == type.rawValue }
    }

    private var categoryChip: some View {
        let category = typed.first { $0.id == categoryID }
        return Menu {
            Picker("Category", selection: $categoryID) {
                ForEach(typed) { category in
                    Label(category.name, systemImage: categorySymbolName(for: resolvedCategoryIconKey(category.icon, name: category.name)))
                        .tag(Optional(category.id))
                }
            }
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
    }

    private func submit() async {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let defaultAmount = DefaultAmount(amount)
        nameError = trimmedName.isEmpty ? "Name is required." : nil
        amountError = defaultAmount == .invalid ? "Default amount must be a valid number." : nil
        formError = categoryID == nil ? "Category is required." : nil
        guard !trimmedName.isEmpty, defaultAmount != .invalid, let categoryID else {
            return
        }
        saving = true
        defer { saving = false }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = TemplateMutationRequest(
            name: trimmedName,
            type: type,
            categoryID: categoryID,
            defaultAmountCents: defaultAmount.cents,
            title: trimmedTitle.isEmpty ? nil : trimmedTitle,
            tags: tags
        )
        if await model.saveTemplate(id: nil, body: body) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Unable to create template."
        }
    }
}
