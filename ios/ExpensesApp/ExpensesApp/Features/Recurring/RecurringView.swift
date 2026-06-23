import SwiftUI

struct RecurringView: View {
    @Environment(AppModel.self) private var model
    @Binding private var quickAddTrigger: Int
    @State private var activeSheet: RecurringSheet?
    @State private var pendingDelete: RecurringRule?

    init(quickAddTrigger: Binding<Int> = .constant(0)) {
        _quickAddTrigger = quickAddTrigger
    }

    var body: some View {
        List {
            if model.identity?.authenticated != true {
                SignedOutStateSection()
            } else if let recurring = model.recurring {
                Section("Monthly") {
                    LabeledContent("Income", value: AppFormatters.euros(recurring.stats.totalMonthlyIncome))
                    LabeledContent("Expenses", value: AppFormatters.euros(recurring.stats.totalMonthlyExpenses))
                    LabeledContent("Net", value: AppFormatters.euros(recurring.stats.netMonthly))
                    LabeledContent("Coverage", value: "\(Int(recurring.stats.coverageRatio.rounded()))%")
                }

                Section("Rules") {
                    if recurring.rules.isEmpty {
                        ContentUnavailableView("No recurring rules", systemImage: "repeat")
                    } else {
                        ForEach(recurring.rules) { rule in
                            NavigationLink {
                                RecurringOccurrencesView(ruleID: rule.id)
                            } label: {
                                RecurringRuleRow(rule: rule)
                            }
                            .swipeActions(edge: .leading) {
                                Button(rule.autoPost ? "Disable" : "Enable") {
                                    Task { await model.toggleRecurringRule(rule, autoPost: !rule.autoPost) }
                                }
                                .tint(rule.autoPost ? .orange : .green)
                                Button("Edit") {
                                    activeSheet = .rule(rule)
                                }
                                .tint(.blue)
                            }
                            .swipeActions(edge: .trailing) {
                                Button("Delete", role: .destructive) {
                                    pendingDelete = rule
                                }
                            }
                        }
                    }
                }

                if !recurring.stats.expenseBreakdown.isEmpty {
                    Section("Expense mix") {
                        ForEach(recurring.stats.expenseBreakdown) { item in
                            LabeledContent(item.name, value: AppFormatters.euros(item.amountCents))
                        }
                    }
                }
            } else if model.isLoading {
                LoadingStateSection(title: "Loading recurring rules")
            } else {
                ContentUnavailableView("No recurring rules loaded", systemImage: "repeat")
            }
        }
        .navigationTitle("Recurring")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    activeSheet = .rule(nil)
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add Recurring Rule")
                .disabled(model.identity?.authenticated != true)
            }
        }
        .expensesScreenStyle()
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .rule(let rule):
                RecurringRuleFormView(rule: rule, categories: model.recurring?.categories ?? [])
            }
        }
        .confirmationDialog(
            "Delete recurring rule?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { isPresented in
                    if !isPresented {
                        pendingDelete = nil
                    }
                }
            )
        ) {
            Button("Delete Rule", role: .destructive) {
                if let rule = pendingDelete {
                    Task { await model.deleteRecurringRule(rule) }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .task {
            await model.loadRecurring()
        }
        .refreshable {
            await model.loadRecurring()
        }
        .animation(.easeInOut(duration: 0.18), value: model.isLoading && model.recurring == nil)
        .onChange(of: quickAddTrigger) { _, _ in
            activeSheet = .rule(nil)
        }
    }
}

private enum RecurringSheet: Identifiable {
    case rule(RecurringRule?)

    var id: String {
        switch self {
        case .rule(let rule):
            "rule-\(rule?.id ?? 0)"
        }
    }
}

private struct RecurringRuleRow: View {
    let rule: RecurringRule

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(rule.name ?? rule.category?.name ?? "Untitled")
                    .font(.body.weight(.medium))
                Text("\(frequencyLabel) · Next \(AppFormatters.day(rule.nextOccurrence))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(AppFormatters.euros(rule.type == "income" ? rule.amountCents : -rule.amountCents))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(rule.type == "income" ? .green : .primary)
                Text(rule.autoPost ? "Auto" : "Manual")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var frequencyLabel: String {
        if rule.intervalCount == 1 {
            return "Every \(rule.intervalUnit)"
        }
        return "Every \(rule.intervalCount) \(rule.intervalUnit)s"
    }
}

private struct RecurringRuleFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let rule: RecurringRule?
    let categories: [RecurringCategory]
    @State private var name: String
    @State private var type: String
    @State private var currencyCode: String
    @State private var amount: String
    @State private var categoryID: Int?
    @State private var anchorDate: Date
    @State private var intervalUnit: String
    @State private var intervalCount: Int
    @State private var endDate: Date?
    @State private var hasEndDate: Bool
    @State private var autoPost: Bool
    @State private var skipWeekends: Bool
    @State private var monthDayPolicy: String
    @State private var preview: RecurringPreviewResponse?
    @State private var formError: String?

    init(rule: RecurringRule?, categories: [RecurringCategory]) {
        self.rule = rule
        self.categories = categories
        _name = State(initialValue: rule?.name ?? "")
        _type = State(initialValue: rule?.type ?? "expense")
        _currencyCode = State(initialValue: rule?.currencyCode ?? "EUR")
        if let amount = rule?.amountCents {
            _amount = State(initialValue: String(format: "%.2f", Double(amount) / 100.0))
        } else {
            _amount = State(initialValue: "")
        }
        _categoryID = State(initialValue: rule?.categoryID)
        _anchorDate = State(initialValue: rule?.anchorDate ?? Date())
        _intervalUnit = State(initialValue: rule?.intervalUnit ?? "month")
        _intervalCount = State(initialValue: rule?.intervalCount ?? 1)
        _endDate = State(initialValue: rule?.endDate)
        _hasEndDate = State(initialValue: rule?.endDate != nil)
        _autoPost = State(initialValue: rule?.autoPost ?? true)
        _skipWeekends = State(initialValue: rule?.skipWeekends ?? false)
        _monthDayPolicy = State(initialValue: rule?.monthDayPolicy ?? "snap_to_end")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    Picker("Type", selection: $type) {
                        Text("Expense").tag("expense")
                        Text("Income").tag("income")
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: type) { _, nextType in
                        if !filteredCategories(for: nextType).contains(where: { $0.id == categoryID }) {
                            categoryID = filteredCategories(for: nextType).first?.id
                        }
                    }
                    Picker("Currency", selection: $currencyCode) {
                        Text("EUR").tag("EUR")
                        Text("USD").tag("USD")
                    }
                    TextField("Amount", text: $amount)
                        .keyboardType(.decimalPad)
                    Picker("Category", selection: $categoryID) {
                        Text("Select category").tag(Int?.none)
                        ForEach(filteredCategories(for: type)) { category in
                            Text(category.name).tag(Optional(category.id))
                        }
                    }
                }

                Section("Schedule") {
                    DatePicker("Start date", selection: $anchorDate, displayedComponents: .date)
                    Stepper("Every \(intervalCount) \(intervalUnit)\(intervalCount == 1 ? "" : "s")", value: $intervalCount, in: 1...365)
                    Picker("Interval", selection: $intervalUnit) {
                        Text("Day").tag("day")
                        Text("Week").tag("week")
                        Text("Month").tag("month")
                        Text("Year").tag("year")
                    }
                    Toggle("Has end date", isOn: $hasEndDate)
                    if hasEndDate {
                        DatePicker(
                            "End date",
                            selection: Binding(
                                get: { endDate ?? anchorDate },
                                set: { endDate = $0 }
                            ),
                            displayedComponents: .date
                        )
                    }
                    Toggle("Auto-post", isOn: $autoPost)
                    Toggle("Skip weekends", isOn: $skipWeekends)
                    Picker("Missing month day", selection: $monthDayPolicy) {
                        Text("Last day").tag("snap_to_end")
                        Text("Skip").tag("skip")
                        Text("Carry forward").tag("carry_forward")
                    }
                }

                Section("Preview") {
                    Button {
                        Task { await previewSchedule() }
                    } label: {
                        Label("Preview Schedule", systemImage: "calendar.badge.clock")
                    }
                    if let preview {
                        if let error = preview.error {
                            Text(error)
                                .foregroundStyle(.red)
                        } else {
                            ForEach(Array(preview.occurrences.enumerated()), id: \.offset) { _, occurrence in
                                Text(AppFormatters.day(occurrence))
                            }
                        }
                    }
                }

                if let formError {
                    Section {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(rule == nil ? "Add Rule" : "Edit Rule")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(model.isLoading)
                }
            }
        }
    }

    private func previewSchedule() async {
        let body = RecurringPreviewRequest(
            startDate: RecurringFormParsing.dateString(anchorDate),
            intervalUnit: intervalUnit,
            intervalCount: intervalCount,
            monthDayPolicy: monthDayPolicy,
            skipWeekends: skipWeekends
        )
        preview = await model.previewRecurring(body)
        if preview == nil {
            formError = model.lastError?.message ?? "Schedule preview failed."
        }
    }

    private func save() async {
        guard let amountCents = RecurringFormParsing.parseAmount(amount) else {
            formError = "Amount is invalid."
            return
        }
        guard let categoryID else {
            formError = "Category is required."
            return
        }
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let anchor = RecurringFormParsing.dateString(anchorDate)
        let nextOccurrence = recurringNextOccurrence(anchor: anchor)
        let body = RecurringRuleRequest(
            name: cleanName.isEmpty ? nil : cleanName,
            type: type,
            currencyCode: currencyCode,
            amountCents: amountCents,
            categoryID: categoryID,
            anchorDate: anchor,
            intervalUnit: intervalUnit,
            intervalCount: intervalCount,
            nextOccurrence: nextOccurrence,
            endDate: hasEndDate ? RecurringFormParsing.dateString(endDate ?? anchorDate) : nil,
            autoPost: autoPost,
            skipWeekends: skipWeekends,
            monthDayPolicy: monthDayPolicy
        )
        if await model.saveRecurringRule(id: rule?.id, body: body) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Recurring rule could not be saved."
        }
    }

    private func recurringNextOccurrence(anchor: String) -> String {
        guard let rule else {
            return anchor
        }
        if RecurringFormParsing.dateString(rule.anchorDate) == anchor,
           rule.intervalUnit == intervalUnit,
           rule.intervalCount == intervalCount,
           (rule.skipWeekends ?? false) == skipWeekends,
           (rule.monthDayPolicy ?? "snap_to_end") == monthDayPolicy
        {
            return RecurringFormParsing.dateString(rule.nextOccurrence)
        }
        return anchor
    }

    private func filteredCategories(for selectedType: String) -> [RecurringCategory] {
        categories.filter { $0.type == selectedType }
    }
}

