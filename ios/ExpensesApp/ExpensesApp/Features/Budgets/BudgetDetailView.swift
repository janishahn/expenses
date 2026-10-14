import SwiftUI

/// One budget: spent against it, its amount and timing, and for a month its pace and
/// top spending days.
struct BudgetDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let key: BudgetKey
    @State private var comparing = false
    @State private var burndown: Result<BudgetBurndownResponse, APIErrorInfo>?
    @State private var editingAmount = false
    @State private var removingTemplate = false
    @State private var failure: String?

    private var budget: BudgetScope? {
        model.budgets?.budget(key)
    }

    var body: some View {
        List {
            if let budgets = model.budgets, let budget {
                content(budgets, budget)
            } else {
                UnavailableStateSection(title: "This budget was removed", systemImage: "target")
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .toolbar {
            if let budgets = model.budgets, let budget {
                ToolbarItem(placement: .topBarTrailing) {
                    menu(budgets, budget)
                }
            }
        }
        .sheet(isPresented: $editingAmount) {
            if let budgets = model.budgets, let budget {
                BudgetAmountSheet(key: key, budgets: budgets, budget: budget)
            }
        }
        .alert("Remove the \(budget?.scopeLabel ?? "") budget?", isPresented: $removingTemplate) {
            Button("Cancel", role: .cancel) {}
            Button("Remove", role: .destructive) {
                if let budget {
                    Task { await remove { await model.deleteBudgetTemplate(id: budget.sourceID) } }
                }
            }
        } message: {
            Text("It is removed from every period it applies to.")
        }
        .failureAlert("Couldn't change the budget", message: $failure)
        .task(id: burndownRequest) {
            guard let burndownRequest else {
                return
            }
            let result = await model.budgetBurndown(
                month: burndownRequest.month.value,
                scope: key.scopeCategoryID.map(String.init) ?? "overall",
                compareMonth: burndownRequest.comparing ? burndownRequest.month.adding(-1).value : nil
            )
            if !Task.isCancelled {
                burndown = result
            }
        }
        .refreshable {
            if let month = model.budgets?.monthValue {
                await model.loadBudgets(month: month)
            }
        }
    }

    private struct BurndownRequest: Equatable {
        let month: BudgetMonth
        let comparing: Bool
        let budgetCents: Int
    }

    // A month's pace reloads when its amount changes.
    private var burndownRequest: BurndownRequest? {
        guard key.kind == .month, let budgets = model.budgets, let budget else {
            return nil
        }
        return BurndownRequest(month: budgets.budgetMonth, comparing: comparing, budgetCents: budget.amountCents)
    }

    @ViewBuilder
    private func content(_ budgets: BudgetsResponse, _ budget: BudgetScope) -> some View {
        let spent = budgets.spent(key.kind, budget)
        let template = budgets.activeTemplate(key.kind, scope: key.scopeCategoryID)
        let progress = key.kind == .month ? budgets.progress(key.scopeCategoryID) : nil
        let month = budgets.budgetMonth

        Section {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    if key.scopeCategoryID != nil {
                        ScopeGlyph(categoryID: key.scopeCategoryID, iconKey: budgets.category(key.scopeCategoryID)?.icon, name: budget.scopeLabel)
                    }
                    Text(budget.scopeLabel)
                        .font(.title2.weight(.semibold))
                }
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    AmountText(spent)
                        .font(.system(size: 34, weight: .semibold))
                    HStack(spacing: 4) {
                        Text("of")
                        AmountText(budget.amountCents)
                    }
                    .font(.title3)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))

        Section {
            Button {
                editingAmount = true
            } label: {
                LabeledContent("Amount") {
                    HStack(spacing: 4) {
                        AmountText(budget.amountCents)
                            .foregroundStyle(.primary)
                        if budget.source == "override", let template {
                            Text("· usually")
                            AmountText(template.amountCents)
                        }
                    }
                }
            }
            .tint(.primary)

            LabeledContent("Repeats") {
                Text(key.kind == .year ? "Every year" : budget.source == "override" && template == nil ? "Only \(month.title)" : "Every month")
                    .foregroundStyle(.primary)
            }
            if let template {
                LabeledContent("Started") {
                    Text(period(template.startsOn))
                        .foregroundStyle(.primary)
                }
                if let endsOn = template.endsOn {
                    LabeledContent("Ends") {
                        Text(period(endsOn))
                            .foregroundStyle(.primary)
                    }
                }
            }
            if let progress, progress.daysElapsed > 0 {
                LabeledContent("Projected") {
                    AmountText(progress.projectedTotalCents)
                        .foregroundStyle(Double(progress.projectedTotalCents) > Double(budget.amountCents) * 1.1 ? ExpensesTheme.expense(for: scheme) : .primary)
                }
            }
            if let progress, progress.daysRemaining > 0 {
                LabeledContent("Allowance") {
                    HStack(spacing: 4) {
                        AmountText(progress.dailyRemainingCents)
                        Text("per day")
                    }
                    .foregroundStyle(.primary)
                }
            }
            if key.kind == .year {
                let remaining = budget.amountCents - spent
                LabeledContent(remaining < 0 ? "Over" : "Left") {
                    AmountText(abs(remaining))
                        .foregroundStyle(remaining < 0 ? ExpensesTheme.expense(for: scheme) : .primary)
                }
            }
        }
        .expensesRowBackground()

        if key.kind == .month {
            Section("Pace") {
                switch burndown {
                case nil:
                    ChartMessage(text: "Loading…")
                case .failure:
                    ChartMessage(text: "The pace chart is unavailable.")
                case .success(let data):
                    PaceChart(data: data, month: month, height: 150)
                        .padding(.vertical, 8)
                }
            }
            .expensesRowBackground()

            if case .success(let data) = burndown {
                Section("Top spending days") {
                    if data.topSpendingDays.isEmpty {
                        Text("No spending yet")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(data.topSpendingDays) { day in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(day.transactions.map { $0.title.isEmpty ? "Untitled" : $0.title }.joined(separator: ", "))
                                        .lineLimit(1)
                                    Text(AppFormatters.bookingDay(month.day(day.day)))
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 8)
                                AmountText(day.totalCents)
                            }
                        }
                    }
                }
                .expensesRowBackground()
            }
        }
    }

    private func menu(_ budgets: BudgetsResponse, _ budget: BudgetScope) -> some View {
        let template = budgets.activeTemplate(key.kind, scope: key.scopeCategoryID)
        return Menu {
            if key.kind == .month {
                Toggle("Compare previous month", systemImage: "clock.arrow.circlepath", isOn: $comparing)
                Divider()
            }
            if budget.source == "override" {
                if let template {
                    Button("Reset to usual \(model.amountString(template.amountCents))", systemImage: "arrow.counterclockwise") {
                        Task { await change { await model.deleteBudgetOverride(id: budget.sourceID) } }
                    }
                } else {
                    Button("Remove \(budgets.budgetMonth.title) budget", systemImage: "trash", role: .destructive) {
                        Task { await remove { await model.deleteBudgetOverride(id: budget.sourceID) } }
                    }
                }
            } else {
                Button("Remove budget", systemImage: "trash", role: .destructive) {
                    removingTemplate = true
                }
            }
        } label: {
            Label("More actions", systemImage: "ellipsis")
        }
    }

    private func period(_ day: Date) -> String {
        let style = Date.FormatStyle(timeZone: .gmt)
        return day.formatted(key.kind == .year ? style.year() : style.month(.abbreviated).year())
    }

    private func change(_ action: () async -> Bool) async {
        if !(await action()) {
            failure = model.lastError?.message ?? "Unable to change the budget."
        }
    }

    private func remove(_ action: () async -> Bool) async {
        if await action() {
            dismiss()
        } else {
            failure = model.lastError?.message ?? "Unable to remove the budget."
        }
    }
}

