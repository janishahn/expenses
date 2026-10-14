import SwiftUI

/// Bank statement rows checked one by one against tracked transactions. It never compares
/// totals: a statement covers one account, while the app may track several.
struct ReconciliationView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var resolved = false
    @State private var account: String?
    @State private var outcome: BankRowResolution?
    @State private var accounts: [BankAccount]?
    @State private var rows: Result<Rows, APIErrorInfo>?
    @State private var importing = false
    @State private var prompt: BankRowPrompt?
    @State private var matchingAll: [BankStatementRow]?
    @State private var ignoringRemaining = false
    @State private var failure: String?
    @State private var changed = 0

    private struct Query: Hashable {
        let resolved: Bool
        let account: String?
        let outcome: BankRowResolution?
    }

    private struct Rows {
        var items: [BankStatementRow]
        var total: Int
        var pages: Int
    }

    var body: some View {
        List {
            Section {
                Picker("View", selection: $resolved) {
                    Text("To review").tag(false)
                    Text("Resolved").tag(true)
                }
                .pickerStyle(.segmented)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())

            switch rows {
            case nil:
                LoadingStateSection(title: "Loading bank rows")
            case let .failure(error):
                UnavailableStateSection(
                    title: "Couldn't load bank rows",
                    systemImage: "exclamationmark.triangle",
                    message: error.message
                )
            case let .success(loaded):
                if loaded.items.isEmpty {
                    emptyState
                } else if resolved {
                    Section {
                        ForEach(loaded.items) { row in
                            resolvedRow(row)
                        }
                    }
                    .expensesRowBackground()
                } else {
                    ForEach(OpenBand.allCases) { band in
                        let bandRows = loaded.items.filter { $0.status == band.status }
                        if !bandRows.isEmpty {
                            bandSection(band, rows: bandRows)
                        }
                    }
                }
                if loaded.items.count < loaded.total {
                    NextPageSection(page: loaded.pages) {
                        await loadNextPage()
                    }
                }
            }
        }
        .navigationTitle("Reconcile")
        .expensesScreenStyle()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let accounts, !accounts.isEmpty || resolved {
                    filterMenu(accounts)
                }
                Button("Import Statement", systemImage: "square.and.arrow.down") {
                    importing = true
                }
                if !resolved {
                    Menu {
                        Button("Ignore Remaining Rows…", systemImage: "eye.slash") {
                            ignoringRemaining = true
                        }
                        .disabled(openTotal == 0)
                    } label: {
                        Label("More", systemImage: "ellipsis")
                    }
                }
            }
        }
        .task(id: query) {
            await reload()
        }
        .refreshable {
            await reload()
        }
        .onChange(of: resolved) {
            rows = nil
            outcome = nil
        }
        .sheet(isPresented: $importing) {
            ImportStatementSheet(accounts: accounts ?? []) {
                changed += 1
                if resolved {
                    resolved = false
                } else {
                    await reload()
                }
            }
        }
        .alert(
            "Match \(rowCount(matchingAll?.count ?? 0))?",
            isPresented: Binding(get: { matchingAll != nil }, set: { if !$0 { matchingAll = nil } }),
            presenting: matchingAll
        ) { band in
            Button("Cancel", role: .cancel) {}
            Button("Match") {
                Task { await matchAll(band) }
            }
        }
        .alert(
            "Ignore \(rowCount(openTotal)) to review\(account.map { " in \($0)" } ?? "")?",
            isPresented: $ignoringRemaining
        ) {
            Button("Cancel", role: .cancel) {}
            Button("Ignore All") {
                Task { await finish(model.ignoreOpenBankRows(account: account)) }
            }
        } message: {
            Text("They move to Resolved, where you can reopen them.")
        }
        .bankRowPrompt($prompt, failure: $failure) {
            changed += 1
            await reload()
        }
        .sensoryFeedback(.success, trigger: changed)
        .failureAlert("Couldn't update the bank row", message: $failure)
    }

    private var query: Query {
        Query(resolved: resolved, account: account, outcome: outcome)
    }

    private var openTotal: Int {
        (try? rows?.get().total) ?? 0
    }

    private func filterMenu(_ accounts: [BankAccount]) -> some View {
        Menu {
            if !accounts.isEmpty {
                Section("Account") {
                    Picker("Account", selection: $account) {
                        Text("All Accounts").tag(String?.none)
                        ForEach(accounts) { entry in
                            Text(entry.label).tag(Optional(entry.label))
                        }
                    }
                    .pickerStyle(.inline)
                }
            }
            if resolved {
                Section("Outcome") {
                    Picker("Outcome", selection: $outcome) {
                        Text("All Outcomes").tag(BankRowResolution?.none)
                        ForEach(BankRowResolution.allCases) { resolution in
                            Label(resolution.title, systemImage: resolution.symbol).tag(Optional(resolution))
                        }
                    }
                    .pickerStyle(.inline)
                }
            }
        } label: {
            Label(
                "Filter",
                systemImage: account == nil && outcome == nil ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill"
            )
        }
    }

    private func bandSection(_ band: OpenBand, rows: [BankStatementRow]) -> some View {
        Section {
            ForEach(rows) { row in
                NavigationLink {
                    BankRowView(row: row, resolved: false) {
                        changed += 1
                        await reload()
                    }
                } label: {
                    BankRowLabel(row: row, symbol: band.symbol, detail: openDetail(row, band: band))
                }
                .navigationLinkIndicatorVisibility(.hidden)
                .swipeActions(edge: .leading) {
                    if band == .suggested {
                        Button("Match", systemImage: "link") {
                            Task { await matchSuggestion(row) }
                        }
                        .tint(ExpensesTheme.focus(for: scheme))
                    }
                }
                .contextMenu {
                    if band == .suggested {
                        Button("Match", systemImage: "link") {
                            Task { await matchSuggestion(row) }
                        }
                    }
                    Button("Create Transaction…", systemImage: "plus.circle") {
                        prompt = .create(row)
                    }
                    BankRowIgnoreMenu { reason in
                        Task { await ignore(row, reason: reason) }
                    } otherReason: {
                        prompt = .ignore(row)
                    }
                }
            }
        } header: {
            HStack(spacing: 6) {
                Text(band.title)
                Text("\(rows.count)")
                    .monospacedDigit()
                    .foregroundStyle(.tertiary)
                Spacer()
                if band == .suggested {
                    Button("Match all") {
                        matchingAll = rows
                    }
                    .font(.subheadline.weight(.medium))
                    .textCase(nil)
                }
            }
        }
        .expensesRowBackground()
    }

    private func resolvedRow(_ row: BankStatementRow) -> some View {
        let resolution = row.resolution ?? .matched
        return NavigationLink {
            BankRowView(row: row, resolved: true) {
                changed += 1
                await reload()
            }
        } label: {
            BankRowLabel(row: row, symbol: resolution.symbol, detail: resolvedDetail(row, resolution: resolution))
        }
        .navigationLinkIndicatorVisibility(.hidden)
        .contextMenu {
            Button("Reopen", systemImage: "arrow.uturn.backward") {
                if resolution == .created {
                    prompt = .reopen(row)
                } else {
                    Task { await reopen(row) }
                }
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        Section {
            if accounts?.isEmpty == true {
                ContentUnavailableView {
                    Label("No bank statements", systemImage: "building.columns")
                } actions: {
                    Button("Import statement") {
                        importing = true
                    }
                }
            } else if !resolved {
                ContentUnavailableView {
                    Label("Nothing to review", systemImage: "checkmark.circle")
                } actions: {
                    Button("Show resolved") {
                        resolved = true
                    }
                }
            } else {
                ContentUnavailableView(
                    outcome.map { "No \($0.title.lowercased()) rows" } ?? "No resolved rows",
                    systemImage: "tray"
                )
            }
        }
        .listRowBackground(Color.clear)
    }

    private func openDetail(_ row: BankStatementRow, band: OpenBand) -> String {
        let day = AppFormatters.shortDay(AppFormatters.localDay(row.bookingDate))
        switch band {
        case .suggested:
            return row.suggestedTransaction.map { "\(day) · \($0.displayTitle)" } ?? day
        case .ambiguous:
            return "\(day) · \(row.candidateCount) possible matches"
        case .missing:
            return day
        }
    }

    private func resolvedDetail(_ row: BankStatementRow, resolution: BankRowResolution) -> String {
        let day = AppFormatters.shortDay(AppFormatters.localDay(row.bookingDate))
        if resolution != .ignored, let transaction = row.suggestedTransaction {
            return "\(day) · \(transaction.displayTitle)"
        }
        return [day, resolution.title, row.ignoreReason].compactMap { $0 }.joined(separator: " · ")
    }

    private func reload() async {
        let query = query
        let pages = min(max((try? rows?.get().pages) ?? 1, 1), 4)
        let accountsResult = await model.chart { try await $0.bankAccounts(token: $1) }
        let result = await model.chart {
            try await $0.bankRows(
                resolved: query.resolved,
                outcome: query.outcome,
                account: query.account,
                page: 1,
                limit: pages * 50,
                token: $1
            )
        }
        guard !Task.isCancelled, query == self.query else {
            return
        }
        if let list = try? accountsResult.get() {
            accounts = list
        }
        rows = result.map { Rows(items: $0.items, total: $0.total, pages: pages) }
    }

    private func loadNextPage() async {
        guard case var .success(loaded) = rows else {
            return
        }
        let query = query
        let page = loaded.pages + 1
        let result = await model.chart {
            try await $0.bankRows(
                resolved: query.resolved,
                outcome: query.outcome,
                account: query.account,
                page: page,
                limit: 50,
                token: $1
            )
        }
        guard !Task.isCancelled, query == self.query else {
            return
        }
        switch result {
        case let .success(next):
            let loadedIDs = Set(loaded.items.map(\.id))
            loaded.items += next.items.filter { !loadedIDs.contains($0.id) }
            loaded.total = next.total
            loaded.pages = page
            rows = .success(loaded)
        case let .failure(error):
            failure = error.message
        }
    }

    private func matchSuggestion(_ row: BankStatementRow) async {
        await finish(model.acceptBankRowSuggestion(row))
    }

    private func matchAll(_ band: [BankStatementRow]) async {
        await finish(model.acceptBankRowSuggestions(band) != nil)
    }

    private func ignore(_ row: BankStatementRow, reason: String) async {
        await finish(model.ignoreBankRow(row, reason: reason))
    }

    private func reopen(_ row: BankStatementRow) async {
        await finish(model.reopenBankRow(row, trashCreatedTransaction: false))
    }

    private func finish(_ succeeded: Bool) async {
        if succeeded {
            changed += 1
        } else {
            failure = model.lastError?.message ?? "The bank row could not be updated."
        }
        await reload()
    }
}

private enum OpenBand: CaseIterable, Identifiable {
    case suggested
    case ambiguous
    case missing

    var id: Self { self }

    var status: BankRowStatus {
        switch self {
        case .suggested:
            .suggested
        case .ambiguous:
            .ambiguous
        case .missing:
            .missing
        }
    }

    var title: String {
        switch self {
        case .suggested:
            "Suggested match"
        case .ambiguous:
            "Several matches"
        case .missing:
            "No match"
        }
    }

    var symbol: String {
        switch self {
        case .suggested:
            "checkmark.seal"
        case .ambiguous:
            "arrow.triangle.branch"
        case .missing:
            "circle.dashed"
        }
    }
}

extension BankRowResolution {
    var title: String {
        switch self {
        case .matched:
            "Matched"
        case .created:
            "Created"
        case .ignored:
            "Ignored"
        }
    }

    var symbol: String {
        switch self {
        case .matched:
            "link"
        case .created:
            "plus.circle"
        case .ignored:
            "eye.slash"
        }
    }
}

extension BankStatementRow {
    var title: String {
        bankRowTitle(payee: payee, bookingText: bookingText, purpose: purpose)
    }

    var kind: TransactionKind {
        amountCents > 0 ? .income : .expense
    }
}

extension BankStatementPreviewRow {
    var title: String {
        bankRowTitle(payee: payee, bookingText: bookingText, purpose: purpose)
    }
}

extension BankReconciliationTransaction {
    var displayTitle: String {
        title.flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled transaction"
    }

    /// How far the transaction's date is from the booking: "same day", "2 days earlier".
    var dayDistance: String {
        if dateDeltaDays == 0 {
            return "same day"
        }
        let count = abs(dateDeltaDays)
        return "\(count) \(count == 1 ? "day" : "days") \(dateDeltaDays > 0 ? "earlier" : "later")"
    }
}

/// A bank row's name: the payee, else the booking text or purpose.
private func bankRowTitle(payee: String?, bookingText: String?, purpose: String?) -> String {
    [payee, bookingText, purpose].compactMap { $0 }.first { !$0.isEmpty } ?? "Bank transaction"
}

func rowCount(_ count: Int) -> String {
    "\(count) row\(count == 1 ? "" : "s")"
}

/// A bank amount in its own currency; income is green with a plus.
struct BankAmount: View {
    @Environment(\.colorScheme) private var scheme

    let cents: Int
    let currency: String

    var body: some View {
        AmountText(abs(cents), currencyCode: currency, signed: cents > 0)
            .foregroundStyle(cents > 0 ? ExpensesTheme.income(for: scheme) : .primary)
    }
}

private struct BankRowLabel: View {
    let row: BankStatementRow
    let symbol: String
    let detail: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.callout)
                .foregroundStyle(.secondary)
                .frame(width: 26)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title)
                    .lineLimit(1)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            BankAmount(cents: row.amountCents, currency: row.currency)
        }
        .contentShape(Rectangle())
    }
}

