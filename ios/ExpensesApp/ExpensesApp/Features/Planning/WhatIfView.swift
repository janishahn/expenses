import Charts
import SwiftUI

/// A temporary change to the forecast, as the API names it.
private enum AdjustmentKind: String, CaseIterable, Identifiable {
    case removeRule = "remove_rule"
    case addRule = "add_rule"
    case modifyRule = "modify_rule"
    case oneTime = "one_time"
    case adjustCategory = "adjust_category"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .removeRule:
            "Remove a recurring rule"
        case .addRule:
            "Add a recurring rule"
        case .modifyRule:
            "Change a recurring rule"
        case .oneTime:
            "One-time event"
        case .adjustCategory:
            "Category estimate"
        }
    }

    var systemImage: String {
        switch self {
        case .removeRule:
            "minus.circle"
        case .addRule:
            "plus.circle"
        case .modifyRule:
            "pencil"
        case .oneTime:
            "calendar"
        case .adjustCategory:
            "slider.horizontal.3"
        }
    }
}

private enum Repeat: String, CaseIterable, Identifiable {
    case monthly
    case yearly
    case weekly

    var id: String { rawValue }

    var title: String {
        switch self {
        case .monthly:
            "Every month"
        case .yearly:
            "Every year"
        case .weekly:
            "Every week"
        }
    }
}

