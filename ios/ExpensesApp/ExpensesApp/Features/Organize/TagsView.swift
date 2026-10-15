import SwiftUI

private enum TagSort: String, ListSortKey {
    case spent
    case usage
    case name
    case created

    var id: Self { self }

    var title: String {
        switch self {
        case .spent:
            "Spent"
        case .usage:
            "Usage"
        case .name:
            "Name"
        case .created:
            "Date Created"
        }
    }

    var ascendingTitle: String {
        switch self {
        case .spent:
            "Lowest First"
        case .usage:
            "Least Used First"
        case .name:
            "A to Z"
        case .created:
            "Oldest First"
        }
    }

    var descendingTitle: String {
        switch self {
        case .spent:
            "Highest First"
        case .usage:
            "Most Used First"
        case .name:
            "Z to A"
        case .created:
            "Newest First"
        }
    }

    var startsAscending: Bool {
        self == .name || self == .created
    }
}

/// "1 Nov – 30 Nov 2026" for a tag's auto-add days.
func autoAddRange(_ period: TagAutoAttachPeriod) -> String {
    (ruleDay(period.start)..<ruleDay(period.end)).formatted(Date.IntervalFormatStyle(timeZone: .gmt).day().month(.abbreviated).year())
}

/// Whether today is before, inside or after a tag's auto-add days.
func autoAddStatus(_ period: TagAutoAttachPeriod) -> String {
    let today = AppFormatters.isoDay(.now)
    return today < period.start ? "upcoming" : today > period.end ? "ended" : "active"
}

/// Tags with their spending and use in the period; archived ones last.
struct TagsView: View {
    @Environment(AppModel.self) private var model
    @State private var sort = ListSort(key: TagSort.spent, ascending: false)
    @State private var adding = false
    @State private var loadFailed = false

    let openTransactions: (TransactionQuery) -> Void

