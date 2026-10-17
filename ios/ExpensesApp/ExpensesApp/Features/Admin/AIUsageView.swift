import Charts
import SwiftUI

/// The server's AI usage over a period: totals, a chart and list by feature and model,
/// and Assistant chats. A model's row opens the same screen for that model alone.
struct AIUsageView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    let scope: AIUsageScope?
    @State private var period: AIUsage.Period
    @State private var chatLimit = Self.chatPage
    @State private var usage: Result<AIUsage, APIErrorInfo>?
    @State private var loadedPeriod: AIUsage.Period?

    private static let chatPage = 50
    // The most chats the server lists at once.
    private static let chatLimitMax = 500

    init(scope: AIUsageScope? = nil, period: AIUsage.Period = .week) {
        self.scope = scope
        _period = State(initialValue: period)
    }

    var body: some View {
        List {
            switch usage {
            case nil:
                LoadingStateSection(title: "Loading usage")
            case .failure(let error) where error.statusCode == 403:
                AdminUnlockSection(title: "Admin access expired") {
                    await load()
                }
            case .failure(let error):
                UnavailableStateSection(title: "Usage is unavailable", systemImage: "exclamationmark.triangle", message: error.message) {
                    await load()
                }
            case .success(let usage) where usage.totals.runs == 0:
                UnavailableStateSection(title: "No AI usage", systemImage: "chart.bar")
            case .success(let usage):
                summary(usage.totals)
                AIUsageChartSection(usage: usage)
                if scope == nil {
                    sliceSections(usage.slices)
                }
                if showsChats, usage.chatCount > 0 {
                    chatSection(usage)
                }
            }
        }
        .navigationTitle(scope?.model ?? "AI Usage")
        .navigationSubtitle(scope.map { "\(AIUsage.featureName($0.feature)) · \(period.title)" } ?? period.title)
        .expensesScreenStyle()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Period", selection: $period) {
                        ForEach(AIUsage.Period.allCases) { period in
                            Text(period.title).tag(period)
                        }
                    }
                } label: {
                    Label("Period", systemImage: "calendar")
                }
                .sensoryFeedback(.selection, trigger: period)
            }
        }
        .task(id: period) {
            // Coming back from a model or chat reloads in place and keeps the scroll position.
            if loadedPeriod != period {
                usage = nil
                chatLimit = Self.chatPage
            }
            await load()
        }
        .refreshable {
            await load()
        }
    }

    // Chats are Assistant runs, so a scope on another feature has none.
    private var showsChats: Bool {
        scope.map { $0.feature == "spending_chat" } ?? true
    }

    private func summary(_ totals: AIUsage.Totals) -> some View {
        Section {
            MetricGrid {
                GridRow {
                    Metric("Cost") {
                        Text(cost(totals.pricedRuns, totals.costUSD))
                    } detail: {
                        if totals.pricedRuns == 0 {
                            Text("No prices reported")
                        } else if totals.pricedRuns < totals.runs {
                            Text("\(totals.pricedRuns.formatted()) of \(totals.runs.formatted()) runs priced")
                        }
                    }
                    Metric("Tokens") {
                        Text(totals.totalTokens.formatted())
                    } detail: {
                        Text("\(totals.cachedInputTokens.formatted()) cached")
                    }
                }
                GridRow {
                    Metric("Runs") {
                        Text(totals.runs.formatted())
                    } detail: {
                        let detail = [
                            totals.failedRuns > 0 ? "\(totals.failedRuns.formatted()) failed" : nil,
                            totals.p95DurationMS.map { "\(seconds($0)) p95" },
                        ].compactMap(\.self)
                        if !detail.isEmpty {
                            Text(detail.joined(separator: " · "))
                        }
                    }
                    if showsChats {
                        Metric("Chats") {
                            Text(totals.chats.formatted())
                        } detail: {
                            Text("^[\(totals.turns) turn](inflect: true)")
                        }
                    }
                }
            }
            .monospacedDigit()
            .padding(.vertical, 6)
        }
        .expensesRowBackground()
    }

    private func sliceSections(_ slices: [AIUsage.Slice]) -> some View {
        let features = slices.reduce(into: [String]()) { features, slice in
            if !features.contains(slice.feature) {
                features.append(slice.feature)
            }
        }
        return ForEach(features, id: \.self) { feature in
            let group = slices.filter { $0.feature == feature }
            let priced = group.reduce(0) { $0 + $1.pricedRuns }
            Section {
                ForEach(group, id: \.self) { slice in
                    NavigationLink {
                        AIUsageView(scope: slice.scope, period: period)
                    } label: {
                        SliceRow(slice: slice, color: ExpensesTheme.category(slices.firstIndex(of: slice), for: scheme))
                    }
                }
            } header: {
                HStack(alignment: .firstTextBaseline) {
                    Text(AIUsage.featureName(feature))
                    Spacer()
                    Text(
                        priced > 0
                            ? usd(group.reduce(0) { $0 + (Double($1.costUSD) ?? 0) })
                            : "\(group.reduce(0) { $0 + $1.totalTokens }.formatted()) tokens"
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                }
            }
            .expensesRowBackground()
        }
    }

    private func chatSection(_ usage: AIUsage) -> some View {
        Section {
            ForEach(usage.chats) { chat in
                NavigationLink {
                    AIUsageChatView(chat: chat)
                } label: {
                    TrailingRow {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(chat.name)
                                .foregroundStyle(chat.access == .own ? .primary : .secondary)
                            Text("\(AppFormatters.occurred(chat.lastRunAt)) · ^[\(chat.turns) turn](inflect: true)")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    } trailing: {
                        Text(usageFigure(chat.pricedRuns, chat.costUSD, tokens: chat.totalTokens))
                            .monospacedDigit()
                    }
                }
            }
            if usage.chats.count < min(usage.chatCount, Self.chatLimitMax) {
                Button("Show More") {
                    chatLimit += Self.chatPage
                    Task { await load() }
                }
            }
        } header: {
            HStack(alignment: .firstTextBaseline) {
                Text("Chats")
                Spacer()
                Text(usage.chatCount.formatted())
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
        .expensesRowBackground()
    }

    private func load() async {
        let period = period
        let scope = scope
        let chats = chatLimit
        let result = await model.chart { try await $0.aiUsage(period: period, scope: scope, chats: chats, token: $1) }
        // A later period or a longer chat list has its own load.
        guard !Task.isCancelled, period == self.period, chats == chatLimit else {
            return
        }
        usage = result
        loadedPeriod = period
    }
}

private struct SliceRow: View {
    let slice: AIUsage.Slice
    let color: Color

    var body: some View {
        TrailingRow {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .frame(width: 10, height: 10)
                .glyphColumn(14)
        } content: {
            VStack(alignment: .leading, spacing: 2) {
                Text(slice.model)
                Text("\(slice.backend.map { "\($0) · " } ?? "")^[\(slice.runs) run](inflect: true)")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } trailing: {
            Text(usageFigure(slice.pricedRuns, slice.costUSD, tokens: slice.totalTokens))
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }
}

/// Usage per bucket, stacked by feature and model, in cost or tokens.
private struct AIUsageChartSection: View {
    enum Measure: Hashable {
        case cost
        case tokens
    }

    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .caption2) private var edge = 14.0

    let usage: AIUsage
    @State private var chosen: Measure?
    // A bucket's index as the chart's category.
    @State private var selected: String?

    var body: some View {
        // Usage that no backend priced, such as a self-hosted model's, opens on tokens.
        let measure = chosen ?? (usage.totals.pricedRuns > 0 ? .cost : .tokens)
        Section {
            Picker("Chart measure", selection: Binding(get: { measure }, set: { chosen = $0 })) {
                Text("Cost").tag(Measure.cost)
                Text("Tokens").tag(Measure.tokens)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .sensoryFeedback(.selection, trigger: chosen)

            if measure == .cost && usage.totals.pricedRuns == 0 {
                ChartMessage(text: "No prices reported in this period.")
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    chart(measure)
                    ChartLegend {
                        ForEach(Array(usage.slices.enumerated()), id: \.element) { index, slice in
                            ChartLegendItem(title: name(slice), color: ExpensesTheme.category(index, for: scheme), mark: .area)
                        }
                    }
                }
                .padding(.vertical, 8)
            }
        } header: {
            Text("By \(usage.bucket.rawValue)")
        }
        .expensesRowBackground()
    }

    private func chart(_ measure: Measure) -> some View {
        let keys = usage.buckets.indices.map(String.init)
        // About six labels, so they stay apart at any period.
        let step = max(1, Int((Double(keys.count) / 6).rounded(.up)))
        return Chart {
            ForEach(Array(usage.slices.enumerated()), id: \.element) { sliceIndex, slice in
                ForEach(usage.buckets.indices, id: \.self) { index in
                    let amount = value(slice, index, measure)
                    if amount > 0 {
                        BarMark(x: .value("Period", keys[index]), y: .value(measure == .cost ? "Cost" : "Tokens", amount), width: .ratio(0.7))
                            .foregroundStyle(
                                ExpensesTheme.category(sliceIndex, for: scheme).opacity(selected == nil || selected == keys[index] ? 1 : 0.4)
                            )
                            .accessibilityLabel("\(title(index)), \(name(slice))")
                            // VoiceOver reads each cost exact, where the chart and its tooltip round it.
                            .accessibilityValue(measure == .cost ? "$\(slice.bucketCostUSD[index])" : figure(slice, index, measure))
                    }
                }
            }
            if let selected, let index = Int(selected), usage.buckets.indices.contains(index) {
                RuleMark(x: .value("Period", selected))
                    .foregroundStyle(.clear)
                    .annotation(position: .top, spacing: 4, overflowResolution: .init(x: .fit(to: .chart), y: .fit(to: .chart))) {
                        ChartTooltip(title: title(index)) {
                            ForEach(Array(usage.slices.enumerated()), id: \.element) { sliceIndex, slice in
                                TooltipRow(label: name(slice), color: ExpensesTheme.category(sliceIndex, for: scheme)) {
                                    Text(figure(slice, index, measure))
                                        .monospacedDigit()
                                }
                            }
                        }
                    }
                    .accessibilityHidden(true)
            }
        }
        .chartXScale(domain: keys, range: .plotDimension(padding: edge))
        .chartXSelection(value: $selected)
        .chartXAxis {
            AxisMarks(values: keys.enumerated().filter { $0.offset % step == 0 }.map(\.element)) { value in
                AxisValueLabel {
                    if let key = value.as(String.self), let index = Int(key) {
                        Text(label(index))
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { value in
                AxisGridLine()
                if let amount = value.as(Double.self) {
                    AxisValueLabel {
                        Text(measure == .cost ? usd(amount) : amount.formatted(.number.notation(.compactName)))
                    }
                }
            }
        }
        .frame(height: 160)
    }

    private func value(_ slice: AIUsage.Slice, _ index: Int, _ measure: Measure) -> Double {
        measure == .cost ? Double(slice.bucketCostUSD[index]) ?? 0 : Double(slice.bucketTokens[index])
    }

    private func figure(_ slice: AIUsage.Slice, _ index: Int, _ measure: Measure) -> String {
        measure == .cost ? usd(Double(slice.bucketCostUSD[index]) ?? 0) : slice.bucketTokens[index].formatted()
    }

    // "qwen3 on local"; the feature joins it when the same model serves several features.
    private func name(_ slice: AIUsage.Slice) -> String {
        let name = slice.backend.map { "\(slice.model) on \($0)" } ?? slice.model
        let shared = usage.slices.contains { $0 != slice && $0.model == slice.model && $0.backend == slice.backend }
        return shared ? "\(name) · \(AIUsage.featureName(slice.feature))" : name
    }

    // Buckets decode as UTC midnight, so they format in UTC.
    private func label(_ index: Int) -> String {
        let style = Date.FormatStyle(timeZone: .gmt)
        let start = usage.buckets[index]
        switch usage.bucket {
        case .day:
            return start.formatted(style.day())
        case .week:
            return start.formatted(style.day().month(.abbreviated))
        case .month:
            return start.formatted(style.month(.abbreviated))
        }
    }

    private func title(_ index: Int) -> String {
        let style = Date.FormatStyle(timeZone: .gmt)
        let start = usage.buckets[index]
        let title = switch usage.bucket {
        case .day:
            start.formatted(style.day().month(.abbreviated))
        case .week:
            "Week of \(start.formatted(style.day().month(.abbreviated)))"
        case .month:
            start.formatted(style.month(.wide).year())
        }
        return index == usage.buckets.count - 1 ? "\(title) so far" : title
    }
}

/// One Assistant chat's usage, turn by turn. A turn counts every model request and tool
/// call it made.
struct AIUsageChatView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    let chat: AIUsageChat
    @State private var detail: Result<AIUsageChatDetail, APIErrorInfo>?
    @State private var showsAssistant = false

    var body: some View {
        List {
            switch detail {
            case nil:
                LoadingStateSection(title: "Loading chat usage")
            case .failure(let error) where error.statusCode == 403:
                AdminUnlockSection(title: "Admin access expired") {
                    await load()
                }
            case .failure(let error):
                UnavailableStateSection(title: "Chat usage is unavailable", systemImage: "exclamationmark.triangle", message: error.message) {
                    await load()
                }
            case .success(let detail):
                summary(detail)
                // A long chat lists its latest turns, as the Assistant does.
                Section(detail.runs.count < detail.chat.turns ? "Latest \(detail.runs.count) Turns" : "Turns") {
                    ForEach(Array(detail.runs.enumerated()), id: \.offset) { _, run in
                        TrailingRow {
                            if run.status == .completed {
                                Text(AppFormatters.occurred(run.createdAt))
                            } else {
                                let state = Text(status(run.status))
                                    .foregroundStyle(run.status == .failed ? ExpensesTheme.expense(for: scheme) : .secondary)
                                Text("\(AppFormatters.occurred(run.createdAt)) · \(state)")
                            }
                        } trailing: {
                            Text(run.costUSD.map { usd($0) } ?? "\(run.totalTokens.formatted()) tokens")
                                .monospacedDigit()
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .expensesRowBackground()
            }
        }
        .navigationTitle(chat.name)
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .toolbar {
            if chat.access == .own {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Open Chat", systemImage: "bubble.left") {
                        showsAssistant = true
                        Task { await model.openAssistantChat(chat.id) }
                    }
                }
            }
        }
        .navigationDestination(isPresented: $showsAssistant) {
            AssistantView()
                .toolbar(.hidden, for: .tabBar)
        }
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    private func summary(_ detail: AIUsageChatDetail) -> some View {
        let chat = detail.chat
        let models = detail.models.map { used in used.backend.map { "\(used.model) on \($0)" } ?? used.model }
        return Section {
            VStack(alignment: .leading, spacing: 2) {
                Text(chat.pricedRuns > 0 ? usd(Double(chat.costUSD) ?? 0) : "\(chat.totalTokens.formatted()) tokens")
                    .font(.title2.weight(.semibold))
                if chat.pricedRuns > 0 {
                    Text("\(chat.totalTokens.formatted()) tokens")
                        .foregroundStyle(.secondary)
                }
            }
            .monospacedDigit()
            .padding(.vertical, 4)
            LabeledContent("User", value: chat.username ?? "Removed user")
            LabeledContent("Started", value: AppFormatters.occurred(chat.startedAt))
            LabeledContent("Turns", value: chat.turns.formatted())
            LabeledContent("Model", value: models.joined(separator: ", "))
            LabeledContent("Tool calls", value: detail.toolCalls.formatted())
        }
        .expensesRowBackground()
    }

    private func status(_ status: AIUsageChatDetail.Run.Status) -> String {
        switch status {
        case .running:
            "Running"
        case .completed:
            "Completed"
        case .failed:
            "Failed"
        case .stopped:
            "Stopped"
        }
    }

    private func load() async {
        let id = chat.id
        let result = await model.chart { try await $0.aiUsageChat(id: id, token: $1) }
        guard !Task.isCancelled else {
            return
        }
        detail = result
    }
}

/// "$0.0123", "$1.84": costs under a dollar keep three significant digits, so a fraction
/// of a cent stays short.
private func usd(_ amount: Double) -> String {
    let locale = Locale(identifier: "en_US")
    let figure = abs(amount) < 1
        ? amount.formatted(.number.precision(.significantDigits(1...3)).locale(locale))
        : amount.formatted(.number.precision(.fractionLength(2)).locale(locale))
    return "$\(figure)"
}

private func usd(_ decimal: String) -> String {
    usd(Double(decimal) ?? 0)
}

// The cost, or the tokens when no backend priced the runs, as for a self-hosted model.
private func usageFigure(_ pricedRuns: Int, _ costUSD: String, tokens: Int) -> String {
    pricedRuns > 0 ? usd(costUSD) : "\(tokens.formatted()) tokens"
}

private func cost(_ pricedRuns: Int, _ costUSD: String) -> String {
    pricedRuns > 0 ? usd(costUSD) : "–"
}

private func seconds(_ milliseconds: Int) -> String {
    "\((Double(milliseconds) / 1000).formatted(.number.precision(.fractionLength(0...1)))) s"
}
