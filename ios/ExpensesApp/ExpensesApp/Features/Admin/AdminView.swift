import SwiftUI

/// The server sections, as the web lists them, behind the admin password.
struct AdminView: View {
    @Environment(AppModel.self) private var model

    @State private var now = Date.now

    var body: some View {
        List {
            if isElevated {
                Section {
                    link("Health", systemImage: "waveform.path.ecg") { AdminHealthView() }
                    link("Maintenance", systemImage: "wrench.and.screwdriver") { AdminMaintenanceView() }
                    link("AI", systemImage: "cpu") { AdminAIView() }
                    link("AI Usage", systemImage: "chart.bar") { AIUsageView() }
                    link("Logs", systemImage: "doc.text.magnifyingglass") { AdminLogsView() }
                    link("System", systemImage: "info.circle") { AdminSystemView() }
                }
                .expensesRowBackground()
            } else {
                AdminUnlockSection(title: "Enter your password")
            }
        }
        .navigationTitle("Admin")
        .expensesScreenStyle()
        // Admin access expires, so this checks again on each appearance and when it ends.
        .task(id: elevatedUntil) {
            now = .now
            if let elevatedUntil, elevatedUntil > now {
                try? await Task.sleep(for: .seconds(elevatedUntil.timeIntervalSince(now)))
                now = .now
            }
        }
    }

    private var elevatedUntil: Date? {
        model.identity?.session?.elevatedUntil
    }

    private var isElevated: Bool {
        elevatedUntil.map { $0 > now } ?? false
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
}

/// The admin password, which grants admin access for a while. `onUnlock` runs once it
/// is accepted.
struct AdminUnlockSection: View {
    @Environment(AppModel.self) private var model

    @State private var password = ""
    @State private var unlocking = false
    @State private var unlockError: String?

    let title: String
    var onUnlock: () async -> Void = {}

    var body: some View {
        Section(title) {
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
        if await model.elevateAdmin(password: password) {
            await onUnlock()
        } else {
            unlockError = model.lastError?.message ?? "Couldn't unlock admin access."
        }
    }
}