/// The ignore reasons, with a last item for a reason of one's own.
struct BankRowIgnoreMenu: View {
    let ignore: (String) -> Void
    let otherReason: () -> Void

    private struct Reason {
        let title: String
        let value: String
        let symbol: String
    }

    // The values match the web's, so a reason reads the same everywhere.
    private static let reasons = [
        Reason(title: "Cash Withdrawal", value: "Cash withdrawal", symbol: "banknote"),
        Reason(title: "Transfer Between My Accounts", value: "Transfer between my accounts", symbol: "arrow.left.arrow.right"),
        Reason(title: "Not Something I Track", value: "Not something I track", symbol: "eye.slash"),
    ]

    var body: some View {
        Menu {
            ForEach(Self.reasons, id: \.value) { reason in
                Button(reason.title, systemImage: reason.symbol) {
                    ignore(reason.value)
                }
            }
            Divider()
            Button("Other Reason…", systemImage: "pencil") {
                otherReason()
            }
        } label: {
            Label("Ignore", systemImage: "eye.slash")
        }
    }
}

/// A bank row action that asks for more first.
enum BankRowPrompt: Identifiable {
    case create(BankStatementRow)
    case ignore(BankStatementRow)
    case reopen(BankStatementRow)

    var id: String {
        switch self {
        case let .create(row):
            "create-\(row.id)"
        case let .ignore(row):
            "ignore-\(row.id)"
        case let .reopen(row):
            "reopen-\(row.id)"
        }
    }
}

