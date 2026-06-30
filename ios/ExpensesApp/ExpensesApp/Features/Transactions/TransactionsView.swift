import SwiftUI

struct TransactionsView: View {
    @Environment(AppModel.self) private var model
    @Binding var path: [Int]
    @State private var listMode: TransactionListMode = .active
    @State private var selectingTransactions = false
    @State private var selectedTransactionIDs: Set<Int> = []
    @State private var presentingBulkEdit = false
    @State private var pendingPermanentDelete: DeletedTransaction?
    @State private var presentingFilters = false
    @State private var draftSearchQuery = ""
    @State private var draftType = ""
    @State private var draftCategoryID: Int?
    @State private var draftTagID: Int?
    @State private var searchAlert: TransactionSearchAlert?
    @State private var isTranslatingSearch = false
    @State private var liveSearchTask: Task<Void, Never>?
    @State private var lastTranslatedSearchQuery: String?
    @State private var appliedSearchQuery = ""
    @State private var appliedType = ""
    @State private var appliedCategoryID: Int?
    @State private var appliedTagID: Int?

    init(path: Binding<[Int]> = .constant([])) {
        _path = path
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if model.identity?.authenticated != true {
                    SignedOutStateSection()
                } else {
                    if model.llmEnabled, canAskSearch || isTranslatingSearch {
                        SearchAskSection(
                            query: draftSearchQuery,
                            isLoading: isTranslatingSearch,
                            onAsk: {
                                Task { await translateNaturalLanguageSearch() }
                            }
                        )
                    }

                    if listMode != .deleted, hasStructuredFilters {
                        FilterSummarySection(
                            labels: activeFilterLabels,
                            onOpen: {
                                resetDraftFiltersToApplied()
                                presentingFilters = true
                            },
                            onClear: {
                                clearFilters()
                            }
                        )
                    }

                    switch listMode {
                    case .active:
                        if let transactions = model.transactions {
                            if transactions.items.isEmpty {
                                if hasActiveQueryOrFilters {
                                    ContentUnavailableView(
                                        "No matching transactions",
                                        systemImage: "magnifyingglass",
                                        description: Text("Try a different search or clear your filters.")
                                    )
                                } else {
                                    ContentUnavailableView(
                                        "No transactions yet",
                                        systemImage: "list.bullet.rectangle",
                                        description: Text("Add your first transaction with the + button.")
                                    )
                                }
                            } else {
                                TransactionRows(
                                    transactions: transactions.items,
                                    categories: transactions.categories,
                                    selecting: selectingTransactions,
                                    selectedIDs: $selectedTransactionIDs
                                )
                            }
                        } else if model.showsTransactionsInitialLoading {
                            LoadingStateSection(title: "Loading transactions")
                        } else {
                            ContentUnavailableView("No transactions loaded", systemImage: "list.bullet.rectangle")
                        }
                    case .uncategorized:
                        if let transactions = model.uncategorizedTransactions {
                            if transactions.total == 0 {
                                ContentUnavailableView(
                                    "Inbox zero",
                                    systemImage: "checkmark.circle",
                                    description: Text("Every transaction has a category.")
                                )
                            } else {
                                Section {
                                    LabeledContent("Open items", value: "\(transactions.total)")
                                }
                                UncategorizedTriageRows(
                                transactions: transactions.items,
                                categories: transactions.categories,
                                suggestions: model.transactionSuggestions,
                                llmEnabled: model.llmEnabled,
                                selecting: selectingTransactions,
                                selectedIDs: $selectedTransactionIDs,
                                onSuggest: { transaction in
                                    Task { await model.triageTransaction(transaction) }
                                },
                                onAccept: { suggestion in
                                    Task {
                                        if await model.acceptTransactionSuggestion(suggestion) {
                                            await loadSelectedMode()
                                        }
                                    }
                                },
                                onReject: { suggestion in
                                    Task { await model.rejectTransactionSuggestion(suggestion) }
                                }
                                )
                            }
                        } else {
                            ContentUnavailableView("No uncategorized transactions loaded", systemImage: "tray")
                        }
                    case .deleted:
                        DeletedTransactionsList(
                            transactions: model.deletedTransactions?.transactions ?? [],
                            onRestore: { transaction in
                                Task { await model.restoreTransaction(transaction) }
                            },
                            onPermanentDelete: { transaction in
                                pendingPermanentDelete = transaction
                            }
                        )
                    }
                }
            }
            .navigationTitle("Transactions")
            .expensesScreenStyle()
            .searchable(
                text: $draftSearchQuery,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search transactions"
            )
            .onSubmit(of: .search, applyFilters)
            .onChange(of: draftSearchQuery) { _, _ in
                scheduleLiveSearch()
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    TransactionListModeMenu(listMode: $listMode)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        resetDraftFiltersToApplied()
                        presentingFilters = true
                    } label: {
                        Label("Filters", systemImage: hasStructuredFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    }
                    .disabled(listMode == .deleted)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(selectingTransactions ? "Done" : "Select") {
                        selectingTransactions.toggle()
                        if !selectingTransactions {
                            selectedTransactionIDs.removeAll()
                        }
                    }
                    .disabled(!listMode.supportsBulkEdit || currentTransactions.isEmpty)
                }
            }
            .sheet(isPresented: $presentingFilters, onDismiss: resetDraftFiltersToApplied) {
                TransactionFiltersSheet(
                    type: $draftType,
                    categoryID: $draftCategoryID,
                    tagID: $draftTagID,
                    categories: currentCategories,
                    tags: currentTags,
                    onApply: applyFilters,
                    onClear: clearFilters
                )
                .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $presentingBulkEdit) {
                BulkEditSheet(
                    mode: listMode,
                    selectedIDs: selectedTransactionIDs,
                    categories: currentCategories,
                    uncategorizedDefinition: model.uncategorizedTransactions?.definition,
                    query: appliedSearchQuery,
                    type: appliedType,
                    filterCategoryID: appliedCategoryID,
                    filterTagID: appliedTagID
                ) { request in
                    await model.previewBulkEdit(request)
                } onApply: { request in
                    await model.applyBulkEdit(request)
                }
            }
            .confirmationDialog(
                "Permanently delete this transaction?",
                isPresented: Binding(
                    get: { pendingPermanentDelete != nil },
                    set: { isPresented in
                        if !isPresented {
                            pendingPermanentDelete = nil
                        }
                    }
                )
            ) {
                Button("Delete Forever", role: .destructive) {
                    if let transaction = pendingPermanentDelete {
                        Task { await model.permanentlyDeleteTransaction(transaction) }
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
            .alert(item: $searchAlert) { alert in
                Alert(
                    title: Text(alert.title),
                    message: Text(alert.message),
                    dismissButton: .default(Text("OK"))
                )
            }
            .task(id: listMode) {
                await loadSelectedMode()
            }
            .refreshable {
                await loadSelectedMode()
            }
            .navigationDestination(for: Int.self) { id in
                TransactionDetailView(transactionID: id)
            }
            .safeAreaInset(edge: .bottom) {
                if selectingTransactions && listMode.supportsBulkEdit {
                    BulkSelectionBar(
                        selectedCount: selectedTransactionIDs.count,
                        canUseFilteredMode: listMode != .deleted,
                        onSelectPage: {
                            selectedTransactionIDs = Set(currentTransactions.map(\.id))
                        },
                        onClear: {
                            selectedTransactionIDs.removeAll()
                        },
                        onBulkEdit: {
                            presentingBulkEdit = true
                        }
                    )
                }
            }
            .animation(.easeInOut(duration: 0.18), value: model.showsTransactionsInitialLoading)
        }
    }

    private func loadSelectedMode() async {
        selectedTransactionIDs.removeAll()
        selectingTransactions = false
        if listMode == .deleted {
            presentingFilters = false
        }
        switch listMode {
        case .active:
            await model.loadTransactions(
                query: appliedSearchQuery,
                type: appliedType,
                categoryID: appliedCategoryID,
                tagID: appliedTagID
            )
        case .uncategorized:
            await model.loadUncategorizedTransactions(
                query: appliedSearchQuery,
                type: appliedType,
                categoryID: appliedCategoryID,
                tagID: appliedTagID
            )
        case .deleted:
            await model.loadDeletedTransactions()
        }
    }

    private func applyFilters() {
        liveSearchTask?.cancel()
        appliedSearchQuery = draftSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        appliedType = draftType
        appliedCategoryID = draftCategoryID
        appliedTagID = draftTagID
        Task { await loadSelectedMode() }
    }

    private func scheduleLiveSearch() {
        liveSearchTask?.cancel()
        guard listMode != .deleted, !isTranslatingSearch else {
            return
        }

        let query = draftSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query != appliedSearchQuery else {
            return
        }

        liveSearchTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard !Task.isCancelled else {
                return
            }
            await MainActor.run {
                guard query != appliedSearchQuery, !isTranslatingSearch else {
                    return
                }
                appliedSearchQuery = query
                Task { await loadSelectedMode() }
            }
        }
    }

    private func translateNaturalLanguageSearch() async {
        let query = draftSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            return
        }
        guard !isTranslatingSearch else {
            return
        }
        liveSearchTask?.cancel()
        isTranslatingSearch = true
        defer { isTranslatingSearch = false }

        guard let result = await model.translateSearchQuery(query) else {
            searchAlert = TransactionSearchAlert(message: model.lastError?.message ?? "Search could not be translated.")
            return
        }
        if result.clarificationNeeded || result.query.isEmpty {
            searchAlert = TransactionSearchAlert(message: result.clarificationQuestion ?? "Search could not be translated.")
            return
        }
        draftSearchQuery = result.query
        appliedSearchQuery = result.query
        lastTranslatedSearchQuery = result.query.trimmingCharacters(in: .whitespacesAndNewlines)
        await loadSelectedMode()
    }

    private func clearFilters() {
        draftType = ""
        draftCategoryID = nil
        draftTagID = nil
        appliedType = ""
        appliedCategoryID = nil
        appliedTagID = nil
        Task { await loadSelectedMode() }
    }

    private func resetDraftFiltersToApplied() {
        draftSearchQuery = appliedSearchQuery
        draftType = appliedType
        draftCategoryID = appliedCategoryID
        draftTagID = appliedTagID
    }

    private var currentTransactions: [TransactionListItem] {
        switch listMode {
        case .active:
            model.transactions?.items ?? []
        case .uncategorized:
            model.uncategorizedTransactions?.items ?? []
        case .deleted:
            []
        }
    }

    private var currentCategories: [CategorySummary] {
        switch listMode {
        case .active:
            model.transactions?.categories ?? model.knownCategories
        case .uncategorized:
            model.uncategorizedTransactions?.categories ?? model.knownCategories
        case .deleted:
            model.knownCategories
        }
    }

    private var currentTags: [TransactionTag] {
        switch listMode {
        case .active:
            model.transactions?.tags ?? model.tags?.tags.map { TransactionTag(id: $0.id, name: $0.name) } ?? []
        case .uncategorized:
            model.uncategorizedTransactions?.tags ?? model.tags?.tags.map { TransactionTag(id: $0.id, name: $0.name) } ?? []
        case .deleted:
            []
        }
    }

    private var hasStructuredFilters: Bool {
        !appliedType.isEmpty || appliedCategoryID != nil || appliedTagID != nil
    }

    private var hasActiveQueryOrFilters: Bool {
        hasStructuredFilters || !appliedSearchQuery.isEmpty
    }

    private var canAskSearch: Bool {
        let query = draftSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        return listMode != .deleted && !query.isEmpty && query != lastTranslatedSearchQuery
    }

    private var activeFilterLabels: [String] {
        var labels: [String] = []
        if !appliedType.isEmpty {
            labels.append(appliedType == "income" ? "Income" : "Expenses")
        }
        if let appliedCategoryID,
           let category = currentCategories.first(where: { $0.id == appliedCategoryID }) {
            labels.append(category.name)
        }
        if let appliedTagID,
           let tag = currentTags.first(where: { $0.id == appliedTagID }) {
            labels.append(tag.name)
        }
        return labels
    }
}

