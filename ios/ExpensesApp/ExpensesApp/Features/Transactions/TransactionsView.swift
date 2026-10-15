import SwiftUI
import UniformTypeIdentifiers

enum TransactionsRoute: Hashable {
    case transaction(Int)
    case trash
}

struct TransactionsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @Binding var path: [TransactionsRoute]
    @Binding var selecting: Bool
    @State private var search = ""
    @State private var presentingFilters = false
    @State private var selection: Set<Int> = []
    // Every transaction the query matches, across pages, rather than the rows picked.
    @State private var selectsAllMatching = false
    @State private var bulkSheet: BulkSheet?
    @State private var pendingBulk: PendingBulkEdit?
    @State private var appliedBulk = 0
    @State private var export: CSVFile?
    @State private var failure: String?
    @State private var searchStartsHidden = true

    var body: some View {
        @Bindable var model = model
        NavigationStack(path: $path) {
            List(selection: $selection) {
                if let transactions = model.transactions {
                    if transactions.items.isEmpty {
                        emptyState
                    } else {
                        ledger(transactions)
                    }
                } else if model.showsTransactionsLoadFailed {
                    UnavailableStateSection(
                        title: "Couldn't load transactions",
                        systemImage: "exclamationmark.triangle",
                        message: model.lastError?.message
                    ) {
                        await model.loadTransactions()
                    }
                } else {
                    LoadingStateSection(title: "Loading transactions")
                }
            }
            .refreshable {
                await model.loadTransactions()
            }
            .checkedTint()
            .quickAddButton(shown: !selecting)
            .environment(\.editMode, .constant(selecting ? .active : .inactive))
            .navigationTitle(selecting ? "\(selectionCount) Selected" : "Transactions")
            .navigationSubtitle(selecting ? "" : subtitle)
            .expensesScreenStyle()
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .automatic))
            .toolbar {
                if selecting {
                    selectionToolbar
                } else {
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        PeriodMenu(period: $model.transactionQuery.period)
                        Button {
                            presentingFilters = true
                        } label: {
                            Label(
                                "Filter",
                                systemImage: model.transactionQuery.hasFilters
                                    ? "line.3.horizontal.decrease.circle.fill"
                                    : "line.3.horizontal.decrease"
                            )
                        }
                        Menu {
                            Button("Select", systemImage: "checkmark.circle") {
                                selecting = true
                            }
                            .disabled(model.transactions?.items.isEmpty != false)
                            Button("Trash", systemImage: "trash") {
                                path.append(.trash)
                            }
                            Button("Export CSV", systemImage: "square.and.arrow.up") {
                                Task { await exportCSV() }
                            }
                        } label: {
                            Label("More", systemImage: "ellipsis")
                        }
                    }
                }
            }
            .toolbar(selecting ? .hidden : .automatic, for: .tabBar)
            .task(id: model.transactionQuery) {
                if model.transactions == nil || model.loadedTransactionQuery != model.transactionQuery {
                    await model.loadTransactions()
                }
            }
            .task(id: search) {
                try? await Task.sleep(for: .milliseconds(250))
                if !Task.isCancelled && search != model.transactionQuery.search {
                    model.transactionQuery.search = search
                }
            }
            .onChange(of: model.transactionQuery) {
                clearSelection()
            }
            // Insights opens the ledger on a new query.
            .onChange(of: model.transactionQuery.search) { _, value in
                search = value
            }
            .onChange(of: selecting) {
                clearSelection()
            }
            .onChange(of: selection) {
                if selectsAllMatching && selection != loadedIDs {
                    selectsAllMatching = false
                }
            }
            .onChange(of: model.transactions?.items.count) {
                if selectsAllMatching {
                    selection = loadedIDs
                }
            }
            .sheet(isPresented: $presentingFilters) {
                TransactionFilterSheet(
                    query: $model.transactionQuery,
                    categories: model.transactions?.categories ?? model.knownCategories,
                    tags: model.transactions?.tags ?? []
                )
            }
            .sheet(item: $bulkSheet) { sheet in
                switch sheet {
                case .category:
                    CategoryPickerSheet(title: "Set category", categories: model.activeKnownCategories) { category in
                        Task {
                            await prepareBulk(
                                BulkOperationRequest(setCategoryID: category.id, tagPatch: nil, lifecycle: "none"),
                                verb: "Change the category of",
                                confirmLabel: "Apply"
                            )
                        }
                    }
                case let .tags(mode):
                    TagPickerSheet(title: mode.title, options: tagOptions) { names in
                        guard !names.isEmpty else {
                            return
                        }
                        Task {
                            await prepareBulk(
                                BulkOperationRequest(setCategoryID: nil, tagPatch: BulkTagPatchRequest(mode: mode.rawValue, tags: names), lifecycle: "none"),
                                verb: mode.verb,
                                confirmLabel: "Apply"
                            )
                        }
                    }
                }
            }
            .bulkConfirmation($pendingBulk) { pending in
                await applyBulk(pending)
            }
            .sensoryFeedback(.success, trigger: appliedBulk)
            .fileExporter(
                isPresented: Binding(get: { export != nil }, set: { if !$0 { export = nil } }),
                document: export,
                contentType: .commaSeparatedText,
                defaultFilename: export?.filename
            ) { _ in
                export = nil
            }
            .failureAlert("Couldn't complete the action", message: $failure)
            .navigationDestination(for: TransactionsRoute.self) { route in
                switch route {
                case let .transaction(id):
                    TransactionDetailView(transactionID: id)
                case .trash:
                    TrashView()
                }
            }
        }
    }

    @ToolbarContentBuilder
    private var selectionToolbar: some ToolbarContent {
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
        ToolbarItemGroup(placement: .bottomBar) {
            // Bulk edits move rows to a category; they cannot clear one.
            Button("Category", systemImage: "square.on.circle") {
                bulkSheet = .category
            }
            .disabled(selectionCount == 0)
            Spacer()
            Menu {
                ForEach(TagPatchMode.allCases) { mode in
                    Button(mode.title, systemImage: mode.systemImage) {
                        bulkSheet = .tags(mode)
                    }
                }
                Divider()
                Button("Clear Tags", systemImage: "eraser") {
                    Task {
                        await prepareBulk(
                            BulkOperationRequest(setCategoryID: nil, tagPatch: BulkTagPatchRequest(mode: "clear", tags: []), lifecycle: "none"),
                            verb: "Clear tags on",
                            confirmLabel: "Clear Tags"
                        )
                    }
                }
            } label: {
                Label("Tags", systemImage: "tag")
            }
            .disabled(selectionCount == 0)
            Spacer()
            Button("Delete", systemImage: "trash", role: .destructive) {
                Task {
                    await prepareBulk(
                        BulkOperationRequest(setCategoryID: nil, tagPatch: nil, lifecycle: "soft_delete"),
                        verb: "Delete",
                        confirmLabel: "Delete"
                    )
                }
            }
            .disabled(selectionCount == 0)
        }
    }

    @ViewBuilder
    private func ledger(_ transactions: TransactionsResponse) -> some View {
        let categoriesByID = Dictionary(uniqueKeysWithValues: transactions.categories.map { ($0.id, $0) })
        let days = DayGroup.groups(transactions.items)
        ForEach(days) { day in
            Section {
                ForEach(day.rows) { row in
                    NavigationLink(value: TransactionsRoute.transaction(row.id)) {
                        LedgerRow(transaction: row, category: row.category.map { categoriesByID[$0.id] ?? $0 })
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                }
            } header: {
                AdaptiveRow {
                    Text(AppFormatters.bookingDay(day.date))
                        .background {
                            if searchStartsHidden && day.id == days.first?.id {
                                HiddenSearchStart { searchStartsHidden = false }
                            }
                        }
                } trailing: {
                    // The last day may continue on the next page, so it shows no partial net.
                    if !(transactions.hasMore && day.id == days.last?.id) {
                        AmountText(day.net, signed: true)
                    }
                }
            }
            .expensesRowBackground()
        }
        if transactions.hasMore {
            NextPageSection(page: transactions.page) {
                await model.loadTransactions(nextPage: true)
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        let query = model.transactionQuery
        Section {
            if query.hasFilters || !query.trimmedSearch.isEmpty {
                ContentUnavailableView {
                    Label("No matching transactions", systemImage: "magnifyingglass")
                } actions: {
                    Button("Clear filters") {
                        search = ""
                        model.transactionQuery = TransactionQuery(period: query.period)
                    }
                }
            } else if query.period != .all {
                ContentUnavailableView {
                    Label("No matching transactions", systemImage: "calendar")
                } actions: {
                    Button("Show all time") {
                        model.transactionQuery.period = .all
                    }
                }
            } else {
                ContentUnavailableView("No transactions yet", systemImage: "list.bullet")
            }
        }
        .listRowBackground(Color.clear)
    }

    // "October 2026 · Expenses · Groceries"
    private var subtitle: String {
        let query = model.transactionQuery
        var parts = [query.period.title]
        if let type = query.type {
            parts.append(type == .income ? "Income" : "Expenses")
        }
        if let categoryID = query.categoryID {
            parts.append(model.knownCategories.first { $0.id == categoryID }?.name ?? "1 category")
        }
        if let tags = query.tagSummary(model.transactions?.tags ?? []) {
            parts.append(tags)
        }
        return parts.joined(separator: " · ")
    }

    private var loadedIDs: Set<Int> {
        Set(model.transactions?.items.map(\.id) ?? [])
    }

    private var selectionCount: Int {
        selectsAllMatching ? model.transactions?.total ?? 0 : selection.count
    }

    private var tagOptions: [String] {
        (model.transactions?.tags.map(\.name) ?? []).sorted {
            $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
        }
    }

    private func clearSelection() {
        selection = []
        selectsAllMatching = false
    }

    // Previews the change, then asks to confirm it with the affected count.
    private func prepareBulk(_ operation: BulkOperationRequest, verb: String, confirmLabel: String) async {
        let request = BulkEditRequest(
            selection: selectsAllMatching
                ? BulkSelectionRequest(
                    mode: "query",
                    transactionIDs: [],
                    query: (model.loadedTransactionQuery ?? model.transactionQuery).bulkSelection()
                )
                : BulkSelectionRequest(mode: "ids", transactionIDs: selection.sorted(), query: nil),
            operation: operation
        )
        guard let preview = await model.previewBulkEdit(request) else {
            failure = model.lastError?.message ?? "The change could not be previewed."
            return
        }
        pendingBulk = PendingBulkEdit(
            request: request,
            preview: preview,
            verb: verb,
            confirmLabel: confirmLabel,
            destructive: operation.lifecycle == "soft_delete"
        )
    }

    private func applyBulk(_ pending: PendingBulkEdit) async {
        guard await model.applyBulkEdit(pending.request) != nil else {
            failure = model.lastError?.message ?? "The change could not be applied."
            return
        }
        appliedBulk += 1
        selecting = false
    }

    private func exportCSV() async {
        guard let download = await model.exportTransactionsCSV() else {
            failure = model.lastError?.message ?? "The export could not be created."
            return
        }
        export = CSVFile(data: download.data, filename: download.filename)
    }
}

/// Booking days with their rows, in list order, and each day's net.
struct DayGroup: Identifiable {
    let date: Date
    var rows: [TransactionListItem]

    // A back-dated row can bring a date back further down, so the date alone is not unique.
    var id: Int { rows[0].id }

    // Expenses count at their net after reimbursements; a reimbursement is not income.
    var net: Int {
        rows.reduce(0) { total, row in
            if row.type == "expense" {
                return total - row.netAmountCents
            }
            return row.isReimbursement ? total : total + row.amountCents
        }
    }

    static func groups(_ rows: [TransactionListItem]) -> [DayGroup] {
        var groups: [DayGroup] = []
        for row in rows {
            if groups.last?.date == row.date {
                groups[groups.count - 1].rows.append(row)
            } else {
                groups.append(DayGroup(date: row.date, rows: [row]))
            }
        }
        return groups
    }
}

/// Loads the next page when it scrolls into view.
struct NextPageSection: View {
    let page: Int
    let load: () async -> Void

    var body: some View {
        Section {
            ProgressView()
                .frame(maxWidth: .infinity)
                .task(id: page) {
                    await load()
                }
        }
        .listRowBackground(Color.clear)
    }
}

/// A bulk edit that was previewed and waits for confirmation.
struct PendingBulkEdit {
    let request: BulkEditRequest
    let title: String
    let message: String?
    let confirmLabel: String
    let destructive: Bool

    init(request: BulkEditRequest, preview: BulkEditResponse, verb: String, confirmLabel: String, destructive: Bool) {
        self.request = request
        title = "\(verb) \(transactionCount(preview.eligibleCount))?"
        message = preview.skippedCount > 0 ? "\(transactionCount(preview.skippedCount)) will be skipped." : nil
        self.confirmLabel = confirmLabel
        self.destructive = destructive
    }
}

extension View {
    func bulkConfirmation(_ pending: Binding<PendingBulkEdit?>, apply: @escaping (PendingBulkEdit) async -> Void) -> some View {
        alert(
            pending.wrappedValue?.title ?? "",
            isPresented: Binding(get: { pending.wrappedValue != nil }, set: { if !$0 { pending.wrappedValue = nil } }),
            presenting: pending.wrappedValue
        ) { edit in
            Button("Cancel", role: .cancel) {}
            Button(edit.confirmLabel, role: edit.destructive ? .destructive : .confirm) {
                Task { await apply(edit) }
            }
        } message: { edit in
            if let message = edit.message {
                Text(message)
            }
        }
    }
}

/// "1 transaction", "3 transactions".
func transactionCount(_ count: Int) -> String {
    "\(count) transaction\(count == 1 ? "" : "s")"
}

private enum BulkSheet: Identifiable {
    case category
    case tags(TagPatchMode)

    var id: String {
        switch self {
        case .category:
            "category"
        case let .tags(mode):
            mode.rawValue
        }
    }
}

private enum TagPatchMode: String, CaseIterable, Identifiable {
    case add
    case remove
    case replace

    var id: String { rawValue }

    var title: String {
        switch self {
        case .add:
            "Add tags"
        case .remove:
            "Remove tags"
        case .replace:
            "Replace tags"
        }
    }

    var verb: String {
        switch self {
        case .add:
            "Add tags to"
        case .remove:
            "Remove tags from"
        case .replace:
            "Replace tags on"
        }
    }

    var systemImage: String {
        switch self {
        case .add:
            "plus"
        case .remove:
            "minus"
        case .replace:
            "arrow.left.arrow.right"
        }
    }
}

private struct CSVFile: FileDocument {
    static let readableContentTypes: [UTType] = [.commaSeparatedText]

    let data: Data
    let filename: String

    init(data: Data, filename: String) {
        self.data = data
        self.filename = filename
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
        filename = configuration.file.filename ?? "transactions.csv"
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

/// Type, category and tags. Changes apply as they are made.
private struct TransactionFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var query: TransactionQuery
    let categories: [CategorySummary]
    let tags: [TransactionTag]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $query.type) {
                        Text("All").tag(TransactionKind?.none)
                        Text("Expense").tag(TransactionKind?.some(.expense))
                        Text("Income").tag(TransactionKind?.some(.income))
                    }
                    .pickerStyle(.segmented)

                    Picker("Category", selection: $query.categoryID) {
                        Text("All categories").tag(Int?.none)
                        ForEach(categories) { category in
                            Label {
                                Text(category.name)
                            } icon: {
                                CategoryGlyph(categoryID: category.id, iconKey: category.icon, name: category.name)
                            }
                            .tag(Optional(category.id))
                        }
                    }
                    .pickerStyle(.navigationLink)
                }
                .expensesRowBackground()

                TagFilterSection(mode: $query.tagMode, ids: $query.tagIDs, tags: tags)
            }
            .navigationTitle("Filter")
            .navigationBarTitleDisplayMode(.inline)
            .expensesScreenStyle()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Clear") {
                        query = TransactionQuery(period: query.period, search: query.search)
                    }
                    .disabled(!query.hasFilters)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", role: .confirm) {
                        dismiss()
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: query)
        }
        .presentationDetents([.medium, .large])
    }
}

