import SwiftUI

/// Adds a recurring rule, entered like a transaction: the amount in large figures, a
/// name, chips for the category and schedule, and the next days it would post.
struct AddRecurringRuleSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let categories: [CategorySummary]

    @State private var type = TransactionKind.expense
    @State private var amount = ""
    @State private var name = ""
    @State private var currencyCode = "EUR"
    @State private var categoryID: Int?
    @State private var schedule = RuleSchedule(unit: .month, count: 1, policy: .snapToEnd)
    // Local days, as the pickers show them.
    @State private var start = Date.now
    @State private var end: Date?
    @State private var autoPost = true
    @State private var skipWeekends = false
    @State private var choosingRepeats = false
    @State private var choosingStart = false
    @State private var choosingEnd = false
    @State private var upcoming: Result<RecurringPreviewResponse, APIErrorInfo>?
    @State private var amountError: String?
    @State private var formError: String?
    @State private var saving = false
    @FocusState private var amountFocused: Bool

    init(categories: [CategorySummary]) {
        self.categories = categories
        _categoryID = State(initialValue: categories.first { $0.type == TransactionKind.expense.rawValue }?.id)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    EntryAmountField(text: $amount, income: type == .income, prompt: AppFormatters.amount(0, currencyCode: currencyCode))
                        .focused($amountFocused)
                        .fieldError(amountError)

                    TextField("Name", text: $name)
                        .font(.title3)

                    ChipFlow {
                        categoryChip

                        Button {
                            choosingRepeats = true
                        } label: {
                            EntryChip(schedule.unit.repeats(schedule.count), systemImage: "repeat", isSet: true)
                        }
                        .popover(isPresented: $choosingRepeats) {
                            RepeatsPopover(schedule: schedule, anchor: ruleDay(AppFormatters.isoDay(start)), confirm: "Done") { schedule = $0 }
                        }
                        .accessibilityLabel("Repeats")
                        .accessibilityValue(schedule.unit.repeats(schedule.count))

                        Button {
                            choosingStart = true
                        } label: {
                            EntryChip("From \(AppFormatters.shortDay(start))", systemImage: "calendar", isSet: true)
                        }
                        .popover(isPresented: $choosingStart) {
                            DayPopover(day: start, confirm: "Done") { start = $0 }
                        }
                        .accessibilityLabel("Start")
                        .accessibilityValue(AppFormatters.shortDay(start))

                        Button {
                            choosingEnd = true
                        } label: {
                            EntryChip(end.map { "Until \(AppFormatters.shortDay($0))" } ?? "No end", systemImage: "calendar.badge.minus", isSet: end != nil)
                        }
                        .popover(isPresented: $choosingEnd) {
                            DayPopover(day: end ?? start, confirm: "Done", onClear: end == nil ? nil : { end = nil }) { end = $0 }
                        }
                        .accessibilityLabel("End")
                        .accessibilityValue(end.map(AppFormatters.shortDay) ?? "No end")

                        Button {
                            autoPost.toggle()
                        } label: {
                            EntryChip("Post automatically", systemImage: "bolt", isSet: autoPost)
                        }
                        .accessibilityAddTraits(autoPost ? .isSelected : [])

                        Button {
                            skipWeekends.toggle()
                        } label: {
                            EntryChip("Skip weekends", systemImage: "forward.end", isSet: skipWeekends)
                        }
                        .accessibilityAddTraits(skipWeekends ? .isSelected : [])

                        Menu {
                            Picker("Currency", selection: $currencyCode) {
                                Text("Euro (€)").tag("EUR")
                                Text("US dollar ($)").tag("USD")
                            }
                        } label: {
                            EntryChip(currencyCode, systemImage: currencyCode == "USD" ? "dollarsign" : "eurosign", isSet: currencyCode == "USD")
                        }
                        .accessibilityLabel("Currency")
                        .accessibilityValue(currencyCode)
                    }
                    .buttonStyle(.plain)

                    if let upcomingText {
                        Text(upcomingText)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

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
        }
        .interactiveDismissDisabled(hasInput || saving)
        .task {
            amountFocused = true
        }
        .task(id: preview) {
            let request = preview
            let result = await model.chart { try await $0.previewRecurring(request, token: $1) }
            if !Task.isCancelled {
                upcoming = result
            }
        }
    }

    // The schedule and its options are defaults, so they alone are no input to lose.
    private var hasInput: Bool {
        !amount.isEmpty || !name.isEmpty || end != nil
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
        categories.filter { $0.type == type.rawValue }
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

    private var preview: RecurringPreviewRequest {
        RecurringPreviewRequest(
            startDate: AppFormatters.isoDay(start),
            intervalUnit: schedule.unit,
            intervalCount: schedule.count,
            monthDayPolicy: schedule.policy,
            skipWeekends: skipWeekends
        )
    }

    // "Next 13 Nov · 13 Dec · 13 Jan", up to the end.
    private var upcomingText: String? {
        switch upcoming {
        case nil:
            return nil
        case .failure:
            return "Preview unavailable"
        case .success(let preview):
            if let error = preview.error {
                return error
            }
            let last = end.map { ruleDay(AppFormatters.isoDay($0)) }
            let days = preview.occurrences.filter { day in last.map { day <= $0 } ?? true }
            return days.isEmpty ? nil : "Next " + days.map { AppFormatters.shortDay(AppFormatters.localDay($0)) }.joined(separator: " · ")
        }
    }

    private func submit() async {
        let cents = AppFormatters.parseAmountCents(amount)
        amountError = cents == nil ? "Enter a valid amount." : nil
        formError = categoryID == nil ? "Choose a category." : nil
        guard let cents, let categoryID else {
            return
        }
        if let end, AppFormatters.isoDay(end) < AppFormatters.isoDay(start) {
            formError = "The end must not be before the start."
            return
        }

        saving = true
        defer { saving = false }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = RecurringRuleRequest(
            name: trimmed.isEmpty ? nil : trimmed,
            type: type,
            currencyCode: currencyCode,
            amountCents: cents,
            categoryID: categoryID,
            anchorDate: AppFormatters.isoDay(start),
            intervalUnit: schedule.unit,
            intervalCount: schedule.count,
            nextOccurrence: AppFormatters.isoDay(start),
            endDate: end.map(AppFormatters.isoDay),
            autoPost: autoPost,
            skipWeekends: skipWeekends,
            monthDayPolicy: schedule.policy
        )
        if await model.saveRecurringRule(id: nil, body: body) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Could not add the rule."
        }
    }
}
