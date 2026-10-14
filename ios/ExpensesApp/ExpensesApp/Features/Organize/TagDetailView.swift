import SwiftUI

/// One tag, edited in place: its name, budgets, filter menus and auto-add days, with
/// what it spent in the Tags period, where, and its latest transactions.
struct TagDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let tagID: Int
    let openTransactions: (TransactionQuery) -> Void

    @State private var entered: [Field: Entered] = [:]
    @State private var errors: [Field: String] = [:]
    @State private var saveQueue: Task<Void, Never>?
    @State private var nameDraft = ""
    @FocusState private var nameFocused: Bool
    @State private var choosingAutoAdd = false
    @State private var merging = false
    @State private var deleting = false
    @State private var actionError: String?
    @State private var recent: Result<TransactionsResponse, APIErrorInfo>?
    @State private var detail: Result<TagDetailResponse, APIErrorInfo>?

    private enum Field: CaseIterable, Hashable {
        case name
        case budgets
        case filters
        case auto
    }

    private struct Entered {
        let id = UUID()
        let change: (inout TagMutationRequest) -> Void
    }

    private var tag: TagRow? {
        model.tags?.tags.first { $0.id == tagID }
    }

    private var query: TransactionQuery {
        var query = TransactionQuery(period: model.tagsPeriod)
        query.tagIDs = [tagID]
        return query
    }

    var body: some View {
        List {
            if let tag {
                let shown = shown(tag)
                head(tag)
                settings(tag, shown)
                recentSection
                breakdownSections
            } else if model.tags != nil {
                ContentUnavailableView("This tag no longer exists", systemImage: "tag")
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateSection(title: "Loading tag")
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .toolbar {
            if let tag {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if tag.archivedAt == nil {
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
                        Divider()
                        Button("Delete Tag", systemImage: "trash", role: .destructive) {
                            deleting = true
                        }
                    } label: {
                        Label("More actions", systemImage: "ellipsis")
                    }
                }
            }
        }
        .sheet(isPresented: $merging) {
            if let tag {
                MergeSheet(
                    sourceName: tag.name,
                    noun: "tag",
                    targets: model.activeTags.filter { $0.id != tag.id }.map { MergeTarget(id: $0.id, name: $0.name) },
                    preview: { target in
                        await model.chart { try await $0.previewTagMerge(TagMergeRequest(sourceTagID: tagID, targetTagID: target), token: $1) }
                    },
                    countRows: { counts in
                        [
                            ("Transactions", "\(counts["transaction_links"] ?? 0)"),
                            ("Budget rules", "\(counts["budget_exclude_rules"] ?? 0)"),
                        ]
                    },
                    merge: { target in
                        await model.mergeTags(sourceID: tagID, targetID: target) ? nil : model.lastError?.message ?? "Unable to merge tags."
                    },
                    onMerged: { dismiss() }
                )
            }
        }
        .alert("Delete tag “\(tag?.name ?? "")”?", isPresented: $deleting) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task { await delete() }
            }
        } message: {
            Text("It is removed from all transactions.")
        }
        .failureAlert("Couldn't change the tag", message: $actionError)
        .onChange(of: nameFocused) { _, focused in
            if !focused {
                commitName()
            }
        }
        .task {
            if model.tags == nil {
                _ = await model.loadTags()
            }
        }
        .onChange(of: tag == nil, initial: true) {
            nameDraft = tag?.name ?? ""
        }
        .task(id: query) {
            let query = query
            let result = await model.chart { try await $0.transactions(query, page: 1, limit: 5, token: $1) }
            if !Task.isCancelled {
                recent = result
            }
        }
        .task(id: model.tagsPeriod) {
            let period = model.tagsPeriod
            let result = await model.chart { try await $0.tagDetail(id: tagID, period: period, token: $1) }
            if !Task.isCancelled {
                detail = result
            }
        }
    }

    // MARK: Sections

    private func head(_ tag: TagRow) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                TextField("Name", text: $nameDraft, axis: .vertical)
                    .font(.title2.weight(.semibold))
                    .focused($nameFocused)
                    .submitLabel(.done)
                    .onChange(of: nameDraft) { _, draft in
                        // Return ends the edit instead of starting a new line.
                        if draft.contains("\n") {
                            nameDraft = draft.replacingOccurrences(of: "\n", with: "")
                            nameFocused = false
                        }
                    }
                    .fieldError(errors[.name])
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    AmountText(tag.expenseCents)
                        .font(.system(size: 34, weight: .semibold))
                    Text("spent")
                        .foregroundStyle(.secondary)
                }
                if tag.incomeCents > 0 {
                    HStack(spacing: 4) {
                        AmountText(tag.incomeCents, signed: true)
                            .foregroundStyle(ExpensesTheme.income(for: scheme))
                        Text("income")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
    }

    private func settings(_ tag: TagRow, _ shown: TagMutationRequest) -> some View {
        Section {
            Toggle("Count in budgets", isOn: Binding(get: { !shown.isHiddenFromBudget }, set: { counts in
                save(.budgets) { $0.isHiddenFromBudget = !counts }
            }))
            .fieldError(errors[.budgets])

            Toggle("Show in filter menus", isOn: Binding(get: { !shown.isHiddenFromFilters }, set: { shows in
                save(.filters) { $0.isHiddenFromFilters = !shows }
            }))
            .fieldError(errors[.filters])

            Button {
                choosingAutoAdd = true
            } label: {
                LabeledContent("Auto-add") {
                    Text(shown.autoAttachPeriod.map(autoAddRange) ?? "Off")
                        .foregroundStyle(shown.autoAttachPeriod == nil ? .secondary : .primary)
                }
            }
            .tint(.primary)
            .popover(isPresented: $choosingAutoAdd) {
                AutoAddPopover(
                    period: shown.autoAttachPeriod,
                    confirm: "Save",
                    onTurnOff: shown.autoAttachPeriod == nil ? nil : { save(.auto) { $0.autoAttachPeriod = nil } }
                ) { period in
                    if period != tag.autoAttachPeriod || errors[.auto] != nil {
                        save(.auto) { $0.autoAttachPeriod = period }
                    }
                }
            }
            .fieldError(errors[.auto])

            LabeledContent(model.tagsPeriod.title, value: usesText(tag.usageCount))
            LabeledContent("Created", value: AppFormatters.shortDay(tag.createdAt))
            if let archivedAt = tag.archivedAt {
                LabeledContent("Archived", value: AppFormatters.shortDay(archivedAt))
            }
        }
        .expensesRowBackground()
    }

    private var recentSection: some View {
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
                            title: item.title ?? item.category?.name ?? "Untitled",
                            detail: AppFormatters.bookingDay(item.date),
                            categoryID: item.category?.id,
                            iconKey: item.category?.icon,
                            categoryName: item.category?.name,
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

    @ViewBuilder
    private var breakdownSections: some View {
        if case .success(let data) = detail {
            breakdown("Expenses by category", data.donut.expenseBreakdown)
            breakdown("Income by category", data.donut.incomeBreakdown)
        }
    }

    @ViewBuilder
    private func breakdown(_ title: String, _ items: [TagBreakdownItem]) -> some View {
        if !items.isEmpty {
            let total = items.reduce(0) { $0 + $1.amountCents }
            Section(title) {
                CategoryShareDonut(slices: items.map {
                    CategoryShare(id: String($0.id), categoryID: $0.id, name: $0.name, cents: $0.amountCents, share: ($0.percent / 100).formatted(.percent.precision(.fractionLength(0))))
                }) {
                    AmountText(total, decimals: false)
                        .font(.footnote.weight(.semibold))
                }
            }
            .expensesRowBackground()
        }
    }

    // MARK: Saving

    private func shown(_ tag: TagRow) -> TagMutationRequest {
        var body = TagMutationRequest(tag)
        for field in Field.allCases {
            entered[field]?.change(&body)
        }
        return body
    }

    private func save(_ field: Field, _ change: @escaping (inout TagMutationRequest) -> Void) {
        let entry = Entered(change: change)
        if field != .name {
            entered[field] = entry
        }
        errors[field] = nil
        let previous = saveQueue
        saveQueue = Task {
            await previous?.value
            guard let stored = tag else {
                return
            }
            var body = TagMutationRequest(stored)
            change(&body)
            if await model.saveTag(id: tagID, body: body) {
                errors[field] = nil
                if entered[field]?.id == entry.id {
                    entered[field] = nil
                }
            } else {
                errors[field] = model.lastError?.message ?? "Unable to save the change."
            }
        }
    }

    private func commitName() {
        guard let tag else {
            return
        }
        let name = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            errors[.name] = "Enter a tag name."
            return
        }
        nameDraft = name
        if name != tag.name || errors[.name] != nil {
            save(.name) { $0.name = name }
        }
    }

    private func setArchived(_ archived: Bool) async {
        if !(await model.setTagArchived(id: tagID, archived: archived)) {
            actionError = model.lastError?.message ?? "Unable to \(archived ? "archive" : "restore") the tag."
        }
    }

    private func delete() async {
        if await model.deleteTag(id: tagID) {
            dismiss()
        } else {
            actionError = model.lastError?.message ?? "Unable to delete the tag."
        }
    }
}
