import SwiftUI

extension RecurringRule {
    /// The name, or the category's when the rule has none.
    var label: String {
        if let name, !name.isEmpty {
            return name
        }
        return category?.name ?? "Untitled"
    }
}

extension IntervalUnit {
    /// "Every month", "Every 4 weeks".
    func repeats(_ count: Int) -> String {
        count == 1 ? "Every \(rawValue)" : "Every \(count) \(rawValue)s"
    }

    /// "Every month on the 13th", "Every year on 1 Mar", "Every 2 weeks on Friday".
    func schedule(_ count: Int, anchor: Date) -> String {
        let style = Date.FormatStyle(timeZone: .gmt)
        let day = CalendarMonth.calendar.component(.day, from: anchor)
        return switch self {
        case .day:
            repeats(count)
        case .week:
            "\(repeats(count)) on \(anchor.formatted(style.weekday(.wide)))"
        case .month:
            "\(repeats(count)) on the \(NumberFormatter.localizedString(from: day as NSNumber, number: .ordinal))"
        case .year:
            "\(repeats(count)) on \(anchor.formatted(style.day().month(.abbreviated)))"
        }
    }

    /// Days past the 28th need a rule for shorter months.
    func needsMonthDayPolicy(_ anchor: Date) -> Bool {
        (self == .month || self == .year) && CalendarMonth.calendar.component(.day, from: anchor) > 28
    }
}

extension MonthDayPolicy {
    var title: String {
        switch self {
        case .snapToEnd:
            "Post on last day"
        case .skip:
            "Skip that month"
        case .carryForward:
            "Use previous month's day"
        }
    }
}

struct RuleSchedule: Equatable {
    var unit: IntervalUnit
    var count: Int
    var policy: MonthDayPolicy
}

/// A rule's "yyyy-MM-dd" day as the UTC midnight the API's days decode to.
func ruleDay(_ value: String) -> Date {
    try! Date(value, strategy: .iso8601.year().month().day())
}

/// "13 Nov 2026" for a day that decoded as UTC midnight.
func fullDay(_ date: Date) -> String {
    date.formatted(Date.FormatStyle(timeZone: .gmt).day().month(.abbreviated).year())
}

/// How often a rule repeats, and where it posts in a month that lacks its day.
struct RepeatsPopover: View {
    @Environment(\.dismiss) private var dismiss