private struct TransactionSearchAlert: Identifiable {
    let id = UUID()
    let title = "Search"
    let message: String
}

private struct SearchAskSection: View {
    let query: String
    let isLoading: Bool
    var onAsk: () -> Void

    var body: some View {
        Section {
            Button {
                onAsk()
            } label: {
                HStack(spacing: 10) {
                    if isLoading {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "sparkles")
                    }
                    Text(isLoading ? "Asking" : "Ask \"\(query)\"")
                        .lineLimit(1)
                    Spacer()
                }
            }
            .disabled(isLoading)
        }
    }
}

private struct TransactionListModeMenu: View {
    @Binding var listMode: TransactionListMode

    var body: some View {
        Menu {
            Picker("List", selection: $listMode) {
                ForEach(TransactionListMode.allCases) { mode in
                    Label(mode.title, systemImage: mode.systemImage).tag(mode)
                }
            }
        } label: {
            Label(listMode.title, systemImage: listMode.systemImage)
                .labelStyle(.titleAndIcon)
        }
        .menuOrder(.fixed)
    }
}

private struct FilterSummarySection: View {
    let labels: [String]
    var onOpen: () -> Void
    var onClear: () -> Void

    var body: some View {
        Section {
            HStack(spacing: 10) {
                Button(action: onOpen) {
                    Label(labels.joined(separator: " · "), systemImage: "line.3.horizontal.decrease.circle.fill")
                        .lineLimit(1)
                }
                .buttonStyle(.plain)

                Spacer(minLength: 8)

                Button(action: onClear) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear filters")
            }
            .font(.callout.weight(.medium))
        }
    }
}

