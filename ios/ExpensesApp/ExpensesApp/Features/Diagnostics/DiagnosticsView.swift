import SwiftUI

/// The server this device talks to, and what that server reports about itself.
struct DiagnosticsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    @State private var testing = false
    @State private var connected = false
    @State private var server = ""
    @State private var confirmingSwitch = false

    var body: some View {
        List {
            Section("Server") {
                TextField("Server URL", text: $server)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.go)
                    .onSubmit { confirmingSwitch = serverChanged }
                Button {
                    if serverChanged {
                        confirmingSwitch = true
                    } else {
                        Task { await test() }
                    }
                } label: {
                    HStack {
                        Text("Test connection")
                        Spacer()
                        if testing {
                            ProgressView()
                        } else if connected {
                            Text("\(Image(systemName: "checkmark.circle")) Connected")
                                .foregroundStyle(ExpensesTheme.income(for: scheme))
                        }
                    }
                }
                .disabled(testing)
                Button("Use local server") {
                    server = ExpensesAppStorage.defaultLocalBackendURL
                    confirmingSwitch = serverChanged
                }
            }
            .expensesRowBackground()

            if let status = model.status {
                Section {
                    LabeledContent("Version", value: status.version)
                    LabeledContent("Time zone", value: status.timezone)
                    LabeledContent("Receipt limit", value: ByteCountFormatter.string(
                        fromByteCount: Int64(status.receiptMaxBytes),
                        countStyle: .file
                    ))
                }
                .expensesRowBackground()
            }

            if let error = model.lastError {
                ErrorDetailsView(error: error)
            }
        }
        .navigationTitle("Diagnostics")
        .expensesScreenStyle()
        .refreshable {
            await test()
        }
        .onChange(of: model.baseURLString) {
            connected = false
        }
        .onAppear {
            server = model.baseURLString
        }
        // A new address replaces this server's session, so it applies only once confirmed.
        .alert("Switch server?", isPresented: $confirmingSwitch) {
            Button("Cancel", role: .cancel) {
                server = model.baseURLString
            }
            Button("Switch", role: .destructive) {
                model.baseURLString = server.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        } message: {
            Text("This signs you out. Sign in again on the new server.")
        }
    }

    private var serverChanged: Bool {
        server.trimmingCharacters(in: .whitespacesAndNewlines) != model.baseURLString
    }

    private func test() async {
        testing = true
        defer { testing = false }
        await model.testConnection()
        connected = model.lastError == nil
    }
}

struct ErrorDetailsView: View {
    let error: APIErrorInfo

    var body: some View {
        Section("Error") {
            FieldError(error.message)
            if let statusCode = error.statusCode {
                LabeledContent("Status", value: "\(statusCode)")
            }
            if let requestID = error.requestID {
                LabeledContent("Request ID", value: requestID)
                    .textSelection(.enabled)
            }
        }
        .expensesRowBackground()
    }
}
