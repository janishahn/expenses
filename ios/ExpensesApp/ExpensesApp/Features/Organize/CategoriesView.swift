import SwiftUI

private enum CategorySort: String, ListSortKey {
    case usage
    case name

    var id: Self { self }

    var title: String {
        self == .usage ? "Usage" : "Name"
    }

    var ascendingTitle: String {
        self == .usage ? "Least Used First" : "A to Z"
    }

    var descendingTitle: String {
        self == .usage ? "Most Used First" : "Z to A"
    }

    var startsAscending: Bool {
        self == .name
    }
}

/// Categories by type with their use in the period; archived ones last.
struct CategoriesView: View {
    @Environment(AppModel.self) private var model
    @State private var sort = ListSort(key: CategorySort.usage, ascending: false)
    @State private var adding = false
    @State private var loadFailed = false

    let openTransactions: (TransactionQuery) -> Void

    var body: some View {
        @Bindable var model = model
        List {
            if let categories = model.categories?.categories {
                if categories.isEmpty {
                    ContentUnavailableView {
                        Label("No categories yet", systemImage: "square.on.circle")
                    } actions: {
                        Button("Add category") {
                            adding = true
                        }
                    }
                    .listRowBackground(Color.clear)
                } else {
                    let active = categories.filter { $0.archivedAt == nil }
                    band("Expenses", sorted(active.filter { $0.type == .expense }, by: sort))
                    band("Income", sorted(active.filter { $0.type == .income }, by: sort))
                    band("Archived", sorted(categories.filter { $0.archivedAt != nil }, by: ListSort(key: .name, ascending: true)))
                }
            } else if loadFailed {
                UnavailableStateSection(title: "Couldn't load categories", systemImage: "exclamationmark.triangle", message: model.lastError?.message) {
                    loadFailed = !(await model.loadCategories())
                }
            } else {
                LoadingStateSection(title: "Loading categories")
            }
        }
        .refreshable {
            loadFailed = !(await model.loadCategories())
        }
        .navigationTitle("Categories")
        .navigationSubtitle(model.categoriesPeriod.title)
        .expensesScreenStyle()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                PeriodMenu(period: $model.categoriesPeriod)
                SortMenu(sort: $sort)
                Button("Add category", systemImage: "plus") {
                    adding = true
                }
            }
        }
        .sheet(isPresented: $adding) {
            AddCategorySheet()
        }
        .task(id: model.categoriesPeriod) {
            loadFailed = !(await model.loadCategories())
        }
    }

    @ViewBuilder
    private func band(_ title: String, _ rows: [CategoryListItem]) -> some View {
        if !rows.isEmpty {
            Section {
                ForEach(rows) { category in
                    NavigationLink {
                        CategoryDetailView(categoryID: category.id, openTransactions: openTransactions)
                    } label: {
                        HStack(spacing: 12) {
                            CategoryGlyph(categoryID: category.id, iconKey: category.icon, name: category.name)
                            Text(category.name)
                                .lineLimit(1)
                                .foregroundStyle(category.archivedAt == nil ? .primary : .secondary)
                            Spacer(minLength: 8)
                            Text(category.archivedAt.map { "Archived \(AppFormatters.shortDay($0))" } ?? usesText(category.usageCount))
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                }
            } header: {
                HStack {
                    Text(title)
                    Spacer()
                    Text("\(rows.count)")
                        .monospacedDigit()
                }
            }
            .expensesRowBackground()
        }
    }

    private func sorted(_ rows: [CategoryListItem], by sort: ListSort<CategorySort>) -> [CategoryListItem] {
        rows.sorted { a, b in
            if sort.key == .usage, a.usageCount != b.usageCount {
                return sort.ascending ? a.usageCount < b.usageCount : a.usageCount > b.usageCount
            }
            let order = a.name.localizedCaseInsensitiveCompare(b.name)
            return sort.key == .name && !sort.ascending ? order == .orderedDescending : order == .orderedAscending
        }
    }
}

/// Adds a category: its type, name, icon and place in the order.
private struct AddCategorySheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var type = TransactionKind.expense
    @State private var name = ""
    @State private var icon = defaultCategoryIconKey
    @State private var order = 0
    @State private var choosingIcon = false
    @State private var choosingOrder = false
    @State private var nameError: String?
    @State private var formError: String?
    @State private var saving = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    TextField("Name", text: $name)
                        .font(.title3)
                        .focused($nameFocused)
                        .submitLabel(.done)
                        .fieldError(nameError)

                    ChipFlow {
                        Button {
                            choosingIcon = true
                        } label: {
                            EntryChip(icon == defaultCategoryIconKey ? "Icon" : categoryIconLabel(icon), isSet: icon != defaultCategoryIconKey) {
                                Image(systemName: categorySymbolName(for: icon))
                            }
                        }
                        .accessibilityLabel("Icon")
                        .accessibilityValue(icon == defaultCategoryIconKey ? "" : categoryIconLabel(icon))

                        Button {
                            choosingOrder = true
                        } label: {
                            EntryChip("Order \(order)", systemImage: "list.number", isSet: order != 0)
                        }
                        .popover(isPresented: $choosingOrder) {
                            ValuePopover(title: "Order", text: String(order), keyboard: .numbersAndPunctuation, confirm: "Done") { raw in
                                guard let value = Int(raw.trimmingCharacters(in: .whitespaces)) else {
                                    return "Enter a whole number."
                                }
                                order = value
                                return nil
                            }
                        }
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
                    Picker("Type", selection: $type) {
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
            .sheet(isPresented: $choosingIcon) {
                IconPickerSheet(selected: icon) { icon = $0 }
            }
        }
        .interactiveDismissDisabled(hasInput || saving)
        .task {
            nameFocused = true
        }
    }

    private var hasInput: Bool {
        !name.isEmpty || icon != defaultCategoryIconKey || order != 0
    }

    private func submit() async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        nameError = trimmed.isEmpty ? "Enter a category name." : nil
        formError = nil
        guard !trimmed.isEmpty else {
            return
        }
        saving = true
        defer { saving = false }
        if await model.createCategory(CategoryCreateRequest(name: trimmed, type: type, icon: icon, order: order)) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Unable to create category."
        }
    }
}