/// The budget's amount. A month's amount applies to that month only or becomes the
/// usual amount from that month on; a year's amount applies from that year on.
private struct BudgetAmountSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let key: BudgetKey
    let budgets: BudgetsResponse
    let budget: BudgetScope
    @State private var amount: String
    @State private var laterMonths = false
    @State private var error: String?
    @State private var saving = false
    @FocusState private var focused: Bool

    init(key: BudgetKey, budgets: BudgetsResponse, budget: BudgetScope) {
        self.key = key
        self.budgets = budgets
        self.budget = budget
        _amount = State(initialValue: AppFormatters.amountInput(budget.amountCents))
    }

    var body: some View {
        let month = budgets.budgetMonth.title
        NavigationStack {
            Form {
                Section {
                    EntryAmountField(text: $amount, income: false)
                        .focused($focused)
                        .fieldError(error)
                }
                .expensesRowBackground()
                if key.kind == .month {
                    Section("Apply to") {
                        Picker("Apply to", selection: $laterMonths) {
                            Text("Only \(month)").tag(false)
                            Text("\(month) and later").tag(true)
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                    .expensesRowBackground()
                }
            }
            .expensesScreenStyle()
            .navigationTitle(budget.scopeLabel)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", role: .confirm) {
                        Task { await save() }
                    }
                    .disabled(saving)
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear {
            focused = true
        }
    }

    private func save() async {
        guard let cents = AppFormatters.parseAmountCents(amount) else {
            error = "Enter a valid amount."
            return
        }
        saving = true
        defer { saving = false }
        let saved = if key.kind == .month && !laterMonths {
            await model.saveBudgetOverride(
                BudgetOverrideRequest(year: budgets.year, month: budgets.month, categoryID: key.scopeCategoryID, amountCents: cents)
            )
        } else {
            await model.applyBudgetTemplateFrom(
                BudgetTemplateRequest(
                    frequency: key.kind == .month ? "monthly" : "yearly",
                    categoryID: key.scopeCategoryID,
                    amountCents: cents,
                    startsOn: key.kind == .month ? "\(budgets.budgetMonth.value)-01" : "\(budgets.yearValue)-01-01",
                    endsOn: nil
                )
            )
        }
        if saved {
            dismiss()
        } else {
            error = model.lastError?.message ?? "Could not save the budget."
        }
    }
}