private struct TransactionFiltersSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var type: String
    @Binding var categoryID: Int?
    @Binding var tagID: Int?
    let categories: [CategorySummary]
    let tags: [TransactionTag]
    var onApply: () -> Void
    var onClear: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Picker("Type", selection: $type) {
                    Text("All").tag("")
                    Text("Income").tag("income")
                    Text("Expenses").tag("expense")
                }

                Picker("Category", selection: $categoryID) {
                    Text("All categories").tag(Int?.none)
                    ForEach(categories) { category in
                        Text("\(category.type?.capitalized ?? "Category") · \(category.name)")
                            .tag(Optional(category.id))
                    }
                }

                Picker("Tag", selection: $tagID) {
                    Text("All tags").tag(Int?.none)
                    ForEach(tags) { tag in
                        Text(tag.name).tag(Optional(tag.id))
                    }
                }
            }
            .pickerStyle(.navigationLink)
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Reset") {
                        onClear()
                        dismiss()
                    }
                    .disabled(type.isEmpty && categoryID == nil && tagID == nil)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onApply()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }
}

private enum TransactionListMode: String, CaseIterable, Identifiable {
    case active
    case uncategorized
    case deleted

    var id: String { rawValue }

    var title: String {
        switch self {
        case .active:
            "Current"
        case .uncategorized:
            "Inbox"
        case .deleted:
            "Deleted"
        }
    }

