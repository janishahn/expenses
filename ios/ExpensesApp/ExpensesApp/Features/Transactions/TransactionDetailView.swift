import MapKit
import QuickLook
import SwiftUI
import UIKit

/// One transaction, edited in place. Each change saves at once with the full body, and
/// saves run one after another, so each builds on the last.
struct TransactionDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let transactionID: Int

    @State private var loadFailed = false
    @State private var saves = FieldSaves<Field, TransactionMutationRequest>()
    @State private var dateSave: Task<Void, Never>?
    // Text fields keep their own drafts and save when they lose focus.
    @State private var titleDraft = ""
    @State private var amountDraft = ""
    @State private var notesDraft = ""
    @State private var editingAmount = false
    @FocusState private var focus: Field?
    @State private var sheet: Sheet?
    @State private var locating = false
    @State private var locationProvider = LocationProvider()
    @State private var removingAllocation: Int?
    @State private var deleting = false
    @State private var copied = 0
    @State private var actionError: String?

    // In the order entered values apply, so a category chosen after a type change stays.
    private enum Field: CaseIterable, Hashable {
        case title
        case amount
        case type
        case date
        case category
        case tags
        case reimbursement
        case location
        case notes
    }

    private enum Sheet: Identifiable {
        case category
        case tags
        case durable

        var id: Self { self }
    }

    private var transaction: TransactionDetail? {
        model.selectedTransaction?.id == transactionID ? model.selectedTransaction : nil
    }

    var body: some View {
        List {
            if let transaction {
                let shown = shown(transaction)
                head(transaction, shown)
                properties(transaction, shown)
                Section("Notes") {
                    TextField("Add notes", text: $notesDraft, axis: .vertical)
                        .lineLimit(3...)
                        .focused($focus, equals: .notes)
                        .fieldError(saves.errors[.notes])
                }
                .expensesRowBackground()
                reimbursements(transaction)
                if let coordinate = coordinate(transaction, shown) {
                    Section("Location") {
                        Map(initialPosition: .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 600, longitudinalMeters: 600)), interactionModes: []) {
                            Marker(transaction.title, coordinate: coordinate)
                        }
                        .frame(height: 180)
                        .listRowInsets(EdgeInsets())
                        .id("\(coordinate.latitude),\(coordinate.longitude)")
                    }
                }
                ReceiptsSection(transaction: transaction)
            } else if loadFailed {
                UnavailableStateSection(title: "Couldn't load transaction", systemImage: "exclamationmark.triangle") {
                    await reload()
                }
            } else {
                LoadingStateSection(title: "Loading transaction")
            }
        }
        .refreshable {
            await reload()
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .toolbar {
            if transaction != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if transaction?.type == "expense", transaction?.durablePurchase == nil {
                            Button("Track as Durable…", systemImage: "shippingbox") {
                                sheet = .durable
                            }
                        }
                        Button("Copy Link", systemImage: "link") {
                            let base = model.baseURLString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                            UIPasteboard.general.string = "\(base)/transactions/\(transactionID)"
                            copied += 1
                        }
                        Divider()
                        Button("Delete", systemImage: "trash", role: .destructive) {
                            deleting = true
                        }
                    } label: {
                        Label("More actions", systemImage: "ellipsis")
                    }
                }
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    focus = nil
                }
            }
        }
        .sheet(item: $sheet) { sheet in
            if let transaction {
                let shown = shown(transaction)
                switch sheet {
                case .category:
                    CategoryPickerSheet(
                        title: "Category",
                        categories: model.activeKnownCategories.filter { ($0.type ?? "expense") == shown.type.rawValue },
                        selectedID: shown.categoryID,
                        onSelectNone: { saveCategory(nil, shown: shown) }
                    ) { category in
                        saveCategory(category.id, shown: shown)
                    }
                case .tags:
                    TagPickerSheet(title: "Tags", options: model.activeTags.map(\.name), selected: shown.tags) { names in
                        if names != shown.tags || saves.errors[.tags] != nil {
                            save(.tags) { $0.tags = names }
                        }
                    }
                case .durable:
                    DurableSheet(transaction: transaction)
                }
            }
        }
        .alert("Delete this transaction?", isPresented: $deleting) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task {
                    if await model.deleteTransaction(id: transactionID) {
                        dismiss()
                    } else {
                        actionError = model.lastError?.message ?? "Unable to delete transaction."
                    }
                }
            }
        }
        .alert(
            "Remove this reimbursement allocation?",
            isPresented: Binding(get: { removingAllocation != nil }, set: { if !$0 { removingAllocation = nil } }),
            presenting: removingAllocation
        ) { allocationID in
            Button("Cancel", role: .cancel) {}
            Button("Remove", role: .destructive) {
                Task { await removeAllocation(allocationID) }
            }
        }
        .failureAlert("Couldn't complete the action", message: $actionError)
        .sensoryFeedback(.success, trigger: copied)
        .onChange(of: focus) { previous, _ in
            switch previous {
            case .title:
                commitTitle()
            case .amount:
                commitAmount()
            case .notes:
                commitNotes()
            default:
                break
            }
        }
        // Back can close the screen before the focused field reports losing focus.
        .onDisappear {
            commitTitle()
            commitAmount()
            commitNotes()
        }
        .task {
            await reload()
            if model.tags == nil {
                await model.loadOrganizeData()
            }
        }
    }

    // MARK: Sections

    private func head(_ transaction: TransactionDetail, _ shown: TransactionMutationRequest) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                TextField("Title", text: $titleDraft, axis: .vertical)
                    .focused($focus, equals: .title)
                    .detailNameField($titleDraft) { focus = nil }
                    .fieldError(saves.errors[.title])
                if editingAmount || saves.errors[.amount] != nil {
                    EntryAmountField(text: $amountDraft, income: shown.type == .income)
                        .focused($focus, equals: .amount)
                        .onAppear {
                            focus = .amount
                        }
                        .fieldError(saves.errors[.amount])
                } else {
                    Button {
                        editingAmount = true
                    } label: {
                        AmountText(AppFormatters.parseAmountCents(amountDraft) ?? transaction.amountCents, signed: shown.type == .income)
                            .font(.largeTitle.weight(.semibold))
                            .foregroundStyle(shown.type == .income ? ExpensesTheme.income(for: scheme) : .primary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Edits the amount")
                }
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 4))
    }

    private func properties(_ transaction: TransactionDetail, _ shown: TransactionMutationRequest) -> some View {
        Section {
            Picker("Type", selection: Binding(get: { shown.type }, set: { next in
                if next != shown.type || saves.errors[.type] != nil {
                    save(.type) { body in
                        body.type = next
                        body.categoryID = nil
                        if next == .expense {
                            body.isReimbursement = false
                        }
                    }
                }
            })) {
                Text("Expense").tag(TransactionKind.expense)
                Text("Income").tag(TransactionKind.income)
            }
            .pickerStyle(.menu)
            .fieldError(saves.errors[.type])

            // The stored time shows as the server stored it, wherever the device is.
            DatePicker("Date", selection: dateSelection(shown))
                .environment(\.timeZone, model.serverTimeZone)
                .fieldError(saves.errors[.date])

            Button {
                sheet = .category
            } label: {
                LabeledContent("Category") {
                    if let category = category(transaction, shown) {
                        HStack(spacing: 4) {
                            CategoryGlyph(categoryID: category.id, iconKey: category.icon, name: category.name)
                            Text(category.name)
                                .foregroundStyle(.primary)
                        }
                    } else {
                        Text("Uncategorized")
                    }
                }
            }
            .tint(.primary)
            .fieldError(saves.errors[.category])

            Button {
                sheet = .tags
            } label: {
                LabeledContent("Tags") {
                    Text(shown.tags.isEmpty ? "None" : shown.tags.joined(separator: ", "))
                        .foregroundStyle(shown.tags.isEmpty ? .secondary : .primary)
                        .lineLimit(2)
                }
            }
            .tint(.primary)
            .fieldError(saves.errors[.tags])

            if shown.type == .income {
                Toggle("Reimbursement", isOn: Binding(get: { shown.isReimbursement }, set: { value in
                    save(.reimbursement) { $0.isReimbursement = value }
                }))
                .fieldError(saves.errors[.reimbursement])
            }

            Menu {
                Button("Use Current Location", systemImage: "location") {
                    Task { await locate() }
                }
                if coordinate(transaction, shown) != nil {
                    Button("Remove Location", systemImage: "location.slash", role: .destructive) {
                        save(.location) { $0.location = .clear }
                    }
                }
            } label: {
                LabeledContent("Location") {
                    if locating {
                        Text("Locating…")
                    } else if let coordinate = coordinate(transaction, shown) {
                        Text(String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude))
                            .monospacedDigit()
                            .foregroundStyle(.primary)
                    } else {
                        Text("None")
                    }
                }
            }
            .tint(.primary)
            .fieldError(saves.errors[.location])

            if transaction.type == "expense" {
                ReimbursedRow(transaction: transaction)
            }
            if transaction.type == "expense" && transaction.reimbursedTotalCents > 0 {
                LabeledContent {
                    AmountText(transaction.netAmountCents)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)
                } label: {
                    Text("Net")
                        .fontWeight(.semibold)
                }
            }

            if transaction.type == "income", transaction.isReimbursement,
               let reimbursements = model.transactionReimbursements, reimbursements.mode == "income"
            {
                LabeledContent("Remaining") {
                    AmountText(reimbursements.remainingToAllocateCents ?? 0)
                        .foregroundStyle(.primary)
                }
            }

            // Tracking starts from ⋯, so the row shows only once tracked.
            if shown.type == .expense, let durable = transaction.durablePurchase {
                Button {
                    sheet = .durable
                } label: {
                    LabeledContent("Durable") {
                        VStack(alignment: .trailing, spacing: 2) {
                            HStack(spacing: 4) {
                                AmountText(DurableSheet.perDay(transaction.amountCents, days: durable.expectedLifespanDays))
                                Text("per day")
                            }
                            .foregroundStyle(.primary)
                            Text("\(DurableSheet.lifespanLabel(durable.expectedLifespanDays)) from \(AppFormatters.shortDay(AppFormatters.localDay(durable.acquiredOn)))")
                                .font(.footnote)
                        }
                    }
                }
                .tint(.primary)
            }

            if let bank = transaction.bankRow {
                LabeledContent("Bank") {
                    Text("\(bank.accountLabel) · booked \(AppFormatters.shortDay(AppFormatters.localDay(bank.bookingDate)))")
                        .foregroundStyle(.primary)
                }
            }
        }
        .expensesRowBackground()
    }

    // An expense lists what paid it back; a reimbursement lists where it went and
    // allocates the rest.
    @ViewBuilder
    private func reimbursements(_ transaction: TransactionDetail) -> some View {
        if let reimbursements = model.transactionReimbursements {
            if transaction.type == "expense", reimbursements.mode == "expense",
               let allocations = reimbursements.allocationsIn, !allocations.isEmpty
            {
                Section("Reimbursements") {
                    ForEach(allocations) { allocation in
                        allocationRow(allocation.allocationID, linked: allocation.reimbursementTransaction, amountCents: allocation.amountCents, income: true)
                    }
                }
                .expensesRowBackground()
            } else if transaction.type == "income", transaction.isReimbursement, reimbursements.mode == "income" {
                Section {
                    let allocations = reimbursements.allocationsOut ?? []
                    if allocations.isEmpty {
                        Text("Not allocated yet")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(allocations) { allocation in
                        allocationRow(allocation.allocationID, linked: allocation.expenseTransaction, amountCents: allocation.amountCents, income: false)
                    }
                } header: {
                    AdaptiveRow {
                        Text("Allocated to")
                    } trailing: {
                        HStack(spacing: 4) {
                            AmountText(reimbursements.allocatedTotalCents ?? 0)
                            Text("of")
                            AmountText(transaction.amountCents)
                        }
                    }
                }
                .expensesRowBackground()
                AllocationSearchSection(transactionID: transaction.id)
            }
        }
    }

    private func allocationRow(_ allocationID: Int, linked: ReimbursementTransactionSummary, amountCents: Int, income: Bool) -> some View {
        NavigationLink {
            TransactionDetailView(transactionID: linked.id)
        } label: {
            HStack(spacing: 8) {
                if income {
                    Image(systemName: "arrow.uturn.backward")
                        .foregroundStyle(ExpensesTheme.income(for: scheme))
                }
                TrailingRow {
                    HStack(spacing: 8) {
                        Text(linked.title ?? linked.category?.name ?? (income ? "Reimbursement" : "Expense"))
                        Text(AppFormatters.shortDay(AppFormatters.localDay(linked.date)))
                            .foregroundStyle(.secondary)
                            .fixedSize()
                    }
                } trailing: {
                    AmountText(amountCents, signed: income)
                        .foregroundStyle(income ? ExpensesTheme.income(for: scheme) : .primary)
                }
            }
        }
        .navigationLinkIndicatorVisibility(.hidden)
        .swipeActions {
            Button("Remove", systemImage: "xmark") {
                removingAllocation = allocationID
            }
            .tint(ExpensesTheme.expense(for: scheme))
        }
        .contextMenu {
            Button("Remove Allocation", systemImage: "xmark", role: .destructive) {
                removingAllocation = allocationID
            }
        }
    }

    // MARK: Values

    private func shown(_ transaction: TransactionDetail) -> TransactionMutationRequest {
        saves.shown(TransactionMutationRequest(transaction, serverTimeZone: model.serverTimeZone))
    }

    private func category(_ transaction: TransactionDetail, _ shown: TransactionMutationRequest) -> CategorySummary? {
        guard let id = shown.categoryID else {
            return nil
        }
        return model.knownCategories.first { $0.id == id } ?? (transaction.category?.id == id ? transaction.category : nil)
    }

    private func coordinate(_ transaction: TransactionDetail, _ shown: TransactionMutationRequest) -> CLLocationCoordinate2D? {
        switch shown.location {
        case .keep:
            guard let latitude = transaction.latitude, let longitude = transaction.longitude else {
                return nil
            }
            return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        case .clear:
            return nil
        case let .set(latitude, longitude):
            return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        }
    }

    // MARK: Saving

    private func save(_ field: Field, _ change: @escaping (inout TransactionMutationRequest) -> Void) {
        saves.save(field, stored: { transaction.map { TransactionMutationRequest($0, serverTimeZone: model.serverTimeZone) } }, commit: { body in
            await model.updateTransaction(id: transactionID, body: body) ? nil : model.lastError?.message ?? "Unable to save the change."
        }, change)
    }

    // The picker reports each step, so the date saves once it rests.
    private func dateSelection(_ shown: TransactionMutationRequest) -> Binding<Date> {
        Binding(
            get: { shown.occurredAt },
            set: { date in
                saves.enter(.date) { $0.occurredAt = date }
                dateSave?.cancel()
                dateSave = Task {
                    try? await Task.sleep(for: .milliseconds(800))
                    if !Task.isCancelled {
                        save(.date) { $0.occurredAt = date }
                    }
                }
            }
        )
    }

    private func saveCategory(_ categoryID: Int?, shown: TransactionMutationRequest) {
        if categoryID != shown.categoryID || saves.errors[.category] != nil {
            save(.category) { $0.categoryID = categoryID }
        }
    }

    private func commitTitle() {
        guard let transaction else {
            return
        }
        let title = titleDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            saves.errors[.title] = "Enter a title."
            return
        }
        titleDraft = title
        if title != shown(transaction).title || saves.errors[.title] != nil {
            save(.title) { $0.title = title }
        }
    }

    private func commitAmount() {
        guard let transaction else {
            return
        }
        guard let cents = AppFormatters.parseAmountCents(amountDraft) else {
            saves.errors[.amount] = "Enter a valid amount."
            return
        }
        editingAmount = false
        if cents != shown(transaction).amountCents || saves.errors[.amount] != nil {
            save(.amount) { $0.amountCents = cents }
        }
    }

    private func commitNotes() {
        guard let transaction else {
            return
        }
        let notes = notesDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = notes.isEmpty ? nil : notes
        if description != shown(transaction).description || saves.errors[.notes] != nil {
            save(.notes) { $0.description = description }
        }
    }

    private func locate() async {
        locating = true
        defer { locating = false }
        do {
            let coordinate = try await locationProvider.currentCoordinate()
            save(.location) { $0.location = .set(latitude: coordinate.latitude, longitude: coordinate.longitude) }
        } catch {
            saves.errors[.location] = error.localizedDescription
        }
    }

    private func removeAllocation(_ allocationID: Int) async {
        if !(await model.deleteReimbursementAllocation(allocationID, transactionID: transactionID)) {
            actionError = model.lastError?.message ?? "Unable to remove the allocation."
        }
    }

    private func reload() async {
        loadFailed = false
        // A transaction opened again shows its last copy while it loads.
        if let transaction {
            fillDrafts(transaction)
        }
        await model.loadTransactionDetail(id: transactionID)
        guard let transaction else {
            loadFailed = true
            return
        }
        fillDrafts(transaction)
    }

    private func fillDrafts(_ transaction: TransactionDetail) {
        // A value still to save stays in its field.
        let shown = shown(transaction)
        titleDraft = shown.title
        amountDraft = AppFormatters.amountInput(shown.amountCents)
        notesDraft = shown.description ?? ""
    }
}

