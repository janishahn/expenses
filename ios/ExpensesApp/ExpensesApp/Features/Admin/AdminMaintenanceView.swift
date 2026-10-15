import SwiftUI

/// Backups and repair jobs for the whole server, and purging old deleted transactions.
struct AdminMaintenanceView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    @State private var running: Job?
    @State private var jobResult: String?
    @State private var jobError: String?
    @State private var exportedFile: URL?
    @State private var confirmingRebuild = false

    @State private var days = 30
    @State private var choosingDays = false
    @State private var purgeCount: Result<Int, APIErrorInfo>?
    @State private var confirmingPurge = false
    @State private var purging = false
    @State private var purgeResult: String?
    @State private var purgeError: String?

    private enum Job {
        case backup
        case csv
        case rebuild
        case catchUp
    }

    var body: some View {
        List {
            if case .failure(let error) = purgeCount, error.statusCode == 403 {
                AdminUnlockSection(title: "Admin access expired") {
                    await loadPurgeCount()
                }
            }

            Section {
                jobButton("Database backup", systemImage: "externaldrive", job: .backup)
                jobButton("All users’ transactions as CSV", systemImage: "tablecells", job: .csv)
                jobButton("Rebuild monthly totals", systemImage: "arrow.triangle.2.circlepath", job: .rebuild)
                jobButton("Post overdue recurring transactions", systemImage: "repeat", job: .catchUp)
                NavigationLink {
                    LegacyImportView()
                } label: {
                    Label("Legacy SQLite Import", systemImage: "tray.and.arrow.down")
                }
                .navigationLinkIndicatorVisibility(.hidden)
                if let jobResult {
                    done(jobResult)
                }
                if let jobError {
                    FieldError(jobError)
                }
            }
            .expensesRowBackground()

            Section("Purge deleted transactions") {
                Button {
                    choosingDays = true
                } label: {
                    LabeledContent("Older than") {
                        Text(days == 1 ? "1 day" : "\(days) days")
                            .monospacedDigit()
                            .foregroundStyle(.primary)
                    }
                }
                .tint(.primary)
                .popover(isPresented: $choosingDays) {
                    ValuePopover(title: "Days", text: String(days), keyboard: .numberPad, confirm: "Done") { raw in
                        guard let value = Int(raw.trimmingCharacters(in: .whitespaces)), (1...99_999).contains(value) else {
                            return "Enter a whole number of days, at least 1."
                        }
                        days = value
                        purgeResult = nil
                        purgeError = nil
                        return nil
                    }
                }

                Button(role: .destructive) {
                    confirmingPurge = true
                } label: {
                    HStack {
                        Text(purgeTitle)
                        Spacer()
                        if purging {
                            ProgressView()
                        }
                    }
                }
                .disabled(purging || purgeableCount == 0)

                if case .failure(let error) = purgeCount {
                    FieldError(error.message)
                }
                if let purgeResult {
                    done(purgeResult)
                }
                if let purgeError {
                    FieldError(purgeError)
                }
            }
            .expensesRowBackground()
        }
        .navigationTitle("Maintenance")
        .expensesScreenStyle()
        // The count for other days must not show, or confirm a purge, while the new one loads.
        .onChange(of: days) {
            purgeCount = nil
        }
        .task(id: days) {
            await loadPurgeCount()
        }
        .refreshable {
            await loadPurgeCount()
        }
        .fileMover(
            isPresented: Binding(get: { exportedFile != nil }, set: { if !$0 { exportedFile = nil } }),
            file: exportedFile
        ) { result in
            if case let .failure(error) = result {
                jobError = error.localizedDescription
            }
            exportedFile = nil
        } onCancellation: { [exportedFile] in
            // A canceled move leaves the file in the temporary directory.
            if let exportedFile {
                try? FileManager.default.removeItem(at: exportedFile)
            }
        }
        .alert("Rebuild monthly totals now?", isPresented: $confirmingRebuild) {
            Button("Cancel", role: .cancel) {}
            Button("Rebuild") {
                Task { await run(.rebuild) }
            }
        }
        .alert(purgeConfirmTitle, isPresented: $confirmingPurge) {
            Button("Cancel", role: .cancel) {}
            Button("Purge", role: .destructive) {
                Task { await purge() }
            }
        } message: {
            Text("Deleted more than \(days == 1 ? "1 day" : "\(days) days") ago. This cannot be undone.")
        }
    }

    // Zero until the count loads.
    private var purgeableCount: Int {
        guard case .success(let count) = purgeCount else {
            return 0
        }
        return count
    }

    private var purgeTitle: String {
        switch purgeCount {
        case .success(0):
            "No deleted transactions to purge"
        case .success(let count):
            count == 1 ? "Purge 1 transaction" : "Purge \(count) transactions"
        default:
            "Purge"
        }
    }

    private var purgeConfirmTitle: String {
        purgeableCount == 1 ? "Purge 1 deleted transaction?" : "Purge \(purgeableCount) deleted transactions?"
    }

    private func jobButton(_ title: String, systemImage: String, job: Job) -> some View {
        Button {
            if job == .rebuild {
                confirmingRebuild = true
            } else {
                Task { await run(job) }
            }
        } label: {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                if running == job {
                    ProgressView()
                }
            }
        }
        .disabled(running != nil)
    }

    private func done(_ message: String) -> some View {
        Label {
            Text(message)
        } icon: {
            Image(systemName: "checkmark.circle")
                .foregroundStyle(ExpensesTheme.income(for: scheme))
        }
    }

    private func run(_ job: Job) async {
        jobResult = nil
        jobError = nil
        running = job
        defer { running = nil }
        switch job {
        case .backup, .csv:
            guard let download = await (job == .backup ? model.downloadAdminDatabase() : model.exportAdminCSV()) else {
                jobError = model.lastError?.message ?? "Couldn't download the file."
                return
            }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(download.filename)
            do {
                try download.data.write(to: url, options: .atomic)
                exportedFile = url
            } catch {
                jobError = error.localizedDescription
            }
        case .rebuild:
            guard await model.rebuildRollups() != nil else {
                jobError = model.lastError?.message ?? "Couldn't rebuild monthly totals."
                return
            }
            jobResult = "Monthly totals rebuilt"
        case .catchUp:
            guard let result = await model.recurringCatchUp() else {
                jobError = model.lastError?.message ?? "Catch-up failed."
                return
            }
            let rules = { (count: Int) in count == 1 ? "1 rule" : "\(count) rules" }
            if result.updated {
                jobResult = "Catch-up ran. Updated \(rules(result.advancedRules))"
            } else if result.overdueRules > 0 {
                jobResult = "Catch-up ran. No updates. \(result.overdueRules == 1 ? "1 overdue rule remains" : "\(result.overdueRules) overdue rules remain")"
            } else {
                jobResult = "Catch-up ran. No updates needed"
            }
        }
    }

    private func loadPurgeCount() async {
        let days = days
        let result = await model.chart { try await $0.purgeDeletedPreview(days: days, token: $1).count }
        guard !Task.isCancelled, days == self.days else {
            return
        }
        purgeCount = result
    }

    private func purge() async {
        purgeResult = nil
        purgeError = nil
        purging = true
        defer { purging = false }
        guard let result = await model.purgeDeleted(days: days) else {
            purgeError = model.lastError?.message ?? "Couldn't purge deleted transactions."
            return
        }
        purgeResult = result.count == 1 ? "Purged 1 deleted transaction" : "Purged \(result.count) deleted transactions"
        await loadPurgeCount()
    }
}