    var body: some View {
        @Bindable var model = model
        List {
            if let tags = model.tags?.tags {
                if tags.isEmpty {
                    ContentUnavailableView {
                        Label("No tags yet", systemImage: "tag")
                    } actions: {
                        Button("Add tag") {
                            adding = true
                        }
                    }
                    .listRowBackground(Color.clear)
                } else {
                    band("Active", sorted(tags.filter { $0.archivedAt == nil }, by: sort))
                    band("Archived", sorted(tags.filter { $0.archivedAt != nil }, by: ListSort(key: .name, ascending: true)))
                }
            } else if loadFailed {
                UnavailableStateSection(title: "Couldn't load tags", systemImage: "exclamationmark.triangle", message: model.lastError?.message) {
                    loadFailed = !(await model.loadTags())
                }
            } else {
                LoadingStateSection(title: "Loading tags")
            }
        }
        .refreshable {
            loadFailed = !(await model.loadTags())
        }
        .navigationTitle("Tags")
        .navigationSubtitle(model.tagsPeriod.title)
        .expensesScreenStyle()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                PeriodMenu(period: $model.tagsPeriod)
                SortMenu(sort: $sort)
                Button("Add tag", systemImage: "plus") {
                    adding = true
                }
            }
        }
        .sheet(isPresented: $adding) {
            AddTagSheet()
        }
        .task(id: model.tagsPeriod) {
            loadFailed = !(await model.loadTags())
        }
    }

    @ViewBuilder
    private func band(_ title: String, _ rows: [TagRow]) -> some View {
        if !rows.isEmpty {
            Section {
                ForEach(rows) { tag in
                    NavigationLink {
                        TagDetailView(tagID: tag.id, openTransactions: openTransactions)
                    } label: {
                        TagListRow(tag: tag)
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

    private func sorted(_ rows: [TagRow], by sort: ListSort<TagSort>) -> [TagRow] {
        rows.sorted { a, b in
            let order: ComparisonResult = switch sort.key {
            case .spent:
                a.expenseCents == b.expenseCents ? .orderedSame : a.expenseCents < b.expenseCents ? .orderedAscending : .orderedDescending
            case .usage:
                a.usageCount == b.usageCount ? .orderedSame : a.usageCount < b.usageCount ? .orderedAscending : .orderedDescending
            case .created:
                a.createdAt == b.createdAt ? .orderedSame : a.createdAt < b.createdAt ? .orderedAscending : .orderedDescending
            case .name:
                a.name.localizedCaseInsensitiveCompare(b.name)
            }
            if order == .orderedSame {
                return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
            return sort.ascending ? order == .orderedAscending : order == .orderedDescending
        }
    }
}

/// A tag in the list: its name and state, its use, and what it spent or earned.
private struct TagListRow: View {
    @Environment(\.colorScheme) private var scheme

    let tag: TagRow

    var body: some View {
        let state = tag.archivedAt.map { "Archived \(AppFormatters.shortDay($0))" }
            ?? tag.autoAttachPeriod.map { "Auto \(autoAddRange($0)) · \(autoAddStatus($0))" }
        HStack(spacing: 12) {
            Image(systemName: "tag")
                .font(.callout)
                .foregroundStyle(.secondary)
                .glyphColumn()
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(tag.name)
                        .lineLimit(1)
                        .foregroundStyle(tag.archivedAt == nil ? .primary : .secondary)
                    if tag.isHiddenFromBudget {
                        Image(systemName: "nosign")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("Excluded from budgets")
                    }
                }
                Text(([state, usesText(tag.usageCount)].compactMap { $0 }).joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                if tag.expenseCents == 0 && tag.incomeCents > 0 {
                    AmountText(tag.incomeCents, signed: true)
                        .foregroundStyle(ExpensesTheme.income(for: scheme))
                } else {
                    AmountText(tag.expenseCents)
                    if tag.incomeCents > 0 {
                        AmountText(tag.incomeCents, signed: true)
                            .font(.subheadline)
                            .foregroundStyle(ExpensesTheme.income(for: scheme))
                    }
                }
            }
        }
        .contentShape(Rectangle())
    }
}

/// The days a tag joins new transactions on its own. Days are local, as the pickers
/// show them.
struct AutoAddPopover: View {
    @Environment(\.dismiss) private var dismiss
    @State private var start: Date
    @State private var end: Date
    @State private var error: String?

    let confirm: String
    let onTurnOff: (() -> Void)?
    let onDone: (TagAutoAttachPeriod) -> Void

    init(period: TagAutoAttachPeriod?, confirm: String, onTurnOff: (() -> Void)?, onDone: @escaping (TagAutoAttachPeriod) -> Void) {
        _start = State(initialValue: period.map { AppFormatters.localDay(ruleDay($0.start)) } ?? .now)
        _end = State(initialValue: period.map { AppFormatters.localDay(ruleDay($0.end)) } ?? .now)
        self.confirm = confirm
        self.onTurnOff = onTurnOff
        self.onDone = onDone
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            DatePicker("From", selection: $start, displayedComponents: .date)
            DatePicker("Until", selection: $end, displayedComponents: .date)
            if let error {
                FieldError(error)
            }
            HStack {
                if let onTurnOff {
                    Button("Turn Off") {
                        onTurnOff()
                        dismiss()
                    }
                }
                Spacer()
                Button(confirm) {
                    let period = TagAutoAttachPeriod(start: AppFormatters.isoDay(start), end: AppFormatters.isoDay(end))
                    guard period.end >= period.start else {
                        error = "The end must not be before the start."
                        return
                    }
                    onDone(period)
                    dismiss()
                }
                .fontWeight(.semibold)
            }
        }
        .padding()
        .frame(width: 340)
        .presentationCompactAdaptation(.popover)
    }
}

/// Adds a tag: its name, whether it counts in budgets and filter menus, and days it
/// joins new transactions.
private struct AddTagSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var name = ""
    @State private var excluded = false
    @State private var hiddenFromFilters = false
    @State private var autoAdd: TagAutoAttachPeriod?
    @State private var choosingAutoAdd = false
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
                            excluded.toggle()
                        } label: {
                            EntryChip("Exclude from budgets", systemImage: "nosign", isSet: excluded)
                        }
                        .accessibilityAddTraits(excluded ? .isSelected : [])

                        Button {
                            hiddenFromFilters.toggle()
                        } label: {
                            EntryChip("Hide from filters", systemImage: "line.3.horizontal.decrease", isSet: hiddenFromFilters)
                        }
                        .accessibilityAddTraits(hiddenFromFilters ? .isSelected : [])

                        Button {
                            choosingAutoAdd = true
                        } label: {
                            EntryChip(autoAdd.map { "Auto-add \(autoAddRange($0))" } ?? "Auto-add", systemImage: "calendar", isSet: autoAdd != nil)
                        }
                        .popover(isPresented: $choosingAutoAdd) {
                            AutoAddPopover(period: autoAdd, confirm: "Done", onTurnOff: autoAdd == nil ? nil : { autoAdd = nil }) {
                                autoAdd = $0
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
            .navigationTitle("New Tag")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    DiscardButton(hasChanges: hasInput)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", role: .confirm) {
                        Task { await submit() }
                    }
                    .disabled(saving)
                }
            }
        }
        .interactiveDismissDisabled(hasInput || saving)
        .task {
            nameFocused = true
        }
    }

    private var hasInput: Bool {
        !name.isEmpty || excluded || hiddenFromFilters || autoAdd != nil
    }

    private func submit() async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        nameError = trimmed.isEmpty ? "Enter a tag name." : nil
        formError = nil
        guard !trimmed.isEmpty else {
            return
        }
        saving = true
        defer { saving = false }
        let body = TagMutationRequest(
            name: trimmed,
            color: nil,
            isHiddenFromBudget: excluded,
            isHiddenFromFilters: hiddenFromFilters,
            autoAttachPeriod: autoAdd
        )
        if await model.saveTag(id: nil, body: body) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Unable to create tag."
        }
    }
}
