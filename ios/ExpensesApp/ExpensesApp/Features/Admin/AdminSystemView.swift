import SwiftUI

/// The server's version and environment, and where its database and logs live.
struct AdminSystemView: View {
    @Environment(AppModel.self) private var model

    @State private var info: Result<AdminInfo, APIErrorInfo>?

    var body: some View {
        List {
            switch info {
            case nil:
                LoadingStateSection(title: "Loading system information")
            case .failure(let error) where error.statusCode == 403:
                AdminUnlockSection(title: "Admin access expired") {
                    await load()
                }
            case .failure(let error):
                UnavailableStateSection(title: "Couldn't load system information", systemImage: "exclamationmark.triangle", message: error.message) {
                    await load()
                }
            case .success(let info):
                Section {
                    LabeledContent("Version", value: info.appVersion)
                    LabeledContent("Environment", value: info.environment)
                    file("Database", detail: "\(info.dbPath) · \(megabytes(info.dbSizeMB))")
                    LabeledContent("Modified", value: info.dbModified.map(AppFormatters.dateTime) ?? "Unknown")
                    file(
                        "Logs",
                        detail: "\(info.logPath) · \(megabytes(info.logSizeMB)) · \(info.logRetainedFiles == 1 ? "1 file" : "\(info.logRetainedFiles) files")"
                    )
                    LabeledContent("Logs modified", value: info.logModified.map(AppFormatters.dateTime) ?? "Unknown")
                }
                .expensesRowBackground()
            }
        }
        .navigationTitle("System")
        .expensesScreenStyle()
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    // A path is too long to sit beside its label.
    private func file(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }

    private func megabytes(_ value: Double) -> String {
        "\(value.formatted(.number.precision(.fractionLength(0...1)))) MB"
    }

    private func load() async {
        info = await model.chart { try await $0.adminInfo(token: $1) }
    }
}
