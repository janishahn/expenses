import Charts
import SwiftUI

/// What the forecast counts: recurring rules alone, or with estimates of variable
/// spending and income.
enum ForecastMode: String {
    case full
    case recurring

    var title: String {
        switch self {
        case .full:
            "With Estimates"
        case .recurring:
            "Recurring Only"
        }
    }
}

/// How far ahead a forecast looks, and what it counts.
struct ForecastOptions: Hashable {
    var horizon = 6
    var mode = ForecastMode.full

    /// "6 months · With Estimates".
    var title: String {
        "\(horizon) months · \(mode.title)"
    }
}

/// The horizon and model pickers, with any further actions under them.
struct ForecastOptionsMenu<Actions: View>: View {
    @Binding var options: ForecastOptions
    @ViewBuilder let actions: Actions

    var body: some View {
        Menu {
            Picker("Horizon", selection: $options.horizon) {
                Text("3 Months").tag(3)
                Text("6 Months").tag(6)
                Text("12 Months").tag(12)
            }
            Picker("Model", selection: $options.mode) {
                Text(ForecastMode.full.title).tag(ForecastMode.full)
                Text(ForecastMode.recurring.title).tag(ForecastMode.recurring)
            }
            actions
        } label: {
            Label("Forecast options", systemImage: "slider.horizontal.3")
        }
        .sensoryFeedback(.selection, trigger: options)
    }
}

extension ForecastOptionsMenu where Actions == EmptyView {
    init(options: Binding<ForecastOptions>) {
        self.init(options: options) {
            EmptyView()
        }
    }
}

struct ForecastView: View {
    @Environment(AppModel.self) private var model
    @State private var options = ForecastOptions()
    @State private var forecast: (options: ForecastOptions, result: Result<ForecastResponse, APIErrorInfo>)?
    // Recurring rules alone, drawn under a forecast with estimates.
    @State private var reference: ForecastResponse?

    var body: some View {
        List {
            switch forecast?.result {
            case nil:
                LoadingStateSection(title: "Loading forecast")
            case .failure(let error):
                UnavailableStateSection(title: "Couldn't load the forecast", systemImage: "exclamationmark.triangle", message: error.message) {
                    await load()
                }
            case .success(let data):
                let loaded = forecast!.options
                ForecastMetricsSection(data: data, options: loaded)
                ForecastBalanceSection(data: data, reference: loaded.mode == .full ? reference : nil, mode: loaded.mode)
                ForecastMonthsSection(months: data.months, mode: loaded.mode)
            }
        }
        .headerProminence(.increased)
        .navigationTitle("Forecast")
        .navigationSubtitle(options.title)
        .expensesScreenStyle()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                ForecastOptionsMenu(options: $options)
                NavigationLink {
                    WhatIfView(options: options)
                } label: {
                    Label("What If", systemImage: "flask")
                }
            }
        }
        .task(id: options) {
            if forecast?.options != options {
                await load()
            }
        }
        .refreshable {
            await load()
        }
    }

    private func load() async {
        let options = options
        async let full = model.chart { try await $0.forecast(horizon: options.horizon, mode: options.mode.rawValue, token: $1) }
        async let recurring = loadReference(options)
        let (result, referenceResult) = await (full, recurring)
        guard !Task.isCancelled else {
            return
        }
        forecast = (options, result)
        reference = referenceResult
    }

    private func loadReference(_ options: ForecastOptions) async -> ForecastResponse? {
        guard options.mode == .full else {
            return nil
        }
        return try? await model.chart { try await $0.forecast(horizon: options.horizon, mode: ForecastMode.recurring.rawValue, token: $1) }.get()
    }
}

/// The month a "months until negative" count points at: 0 is this month, n is the
/// nth forecast month.
private func monthAt(_ months: [ForecastMonth], _ count: Int) -> String {
    count == 0 ? "This month" : CalendarMonth(months[count - 1].month).abbreviatedTitle
}

private let rangeTitle = "\(0.8.formatted(.percent)) range"

private struct ForecastMetricsSection: View {
    @Environment(\.colorScheme) private var scheme

    let data: ForecastResponse
    let options: ForecastOptions

    var body: some View {
        Section {
            MetricGrid {
                GridRow {
                    balance
                        .gridCellColumns(2)
                }
                GridRow {
                    averageNet
                    belowZeroMetric
                }
            }
            .padding(.vertical, 6)
        }
        .expensesRowBackground()
    }