/// The forecast with temporary changes to rules, one-time events, and category
/// estimates, against the forecast as it is.
struct WhatIfView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var options: ForecastOptions
    @State private var adjustments: [ForecastScenarioModificationRequest] = []
    @State private var adding: AdjustmentKind?
    @State private var baseline: (options: ForecastOptions, result: Result<ForecastResponse, APIErrorInfo>)?
    // The adjustments travel with their result, so rows keep their figures while a newer one loads.
    @State private var scenario: (adjustments: [ForecastScenarioModificationRequest], response: ForecastScenarioResponse)?
    @State private var scenarioFailed = false

    private struct ScenarioRequest: Equatable {
        let options: ForecastOptions
        let adjustments: [ForecastScenarioModificationRequest]
    }

    init(options: ForecastOptions) {
        _options = State(initialValue: options)
    }

    private var rules: [RecurringRule] {
        model.recurring?.rules ?? []
    }

    private var categories: [CategorySummary] {
        model.recurring?.categories.filter { $0.type == "expense" } ?? []
    }

    var body: some View {
        List {
            switch baseline?.result {
            case nil:
                LoadingStateSection(title: "Loading forecast")
            case .failure(let error):
                UnavailableStateSection(title: "Couldn't load the forecast", systemImage: "exclamationmark.triangle", message: error.message)
            case .success(let data):
                let result = adjustments.isEmpty ? nil : scenario
                let base = result?.response.baseline
                let months = base?.months ?? data.months
                let baselineValues = [base?.startBalanceCents ?? data.startBalanceCents] + months.map(\.endBalanceCents)
                let scenarioValues = result.map { [$0.response.startBalanceCents] + $0.response.months.map(\.endBalanceCents) }
                WhatIfMetricsSection(
                    baselineCents: base?.summary.projectedBalanceCents ?? data.summary.projectedBalanceCents,
                    scenarioCents: result?.response.summary.projectedBalanceCents,
                    differenceCents: result?.response.impact.finalDeltaCents,
                    adjustmentCount: result?.adjustments.count ?? 0,
                    lastMonth: months.last.map { CalendarMonth($0.month).abbreviatedTitle },
                    horizon: baseline!.options.horizon
                )
                WhatIfBalanceSection(months: months, baseline: baselineValues, scenario: scenarioValues)
                adjustmentsSection(result)
            }
        }
        .headerProminence(.increased)
        .navigationTitle("What If")
        .navigationSubtitle(options.title)
        .expensesScreenStyle()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                ForecastOptionsMenu(options: $options) {
                    Divider()
                    Button("Clear all adjustments", systemImage: "eraser", role: .destructive) {
                        adjustments = []
                    }
                    .disabled(adjustments.isEmpty)
                }
                Menu {
                    ForEach(AdjustmentKind.allCases) { kind in
                        Button(kind.title, systemImage: kind.systemImage) {
                            adding = kind
                        }
                    }
                } label: {
                    Label("Add adjustment", systemImage: "plus")
                }
            }
        }
        .sheet(item: $adding) { kind in
            AdjustmentSheet(kind: kind, rules: rules, categories: categories) { adjustment in
                adjustments.append(adjustment)
            }
        }
        .task {
            if model.recurring == nil {
                await model.loadRecurring()
            }
        }
        .task(id: options) {
            if baseline?.options != options {
                await loadBaseline()
            }
        }
        .task(id: ScenarioRequest(options: options, adjustments: adjustments)) {
            await calculate()
        }
        .refreshable {
            async let base: Void = loadBaseline()
            async let result: Void = calculate()
            _ = await (base, result)
        }
    }

    private func adjustmentsSection(_ result: (adjustments: [ForecastScenarioModificationRequest], response: ForecastScenarioResponse)?) -> some View {
        let impacts = result.map { result in
            Dictionary(uniqueKeysWithValues: result.response.impact.byModification.compactMap { row in
                result.adjustments.indices.contains(row.index) ? (result.adjustments[row.index].id, row.finalDeltaCents) : nil
            })
        } ?? [:]
        return Section {
            if scenarioFailed {
                Label("Unable to calculate this scenario.", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(ExpensesTheme.expense(for: scheme))
            }
            if adjustments.isEmpty {
                Text("No adjustments")
                    .foregroundStyle(.secondary)
            }
            ForEach(adjustments) { adjustment in
                AdjustmentRow(adjustment: adjustment, rules: rules, categories: categories, impact: impacts[adjustment.id]) {
                    adjustments.removeAll { $0.id == adjustment.id }
                }
            }
            .onDelete { offsets in
                adjustments.remove(atOffsets: offsets)
            }
            if let result, result.adjustments.count > 1 {
                let total = result.response.impact.finalDeltaCents
                HStack(spacing: 12) {
                    Text("Total")
                        .padding(.leading, 38)
                    Spacer(minLength: 8)
                    AmountText(total, decimals: false, signed: true)
                        .foregroundStyle(total > 0 ? ExpensesTheme.income(for: scheme) : .primary)
                    Image(systemName: "xmark.circle.fill")
                        .hidden()
                }
                .fontWeight(.semibold)
            }
        } header: {
            HStack(alignment: .firstTextBaseline) {
                Text("Adjustments")
                Spacer()
                if result != nil {
                    Text("Over \(options.horizon) months")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .expensesRowBackground()
    }

    private func loadBaseline() async {
        let options = options
        let result = await model.chart { try await $0.forecast(horizon: options.horizon, mode: options.mode.rawValue, token: $1) }
        baseline = (options, result)
    }

    private func calculate() async {
        let request = ScenarioRequest(options: options, adjustments: adjustments)
        guard !request.adjustments.isEmpty else {
            scenario = nil
            scenarioFailed = false
            return
        }
        let result = await model.chart {
            try await $0.forecastScenario(
                horizon: request.options.horizon,
                mode: request.options.mode.rawValue,
                modifications: request.adjustments,
                token: $1
            )
        }
        guard !Task.isCancelled else {
            return
        }
        switch result {
        case .success(let response):
            scenario = (request.adjustments, response)
            scenarioFailed = false
        case .failure:
            scenarioFailed = true
        }
    }
}

private struct WhatIfMetricsSection: View {
    @Environment(\.colorScheme) private var scheme

    let baselineCents: Int
    let scenarioCents: Int?
    let differenceCents: Int?
    let adjustmentCount: Int
    let lastMonth: String?
    let horizon: Int

    var body: some View {
        Section {
            Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 16) {
                GridRow {
                    Metric("Difference") {
                        if let differenceCents {
                            AmountText(differenceCents, signed: true)
                                .foregroundStyle(differenceCents > 0 ? ExpensesTheme.income(for: scheme) : .primary)
                        } else {
                            Text("No changes")
                        }
                    } detail: {
                        Text("over \(horizon) months")
                    }
                    .gridCellColumns(2)
                }
                GridRow {
                    Metric(lastMonth.map { "Baseline in \($0)" } ?? "Baseline") {
                        AmountText(baselineCents)
                    } detail: {
                        Text("current rules and spending")
                    }
                    Metric(lastMonth.map { "Scenario in \($0)" } ?? "Scenario") {
                        AmountText(scenarioCents ?? baselineCents)
                    } detail: {
                        Text(adjustmentCount == 0 ? "no adjustments" : adjustmentCount == 1 ? "after 1 adjustment" : "after \(adjustmentCount) adjustments")
                    }
                }
            }
            .padding(.vertical, 6)
        }
        .expensesRowBackground()
    }
}

/// The scenario's balance against the baseline, with the difference between them.
private struct WhatIfBalanceSection: View {
    @Environment(AppModel.self) private var model
    @State private var selected: Int?

    let months: [ForecastMonth]
    let baseline: [Int]
    let scenario: [Int]?

    private var differenceColor: Color {
        Color.primary.opacity(0.08)
    }

    var body: some View {
        Section("Balance") {
            VStack(alignment: .leading, spacing: 10) {
                chart
                HStack(spacing: 14) {
                    if scenario != nil {
                        ChartLegendItem(title: "Scenario", color: .primary, mark: .line)
                        ChartLegendItem(title: "Baseline", color: .secondary, mark: .dash)
                        ChartLegendItem(title: "Difference", color: differenceColor, mark: .area)
                    } else {
                        ChartLegendItem(title: "Baseline", color: .primary, mark: .line)
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .expensesRowBackground()
    }

    private func title(_ index: Int) -> String {
        index == 0 ? "Now" : CalendarMonth(months[index - 1].month).abbreviatedTitle
    }

    private var chart: some View {
        let last = baseline.count - 1
        let labels = ["Now"] + months.map { CalendarMonth($0.month).shortTitle }
        return Chart {
            if let scenario {
                ForEach(baseline.indices, id: \.self) { index in
                    AreaMark(
                        x: .value("Month", index),
                        yStart: .value("Low", min(baseline[index], scenario[index])),
                        yEnd: .value("High", max(baseline[index], scenario[index]))
                    )
                    .foregroundStyle(differenceColor)
                    .accessibilityHidden(true)
                }
            }
            ForEach(baseline.indices, id: \.self) { index in
                LineMark(x: .value("Month", index), y: .value("Balance", baseline[index]), series: .value("Series", "Baseline"))
                    .foregroundStyle(scenario == nil ? Color.primary : Color.secondary)
                    .lineStyle(scenario == nil ? StrokeStyle(lineWidth: 2) : StrokeStyle(lineWidth: 1.25, dash: [4, 3]))
                    .accessibilityLabel("\(title(index)), baseline")
                    .accessibilityValue(model.amountString(baseline[index]))
            }
            if let scenario {
                ForEach(scenario.indices, id: \.self) { index in
                    LineMark(x: .value("Month", index), y: .value("Balance", scenario[index]), series: .value("Series", "Scenario"))
                        .foregroundStyle(Color.primary)
                        .accessibilityLabel("\(title(index)), scenario")
                        .accessibilityValue(model.amountString(scenario[index]))
                }
            }
            if let selected {
                RuleMark(x: .value("Month", selected))
                    .foregroundStyle(Color.secondary.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                        // Annotations render outside this view's environment.
                        ChartTooltip(title: title(selected)) {
                            if let scenario {
                                TooltipRow(label: "Scenario", color: .primary) {
                                    AmountText(scenario[selected])
                                }
                                TooltipRow(label: "Baseline", color: .secondary) {
                                    AmountText(baseline[selected])
                                }
                                TooltipRow(label: "Difference", color: nil) {
                                    AmountText(scenario[selected] - baseline[selected], signed: true)
                                }
                            } else {
                                TooltipRow(label: "Baseline", color: .primary) {
                                    AmountText(baseline[selected])
                                }
                            }
                        }
                        .environment(model)
                    }
                    .accessibilityHidden(true)
            }
        }
        .chartXSelection(value: Binding(get: { selected }, set: { selected = $0.map { min(max($0, 0), last) } }))
        .forecastAxes(labels: labels)
    }
}

private struct AdjustmentRow: View {
    @Environment(\.colorScheme) private var scheme

    let adjustment: ForecastScenarioModificationRequest
    let rules: [RecurringRule]
    let categories: [CategorySummary]
    let impact: Int?
    let remove: () -> Void

    var body: some View {
        let kind = AdjustmentKind(rawValue: adjustment.type)!
        HStack(spacing: 12) {
            Image(systemName: kind.systemImage)
                .foregroundStyle(.secondary)
                .frame(width: 26)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title(kind))
                    .lineLimit(2)
                HStack(spacing: 4) {
                    detail(kind)
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if let impact {
                AmountText(impact, decimals: false, signed: true)
                    .foregroundStyle(impact > 0 ? ExpensesTheme.income(for: scheme) : .primary)
            }
            Button(action: remove) {
                Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tertiary)
            .accessibilityLabel("Remove adjustment")
        }
    }

    private func ruleName(_ id: Int?) -> String {
        rules.first { $0.id == id }?.name ?? "Recurring rule"
    }

    private func title(_ kind: AdjustmentKind) -> String {
        switch kind {
        case .removeRule:
            "Cancel \(ruleName(adjustment.ruleID))"
        case .modifyRule:
            ruleName(adjustment.ruleID)
        case .addRule, .oneTime:
            adjustment.name ?? ""
        case .adjustCategory:
            categories.first { $0.id == adjustment.categoryID }?.name ?? "Category"
        }
    }

    @ViewBuilder
    private func detail(_ kind: AdjustmentKind) -> some View {
        let income = adjustment.txType == "income"
        switch kind {
        case .removeRule:
            Text("Recurring rule")
        case .addRule:
            Text("\(Repeat(rawValue: adjustment.interval ?? "")?.title ?? "") ·")
            AmountText(adjustment.amountCents ?? 0, decimals: false, signed: income)
        case .modifyRule:
            Text("From \(CalendarMonth(adjustment.effectiveMonth ?? "").abbreviatedTitle) ·")
            AmountText(adjustment.newAmountCents ?? 0, decimals: false)
        case .oneTime:
            Text("\(CalendarMonth(adjustment.month ?? "").abbreviatedTitle) ·")
            AmountText(adjustment.amountCents ?? 0, decimals: false, signed: income)
        case .adjustCategory:
            AmountText(adjustment.newMonthlyCents ?? 0, decimals: false)
            Text("per month")
        }
    }
}

/// One adjustment, entered like a transaction: the amount in large figures, then
/// chips for what it changes and when.
private struct AdjustmentSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let kind: AdjustmentKind
    let rules: [RecurringRule]
    let categories: [CategorySummary]
    let onAdd: (ForecastScenarioModificationRequest) -> Void

    @State private var amount = ""
    @State private var name = ""
    @State private var income = false
    @State private var repeats = Repeat.monthly
    @State private var ruleID: Int?
    @State private var categoryID: Int?
    @State private var month = CalendarMonth.current.adding(1)
    @State private var amountError: String?
    @State private var nameError: String?
    @State private var choiceError: String?
    @FocusState private var amountFocused: Bool

    private let months = (1...12).map { CalendarMonth.current.adding($0) }

    private var named: Bool {
        kind == .addRule || kind == .oneTime
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if kind != .removeRule {
                        EntryAmountField(text: $amount, income: named && income)
                            .focused($amountFocused)
                            .fieldError(amountError)
                    }
                    if named {
                        TextField("Name", text: $name)
                            .font(.title3)
                            .fieldError(nameError)
                    }
                    ChipFlow {
                        if kind == .removeRule || kind == .modifyRule {
                            ruleChip
                        }
                        if kind == .addRule {
                            Menu {
                                Picker("Repeats", selection: $repeats) {
                                    ForEach(Repeat.allCases) { option in
                                        Text(option.title).tag(option)
                                    }
                                }
                            } label: {
                                EntryChip(repeats.title, systemImage: "repeat", isSet: true)
                            }
                        }
                        if kind == .modifyRule || kind == .oneTime {
                            Menu {
                                Picker("Month", selection: $month) {
                                    ForEach(months, id: \.self) { option in
                                        Text(option.title).tag(option)
                                    }
                                }
                            } label: {
                                EntryChip(kind == .modifyRule ? "From \(month.abbreviatedTitle)" : month.abbreviatedTitle, systemImage: "calendar", isSet: true)
                            }
                        }
                        if kind == .adjustCategory {
                            categoryChip
                        }
                    }
                    .buttonStyle(.plain)

                    if let choiceError {
                        FieldError(choiceError)
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(ExpensesTheme.surface(for: scheme))
            .navigationTitle(kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                }
                if named {
                    ToolbarItem(placement: .principal) {
                        Picker("Type", selection: $income) {
                            Text("Expense").tag(false)
                            Text("Income").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .fixedSize()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", role: .confirm, action: submit)
                }
            }
        }
        .task {
            amountFocused = kind != .removeRule
        }
    }

    private var ruleChip: some View {
        let rule = rules.first { $0.id == ruleID }
        return Menu {
            Picker("Rule", selection: $ruleID) {
                ForEach(rules) { rule in
                    Text("\(rule.name ?? "Recurring rule") · \(model.amountString(rule.amountCents))")
                        .tag(Optional(rule.id))
                }
            }
        } label: {
            if let rule {
                EntryChip(rule.name ?? "Recurring rule", isSet: true) {
                    CategoryGlyph(categoryID: rule.categoryID, iconKey: rule.category?.icon, name: rule.category?.name)
                        .frame(width: 18)
                }
            } else {
                EntryChip("Rule", systemImage: "repeat", isSet: false)
            }
        }
    }

    private var categoryChip: some View {
        let category = categories.first { $0.id == categoryID }
        return Menu {
            Picker("Category", selection: $categoryID) {
                ForEach(categories) { category in
                    Label(category.name, systemImage: categorySymbolName(for: resolvedCategoryIconKey(category.icon, name: category.name)))
                        .tag(Optional(category.id))
                }
            }
        } label: {
            if let category {
                EntryChip(category.name, isSet: true) {
                    CategoryGlyph(categoryID: category.id, iconKey: category.icon, name: category.name)
                        .frame(width: 18)
                }
            } else {
                EntryChip("Category", systemImage: "square.grid.2x2", isSet: false)
            }
        }
    }

    private func submit() {
        let cents = AppFormatters.parseAmountCents(amount)
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        amountError = kind != .removeRule && cents == nil ? "Enter a valid amount." : nil
        nameError = named && title.isEmpty ? "Enter a name." : nil
        choiceError = switch kind {
        case .removeRule, .modifyRule:
            ruleID == nil ? "Choose a rule." : nil
        case .adjustCategory:
            categoryID == nil ? "Choose a category." : nil
        case .addRule, .oneTime:
            nil
        }
        guard amountError == nil, nameError == nil, choiceError == nil else {
            return
        }
        let type = income ? "income" : "expense"
        let adjustment: ForecastScenarioModificationRequest = switch kind {
        case .removeRule:
            .init(type: kind.rawValue, ruleID: ruleID)
        case .addRule:
            .init(type: kind.rawValue, name: title, txType: type, amountCents: cents, interval: repeats.rawValue)
        case .modifyRule:
            .init(type: kind.rawValue, ruleID: ruleID, newAmountCents: cents, effectiveMonth: month.value)
        case .oneTime:
            .init(type: kind.rawValue, name: title, txType: type, amountCents: cents, month: month.value)
        case .adjustCategory:
            .init(type: kind.rawValue, categoryID: categoryID, newMonthlyCents: cents)
        }
        onAdd(adjustment)
        dismiss()
    }
}
