import SwiftUI

/// The assistant's cost, tokens, and chats over a period.
struct AssistantUsageView: View {
    @Environment(AppModel.self) private var model

    @State private var period = AssistantUsage.Period.week
    @State private var usage: Result<AssistantUsage, APIErrorInfo>?

    var body: some View {
        List {
            switch usage {
            case nil:
                LoadingStateSection(title: "Loading usage")
            case .failure(let error):
                UnavailableStateSection(title: "Usage is unavailable", systemImage: "exclamationmark.triangle", message: error.message) {
                    await load()
                }
            case .success(let usage) where usage.totalChats == 0:
                UnavailableStateSection(title: "No assistant usage", systemImage: "chart.bar")
            case .success(let usage):
                Section {
                    MetricGrid {
                        GridRow {
                            Metric("Cost") {
                                Text(usage.costedChats > 0 ? cost(usage.totalCostDecimal, unit: usage.costUnit) : "Not billed")
                            } detail: {
                                if usage.costedChats > 0 {
                                    Text("\(cost(usage.averageCostDecimal, unit: usage.costUnit)) per chat")
                                }
                            }
                            Metric("Tokens") {
                                Text(usage.totalTokens.formatted())
                            } detail: {
                                Text("\(usage.cachedInputTokens.formatted()) cached · \(usage.reasoningTokens.formatted()) reasoning")
                            }
                        }
                        GridRow {
                            Metric("Chats") {
                                Text(usage.totalChats.formatted())
                            } detail: {
                                Text("\(usage.completedChats.formatted()) completed · \(usage.failedChats.formatted()) failed")
                            }
                            Metric("Per chat") {
                                Text("\(usage.averageTotalTokens.formatted()) tokens")
                            } detail: {
                                if let p95 = usage.p95DurationMS {
                                    Text("\(p95.formatted()) ms p95")
                                }
                            }
                        }
                    }
                    .monospacedDigit()
                    .padding(.vertical, 6)
                }
                .expensesRowBackground()
            }
        }
        .navigationTitle("Assistant Usage")
        .navigationSubtitle(period.title)
        .expensesScreenStyle()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Period", selection: $period) {
                        ForEach(AssistantUsage.Period.allCases) { period in
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
            usage = nil
            await load()
        }
        .refreshable {
            await load()
        }
    }

    // "0.42" with "usd" reads "$0.42"; trailing zeros are dropped.
    private func cost(_ decimal: String, unit: String?) -> String {
        var value = decimal
        if value.contains(".") {
            while value.hasSuffix("0") {
                value.removeLast()
            }
            if value.hasSuffix(".") {
                value.removeLast()
            }
        }
        switch unit {
        case "openrouter_credits":
            return "\(value) credits"
        case "usd":
            return "$\(value)"
        case "mixed":
            return "\(value) (mixed)"
        case let unit?:
            return "\(value) \(unit)"
        case nil:
            return value
        }
    }

    private func load() async {
        let period = period
        let result = await model.chart { try await $0.assistantUsage(period: period, token: $1) }
        guard !Task.isCancelled else {
            return
        }
        usage = result
    }
}