extension View {
    /// Presents `prompt`: the create sheet, a reason for ignoring, or what happens to a
    /// created transaction when its row reopens. `onDone` runs after a change.
    func bankRowPrompt(
        _ prompt: Binding<BankRowPrompt?>,
        failure: Binding<String?>,
        onDone: @escaping () async -> Void
    ) -> some View {
        modifier(BankRowPromptModifier(prompt: prompt, failure: failure, onDone: onDone))
    }
}

private struct BankRowPromptModifier: ViewModifier {
    @Environment(AppModel.self) private var model
    @Binding var prompt: BankRowPrompt?
    @Binding var failure: String?
    let onDone: () async -> Void
    @State private var reason = ""

    func body(content: Content) -> some View {
        content
            .sheet(item: creating) { row in
                CreateFromBankRowSheet(row: row) {
                    await onDone()
                }
            }
            .alert(
                "Ignore \(ignoring.wrappedValue?.title ?? "")",
                isPresented: isPresented(ignoring),
                presenting: ignoring.wrappedValue
            ) { row in
                TextField("Reason", text: $reason)
                Button("Cancel", role: .cancel) {}
                Button("Ignore") {
                    let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
                    Task { await run(model.ignoreBankRow(row, reason: trimmed)) }
                }
                .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .confirmationDialog(
                "Reopen this row?",
                isPresented: isPresented(reopening),
                titleVisibility: .visible,
                presenting: reopening.wrappedValue
            ) { row in
                Button("Keep Transaction") {
                    Task { await run(model.reopenBankRow(row, trashCreatedTransaction: false)) }
                }
                Button("Move Transaction to Trash", role: .destructive) {
                    Task { await run(model.reopenBankRow(row, trashCreatedTransaction: true)) }
                }
            } message: { row in
                Text("The transaction “\(row.suggestedTransaction?.displayTitle ?? row.title)” was created from it.")
            }
            .onChange(of: prompt?.id) {
                reason = ""
            }
    }

    private var creating: Binding<BankStatementRow?> {
        binding { if case let .create(row) = $0 { row } else { nil } } wrap: { .create($0) }
    }

    private var ignoring: Binding<BankStatementRow?> {
        binding { if case let .ignore(row) = $0 { row } else { nil } } wrap: { .ignore($0) }
    }

    private var reopening: Binding<BankStatementRow?> {
        binding { if case let .reopen(row) = $0 { row } else { nil } } wrap: { .reopen($0) }
    }

    private func binding(
        _ unwrap: @escaping (BankRowPrompt) -> BankStatementRow?,
        wrap: @escaping (BankStatementRow) -> BankRowPrompt
    ) -> Binding<BankStatementRow?> {
        Binding(
            get: { prompt.flatMap(unwrap) },
            set: { row in prompt = row.map(wrap) }
        )
    }

    private func isPresented(_ row: Binding<BankStatementRow?>) -> Binding<Bool> {
        Binding(get: { row.wrappedValue != nil }, set: { if !$0 { row.wrappedValue = nil } })
    }

    private func run(_ succeeded: Bool) async {
        if succeeded {
            await onDone()
        } else {
            failure = model.lastError?.message ?? "The bank row could not be updated."
        }
    }
}