private struct RecurringOccurrencesView: View {
    @Environment(AppModel.self) private var model
    let ruleID: Int

    private var data: RecurringOccurrencesResponse? {
        model.recurringOccurrences?.rule.id == ruleID ? model.recurringOccurrences : nil
    }

    var body: some View {
        List {
            if let data {
                Section {
                    LabeledContent("Amount", value: AppFormatters.euros(data.rule.amountCents))
                    LabeledContent("Category", value: data.rule.category?.name ?? "-")
                    LabeledContent("Next", value: AppFormatters.day(data.rule.nextOccurrence))
                    LabeledContent("Auto-post", value: data.rule.autoPost ? "Yes" : "No")
                }
                Section("Posted transactions") {
                    if data.occurrences.isEmpty {
                        ContentUnavailableView("No occurrences posted", systemImage: "clock.arrow.circlepath")
                    } else {
                        ForEach(data.occurrences) { occurrence in
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(occurrence.title ?? occurrence.category?.name ?? "Untitled")
                                    Text(occurrence.occurrenceDate.map(AppFormatters.day) ?? "-")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(AppFormatters.euros(occurrence.amountCents))
                                    .font(.body.weight(.semibold))
                            }
                        }
                    }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(data?.rule.name ?? "Occurrences")
        .task {
            await model.loadRecurringOccurrences(ruleID: ruleID)
        }
    }
}

private enum RecurringFormParsing {
    static func parseAmount(_ raw: String) -> Int? {
        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value >= 0, value.isFinite else {
            return nil
        }
        return Int((value * 100).rounded())
    }

    static func dateString(_ date: Date) -> String {
        formatter.string(from: date)
    }

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
