import SwiftUI

struct DiagnosticsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        List {
            Section("Connection") {
                TextField("Backend URL", text: $model.baseURLString)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                Button("Test connection") {
                    Task { await model.testConnection() }
                }
                Button("Reset to local backend") {
                    model.resetBaseURL()
                }
            }

            if let status = model.status {
                Section("Backend") {
                    LabeledContent("App", value: status.app)
                    LabeledContent("Version", value: status.version)
                    LabeledContent("Setup required", value: status.setupRequired ? "Yes" : "No")
                    LabeledContent("Timezone", value: status.timezone)
                    LabeledContent("Receipt limit", value: ByteCountFormatter.string(
                        fromByteCount: Int64(status.receiptMaxBytes),
                        countStyle: .file
                    ))
                }
            }

            if let session = model.identity?.session {
                Section("Mobile session") {
                    LabeledContent("Device", value: session.deviceName)
                    LabeledContent("Expires", value: session.expiresAt.formatted())
                }
            }

            if let error = model.lastError {
                ErrorDetailsView(error: error)
            }
        }
        .navigationTitle("Diagnostics")
        .expensesScreenStyle()
        .refreshable {
            await model.testConnection()
        }
        .overlay {
            if model.isLoading {
                ProgressView()
                    .controlSize(.large)
            }
        }
    }
}

struct ErrorDetailsView: View {
    let error: APIErrorInfo

    var body: some View {
        Section("Error") {
            Text(error.message)
            if let statusCode = error.statusCode {
                LabeledContent("Status", value: "\(statusCode)")
            }
            if let requestID = error.requestID {
                LabeledContent("Request ID", value: requestID)
                    .textSelection(.enabled)
            }
        }
    }
}