    private var balance: some View {
        let summary = data.summary
        return Metric(data.months.last.map { "Balance in \(CalendarMonth($0.month).abbreviatedTitle)" } ?? "Balance") {
            AmountText(summary.projectedBalanceCents)
        } detail: {
            if let low = summary.projectedBalanceP10Cents, let high = summary.projectedBalanceP90Cents {
                let range = HStack(spacing: 4) {
                    AmountText(low, decimals: false)
                    Text("–")
                    AmountText(high, decimals: false)
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 4) {
                        Text(rangeTitle)
                        range
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(rangeTitle)
                        range
                    }
                }
            } else {
                Text("after \(options.horizon) months")
            }
        }
    }

    private var averageNet: some View {
        let net = data.summary.averageMonthlyNetCents
        return Metric("Average monthly net") {
            AmountText(net, signed: true)
                .foregroundStyle(net >= 0 ? ExpensesTheme.income(for: scheme) : .primary)
        } detail: {
            Text(netDetail)
        }
    }

    private var belowZeroMetric: some View {
        Metric("Below zero") {
            Text(belowZero.value)
        } detail: {
            Text(belowZero.detail)
        }
    }

    private var netDetail: String {
        if options.mode == .recurring {
            return "recurring only"
        }
        return data.model?.method == "seasonal_median" ? "seasonal median spending" : "recent median spending"
    }

    private var belowZero: (value: String, detail: String) {
        let summary = data.summary
        if let count = summary.monthsUntilNegative {
            return (monthAt(data.months, count), "expected")
        }
        if let count = summary.riskMonthsUntilNegative {
            let at = monthAt(data.months, count)
            return ("Not expected", "possible \(count == 0 ? "this month" : "in \(at)") within the \(rangeTitle)")
        }
        let interval = summary.projectedBalanceP10Cents != nil
        return ("Not expected", interval ? "not within the \(rangeTitle)" : "within \(options.horizon) months")
    }
}

/// Balance from now to the horizon, with the 80 % range and recurring rules alone
/// when the model has them.
private struct ForecastBalanceSection: View {
    @Environment(AppModel.self) private var model
    @State private var selected: Int?
    @State private var explaining = false

    let data: ForecastResponse
    let reference: ForecastResponse?
    let mode: ForecastMode