/// Receipts as provenance: a capped preview of one file, its name and size, and a strip
/// of thumbnails when there are several.
private struct ReceiptsSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    let transaction: TransactionDetail

    @State private var selected = 0
    @State private var thumbnails: [Int: Thumbnail] = [:]
    @State private var source: ReceiptSource?
    @State private var replacing: ReceiptAttachment?
    @State private var removing: ReceiptAttachment?
    @State private var uploading = false
    @State private var error: String?
    @State private var previewURL: URL?

    private enum Thumbnail {
        case image(UIImage)
        // A PDF, or an image the server could not preview.
        case unavailable
    }

    private var files: [ReceiptAttachment] {
        transaction.attachments
    }

    private var index: Int {
        min(selected, max(files.count - 1, 0))
    }

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                if files.indices.contains(index) {
                    let file = files[index]
                    Button {
                        Task { await open(file) }
                    } label: {
                        preview(file)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open \(file.originalFilename)")

                    HStack(spacing: 8) {
                        Text(file.originalFilename)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 8)
                        Text(ByteCountFormatter.string(fromByteCount: Int64(file.sizeBytes), countStyle: .file))
                            .foregroundStyle(.secondary)
                        Menu {
                            Button("Open", systemImage: "eye") {
                                Task { await open(file) }
                            }
                            Menu("Replace", systemImage: "arrow.triangle.2.circlepath") {
                                ReceiptSourceButtons { choice in
                                    replacing = file
                                    source = choice
                                }
                            }
                            .disabled(uploading)
                            Divider()
                            Button("Remove", systemImage: "trash", role: .destructive) {
                                removing = file
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .frame(width: 32, height: 32)
                                .expandedTouchArea(6)
                        }
                        .tint(.primary)
                        .accessibilityLabel("Receipt actions")
                    }
                    .font(.subheadline)

                    if files.count > 1 {
                        strip
                    }
                } else {
                    Menu {
                        ReceiptSourceButtons { choice in
                            replacing = nil
                            source = choice
                        }
                    } label: {
                        Label(uploading ? "Uploading…" : "Add a receipt", systemImage: "camera")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .tint(.primary)
                    .disabled(uploading)
                }
                if let error {
                    FieldError(error)
                }
            }
            .receiptPicker($source) { receipt in
                Task { await upload(receipt) }
            } onFailure: { message in
                error = message
            }
            .alert(
                "Remove this receipt?",
                isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                presenting: removing
            ) { file in
                Button("Cancel", role: .cancel) {}
                Button("Remove", role: .destructive) {
                    Task { await remove(file) }
                }
            } message: { file in
                Text(file.originalFilename)
            }
            .quickLookPreview($previewURL)
            .task(id: files.map(\.id)) {
                await loadThumbnails()
            }
        } header: {
            HStack(spacing: 12) {
                Text("Receipts")
                Spacer()
                if files.count > 1 {
                    Text("\(index + 1) of \(files.count)")
                        .monospacedDigit()
                }
                if !files.isEmpty {
                    Menu {
                        ReceiptSourceButtons { choice in
                            replacing = nil
                            source = choice
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(uploading)
                    .accessibilityLabel(uploading ? "Uploading receipt" : "Add receipt")
                }
            }
        }
        .expensesRowBackground()
    }

    private func preview(_ file: ReceiptAttachment) -> some View {
        Group {
            switch thumbnails[file.id] {
            case let .image(image)?:
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 240)
            case .unavailable?:
                Image(systemName: "doc.richtext")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                    .frame(height: 120)
            case nil:
                ProgressView()
                    .frame(height: 120)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(12)
        .background(ExpensesTheme.day(for: scheme), in: .rect(cornerRadius: 10))
    }

    private var strip: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(Array(files.enumerated()), id: \.element.id) { position, file in
                    Button {
                        selected = position
                    } label: {
                        Group {
                            switch thumbnails[file.id] {
                            case let .image(image)?:
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFill()
                            default:
                                Image(systemName: "doc.richtext")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .frame(width: 30, height: 40)
                        .background(ExpensesTheme.day(for: scheme))
                        .clipShape(.rect(cornerRadius: 4))
                        .overlay {
                            RoundedRectangle(cornerRadius: 4)
                                .strokeBorder(position == index ? Color.primary : .clear, lineWidth: 1.5)
                        }
                        .expandedTouchArea(7)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(file.originalFilename)
                    .accessibilityAddTraits(position == index ? .isSelected : [])
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    private func loadThumbnails() async {
        for file in files where thumbnails[file.id] == nil {
            if file.mimeType.hasPrefix("image/"),
               let data = await model.attachmentThumbnail(file),
               let image = UIImage(data: data)
            {
                thumbnails[file.id] = .image(image)
            } else {
                thumbnails[file.id] = .unavailable
            }
        }
    }

    // A replacement swaps the file in one request, so it also works at the receipt limit.
    private func upload(_ receipt: ReceiptUpload) async {
        let target = replacing
        replacing = nil
        error = nil
        uploading = true
        defer { uploading = false }
        if await model.uploadReceipt(receipt, transactionID: transaction.id, replacing: target?.id) {
            if target == nil {
                // Receipts list newest first.
                selected = 0
            }
        } else {
            error = model.lastError?.message ?? "Unable to upload the receipt."
        }
    }

    private func open(_ file: ReceiptAttachment) async {
        error = nil
        if let url = await model.downloadAttachment(file) {
            previewURL = url
        } else {
            error = model.lastError?.message ?? "Unable to open the receipt."
        }
    }

    private func remove(_ file: ReceiptAttachment) async {
        error = nil
        if !(await model.deleteAttachment(file, transactionID: transaction.id)) {
            error = model.lastError?.message ?? "Unable to remove the receipt."
        }
    }
}

/// Spreads an expense's cost over the time it is used.
private struct DurableSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let transaction: TransactionDetail

    @State private var lifespan: Int
    @State private var customDays: String
    @State private var acquiredOn: Date
    @State private var error: String?
    @State private var saving = false

    private static let lifespans = [
        (days: 182, label: "6 months"),
        (days: 365, label: "1 year"),
        (days: 730, label: "2 years"),
        (days: 1095, label: "3 years"),
        (days: 1825, label: "5 years"),
    ]
    // The lifespan picker's tag for a number of days typed in.
    private static let custom = 0

    static func lifespanLabel(_ days: Int) -> String {
        lifespans.first { $0.days == days }?.label ?? "\(days) days"
    }

    static func perDay(_ amountCents: Int, days: Int) -> Int {
        Int((Double(amountCents) / Double(days)).rounded())
    }

    init(transaction: TransactionDetail) {
        self.transaction = transaction
        let days = transaction.durablePurchase?.expectedLifespanDays ?? 365
        let preset = Self.lifespans.contains { $0.days == days }
        _lifespan = State(initialValue: preset ? days : Self.custom)
        _customDays = State(initialValue: preset ? "" : String(days))
        _acquiredOn = State(initialValue: AppFormatters.localDay(transaction.durablePurchase?.acquiredOn ?? transaction.date))
    }

    private var days: Int? {
        if lifespan != Self.custom {
            return lifespan
        }
        guard let days = Int(customDays), days > 0 else {
            return nil
        }
        return days
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Lifespan", selection: $lifespan) {
                        ForEach(Self.lifespans, id: \.days) { entry in
                            Text(entry.label).tag(entry.days)
                        }
                        Text("Custom").tag(Self.custom)
                    }
                    .pickerStyle(.menu)
                    if lifespan == Self.custom {
                        LabeledContent("Days") {
                            TextField("Days", text: $customDays)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    DatePicker("Acquired", selection: $acquiredOn, displayedComponents: .date)
                    if let days {
                        LabeledContent("Per day") {
                            AmountText(Self.perDay(transaction.amountCents, days: days))
                                .foregroundStyle(.primary)
                        }
                    }
                } footer: {
                    if let error {
                        FieldError(error)
                    }
                }
                .expensesRowBackground()

                if transaction.durablePurchase != nil {
                    Section {
                        Button("Stop Tracking", role: .destructive) {
                            Task { await finish(nil) }
                        }
                        .disabled(saving)
                    }
                    .expensesRowBackground()
                }
            }
            .navigationTitle("Durable Purchase")
            .navigationBarTitleDisplayMode(.inline)
            .expensesScreenStyle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    DiscardButton(hasChanges: hasChanges)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(transaction.durablePurchase == nil ? "Track" : "Save", role: .confirm) {
                        guard let days else {
                            error = "Expected lifespan must be greater than 0 days."
                            return
                        }
                        Task {
                            await finish(DurablePurchaseRequest(expectedLifespanDays: days, acquiredOn: AppFormatters.isoDay(acquiredOn)))
                        }
                    }
                    .disabled(saving)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(hasChanges || saving)
    }

    private var hasChanges: Bool {
        days != (transaction.durablePurchase?.expectedLifespanDays ?? 365)
            || acquiredOn != AppFormatters.localDay(transaction.durablePurchase?.acquiredOn ?? transaction.date)
    }

    private func finish(_ body: DurablePurchaseRequest?) async {
        saving = true
        defer { saving = false }
        error = nil
        if await model.saveDurablePurchase(transactionID: transaction.id, body) {
            dismiss()
        } else {
            error = model.lastError?.message
                ?? (body == nil ? "Unable to stop tracking this durable purchase." : "Unable to save durable tracking.")
        }
    }
}

/// Finds expenses this reimbursement can pay back and allocates to them.
private struct AllocationSearchSection: View {
    @Environment(AppModel.self) private var model

    let transactionID: Int

    @State private var query = ""
    @State private var allocating: ReimbursementExpenseSearchItem?
    @State private var amount = ""
    @State private var error: String?

    var body: some View {
        Section("Allocate to an expense") {
            Label {
                TextField("Search expenses", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } icon: {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
            }
            .task(id: query) {
                try? await Task.sleep(for: .milliseconds(250))
                if !Task.isCancelled {
                    await search()
                }
            }
            .alert(
                "Allocate to \(allocating?.expense.title ?? "expense")",
                isPresented: Binding(get: { allocating != nil }, set: { if !$0 { allocating = nil } }),
                presenting: allocating
            ) { result in
                TextField("Amount", text: $amount)
                    .keyboardType(.decimalPad)
                Button("Cancel", role: .cancel) {}
                Button("Allocate") {
                    if let cents = AppFormatters.parseAmountCents(amount), cents > 0 {
                        Task { await allocate(result, cents: cents) }
                    } else {
                        error = "Enter a valid amount."
                    }
                }
            } message: { result in
                Text("\(model.amountString(result.remainingUnreimbursedCents)) left")
            }

            if let results = model.reimbursementExpenseSearch?.results {
                if results.isEmpty {
                    Text("No matching expenses")
                        .foregroundStyle(.secondary)
                }
                ForEach(results) { result in
                    TrailingRow {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(result.expense.title ?? result.expense.category?.name ?? "Expense")
                            HStack(spacing: 4) {
                                Text("\(AppFormatters.shortDay(AppFormatters.localDay(result.expense.date))) ·")
                                AmountText(result.remainingUnreimbursedCents)
                                Text("left")
                            }
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        }
                    } trailing: {
                        Menu("Allocate") {
                            AllocationAmountItems(
                                expenseCents: result.expense.amountCents,
                                maxCents: result.allocatedToThisCents + result.suggestedAmountCents
                            ) { cents in
                                Task { await allocate(result, cents: cents) }
                            } other: {
                                amount = AppFormatters.amountInput(result.allocatedToThisCents + result.suggestedAmountCents)
                                allocating = result
                            }
                        }
                        .buttonStyle(.borderless)
                        .disabled(result.suggestedAmountCents <= 0)
                    }
                }
            }
            if let error {
                FieldError(error)
            }
        }
        .expensesRowBackground()
    }

    private func search() async {
        await model.searchReimbursementExpenses(
            reimbursementID: transactionID,
            query: query.trimmingCharacters(in: .whitespaces)
        )
    }

    private func allocate(_ result: ReimbursementExpenseSearchItem, cents: Int) async {
        error = nil
        if await model.saveReimbursementAllocation(reimbursementID: transactionID, expenseID: result.expense.id, amountCents: cents) {
            await search()
        } else {
            error = model.lastError?.message ?? "Unable to save allocation."
        }
    }
}

/// Remaining, Half and Third of the expense, then Other Amount…. Saving replaces the pair's
/// allocation, so the most it can hold is what it has plus what is left.
private struct AllocationAmountItems: View {
    @Environment(AppModel.self) private var model

    let expenseCents: Int
    let maxCents: Int
    let allocate: (Int) -> Void
    let other: () -> Void

    var body: some View {
        item("Remaining", cents: maxCents)
        item("Half", cents: Int((Double(expenseCents) / 2).rounded()))
        item("Third", cents: Int((Double(expenseCents) / 3).rounded()))
        Divider()
        Button("Other Amount…", action: other)
    }

    private func item(_ title: String, cents: Int) -> some View {
        Button {
            allocate(cents)
        } label: {
            Text(title)
            Text(model.amountString(cents))
        }
        .disabled(cents > maxCents)
    }
}

/// The expense's reimbursed total. Its menu allocates from a reimbursement with money left.
private struct ReimbursedRow: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    let transaction: TransactionDetail

    @State private var allocating: OpenReimbursement?
    @State private var amount = ""
    @State private var error: String?

    var body: some View {
        Menu {
            let open = model.openReimbursements?.results ?? []
            if open.isEmpty {
                Text("No reimbursements left to allocate")
            }
            ForEach(open) { entry in
                Menu {
                    AllocationAmountItems(
                        expenseCents: transaction.amountCents,
                        maxCents: entry.allocatedToThisCents + entry.suggestedAmountCents
                    ) { cents in
                        Task { await allocate(entry, cents: cents) }
                    } other: {
                        amount = AppFormatters.amountInput(entry.allocatedToThisCents + entry.suggestedAmountCents)
                        allocating = entry
                    }
                } label: {
                    Text(entry.reimbursement.title ?? "Reimbursement")
                    Text("\(AppFormatters.shortDay(AppFormatters.localDay(entry.reimbursement.date))) · \(model.amountString(entry.remainingToAllocateCents)) left")
                }
                .disabled(entry.suggestedAmountCents <= 0)
            }
        } label: {
            LabeledContent("Reimbursed") {
                if transaction.reimbursedTotalCents > 0 {
                    AmountText(transaction.reimbursedTotalCents, signed: true)
                        .foregroundStyle(ExpensesTheme.income(for: scheme))
                } else {
                    Text("None")
                }
            }
        }
        .tint(.primary)
        .fieldError(error)
        .alert(
            "Allocate from \(allocating?.reimbursement.title ?? "reimbursement")",
            isPresented: Binding(get: { allocating != nil }, set: { if !$0 { allocating = nil } }),
            presenting: allocating
        ) { entry in
            TextField("Amount", text: $amount)
                .keyboardType(.decimalPad)
            Button("Cancel", role: .cancel) {}
            Button("Allocate") {
                if let cents = AppFormatters.parseAmountCents(amount), cents > 0 {
                    Task { await allocate(entry, cents: cents) }
                } else {
                    error = "Enter a valid amount."
                }
            }
        } message: { entry in
            Text("\(model.amountString(entry.remainingToAllocateCents)) left")
        }
    }

    private func allocate(_ entry: OpenReimbursement, cents: Int) async {
        error = nil
        if !(await model.saveReimbursementAllocation(reimbursementID: entry.reimbursement.id, expenseID: transaction.id, amountCents: cents)) {
            error = model.lastError?.message ?? "Unable to save allocation."
        }
    }
}
