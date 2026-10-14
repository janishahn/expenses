import SwiftUI

/// The server's temperature, load, memory, and disk, and what its data takes up.
struct AdminHealthView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    @State private var health: Result<AdminSystemHealth, APIErrorInfo>?

    var body: some View {
        List {
            switch health {
            case nil:
                LoadingStateSection(title: "Loading server health")
            case .failure(let error):
                UnavailableStateSection(title: "Couldn't load server health", systemImage: "exclamationmark.triangle", message: error.message)
            case .success(let health):
                Section {
                    Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 16) {
                        GridRow {
                            Metric("CPU temperature") {
                                Text(health.cpuTempCelsius.map { "\($0.formatted(.number.precision(.fractionLength(0...1)))) °C" } ?? "Not available")
                            } detail: {}
                            Metric("Load") {
                                Text("\(health.cpuLoadPercent.formatted(.number.precision(.fractionLength(0...1)))) %")
                            } detail: {}
                        }
                        GridRow {
                            Metric("Memory") {
                                Text(gigabytes(health.ramUsedBytes))
                            } detail: {
                                Text("of \(gigabytes(health.ramTotalBytes))")
                            }
                            Metric("Disk") {
                                Text(gigabytes(health.diskUsedBytes))
                            } detail: {
                                Text("of \(gigabytes(health.diskTotalBytes))")
                            }
                        }
                    }
                    .monospacedDigit()
                    .padding(.vertical, 6)
                }
                .expensesRowBackground()

                Section("Status") {
                    LabeledContent("Server") {
                        status(health.status)
                    }
                    LabeledContent("Database", value: Int64(health.dbSizeBytes).formatted(.byteCount(style: .binary)))
                    LabeledContent("Receipts", value: Int64(health.receiptsSizeBytes).formatted(.byteCount(style: .binary)))
                    LabeledContent("Free disk space", value: Int64(health.diskFreeBytes).formatted(.byteCount(style: .binary)))
                }
                .expensesRowBackground()
            }
        }
        .navigationTitle("Health")
        .expensesScreenStyle()
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    private func gigabytes(_ bytes: Int) -> String {
        Int64(bytes).formatted(.byteCount(style: .binary, allowedUnits: .gb))
    }

    @ViewBuilder
    private func status(_ status: AdminSystemHealth.Status) -> some View {
        switch status {
        case .healthy:
            Text("\(Image(systemName: "checkmark.circle")) Healthy")
                .foregroundStyle(ExpensesTheme.income(for: scheme))
        case .warm:
            Text("\(Image(systemName: "thermometer.medium")) Warm")
                .foregroundStyle(.secondary)
        case .critical:
            Text("\(Image(systemName: "exclamationmark.triangle")) Critical")
                .foregroundStyle(ExpensesTheme.expense(for: scheme))
        }
    }

    private func load() async {
        health = await model.chart { try await $0.adminSystemHealth(token: $1) }
    }
}