    private var rangeColor: Color {
        Color.primary.opacity(0.08)
    }

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                chart
                ChartLegend {
                    ChartLegendItem(title: mode == .full ? "Expected" : ForecastMode.recurring.title, color: .primary, mark: .line)
                    if reference != nil {
                        ChartLegendItem(title: ForecastMode.recurring.title, color: .secondary, mark: .dash)
                    }
                    if ranges != nil {
                        ChartLegendItem(title: rangeTitle, color: rangeColor, mark: .area)
                    }
                }
            }
            .padding(.vertical, 8)
        } header: {
            HStack {
                Text("Balance")
                Spacer()
                Button {
                    explaining = true
                } label: {
                    Image(systemName: "info.circle")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .expandedTouchArea()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("About this forecast")
                .popover(isPresented: $explaining) {
                    Text(note)
                        .font(.subheadline)
                        .padding()
                        .frame(width: 280, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .presentationCompactAdaptation(.popover)
                }
            }
        }
        .expensesRowBackground()
    }

    private var note: String {
        let method = switch data.model?.method {
        case "seasonal_median":
            "Seasonal median of \(data.model!.historyMonths) months of history."
        case "recent_median":
            "Recent median of \(data.model!.historyMonths) months of history."
        default:
            "Recurring commitments only."
        }
        guard let pending = data.currentMonthNetCents else {
            return method
        }
        let amount = model.amountsHidden ? "a hidden amount" : AppFormatters.signedEuros(pending)
        return "\(method) Includes \(amount) still expected this month."
    }

    private var expected: [Int] {
        [data.startBalanceCents] + data.months.map(\.endBalanceCents)
    }

    // Now has no range; every month needs one, or none show.
    private var ranges: [(low: Int, high: Int)]? {
        guard mode == .full, data.model?.predictionIntervalAvailable == true else {
            return nil
        }
        let months = data.months.compactMap { month in
            month.endBalanceP10Cents.flatMap { low in month.endBalanceP90Cents.map { (low: low, high: $0) } }
        }
        guard months.count == data.months.count else {
            return nil
        }
        return [(data.startBalanceCents, data.startBalanceCents)] + months
    }

    private var recurring: [Int]? {
        reference.map { [data.startBalanceCents] + $0.months.map(\.endBalanceCents) }
    }

    private func title(_ index: Int) -> String {
        index == 0 ? "Now" : CalendarMonth(data.months[index - 1].month).abbreviatedTitle
    }

    private var chart: some View {
        let expected = expected
        let ranges = ranges
        let recurring = recurring
        let last = expected.count - 1
        let labels = ["Now"] + data.months.map { CalendarMonth($0.month).shortTitle }
        return Chart {
            if let ranges {
                ForEach(ranges.indices, id: \.self) { index in
                    AreaMark(x: .value("Month", index), yStart: .value("Low", ranges[index].low), yEnd: .value("High", ranges[index].high))
                        .foregroundStyle(rangeColor)
                        .accessibilityLabel("\(title(index)), \(rangeTitle)")
                        .accessibilityValue("\(model.amountString(ranges[index].low)) to \(model.amountString(ranges[index].high))")
                }
            }
            if let recurring {
                ForEach(recurring.indices, id: \.self) { index in
                    LineMark(x: .value("Month", index), y: .value("Balance", recurring[index]), series: .value("Series", "Recurring"))
                        .foregroundStyle(Color.secondary)
                        .lineStyle(StrokeStyle(lineWidth: 1.25, dash: [4, 3]))
                        .accessibilityLabel("\(title(index)), \(ForecastMode.recurring.title.lowercased())")
                        .accessibilityValue(model.amountString(recurring[index]))
                }
            }
            ForEach(expected.indices, id: \.self) { index in
                LineMark(x: .value("Month", index), y: .value("Balance", expected[index]), series: .value("Series", "Expected"))
                    .foregroundStyle(Color.primary)
                    .accessibilityLabel(title(index))
                    .accessibilityValue(model.amountString(expected[index]))
            }
            if let selected {
                PointMark(x: .value("Month", selected), y: .value("Balance", expected[selected]))
                    .foregroundStyle(Color.primary)
                    .symbolSize(30)
                    .accessibilityHidden(true)
                RuleMark(x: .value("Month", selected))
                    .foregroundStyle(Color.secondary.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                        // Annotations render outside this view's environment.
                        ChartTooltip(title: title(selected)) {
                            TooltipRow(label: mode == .full ? "Expected" : "Balance", color: .primary) {
                                AmountText(expected[selected])
                            }
                            if let ranges, selected > 0 {
                                TooltipRow(label: rangeTitle, color: rangeColor) {
                                    HStack(spacing: 4) {
                                        AmountText(ranges[selected].low, decimals: false)
                                        Text("–")
                                        AmountText(ranges[selected].high, decimals: false)
                                    }
                                }
                            }
                            if let recurring {
                                TooltipRow(label: ForecastMode.recurring.title, color: .secondary) {
                                    AmountText(recurring[selected])
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

extension View {
    /// A balance chart's axes from now to the horizon: one point per month, labelled
    /// every month up to six, then every other month. At accessibility text sizes only
    /// the start, middle and end are labelled.
    func forecastAxes(labels: [String]) -> some View {
        modifier(ForecastAxes(labels: labels))
    }
}

private struct ForecastAxes: ViewModifier {
    @Environment(\.dynamicTypeSize) private var typeSize
    // Room for the first and last month's label at every text size.
    @ScaledMetric(relativeTo: .caption2) private var edge = 14.0

    let labels: [String]

    func body(content: Content) -> some View {
        let last = labels.count - 1
        let step = typeSize.isAccessibilitySize ? max(1, (last + 1) / 2) : last <= 6 ? 1 : 2
        content
            .chartXScale(domain: 0...last, range: .plotDimension(padding: edge))
            .chartYScale(domain: .automatic(includesZero: false))
            .chartXAxis {
                AxisMarks(values: Array(stride(from: 0, through: last, by: step))) { value in
                    AxisValueLabel(anchor: .top) {
                        if let index = value.as(Int.self) {
                            Text(labels[index])
                        }
                    }
                }
            }
            .amountYAxis()
            .frame(height: 190)
    }
}

private struct ForecastMonthsSection: View {
    @Environment(\.colorScheme) private var scheme

    let months: [ForecastMonth]
    let mode: ForecastMode

    var body: some View {
        Section {
            ForEach(months) { month in
                NavigationLink {
                    ForecastMonthView(month: month, mode: mode)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(CalendarMonth(month.month).title)
                            if month.crossesNegative {
                                Label("Dips below zero", systemImage: "exclamationmark.triangle.fill")
                                    .font(.footnote)
                                    .foregroundStyle(ExpensesTheme.expense(for: scheme))
                            }
                        }
                        Spacer()
                        AmountText(month.endBalanceCents, decimals: false)
                            .foregroundStyle(month.endBalanceCents < 0 ? ExpensesTheme.expense(for: scheme) : .primary)
                    }
                }
                .navigationLinkIndicatorVisibility(.hidden)
            }
        } header: {
            HStack(alignment: .firstTextBaseline) {
                Text("Months")
                Spacer()
                Text("End balance")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .expensesRowBackground()
    }
}

/// One forecast month: its end balance, what moves it, and the items behind it.
private struct ForecastMonthView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    let month: ForecastMonth
    let mode: ForecastMode

    var body: some View {
        let breakdown = month.breakdown
        let estimates = (breakdown.variableIncomeEstimates ?? []).map { ($0, true) } + breakdown.variableEstimates.map { ($0, false) }
        List {
            Section {
                Metric("End balance") {
                    AmountText(month.endBalanceCents)
                        .font(.title.weight(.semibold))
                        .foregroundStyle(month.endBalanceCents < 0 ? ExpensesTheme.expense(for: scheme) : .primary)
                } detail: {
                    EmptyView()
                }
                .padding(.vertical, 4)
            }
            .expensesRowBackground()

            Section {
                if let low = month.endBalanceP10Cents, let high = month.endBalanceP90Cents {
                    LabeledContent(rangeTitle) {
                        HStack(spacing: 4) {
                            AmountText(low, decimals: false)
                            Text("–")
                            AmountText(high, decimals: false)
                        }
                    }
                }
                if let lowest = month.minimumBalanceCents {
                    LabeledContent("Lowest") {
                        AmountText(lowest)
                            .foregroundStyle(lowest < 0 ? ExpensesTheme.expense(for: scheme) : .secondary)
                    }
                }
                LabeledContent("Income") {
                    AmountText(month.projectedIncomeCents, signed: true)
                        .foregroundStyle(ExpensesTheme.income(for: scheme))
                }
                LabeledContent("Expenses") {
                    AmountText(month.projectedExpensesCents)
                }
                LabeledContent("Net") {
                    AmountText(month.projectedNetCents, signed: true)
                }
            }
            .expensesRowBackground()

            Section("Recurring") {
                if breakdown.recurringRules.isEmpty {
                    none
                }
                ForEach(breakdown.recurringRules) { rule in
                    LedgerRow(
                        title: rule.name,
                        categoryID: rule.categoryID,
                        iconKey: model.knownCategories.first { $0.id == rule.categoryID }?.icon,
                        categoryName: rule.categoryName ?? rule.name,
                        amountCents: rule.amountCents,
                        income: rule.type == "income"
                    )
                }
            }
            .expensesRowBackground()

            if mode == .full {
                Section("Estimated") {
                    if estimates.isEmpty {
                        none
                    }
                    ForEach(estimates, id: \.0.id) { estimate, income in
                        LedgerRow(
                            title: estimate.name,
                            categoryID: estimate.categoryID,
                            iconKey: estimate.icon,
                            categoryName: estimate.name,
                            amountCents: estimate.amountCents,
                            income: income
                        )
                    }
                }
                .expensesRowBackground()
            }

            Section("One-time") {
                if breakdown.oneTimeEvents.isEmpty {
                    none
                }
                ForEach(breakdown.oneTimeEvents) { event in
                    let income = event.type == "income"
                    TrailingRow {
                        Text(event.name)
                    } trailing: {
                        AmountText(event.amountCents, signed: income)
                            .foregroundStyle(income ? ExpensesTheme.income(for: scheme) : .primary)
                    }
                }
            }
            .expensesRowBackground()
        }
        .navigationTitle(CalendarMonth(month.month).title)
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
    }

    private var none: some View {
        Text("None")
            .foregroundStyle(.secondary)
    }
}