/// Collapses the search field under the title once, so the ledger opens with it hidden;
/// SwiftUI opens it partly shown below a subtitle. Pull down at the top to show it.
private struct HiddenSearchStart: UIViewRepresentable {
    var onCollapse: () -> Void

    func makeUIView(context: Context) -> Anchor {
        let anchor = Anchor()
        anchor.onCollapse = onCollapse
        return anchor
    }

    func updateUIView(_ anchor: Anchor, context: Context) {}

    final class Anchor: UIView {
        var onCollapse: () -> Void = {}

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard window != nil else { return }
            // The navigation bar settles its layout after the first rows appear.
            DispatchQueue.main.async { [weak self] in self?.collapse() }
        }

        private func collapse() {
            onCollapse()
            guard
                let scrollView = sequence(first: self as UIView, next: \.superview).first(where: { $0 is UIScrollView }) as? UIScrollView,
                let controller = sequence(first: scrollView as UIResponder, next: \.next).first(where: { $0 is UIViewController }) as? UIViewController,
                let searchController = controller.navigationItem.searchController,
                !searchController.isActive
            else { return }
            let searchBar = searchController.searchBar
            // Scrolling by the field's height collapses it, but UIKit then keeps the rows
            // in place by scrolling further, so settle on the top of the shortened list.
            scrollView.contentOffset.y += searchBar.frame.height
            controller.navigationController?.view.layoutIfNeeded()
            scrollView.contentOffset.y = -scrollView.adjustedContentInset.top
        }
    }
}
