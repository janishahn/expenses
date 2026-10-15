import SwiftUI

/// Transactions in the Uncategorized category. While automatic categorization is on,
/// each may carry a suggested category to accept or reject.
struct UncategorizedView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var search = ""
    @State private var loadFailed = false
    @State private var selecting = false
    @State private var selection: Set<Int> = []
    @State private var selectsAllMatching = false
    @State private var choosingFor: Choice?
    @State private var pendingBulk: PendingBulkEdit?
    @State private var categorized = 0
    @State private var failure: String?

    var body: some View {
        @Bindable var model = model
        List(selection: $selection) {
            if let response = model.uncategorizedTransactions {
                if response.items.isEmpty {
                    emptyState
                } else {
                    Section {
                        ForEach(response.items) { row in
                            NavigationLink {
                                TransactionDetailView(transactionID: row.id)
                            } label: {
                                rowLabel(row, definition: response.definition)
                            }
                            .navigationLinkIndicatorVisibility(.hidden)
                            .swipeActions(edge: .leading) {
                                if let suggested = suggestedCategory(row, definition: response.definition) {
                                    Button("Accept", systemImage: "checkmark") {
                                        Task { await categorize([row.id], categoryID: suggested.id) }
                                    }
                                    .tint(ExpensesTheme.focus(for: scheme))
                                }
                            }
                            .contextMenu {
                                if let suggested = suggestedCategory(row, definition: response.definition) {
                                    Button("Accept \(suggested.name)", systemImage: "checkmark") {
                                        Task { await categorize([row.id], categoryID: suggested.id) }
                                    }
                                    Button("Reject Suggestion", systemImage: "xmark") {
                                        Task { await dismiss(row) }
                                    }
                                }
                                Button("Choose Category", systemImage: "square.on.circle") {
                                    choosingFor = .row(row)
                                }
                            }
                        }
                    }
                    .expensesRowBackground()
                    if response.hasMore {
                        NextPageSection(page: response.page) {
                            await model.loadUncategorizedTransactions(nextPage: true)
                        }
                    }
                }
            } else if loadFailed {
                UnavailableStateSection(
                    title: "Couldn't load uncategorized transactions",
                    systemImage: "exclamationmark.triangle",
                    message: model.lastError?.message
                ) {
                    loadFailed = await !model.loadUncategorizedTransactions()
                }
            } else {
                LoadingStateSection(title: "Loading uncategorized transactions")
            }
        }
        .checkedTint()
        .environment(\.editMode, .constant(selecting ? .active : .inactive))
        .navigationTitle(selecting ? "\(selectionCount) Selected" : "Uncategorized")
        .navigationSubtitle(selecting ? "" : model.uncategorizedQuery.period.title)
        .expensesScreenStyle()
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always))
        .toolbar {
            if selecting {
                ToolbarItem(placement: .topBarLeading) {
                    Button(selectsAllMatching ? "Deselect All" : "Select All") {
                        if selectsAllMatching {
                            clearSelection()
                        } else {
                            selection = loadedIDs
                            selectsAllMatching = true
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", role: .confirm) {
                        selecting = false
                    }
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("Category", systemImage: "square.on.circle") {
                        choosingFor = .selection
                    }
                    .disabled(selectionCount == 0)
                }
            } else {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    PeriodMenu(period: $model.uncategorizedQuery.period)
                    Button("Select", systemImage: "checkmark.circle") {
                        selecting = true
                    }
                    .disabled(model.uncategorizedTransactions?.items.isEmpty != false)
                }
            }
        }
        .toolbar(selecting ? .hidden : .automatic, for: .tabBar)
        .navigationBarBackButtonHidden(selecting)
        .task(id: model.uncategorizedQuery) {
            loadFailed = await !model.loadUncategorizedTransactions()
        }
        .task(id: search) {
            try? await Task.sleep(for: .milliseconds(250))
            if !Task.isCancelled && search != model.uncategorizedQuery.search {
                model.uncategorizedQuery.search = search
            }
        }
        .refreshable {
            loadFailed = await !model.loadUncategorizedTransactions()
        }
        .onAppear {
            search = model.uncategorizedQuery.search
        }
        .onChange(of: model.uncategorizedQuery) {
            clearSelection()
        }
        .onChange(of: selecting) {
            clearSelection()
        }
        .onChange(of: selection) {
            if selectsAllMatching && selection != loadedIDs {
                selectsAllMatching = false
            }
        }
        .onChange(of: model.uncategorizedTransactions?.items.count) {
            if selectsAllMatching {
                selection = loadedIDs
            }
        }
        .sheet(item: $choosingFor) { choice in
            CategoryPickerSheet(title: "Set category", categories: targets(for: choice)) { category in
                switch choice {
                case let .row(row):
                    Task { await categorize([row.id], categoryID: category.id) }
                case .selection:
                    Task { await prepareBulk(categoryID: category.id) }
                }
            }
        }
        .bulkConfirmation($pendingBulk) { pending in
            guard await model.applyBulkEdit(pending.request) != nil else {
                failure = model.lastError?.message ?? "The change could not be applied."
                return
            }
            categorized += 1
            selecting = false
            await model.loadUncategorizedTransactions()
        }
        .sensoryFeedback(.success, trigger: categorized)
        .failureAlert("Couldn't complete the action", message: $failure)
    }

    private func rowLabel(_ row: UncategorizedTransaction, definition: UncategorizedDefinition) -> some View {
        let suggested = suggestedCategory(row, definition: definition)
        return LedgerRow(
            title: row.transaction.title ?? "Untitled",
            detail: suggested.map { category in
                "\(category.name) · \((row.suggestion?.confidence ?? 0).formatted(.percent.precision(.fractionLength(0))))"
            },
            categoryID: suggested?.id,
            iconKey: suggested?.icon,
            categoryName: suggested?.name,
            amountCents: row.transaction.amountCents,
            income: row.transaction.type == "income"
        )
    }

    @ViewBuilder
    private var emptyState: some View {
        let query = model.uncategorizedQuery
        Section {
            if !query.trimmedSearch.isEmpty {
                ContentUnavailableView {
                    Label("No matching transactions", systemImage: "magnifyingglass")
                } actions: {
                    Button("Clear search") {
                        search = ""
                        model.uncategorizedQuery.search = ""
                    }
                }
            } else if query.period != .all {
                ContentUnavailableView {
                    Label("No matching transactions", systemImage: "calendar")
                } actions: {
                    Button("Show all time") {
                        model.uncategorizedQuery.period = .all
                    }
                }
            } else {
                ContentUnavailableView("No uncategorized transactions", systemImage: "checkmark.circle")
            }
        }
        .listRowBackground(Color.clear)
    }

    // Moving a row to Uncategorized would leave it here, so the pickers never offer it.
    private func targets(for choice: Choice) -> [CategorySummary] {
        let excluded = model.uncategorizedTransactions?.definition.matchedCategoryIDs ?? []
        let categories = model.activeKnownCategories.filter { !excluded.contains($0.id) }
        if case let .row(row) = choice {
            return categories.filter { ($0.type ?? "expense") == row.transaction.type }
        }
        return categories
    }

    private func suggestedCategory(_ row: UncategorizedTransaction, definition: UncategorizedDefinition) -> CategorySummary? {
        guard let suggestion = row.suggestion, !definition.matchedCategoryIDs.contains(suggestion.categoryID) else {
            return nil
        }
        return model.knownCategories.first { $0.id == suggestion.categoryID }
    }

    private var loadedIDs: Set<Int> {
        Set(model.uncategorizedTransactions?.items.map(\.id) ?? [])
    }

    private var selectionCount: Int {
        selectsAllMatching ? model.uncategorizedTransactions?.total ?? 0 : selection.count
    }

    private func clearSelection() {
        selection = []
        selectsAllMatching = false
    }

    private func categorize(_ ids: [Int], categoryID: Int) async {
        if await model.categorize(ids, categoryID: categoryID) {
            categorized += 1
        } else {
            failure = model.lastError?.message ?? "The category could not be set."
        }
    }

    private func dismiss(_ row: UncategorizedTransaction) async {
        if !(await model.dismissCategorySuggestion(row)) {
            failure = model.lastError?.message ?? "The suggestion could not be rejected."
        }
    }

    private func prepareBulk(categoryID: Int) async {
        let query = (model.loadedUncategorizedQuery ?? model.uncategorizedQuery).bulkSelection(
            matchedCategoryIDs: model.uncategorizedTransactions?.definition.matchedCategoryIDs ?? []
        )
        let request = BulkEditRequest(
            selection: selectsAllMatching
                ? BulkSelectionRequest(mode: "query", transactionIDs: [], query: query)
                : BulkSelectionRequest(mode: "ids", transactionIDs: selection.sorted(), query: nil),
            operation: BulkOperationRequest(setCategoryID: categoryID, tagPatch: nil, lifecycle: "none")
        )
        guard let preview = await model.previewBulkEdit(request) else {
            failure = model.lastError?.message ?? "The change could not be previewed."
            return
        }
        pendingBulk = PendingBulkEdit(
            request: request,
            preview: preview,
            verb: "Change the category of",
            confirmLabel: "Apply",
            destructive: false
        )
    }
}

private enum Choice: Identifiable {
    case row(UncategorizedTransaction)
    case selection

    var id: Int {
        switch self {
        case let .row(row):
            row.id
        case .selection:
            0
        }
    }
}
