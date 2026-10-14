import SwiftUI

/// The server sections, as the web lists them, behind the admin password.
struct AdminView: View {
    @Environment(AppModel.self) private var model

    @State private var password = ""
    @State private var unlocking = false
    @State private var unlockError: String?

    var body: some View {
        List {
            if isElevated {
                Section {
                    link("Health", systemImage: "waveform.path.ecg") { AdminHealthView() }
                    link("Maintenance", systemImage: "wrench.and.screwdriver") { AdminMaintenanceView() }
                    if model.llmEnabled {
                        link("Assistant Usage", systemImage: "chart.bar") { AssistantUsageView() }
                    }
                    link("Logs", systemImage: "doc.text.magnifyingglass") { AdminLogsView() }
                    link("System", systemImage: "info.circle") { AdminSystemView() }
                }
                .expensesRowBackground()
            } else {
                Section("Enter your password") {
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .submitLabel(.go)
                        .onSubmit {
                            Task { await unlock() }
                        }
                        .onChange(of: password) {
                            if !password.isEmpty {
                                unlockError = nil
                            }
                        }
                        .fieldError(unlockError)
                    Button(unlocking ? "Checking…" : "Unlock") {
                        Task { await unlock() }
                    }
                    .fontWeight(.semibold)
                    .disabled(unlocking)
                }
                .expensesRowBackground()
            }
        }
        .navigationTitle("Admin")
        .expensesScreenStyle()
    }

    private var isElevated: Bool {
        model.identity?.session?.elevatedUntil.map { $0 > .now } ?? false
    }

    private func link<Destination: View>(
        _ title: String,
        systemImage: String,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        NavigationLink(destination: destination) {
            Label(title, systemImage: systemImage)
        }
        .navigationLinkIndicatorVisibility(.hidden)
    }

    private func unlock() async {
        guard !password.isEmpty else {
            unlockError = "Enter your password."
            return
        }
        unlockError = nil
        unlocking = true
        defer {
            unlocking = false
            password = ""
        }
        if !(await model.elevateAdmin(password: password)) {
            unlockError = model.lastError?.message ?? "Couldn't unlock admin access."
        }
    }
}
