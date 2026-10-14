import SwiftUI

/// Adds a monthly or annual budget, for all expense categories or one category, from a
/// start period with an optional end.
struct AddBudgetSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let budgets: BudgetsResponse
    @State private var yearly = false
    @State private var amount = ""
    @State private var categoryID: Int?
    @State private var start: CalendarMonth
    @State private var end: CalendarMonth?
    @State private var choosingStart = false
    @State private var choosingEnd = false
    @State private var amountError: String?
    @State private var formError: String?
    @State private var saving = false
    @FocusState private var amountFocused: Bool

    init(budgets: BudgetsResponse) {
        self.budgets = budgets
        _start = State(initialValue: budgets.budgetMonth)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    EntryAmountField(text: $amount, income: false)
                        .focused($amountFocused)
                        .fieldError(amountError)

                    ChipFlow {
                        Menu {
                            Picker("Category", selection: $categoryID) {
                                Label("All expense categories", systemImage: "square.grid.2x2")
                                    .tag(Int?.none)
                                ForEach(categories) { category in
                                    Label(category.name, systemImage: categorySymbolName(for: resolvedCategoryIconKey(category.icon, name: category.name)))
                                        .tag(Optional(category.id))
                                }
                            }
                        } label: {
                            EntryChip(category?.name ?? "All expense categories", isSet: category != nil) {
                                ScopeGlyph(categoryID: category?.id, iconKey: category?.icon, name: category?.name ?? "All expense categories")
                                    .frame(width: 18)
                            }
                        }

                        Button {
                            choosingStart = true
                        } label: {
                            EntryChip("From \(label(start))", systemImage: "calendar", isSet: true)
                        }
                        .popover(isPresented: $choosingStart) {
                            PeriodPopover(yearly: yearly, value: start) { start = $0 }
                        }

                        Button {
                            choosingEnd = true
                        } label: {
                            EntryChip(end.map { "Until \(label($0))" } ?? "No end", systemImage: "calendar.badge.minus", isSet: end != nil)
                        }
                        .popover(isPresented: $choosingEnd) {
                            PeriodPopover(yearly: yearly, value: end ?? start, onClear: end == nil ? nil : { end = nil }) { end = $0 }
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
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .principal) {
                    Picker("Budget period", selection: yearlySelection) {
                        Text("Monthly").tag(false)
                        Text("Annual").tag(true)
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
        .task {
            amountFocused = true
        }
    }

    // A new period kind starts at the shown month or year, with no end.
    private var yearlySelection: Binding<Bool> {
        Binding(
            get: { yearly },
            set: { next in
                yearly = next
                start = next ? CalendarMonth(year: budgets.yearValue, month: 1) : budgets.budgetMonth
                end = nil
            }
        )
    }

    private var categories: [BudgetCategory] {
        budgets.categories.filter { $0.type == "expense" && $0.archivedAt == nil }
    }

    private var category: BudgetCategory? {
        categories.first { $0.id == categoryID }
    }

    private func label(_ period: CalendarMonth) -> String {
        yearly ? String(period.year) : period.start.formatted(Date.FormatStyle(timeZone: .gmt).month(.abbreviated).year())
    }

    private func submit() async {
        guard let cents = AppFormatters.parseAmountCents(amount) else {
            amountError = "Enter a valid amount."
            return
        }
        amountError = nil
        formError = nil
        let frequency = yearly ? "yearly" : "monthly"
        let first = yearly ? CalendarMonth(year: start.year, month: 1) : start
        if let existing = budgets.templates.first(where: {
            $0.frequency == frequency && $0.category?.id == categoryID
                && $0.startsOn <= first.start && ($0.endsOn.map { $0 >= first.start } ?? true)
        }) {
            formError = "\(existing.category?.name ?? "All expense categories") already has a \(frequency) budget for this period. Edit that budget instead."
            return
        }
        let last = end.map { yearly ? CalendarMonth(year: $0.year, month: 12) : $0 }
        if let last, last < first {
            formError = "The end must not be before the start."
            return
        }

        saving = true
        defer { saving = false }
        let body = BudgetTemplateRequest(
            frequency: frequency,
            categoryID: categoryID,
            amountCents: cents,
            startsOn: "\(first.value)-01",
            endsOn: last.map { "\($0.value)-\($0.days)" }
        )
        let saved = if body.endsOn == nil {
            await model.applyBudgetTemplateFrom(body)
        } else {
            await model.saveBudgetTemplate(body)
        }
        if saved {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Could not save the budget."
        }
    }
}

/// A month, or a year for an annual budget, picked on wheels.
private struct PeriodPopover: View {
    @Environment(\.dismiss) private var dismiss

    let yearly: Bool
    @State var value: CalendarMonth
    var onClear: (() -> Void)?
    let onDone: (CalendarMonth) -> Void

    private let years = Array((CalendarMonth.current.year - 10)...(CalendarMonth.current.year + 10))

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 0) {
                if !yearly {
                    Picker("Month", selection: Binding(get: { value.month }, set: { value = CalendarMonth(year: value.year, month: $0) })) {
                        ForEach(1...12, id: \.self) { month in
                            Text(Calendar.current.standaloneMonthSymbols[month - 1]).tag(month)
                        }
                    }
                    .pickerStyle(.wheel)
                }
                Picker("Year", selection: Binding(get: { value.year }, set: { value = CalendarMonth(year: $0, month: value.month) })) {
                    ForEach(years, id: \.self) { year in
                        Text(String(year)).tag(year)
                    }
                }
                .pickerStyle(.wheel)
            }
            .frame(height: 180)
            HStack {
                if let onClear {
                    Button("No end") {
                        onClear()
                        dismiss()
                    }
                }
                Spacer()
                Button("Done") {
                    onDone(value)
                    dismiss()
                }
                .fontWeight(.semibold)
            }
        }
        .padding()
        .frame(width: 320)
        .presentationCompactAdaptation(.popover)
    }
}