    var supportsBulkEdit: Bool {
        switch self {
        case .active, .uncategorized:
            true
        case .deleted:
            false
        }
    }

    var systemImage: String {
        switch self {
        case .active:
            "list.bullet.rectangle"
        case .uncategorized:
            "tray"
        case .deleted:
            "trash"
        }
    }
}

private struct TransactionRows: View {
    let transactions: [TransactionListItem]
    let categories: [CategorySummary]
    let selecting: Bool
    @Binding var selectedIDs: Set<Int>

    var body: some View {
        let categoriesByID = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
        ForEach(transactions) { transaction in
            let category = transaction.category.map { categoriesByID[$0.id] ?? $0 }
            if selecting {
                Button {
                    toggle(transaction.id)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: selectedIDs.contains(transaction.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selectedIDs.contains(transaction.id) ? .blue : .secondary)
                        TransactionRow(transaction: transaction, category: category)
                    }
                }
                .buttonStyle(.plain)
            } else {
                NavigationLink(value: transaction.id) {
                    TransactionRow(transaction: transaction, category: category)
                }
            }
        }
    }

    private func toggle(_ id: Int) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
        }
    }
}

private struct UncategorizedTriageRows: View {
    let transactions: [TransactionListItem]
    let categories: [CategorySummary]
    let suggestions: [TransactionSuggestion]
    let llmEnabled: Bool
    let selecting: Bool
    @Binding var selectedIDs: Set<Int>
    var onSuggest: (TransactionListItem) -> Void
    var onAccept: (TransactionSuggestion) -> Void
    var onReject: (TransactionSuggestion) -> Void

