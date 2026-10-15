import SwiftUI

/// Deleted transactions, to restore or delete forever.
struct TrashView: View {
    @Environment(AppModel.self) private var model
    @State private var loadFailed = false
    @State private var selecting = false
    @State private var selection: Set<Int> = []
    @State private var pendingPurge: [Int]?
    @State private var finished = 0
    @State private var failure: String?

    var body: some View {
        List(selection: $selection) {
            if let response = model.deletedTransactions {
                if response.transactions.isEmpty {
                    Section {
                        ContentUnavailableView("Trash is empty", systemImage: "trash")
                    }
                    .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(response.transactions) { row in
                            LedgerRow(
                                title: row.title ?? "Untitled",
                                detail: row.deletedAt.map { "Deleted \(AppFormatters.shortDay($0))" },
                                categoryID: row.category?.id,
                                iconKey: row.category?.icon,
                                categoryName: row.category?.name,
                                amountCents: row.amountCents,
                                income: row.type == "income"
                            )
                            .contextMenu {
                                Button("Restore", systemImage: "arrow.uturn.backward") {
                                    Task { await restore([row.id]) }
                                }
                                Button("Delete Forever", systemImage: "trash", role: .destructive) {
                                    pendingPurge = [row.id]
                                }
                            }
                        }
                    }
                    .expensesRowBackground()
                    if response.transactions.count < response.total {
                        NextPageSection(page: response.transactions.count) {
                            await model.loadDeletedTransactions(nextPage: true)
                        }
                    }
                }
            } else if loadFailed {
                UnavailableStateSection(
                    title: "Couldn't load Trash",
                    systemImage: "exclamationmark.triangle",
                    message: model.lastError?.message
                ) {
                    loadFailed = await !model.loadDeletedTransactions()
                }
            } else {
                LoadingStateSection(title: "Loading Trash")
            }
        }
        .checkedTint()
        .environment(\.editMode, .constant(selecting ? .active : .inactive))
        .navigationTitle(selecting ? "\(selection.count) Selected" : "Trash")
        .expensesScreenStyle()
        .toolbar {
            if selecting {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", role: .confirm) {
                        selecting = false
                    }
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("Restore", systemImage: "arrow.uturn.backward") {
                        Task { await restore(selection.sorted()) }
                    }
                    .disabled(selection.isEmpty)
                    Spacer()
                    Button("Delete Forever", systemImage: "trash", role: .destructive) {
                        pendingPurge = selection.sorted()
                    }
                    .disabled(selection.isEmpty)
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Select") {
                        selecting = true
                    }
                    .disabled(model.deletedTransactions?.transactions.isEmpty != false)
                }
            }
        }
        .toolbar(selecting ? .hidden : .automatic, for: .tabBar)
        .navigationBarBackButtonHidden(selecting)
        .task {
            loadFailed = await !model.loadDeletedTransactions()
        }
        .refreshable {
            loadFailed = await !model.loadDeletedTransactions()
        }
        .onChange(of: selecting) {
            selection = []
        }
        .alert(
            "Delete \(transactionCount(pendingPurge?.count ?? 0)) forever?",
            isPresented: Binding(get: { pendingPurge != nil }, set: { if !$0 { pendingPurge = nil } }),
            presenting: pendingPurge
        ) { ids in
            Button("Cancel", role: .cancel) {}
            Button("Delete Forever", role: .destructive) {
                Task { await purge(ids) }
            }
        } message: { _ in
            Text("This cannot be undone.")
        }
        .sensoryFeedback(.success, trigger: finished)
        .failureAlert("Couldn't complete the action", message: $failure)
    }

    private func restore(_ ids: [Int]) async {
        guard await model.restoreDeletedTransactions(ids) != nil else {
            failure = model.lastError?.message ?? "The transactions could not be restored."
            return
        }
        finished += 1
        selecting = false
    }

    private func purge(_ ids: [Int]) async {
        guard await model.purgeDeletedTransactions(ids) != nil else {
            failure = model.lastError?.message ?? "The transactions could not be deleted."
            return
        }
        finished += 1
        selecting = false
    }
}
