import SwiftUI

/// One category, edited in place: its name, icon and order, with its use in the
/// Categories period and its latest transactions.
struct CategoryDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let categoryID: Int
    let openTransactions: (TransactionQuery) -> Void

    @State private var saves = FieldSaves<Field, CategoryUpdateRequest>()
    @State private var nameDraft = ""
    @FocusState private var nameFocused: Bool
    @State private var choosingIcon = false
    @State private var choosingOrder = false
    @State private var merging = false
    @State private var actionError: String?
    @State private var recent: Result<TransactionsResponse, APIErrorInfo>?

    private enum Field: CaseIterable, Hashable {
        case name
        case icon
        case order
    }

    private var category: CategoryListItem? {
        model.categories?.categories.first { $0.id == categoryID }
    }

    private var query: TransactionQuery {
        var query = TransactionQuery(period: model.categoriesPeriod)
        query.categoryID = categoryID
        return query
    }

    var body: some View {
        List {
            if let category {
                let shown = shown(category)
                head(category)
                properties(category, shown)
                recentSection(shown)
            } else if model.categories != nil {
                ContentUnavailableView("This category no longer exists", systemImage: "square.on.circle")
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateSection(title: "Loading category")
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .toolbar {
            if let category {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if category.archivedAt == nil {
                            Button("Merge Into…", systemImage: "arrow.triangle.merge") {
                                merging = true
                            }
                            Button("Archive", systemImage: "archivebox") {
                                Task { await setArchived(true) }
                            }
                        } else {
                            Button("Restore", systemImage: "arrow.uturn.backward") {
                                Task { await setArchived(false) }
                            }
                        }
                    } label: {
                        Label("More actions", systemImage: "ellipsis")
                    }
                }
            }
        }
        .sheet(isPresented: $choosingIcon) {
            if let category {
                IconPickerSheet(selected: shown(category).icon) { icon in
                    if icon != category.icon || saves.errors[.icon] != nil {
                        save(.icon) { $0.icon = icon }
                    }
                }
            }
        }
        .sheet(isPresented: $merging) {
            if let category {
                MergeSheet(
                    sourceName: category.name,
                    noun: "category",
                    targets: (model.categories?.categories ?? [])
                        .filter { $0.id != category.id && $0.type == category.type && $0.archivedAt == nil }
                        .map { MergeTarget(id: $0.id, name: $0.name, systemImage: categorySymbolName(for: resolvedCategoryIconKey($0.icon, name: $0.name))) },
                    preview: { target in
                        await model.chart { try await $0.previewCategoryMerge(CategoryMergeRequest(sourceCategoryID: categoryID, targetCategoryID: target), token: $1) }
                    },
                    countRows: { counts in
                        let count = { (key: String) in counts[key] ?? 0 }
                        let plural = { (value: Int, word: String) in value == 1 ? "1 \(word)" : "\(value) \(word)s" }
                        return [
                            ("Transactions", "\(count("transactions"))"),
                            ("Recurring rules", "\(count("recurring_rules"))"),
                            ("Rule actions", "\(count("rules_set_category"))"),
                            ("Budgets", "\(plural(count("budget_templates"), "plan")), \(plural(count("budget_overrides"), "adjustment"))"),
                        ]
                    },
                    merge: { target in
                        await model.mergeCategories(sourceID: categoryID, targetID: target) ? nil : model.lastError?.message ?? "Unable to merge categories."
                    },
                    onMerged: { dismiss() }
                )
            }
        }
        .failureAlert("Couldn't change the category", message: $actionError)
        .onChange(of: nameFocused) { _, focused in
            if !focused {
                commitName()
            }
        }
        .task {
            if model.categories == nil {
                _ = await model.loadCategories()
            }
        }
        .onChange(of: category == nil, initial: true) {
            nameDraft = category?.name ?? ""
        }
        .task(id: query) {
            let query = query
            let result = await model.chart { try await $0.transactions(query, page: 1, limit: 5, token: $1) }
            if !Task.isCancelled {
                recent = result
            }
        }
    }

    // MARK: Sections

    private func head(_ category: CategoryListItem) -> some View {
        Section {
            TextField("Name", text: $nameDraft, axis: .vertical)
                .focused($nameFocused)
                .detailNameField($nameDraft) { nameFocused = false }
                .fieldError(saves.errors[.name])
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
    }

    private func properties(_ category: CategoryListItem, _ shown: CategoryUpdateRequest) -> some View {
        let sum = category.type == .income ? category.incomeCents : category.expenseCents
        return Section {
            LabeledContent("Type", value: category.type == .income ? "Income" : "Expense")

            Button {
                choosingIcon = true
            } label: {
                LabeledContent("Icon") {
                    HStack(spacing: 4) {
                        CategoryGlyph(categoryID: category.id, iconKey: shown.icon, name: shown.name)
                        Text(categoryIconLabel(resolvedCategoryIconKey(shown.icon, name: shown.name)))
                            .foregroundStyle(.primary)
                    }
                }
            }
            .tint(.primary)
            .fieldError(saves.errors[.icon])

            Button {
                choosingOrder = true
            } label: {
                LabeledContent("Order") {
                    Text("\(shown.order)")
                        .monospacedDigit()
                        .foregroundStyle(.primary)
                }
            }
            .tint(.primary)
            .popover(isPresented: $choosingOrder) {
                ValuePopover(title: "Order", text: String(shown.order), keyboard: .numbersAndPunctuation, confirm: "Save") { raw in
                    guard let order = Int(raw.trimmingCharacters(in: .whitespaces)) else {
                        return "Enter a whole number."
                    }
                    if order != category.order || saves.errors[.order] != nil {
                        save(.order) { $0.order = order }
                    }
                    return nil
                }
            }
            .fieldError(saves.errors[.order])

            LabeledContent(model.categoriesPeriod.title) {
                HStack(spacing: 4) {
                    Text(usesText(category.usageCount))
                    if sum != 0 {
                        Text("·")
                        AmountText(sum)
                            .foregroundStyle(category.type == .income ? ExpensesTheme.income(for: scheme) : .secondary)
                    }
                }
            }

            if let archivedAt = category.archivedAt {
                LabeledContent("Archived", value: AppFormatters.shortDay(archivedAt))
            }
        }
        .expensesRowBackground()
    }

    // Every row is in this category, so rows draw its current icon and name.
    private func recentSection(_ shown: CategoryUpdateRequest) -> some View {
        Section {
            switch recent {
            case nil:
                Text("Loading…")
                    .foregroundStyle(.secondary)
            case .failure:
                Text("Unable to load transactions.")
                    .foregroundStyle(.secondary)
            case .success(let data) where data.items.isEmpty:
                Text("None")
                    .foregroundStyle(.secondary)
            case .success(let data):
                ForEach(data.items) { item in
                    NavigationLink {
                        TransactionDetailView(transactionID: item.id)
                    } label: {
                        LedgerRow(
                            title: item.title ?? "Untitled",
                            detail: AppFormatters.bookingDay(item.date),
                            categoryID: categoryID,
                            iconKey: shown.icon,
                            categoryName: shown.name,
                            amountCents: item.amountCents,
                            income: item.type == "income"
                        )
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                }
            }
        } header: {
            if case .success(let data) = recent, data.total > data.items.count {
                SectionLink(title: "Recent", destination: "all \(data.total) transactions") {
                    openTransactions(query)
                }
            } else {
                Text("Recent")
            }
        }
        .expensesRowBackground()
    }

    // MARK: Saving

    private func shown(_ category: CategoryListItem) -> CategoryUpdateRequest {
        saves.shown(CategoryUpdateRequest(category))
    }

    private func save(_ field: Field, _ change: @escaping (inout CategoryUpdateRequest) -> Void) {
        saves.save(field, stored: { category.map { CategoryUpdateRequest($0) } }, commit: { body in
            await model.updateCategory(id: categoryID, body: body) ? nil : model.lastError?.message ?? "Unable to save the change."
        }, change)
    }

    private func commitName() {
        guard let category else {
            return
        }
        let name = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            saves.errors[.name] = "Enter a category name."
            return
        }
        nameDraft = name
        if name != category.name || saves.errors[.name] != nil {
            save(.name) { $0.name = name }
        }
    }

    private func setArchived(_ archived: Bool) async {
        if !(await model.setCategoryArchived(id: categoryID, archived: archived)) {
            actionError = model.lastError?.message ?? "Unable to \(archived ? "archive" : "restore") the category."
        }
    }
}