    var body: some View {
        let categoriesByID = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
        let suggestionsByTransaction = suggestions.reduce(into: [Int: TransactionSuggestion]()) { result, suggestion in
            result[suggestion.transactionID] = result[suggestion.transactionID] ?? suggestion
        }
        ForEach(transactions) { transaction in
            let category = transaction.category.map { categoriesByID[$0.id] ?? $0 }
            let suggestion = suggestionsByTransaction[transaction.id]
            VStack(alignment: .leading, spacing: 10) {
                if selecting {
                    Button {
                        toggle(transaction.id)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: selectedIDs.contains(transaction.id) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(selectedIDs.contains(transaction.id) ? .blue : .secondary)
                            TransactionRow(transaction: transaction, category: category)
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    NavigationLink(value: transaction.id) {
                        TransactionRow(transaction: transaction, category: category)
                    }
                }

                if llmEnabled {
                    if let suggestion {
                        TransactionSuggestionReview(
                            suggestion: suggestion,
                            onAccept: { onAccept(suggestion) },
                            onReject: { onReject(suggestion) }
                        )
                    } else if !selecting {
                        HStack {
                            Spacer()
                            Button {
                                onSuggest(transaction)
                            } label: {
                                Label("Suggest", systemImage: "sparkles")
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func toggle(_ id: Int) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
        }
    }
}

private struct TransactionSuggestionReview: View {
    let suggestion: TransactionSuggestion
    var onAccept: () -> Void
    var onReject: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label("Suggested", systemImage: "sparkles")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(Int((suggestion.confidence * 100).rounded()))%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            Text(suggestion.categoryName ?? "Uncategorized")
                .font(.callout.weight(.semibold))

            if let cleanTitle = suggestion.cleanTitle {
                Text(cleanTitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !suggestion.tags.isEmpty {
                Text("Tags: \(suggestion.tags.joined(separator: ", "))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(suggestion.reason)
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                Button("Reject", role: .destructive, action: onReject)
                    .buttonStyle(.bordered)
                Spacer()
                Button("Accept", action: onAccept)
                    .buttonStyle(.borderedProminent)
            }
            .font(.caption.weight(.semibold))
        }
        .padding(12)
        .background(.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct TransactionRow: View {
    @Environment(\.colorScheme) private var scheme

    let transaction: TransactionListItem
    let category: CategorySummary?

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            CategoryIconImage(iconKey: category?.icon)

            VStack(alignment: .leading, spacing: 5) {
                Text(transaction.title ?? "Untitled")
                    .font(.body.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(AppFormatters.day(transaction.date))
                        .fixedSize(horizontal: true, vertical: false)
                    if let category {
                        Text("·")
                            .foregroundStyle(.secondary)
                        Text(category.name)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    if transaction.hasAttachments {
                        Text("·")
                            .foregroundStyle(.secondary)
                        Image(systemName: "paperclip")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(AppFormatters.euros(signedAmount))
                .font(.body.weight(.semibold))
                .foregroundStyle(transaction.type == "income" ? ExpensesTheme.income(for: scheme) : ExpensesTheme.expense(for: scheme))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .layoutPriority(1)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private var signedAmount: Int {
        transaction.type == "income" ? transaction.amountCents : -transaction.netAmountCents
    }
}

private struct BulkSelectionBar: View {
    let selectedCount: Int
    let canUseFilteredMode: Bool
    var onSelectPage: () -> Void
    var onClear: () -> Void
    var onBulkEdit: () -> Void

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 12) {
                Text("\(selectedCount) selected")
                    .font(.callout.weight(.semibold))
                Spacer()
                Button("Page", action: onSelectPage)
                Button("Clear", action: onClear)
                    .disabled(selectedCount == 0)
                Button("Bulk Edit", action: onBulkEdit)
                    .buttonStyle(.glassProminent)
                    .disabled(selectedCount == 0 && !canUseFilteredMode)
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 22))
        }
        .padding(.horizontal)
        .padding(.bottom, 8)
    }
}

private struct BulkEditSheet: View {
    @Environment(\.dismiss) private var dismiss

    let mode: TransactionListMode
    let selectedIDs: Set<Int>
    let categories: [CategorySummary]
    let uncategorizedDefinition: UncategorizedDefinition?
    let query: String
    let type: String
    let filterCategoryID: Int?
    let filterTagID: Int?
    var onPreview: (BulkEditRequest) async -> BulkEditResponse?
    var onApply: (BulkEditRequest) async -> BulkEditResponse?

    @State private var selectionScope: BulkSelectionScope
    @State private var lifecycle = "none"
    @State private var categoryID: Int?
    @State private var tagPatchMode = "none"
    @State private var tags = ""
    @State private var preview: BulkEditResponse?
    @State private var formError: String?
    @State private var confirmingApply = false

    init(
        mode: TransactionListMode,
        selectedIDs: Set<Int>,
        categories: [CategorySummary],
        uncategorizedDefinition: UncategorizedDefinition?,
        query: String,
        type: String,
        filterCategoryID: Int?,
        filterTagID: Int?,
        onPreview: @escaping (BulkEditRequest) async -> BulkEditResponse?,
        onApply: @escaping (BulkEditRequest) async -> BulkEditResponse?
    ) {
        self.mode = mode
        self.selectedIDs = selectedIDs
        self.categories = categories
        self.uncategorizedDefinition = uncategorizedDefinition
        self.query = query
        self.type = type
        self.filterCategoryID = filterCategoryID
        self.filterTagID = filterTagID
        self.onPreview = onPreview
        self.onApply = onApply
        _selectionScope = State(initialValue: selectedIDs.isEmpty ? .filtered : .selected)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Selection") {
                    Picker("Apply to", selection: $selectionScope) {
                        Text("Selected").tag(BulkSelectionScope.selected)
                            .disabled(selectedIDs.isEmpty)
                        Text(mode == .uncategorized ? "All inbox" : "All filtered").tag(BulkSelectionScope.filtered)
                    }
                    LabeledContent("Selected rows", value: "\(selectedIDs.count)")
                }

                Section("Operation") {
                    Picker("Lifecycle", selection: $lifecycle) {
                        Text("No lifecycle change").tag("none")
                        Text("Soft delete").tag("soft_delete")
                    }
                    Picker("Set category", selection: $categoryID) {
                        Text("Leave unchanged").tag(Int?.none)
                        ForEach(categories) { category in
                            Text("\(category.type?.capitalized ?? "Category") · \(category.name)")
                                .tag(Optional(category.id))
                        }
                    }
                    .disabled(lifecycle != "none")
                    Picker("Tags", selection: $tagPatchMode) {
                        Text("No tag change").tag("none")
                        Text("Add").tag("add")
                        Text("Remove").tag("remove")
                        Text("Replace").tag("replace")
                        Text("Clear").tag("clear")
                    }
                    .disabled(lifecycle != "none")
                    TextField("Tag names", text: $tags)
                        .textInputAutocapitalization(.never)
                        .disabled(lifecycle != "none" || tagPatchMode == "none" || tagPatchMode == "clear")
                }

                if let formError {
                    Section {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task { await previewChanges() }
                    } label: {
                        Label("Preview", systemImage: "checklist")
                    }
                    Button(role: lifecycle == "soft_delete" ? .destructive : nil) {
                        if buildRequest() != nil {
                            confirmingApply = true
                        }
                    } label: {
                        Label("Apply", systemImage: "checkmark.circle")
                    }
                }

                if let preview {
                    BulkPreviewSection(response: preview)
                }
            }
            .navigationTitle("Bulk Edit")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .confirmationDialog("Apply bulk changes?", isPresented: $confirmingApply) {
                Button("Apply Changes", role: lifecycle == "soft_delete" ? .destructive : nil) {
                    Task { await applyChanges() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will update every transaction in the selection.")
            }
        }
    }

    private func previewChanges() async {
        guard let request = buildRequest() else {
            return
        }
        preview = await onPreview(request)
        if preview == nil {
            formError = "Bulk preview failed."
        }
    }

    private func applyChanges() async {
        guard let request = buildRequest() else {
            return
        }
        preview = await onApply(request)
        if preview != nil {
            dismiss()
        } else {
            formError = "Bulk apply failed."
        }
    }

    private func buildRequest() -> BulkEditRequest? {
        if lifecycle == "none", categoryID == nil, tagPatchMode == "none" {
            formError = "Choose at least one change."
            return nil
        }
        let cleanTags = parseTags(tags)
        if lifecycle == "none", tagPatchMode != "none", tagPatchMode != "clear", cleanTags.isEmpty {
            formError = "Enter at least one tag."
            return nil
        }
        if selectionScope == .selected, selectedIDs.isEmpty {
            formError = "Select at least one transaction."
            return nil
        }

        formError = nil
        let tagPatch = tagPatchMode == "none"
            ? nil
            : BulkTagPatchRequest(mode: tagPatchMode, tags: tagPatchMode == "clear" ? [] : cleanTags)
        let operation = BulkOperationRequest(
            setCategoryID: lifecycle == "none" ? categoryID : nil,
            tagPatch: lifecycle == "none" ? tagPatch : nil,
            lifecycle: lifecycle
        )
        let selection: BulkSelectionRequest
        if selectionScope == .selected {
            selection = BulkSelectionRequest(
                mode: "ids",
                transactionIDs: selectedIDs.sorted(),
                query: nil
            )
        } else {
            selection = BulkSelectionRequest(
                mode: "query",
                transactionIDs: [],
                query: BulkSelectionQueryRequest(
                    period: "all",
                    start: nil,
                    end: nil,
                    type: type.isEmpty ? nil : type,
                    category: filterCategoryID,
                    matchedCategoryIDs: mode == .uncategorized
                        ? uncategorizedDefinition?.matchedCategoryIDs
                        : nil,
                    tag: filterTagID,
                    q: query.isEmpty ? nil : query
                )
            )
        }
        return BulkEditRequest(selection: selection, operation: operation)
    }

    private func parseTags(_ raw: String) -> [String] {
        var seen: Set<String> = []
        var result: [String] = []
        for part in raw.split(separator: ",") {
            let clean = part.trimmingCharacters(in: .whitespacesAndNewlines)
            let lower = clean.lowercased()
            if clean.isEmpty || seen.contains(lower) {
                continue
            }
            seen.insert(lower)
            result.append(clean)
        }
        return result
    }
}

private enum BulkSelectionScope: String, CaseIterable, Identifiable {
    case selected
    case filtered

    var id: String { rawValue }
}

private struct BulkPreviewSection: View {
    let response: BulkEditResponse

    var body: some View {
        Section("Preview") {
            LabeledContent("Resolved", value: "\(response.resolvedCount)")
            LabeledContent("Skipped", value: "\(response.skippedCount)")
            LabeledContent("Category changes", value: "\(response.changes.categoryChanged)")
            LabeledContent("Tags added", value: "\(response.changes.tagsAdded)")
            LabeledContent("Tags removed", value: "\(response.changes.tagsRemoved)")
            LabeledContent("Tags replaced", value: "\(response.changes.tagsReplaced)")
            if response.changes.deleted > 0 {
                LabeledContent("Deleted", value: "\(response.changes.deleted)")
            }
            if response.changes.restored > 0 {
                LabeledContent("Restored", value: "\(response.changes.restored)")
            }
        }
    }
}

private struct DeletedTransactionsList: View {
    @Environment(\.colorScheme) private var scheme

    let transactions: [DeletedTransaction]
    var onRestore: (DeletedTransaction) -> Void
    var onPermanentDelete: (DeletedTransaction) -> Void

    var body: some View {
        if transactions.isEmpty {
            ContentUnavailableView(
                "No deleted transactions",
                systemImage: "trash",
                description: Text("Deleted transactions will appear here for recovery.")
            )
        } else {
            ForEach(transactions) { transaction in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(transaction.title ?? transaction.category?.name ?? "Untitled")
                            .font(.body.weight(.medium))
                        HStack(spacing: 6) {
                            Text(AppFormatters.day(transaction.date))
                            if let category = transaction.category {
                                Text(category.name)
                            }
                            if let deletedAt = transaction.deletedAt {
                                Text("Deleted \(AppFormatters.day(deletedAt))")
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(AppFormatters.euros(signedAmount(transaction)))
                        .font(.body.weight(.semibold))
                        .foregroundStyle(transaction.type == "income" ? ExpensesTheme.income(for: scheme) : ExpensesTheme.expense(for: scheme))
                    Menu {
                        Button("Restore") {
                            onRestore(transaction)
                        }
                        Button("Delete Forever", role: .destructive) {
                            onPermanentDelete(transaction)
                        }
                    } label: {
                        Label("Deleted transaction actions", systemImage: "ellipsis.circle")
                            .labelStyle(.iconOnly)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Deleted transaction actions")
                }
                .swipeActions(edge: .leading) {
                    Button("Restore") {
                        onRestore(transaction)
                    }
                    .tint(.green)
                }
                .swipeActions(edge: .trailing) {
                    Button("Delete Forever", role: .destructive) {
                        onPermanentDelete(transaction)
                    }
                }
            }
        }
    }

    private func signedAmount(_ transaction: DeletedTransaction) -> Int {
        transaction.type == "income" ? transaction.amountCents : -transaction.amountCents
    }
}