    @State var schedule: RuleSchedule
    let anchor: Date
    let confirm: String
    let onDone: (RuleSchedule) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Stepper(schedule.unit.repeats(schedule.count), value: $schedule.count, in: 1...365)
            Picker("Unit", selection: $schedule.unit) {
                Text("Days").tag(IntervalUnit.day)
                Text("Weeks").tag(IntervalUnit.week)
                Text("Months").tag(IntervalUnit.month)
                Text("Years").tag(IntervalUnit.year)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            if schedule.unit.needsMonthDayPolicy(anchor) {
                Picker("Short months", selection: $schedule.policy) {
                    ForEach(MonthDayPolicy.allCases) { policy in
                        Text(policy.title).tag(policy)
                    }
                }
            }
            HStack {
                Spacer()
                Button(confirm) {
                    onDone(schedule)
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

/// A day on a calendar, with an optional way to clear it. Days are local, as the
/// picker shows them.
struct DayPopover: View {
    @Environment(\.dismiss) private var dismiss

    @State var day: Date
    let confirm: String
    var onClear: (() -> Void)?
    let onDone: (Date) -> Void

    var body: some View {
        VStack(spacing: 12) {
            DatePicker("Day", selection: $day, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .labelsHidden()
            HStack {
                if let onClear {
                    Button("No end") {
                        onClear()
                        dismiss()
                    }
                }
                Spacer()
                Button(confirm) {
                    onDone(day)
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

/// One recurring rule, edited in place. Each change saves the whole rule, and saves run
/// one after another, so each builds on the last.
struct RecurringRuleView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let ruleID: Int

    @State private var saves = FieldSaves<Field, RecurringRuleRequest>()
    // Text fields keep their own drafts and save when they lose focus.
    @State private var nameDraft = ""
    @State private var amountDraft = ""
    @State private var editingAmount = false
    @FocusState private var focus: Field?
    @State private var choosingCategory = false
    @State private var choosingRepeats = false
    @State private var choosingStart = false
    @State private var choosingEnd = false
    @State private var upcoming: Result<RecurringPreviewResponse, APIErrorInfo>?
    @State private var posted: Result<RecurringOccurrencesResponse, APIErrorInfo>?
    @State private var showsAllPosted = false
    @State private var deleting = false
    @State private var deleteError: String?

    // In the order entered values apply, so a category chosen after a type change stays.
    private enum Field: CaseIterable, Hashable {
        case name
        case amount
        case type
        case category
        case repeats
        case starts
        case ends
        case currency
        case post
        case weekends
    }

    private var rule: RecurringRule? {
        model.recurring?.rules.first { $0.id == ruleID }
    }

    var body: some View {
        List {
            if let rule {
                let shown = shown(rule)
                head(rule, shown)
                properties(rule, shown)
                if shown.type == .expense {
                    cost(rule)
                }
                upcomingSection(shown)
                postedSection(shown)
            } else if model.recurring != nil {
                ContentUnavailableView("This rule no longer exists", systemImage: "repeat")
                    .listRowBackground(Color.clear)
            } else if model.showsRecurringLoadFailed {
                UnavailableStateSection(title: "Couldn't load the rule", systemImage: "exclamationmark.triangle", message: model.lastError?.message) {
                    await model.loadRecurring()
                }
            } else {
                LoadingStateSection(title: "Loading rule")
            }
        }
        .refreshable {
            await model.loadRecurring()
            await loadPosted()
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .toolbar {
            if rule != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Delete Rule", systemImage: "trash", role: .destructive) {
                            deleting = true
                        }
                    } label: {
                        Label("More actions", systemImage: "ellipsis")
                    }
                }
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    focus = nil
                }
            }
        }
        .sheet(isPresented: $choosingCategory) {
            if let rule {
                let shown = shown(rule)
                CategoryPickerSheet(title: "Category", categories: categories(shown.type), selectedID: shown.categoryID) { category in
                    if category.id != shown.categoryID || saves.errors[.category] != nil {
                        save(.category) { $0.categoryID = category.id }
                    }
                }
            }
        }
        .navigationDestination(isPresented: $showsAllPosted) {
            if let rule, case .success(let data) = posted {
                PostedListView(title: rule.label, occurrences: data.occurrences, income: rule.type == .income)
            }
        }
        .alert("Delete recurring rule “\(rule?.label ?? "")”?", isPresented: $deleting) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task { await delete() }
            }
        }
        .failureAlert("Couldn't delete the rule", message: $deleteError)
        .onChange(of: focus) { previous, _ in
            switch previous {
            case .name:
                commitName()
            case .amount:
                commitAmount()
            default:
                break
            }
        }
        // Back can close the screen before the focused field reports losing focus.
        .onDisappear {
            commitName()
            commitAmount()
        }
        .task {
            if model.recurring == nil {
                await model.loadRecurring()
            }
        }
        .onChange(of: rule == nil, initial: true) {
            if let rule {
                nameDraft = rule.name ?? ""
                amountDraft = AppFormatters.amountInput(rule.amountCents)
            }
        }
        .task(id: rule.map { preview(shown($0)) }) {
            await loadUpcoming()
        }
        .task {
            await loadPosted()
        }
    }

    // MARK: Sections

    private func head(_ rule: RecurringRule, _ shown: RecurringRuleRequest) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                TextField(rule.category?.name ?? "Untitled", text: $nameDraft, axis: .vertical)
                    .focused($focus, equals: .name)
                    .detailNameField($nameDraft) { focus = nil }
                    .fieldError(saves.errors[.name])
                if editingAmount || saves.errors[.amount] != nil {
                    EntryAmountField(text: $amountDraft, income: shown.type == .income)
                        .focused($focus, equals: .amount)
                        .onAppear {
                            focus = .amount
                        }
                        .fieldError(saves.errors[.amount])
                } else {
                    Button {
                        editingAmount = true
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            AmountText(
                                AppFormatters.parseAmountCents(amountDraft) ?? rule.amountCents,
                                currencyCode: shown.currencyCode,
                                signed: shown.type == .income
                            )
                            .font(.largeTitle.weight(.semibold))
                            .foregroundStyle(shown.type == .income ? ExpensesTheme.income(for: scheme) : .primary)
                            Text(shown.intervalUnit.repeats(shown.intervalCount).lowercased())
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Edits the amount")
                }
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
    }

    private func properties(_ rule: RecurringRule, _ shown: RecurringRuleRequest) -> some View {
        let anchor = ruleDay(shown.anchorDate)
        let end = shown.endDate.map(ruleDay)
        return Section {
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
                    if let category = categories(shown.type).first(where: { $0.id == shown.categoryID }) ?? rule.category {
                        HStack(spacing: 4) {
                            CategoryGlyph(categoryID: category.id, iconKey: category.icon, name: category.name)
                            Text(category.name)
                                .foregroundStyle(.primary)
                        }
                    } else {
                        Text("Uncategorized")
                    }
                }
            }
            .tint(.primary)
            .fieldError(saves.errors[.category])

            Button {
                choosingRepeats = true
            } label: {
                LabeledContent("Repeats") {
                    Text(shown.intervalUnit.schedule(shown.intervalCount, anchor: anchor))
                        .foregroundStyle(.primary)
                }
            }
            .tint(.primary)
            .popover(isPresented: $choosingRepeats) {
                RepeatsPopover(
                    schedule: RuleSchedule(unit: shown.intervalUnit, count: shown.intervalCount, policy: shown.monthDayPolicy),
                    anchor: anchor,
                    confirm: "Save"
                ) { next in
                    save(.repeats) {
                        $0.intervalUnit = next.unit
                        $0.intervalCount = next.count
                        $0.monthDayPolicy = next.policy
                    }
                }
            }
            .fieldError(saves.errors[.repeats])

            Button {
                choosingStart = true
            } label: {
                LabeledContent("Starts") {
                    Text(fullDay(anchor))
                        .foregroundStyle(.primary)
                }
            }
            .tint(.primary)
            .popover(isPresented: $choosingStart) {
                DayPopover(day: AppFormatters.localDay(anchor), confirm: "Save") { day in
                    let start = AppFormatters.isoDay(day)
                    // The server posts from the next occurrence, so a later start moves it too.
                    save(.starts) {
                        $0.anchorDate = start
                        $0.nextOccurrence = max($0.nextOccurrence, start)
                    }
                }
            }
            .fieldError(saves.errors[.starts])

            Button {
                choosingEnd = true
            } label: {
                LabeledContent("Ends") {
                    Text(end.map(fullDay) ?? "Never")
                        .foregroundStyle(end == nil ? .secondary : .primary)
                }
            }
            .tint(.primary)
            .popover(isPresented: $choosingEnd) {
                DayPopover(
                    day: AppFormatters.localDay(end ?? ruleDay(shown.nextOccurrence)),
                    confirm: "Save",
                    onClear: end == nil ? nil : { save(.ends) { $0.endDate = nil } }
                ) { day in
                    save(.ends) { $0.endDate = AppFormatters.isoDay(day) }
                }
            }
            .fieldError(saves.errors[.ends])

            Picker("Currency", selection: Binding(get: { shown.currencyCode }, set: { next in
                save(.currency) { $0.currencyCode = next }
            })) {
                Text("Euro (€)").tag("EUR")
                Text("US dollar ($)").tag("USD")
            }
            .pickerStyle(.menu)
            .fieldError(saves.errors[.currency])

            Toggle("Post automatically", isOn: Binding(get: { shown.autoPost }, set: { value in
                save(.post) { $0.autoPost = value }
            }))
            .fieldError(saves.errors[.post])

            Toggle("Skip weekends", isOn: Binding(get: { shown.skipWeekends }, set: { value in
                save(.weekends) { $0.skipWeekends = value }
            }))
            .fieldError(saves.errors[.weekends])
        }
        .expensesRowBackground()
    }

    private func cost(_ rule: RecurringRule) -> some View {
        let perYear = rule.monthlyEquivalentCents * 12
        return Section("Cost") {
            LabeledContent("Per day") {
                AmountText(Int((Double(perYear) / 365).rounded()))
            }
            LabeledContent("Per year") {
                AmountText(perYear)
            }
            LabeledContent("5 years") {
                AmountText(rule.monthlyEquivalentCents * 60)
            }
        }
        .expensesRowBackground()
    }

    private func upcomingSection(_ shown: RecurringRuleRequest) -> some View {
        Section("Upcoming") {
            switch upcoming {
            case nil:
                Text("Loading…")
                    .foregroundStyle(.secondary)
            case .failure:
                Text("Preview unavailable")
                    .foregroundStyle(.secondary)
            case .success(let preview):
                if let error = preview.error {
                    Text(error)
                        .foregroundStyle(.secondary)
                } else {
                    let end = shown.endDate.map(ruleDay)
                    let dates = preview.occurrences.filter { day in end.map { day <= $0 } ?? true }
                    Text(dates.isEmpty ? "None" : dates.map { AppFormatters.shortDay(AppFormatters.localDay($0)) }.joined(separator: " · "))
                        .foregroundStyle(dates.isEmpty ? .secondary : .primary)
                }
            }
        }
        .expensesRowBackground()
    }

    private func postedSection(_ shown: RecurringRuleRequest) -> some View {
        Section {
            switch posted {
            case nil:
                Text("Loading…")
                    .foregroundStyle(.secondary)
            case .failure:
                Text("Posted transactions are unavailable.")
                    .foregroundStyle(.secondary)
            case .success(let data) where data.occurrences.isEmpty:
                Text("None yet")
                    .foregroundStyle(.secondary)
            case .success(let data):
                ForEach(data.occurrences.prefix(3)) { occurrence in
                    PostedRow(occurrence: occurrence, income: shown.type == .income)
                }
            }
        } header: {
            if case .success(let data) = posted, data.occurrences.count > 3 {
                SectionLink(title: "Posted", destination: "all \(data.occurrences.count) posted") {
                    showsAllPosted = true
                }
            } else {
                Text("Posted")
            }
        }
        .expensesRowBackground()
    }

    // MARK: Values

    private func shown(_ rule: RecurringRule) -> RecurringRuleRequest {
        saves.shown(RecurringRuleRequest(rule))
    }

    private func categories(_ type: TransactionKind) -> [CategorySummary] {
        (model.recurring?.categories ?? []).filter { $0.type == type.rawValue }
    }

    // The next dates from the next occurrence, on the rule's own schedule.
    private func preview(_ shown: RecurringRuleRequest) -> RecurringPreviewRequest {
        RecurringPreviewRequest(
            startDate: shown.nextOccurrence,
            ruleAnchorDate: shown.anchorDate,
            intervalUnit: shown.intervalUnit,
            intervalCount: shown.intervalCount,
            monthDayPolicy: shown.monthDayPolicy,
            skipWeekends: shown.skipWeekends
        )
    }

    // MARK: Saving

    private func save(_ field: Field, _ change: @escaping (inout RecurringRuleRequest) -> Void) {
        saves.save(field, stored: { rule.map { RecurringRuleRequest($0) } }, commit: { body in
            await model.saveRecurringRule(id: ruleID, body: body) ? nil : model.lastError?.message ?? "Unable to save the change."
        }, change)
    }

    // A rule's category must match its type, so a new type takes that type's first category.
    private func changeType(_ next: TransactionKind, _ shown: RecurringRuleRequest) {
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
        guard let rule else {
            return
        }
        let name = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        nameDraft = name
        let value = name.isEmpty ? nil : name
        if value != shown(rule).name || saves.errors[.name] != nil {
            save(.name) { $0.name = value }
        }
    }

    private func commitAmount() {
        guard let rule else {
            return
        }
        guard let cents = AppFormatters.parseAmountCents(amountDraft) else {
            saves.errors[.amount] = "Enter a valid amount."
            return
        }
        editingAmount = false
        if cents != shown(rule).amountCents || saves.errors[.amount] != nil {
            save(.amount) { $0.amountCents = cents }
        }
    }

    private func delete() async {
        if await model.deleteRecurringRule(id: ruleID) {
            dismiss()
        } else {
            deleteError = model.lastError?.message ?? "Unable to delete the rule."
        }
    }

    private func loadUpcoming() async {
        guard let rule else {
            return
        }
        let request = preview(shown(rule))
        let result = await model.chart { try await $0.previewRecurring(request, token: $1) }
        guard !Task.isCancelled else {
            return
        }
        upcoming = result
    }

    private func loadPosted() async {
        posted = await model.chart { try await $0.recurringOccurrences(ruleID: ruleID, token: $1) }
    }
}

/// A transaction a rule posted: its day and amount.
private struct PostedRow: View {
    @Environment(\.colorScheme) private var scheme

    let occurrence: RecurringOccurrence
    let income: Bool

    var body: some View {
        NavigationLink {
            TransactionDetailView(transactionID: occurrence.id)
        } label: {
            TrailingRow {
                Text(occurrence.occurrenceDate.map(fullDay) ?? "–")
            } trailing: {
                AmountText(occurrence.amountCents, signed: income)
                    .foregroundStyle(income ? ExpensesTheme.income(for: scheme) : .primary)
            }
        }
        .navigationLinkIndicatorVisibility(.hidden)
    }
}

/// Every transaction a rule posted, newest first.
private struct PostedListView: View {
    let title: String
    let occurrences: [RecurringOccurrence]
    let income: Bool

    var body: some View {
        List {
            Section {
                ForEach(occurrences) { occurrence in
                    PostedRow(occurrence: occurrence, income: income)
                }
            }
            .expensesRowBackground()
        }
        .navigationTitle(title)
        .navigationSubtitle(occurrences.count == 1 ? "1 posted" : "\(occurrences.count) posted")
        .expensesScreenStyle()
    }
}
