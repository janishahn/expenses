import MapKit
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct TransactionDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var editingTransaction: TransactionDetail?
    @State private var presentingDeleteConfirmation = false
    @State private var presentingAttachmentImporter = false
    @State private var presentingCamera = false
    @State private var pendingDeleteAttachment: ReceiptAttachment?
    @State private var previewDocument: PreviewDocument?
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var attachmentError: String?
    @State private var loadFailed = false
    let transactionID: Int

    var transaction: TransactionDetail? {
        model.selectedTransaction?.id == transactionID ? model.selectedTransaction : nil
    }

    var body: some View {
        List {
            if let transaction {
                Section {
                    TransactionSummaryCard(transaction: transaction, signedAmount: signedAmount(transaction))
                }

                if let description = transaction.description, !description.isEmpty {
                    Section("Description") {
                        Text(.init(description))
                    }
                }

                if let coordinate = transaction.coordinate {
                    TransactionLocationSection(transaction: transaction, coordinate: coordinate)
                }

                if !transaction.tags.isEmpty {
                    Section("Tags") {
                        Text(transaction.tags.joined(separator: ", "))
                    }
                }

                ReimbursementsSection(
                    transactionID: transaction.id,
                    reimbursements: model.transactionReimbursements,
                    searchResults: model.reimbursementExpenseSearch?.results ?? [],
                    onSearch: { query in
                        await model.searchReimbursementExpenses(
                            reimbursementID: transaction.id,
                            query: query
                        )
                    },
                    onAllocate: { expenseID, amountCents in
                        await model.saveReimbursementAllocation(
                            reimbursementID: transaction.id,
                            expenseID: expenseID,
                            amountCents: amountCents
                        )
                    },
                    onDelete: { allocationID in
                        await model.deleteReimbursementAllocation(
                            allocationID,
                            transactionID: transaction.id
                        )
                    }
                )

                Section {
                    ControlGroup {
                        Button {
                            presentingAttachmentImporter = true
                        } label: {
                            Label("Files", systemImage: "folder")
                        }

                        PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                            Label("Photos", systemImage: "photo")
                        }

                        Button {
                            presentingCamera = true
                        } label: {
                            Label("Camera", systemImage: "camera")
                        }
                        .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
                    }

                    if transaction.attachments.isEmpty {
                        Text("No receipts attached.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(transaction.attachments) { attachment in
                            AttachmentRow(
                                attachment: attachment,
                                onPreview: {
                                    Task { await previewAttachment(attachment) }
                                },
                                onDelete: {
                                    pendingDeleteAttachment = attachment
                                }
                            )
                        }
                        ForEach(transaction.attachments.filter(\.isImageAttachment)) { attachment in
                            InlineAttachmentPreview(
                                attachment: attachment,
                                onLoad: {
                                    await model.downloadAttachment(attachment)
                                },
                                onPreview: {
                                    Task { await previewAttachment(attachment) }
                                }
                            )
                        }
                    }
                    if let attachmentError {
                        Text(attachmentError)
                            .foregroundStyle(.red)
                    }
                } header: {
                    Text("Receipts")
                }
            } else if loadFailed {
                ContentUnavailableView(
                    "Couldn't load transaction",
                    systemImage: "exclamationmark.triangle",
                    description: Text("Pull to refresh to try again.")
                )
            } else {
                ProgressView()
            }
        }
        .navigationTitle(transaction?.title ?? "Transaction")
        .expensesScreenStyle()
        .toolbar {
            if let transaction {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Edit") {
                            editingTransaction = transaction
                        }
                        Button("Delete", role: .destructive) {
                            presentingDeleteConfirmation = true
                        }
                    } label: {
                        Label("Actions", systemImage: "ellipsis.circle")
                    }
                }
            }
        }
        .sheet(item: $editingTransaction) { transaction in
            TransactionFormView(mode: .edit(transaction), categories: model.knownCategories) {
                Task { await model.loadTransactionDetail(id: transactionID) }
            }
        }
        .fileImporter(
            isPresented: $presentingAttachmentImporter,
            allowedContentTypes: Self.allowedAttachmentTypes,
            allowsMultipleSelection: false
        ) { result in
            Task { await uploadAttachment(result) }
        }
        .sheet(item: $previewDocument) { document in
            DocumentPreviewView(url: document.url)
        }
        .sheet(isPresented: $presentingCamera) {
            CameraCaptureView { image in
                Task { await uploadCameraImage(image) }
            }
        }
        .onChange(of: selectedPhotoItem) { _, item in
            guard let item else {
                return
            }
            Task { await uploadPhotoItem(item) }
        }
        .confirmationDialog("Delete this transaction?", isPresented: $presentingDeleteConfirmation) {
            Button("Delete Transaction", role: .destructive) {
                Task {
                    if await model.deleteTransaction(id: transactionID) {
                        dismiss()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete this receipt?", isPresented: attachmentDeletePresented) {
            Button("Delete Receipt", role: .destructive) {
                if let attachment = pendingDeleteAttachment {
                    Task {
                        if !(await model.deleteAttachment(attachment, transactionID: transactionID)) {
                            attachmentError = model.lastError?.message ?? "Receipt could not be deleted."
                        }
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .task {
            await reload()
        }
        .refreshable {
            await reload()
        }
    }

    private func reload() async {
        loadFailed = false
        await model.loadTransactionDetail(id: transactionID)
        loadFailed = transaction == nil
    }

    private static let allowedAttachmentTypes: [UTType] = [
        .pdf,
        .jpeg,
        .png,
        UTType(filenameExtension: "webp") ?? .image,
    ]

    private var attachmentDeletePresented: Binding<Bool> {
        Binding(
            get: { pendingDeleteAttachment != nil },
            set: { isPresented in
                if !isPresented {
                    pendingDeleteAttachment = nil
                }
            }
        )
    }

    private func signedAmount(_ transaction: TransactionDetail) -> Int {
        transaction.type == "income" ? transaction.amountCents : -transaction.amountCents
    }

    private func uploadAttachment(_ result: Result<[URL], Error>) async {
        attachmentError = nil
        do {
            guard let fileURL = try result.get().first else {
                return
            }
            if !(await model.uploadAttachment(transactionID: transactionID, fileURL: fileURL)) {
                attachmentError = model.lastError?.message ?? "Receipt could not be uploaded."
            }
        } catch {
            attachmentError = error.localizedDescription
        }
    }

    private func uploadPhotoItem(_ item: PhotosPickerItem) async {
        attachmentError = nil
        defer { selectedPhotoItem = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data),
                  let jpegData = ReceiptImageProcessor.jpegData(from: image)
            else {
                attachmentError = "Selected photo could not be read."
                return
            }
            let filename = "receipt-\(UUID().uuidString).jpg"
            if !(await model.uploadAttachmentData(
                transactionID: transactionID,
                filename: filename,
                mimeType: "image/jpeg",
                data: jpegData
            )) {
                attachmentError = model.lastError?.message ?? "Receipt could not be uploaded."
            }
        } catch {
            attachmentError = error.localizedDescription
        }
    }

    private func uploadCameraImage(_ image: UIImage) async {
        attachmentError = nil
        guard let jpegData = ReceiptImageProcessor.jpegData(from: image) else {
            attachmentError = "Captured image could not be prepared."
            return
        }
        let filename = "receipt-\(UUID().uuidString).jpg"
        if !(await model.uploadAttachmentData(
            transactionID: transactionID,
            filename: filename,
            mimeType: "image/jpeg",
            data: jpegData
        )) {
            attachmentError = model.lastError?.message ?? "Receipt could not be uploaded."
        }
    }

    private func previewAttachment(_ attachment: ReceiptAttachment) async {
        attachmentError = nil
        guard let fileURL = await model.downloadAttachment(attachment) else {
            attachmentError = model.lastError?.message ?? "Receipt could not be downloaded."
            return
        }
        previewDocument = PreviewDocument(url: fileURL)
    }
}

private struct TransactionLocationSection: View {
    let transaction: TransactionDetail
    let coordinate: CLLocationCoordinate2D

    @State private var cameraPosition: MapCameraPosition

    init(transaction: TransactionDetail, coordinate: CLLocationCoordinate2D) {
        self.transaction = transaction
        self.coordinate = coordinate
        _cameraPosition = State(initialValue: .region(MKCoordinateRegion(
            center: coordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.006, longitudeDelta: 0.006)
        )))
    }

    var body: some View {
        Section("Location") {
            Map(position: $cameraPosition) {
                Marker(transaction.title, coordinate: coordinate)
            }
            .frame(height: 220)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(.quaternary, lineWidth: 1)
            }

            Label(coordinateLabel, systemImage: "location")
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    private var coordinateLabel: String {
        String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude)
    }
}

private struct TransactionSummaryCard: View {
    @Environment(\.colorScheme) private var scheme

    let transaction: TransactionDetail
    let signedAmount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Label(transaction.type.capitalized, systemImage: transaction.type == "income" ? "arrow.down.left" : "arrow.up.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(AppFormatters.euros(signedAmount))
                        .font(.system(size: 31, weight: .semibold).monospacedDigit())
                        .foregroundStyle(
                            transaction.type == "income"
                                ? ExpensesTheme.income(for: scheme)
                                : ExpensesTheme.expense(for: scheme)
                        )
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }

                Spacer(minLength: 0)

                if let category = transaction.category {
                    Label(category.name, systemImage: categorySymbolName(for: category.icon))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ExpensesTheme.accent(for: scheme))
                        .lineLimit(1)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(.thinMaterial, in: Capsule())
                }
            }

            Divider()

            HStack(alignment: .top, spacing: 14) {
                TransactionSummaryMetric(
                    title: transaction.occurredAt != nil ? "Date & time" : "Date",
                    value: transaction.occurredAt.map(AppFormatters.dateTime)
                        ?? AppFormatters.day(transaction.date),
                    systemImage: "calendar",
                    color: ExpensesTheme.accent(for: scheme)
                )

                Divider()
                    .frame(height: 48)

                TransactionSummaryMetric(
                    title: "Type",
                    value: transaction.type.capitalized,
                    systemImage: transaction.type == "income" ? "arrow.down.left" : "arrow.up.right",
                    color: ExpensesTheme.accent(for: scheme)
                )
            }
        }
        .padding(.vertical, 8)
    }
}

private struct TransactionSummaryMetric: View {
    let title: String
    let value: String
    let systemImage: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(color)
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Text(value)
                .font(.headline)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct InlineAttachmentPreview: View {
    let attachment: ReceiptAttachment
    var onLoad: () async -> URL?
    var onPreview: () -> Void

    @State private var image: UIImage?
    @State private var loadFailed = false

    var body: some View {
        Button {
            onPreview()
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity, minHeight: 220, maxHeight: 220)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(alignment: .bottomLeading) {
                            Label("Preview", systemImage: "eye")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(.ultraThinMaterial, in: Capsule())
                                .padding(10)
                        }
                } else if loadFailed {
                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundStyle(.secondary)
                        Text("Image preview could not be loaded.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
                } else {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Loading image preview")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
                }

                Text(attachment.originalFilename)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .task(id: attachment.id) {
            await loadImage()
        }
    }

    private func loadImage() async {
        guard image == nil, !loadFailed else {
            return
        }
        guard let fileURL = await onLoad(),
              let data = try? Data(contentsOf: fileURL),
              let loadedImage = UIImage(data: data)
        else {
            loadFailed = true
            return
        }
        image = loadedImage
    }
}

private extension ReceiptAttachment {
    var isImageAttachment: Bool {
        mimeType.lowercased().hasPrefix("image/")
    }
}

private extension TransactionDetail {
    var coordinate: CLLocationCoordinate2D? {
        guard let latitude, let longitude else {
            return nil
        }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

private struct ReimbursementsSection: View {
    let transactionID: Int
    let reimbursements: TransactionReimbursementsResponse?
    let searchResults: [ReimbursementExpenseSearchItem]
    var onSearch: (String) async -> Void
    var onAllocate: (Int, Int) async -> Bool
    var onDelete: (Int) async -> Bool

    @Environment(\.colorScheme) private var scheme
    @State private var searchQuery = ""
    @State private var allocationAmounts: [Int: String] = [:]
    @State private var errorMessage: String?
    @State private var pendingDeleteAllocationID: Int?

    var body: some View {
        Section("Reimbursements") {
            if let reimbursements {
                if reimbursements.mode == "income" {
                    incomeContent(reimbursements)
                } else {
                    expenseContent(reimbursements)
                }
            } else {
                ProgressView()
            }
            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }
        }
        .confirmationDialog("Remove this allocation?", isPresented: deletePresented) {
            Button("Remove Allocation", role: .destructive) {
                if let pendingDeleteAllocationID {
                    Task { _ = await onDelete(pendingDeleteAllocationID) }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    @ViewBuilder
    private func incomeContent(_ reimbursements: TransactionReimbursementsResponse) -> some View {
        if reimbursements.isReimbursement != true {
            Text("Mark this income as a reimbursement before allocating it to expenses.")
                .foregroundStyle(.secondary)
        } else {
            LabeledContent("Allocated", value: AppFormatters.euros(reimbursements.allocatedTotalCents ?? 0))
            LabeledContent("Remaining", value: AppFormatters.euros(reimbursements.remainingToAllocateCents ?? 0))
            ForEach(reimbursements.allocationsOut ?? []) { allocation in
                reimbursementRow(
                    allocationID: allocation.allocationID,
                    title: allocation.expenseTransaction.title
                        ?? allocation.expenseTransaction.category?.name
                        ?? "Expense #\(allocation.expenseTransaction.id)",
                    subtitle: transactionSubtitle(allocation.expenseTransaction),
                    amountCents: allocation.amountCents
                )
            }
            HStack {
                TextField("Search expenses", text: $searchQuery)
                    .textInputAutocapitalization(.never)
                Button("Search") {
                    Task { await onSearch(searchQuery) }
                }
            }
            ForEach(searchResults) { row in
                expenseSearchRow(row)
            }
        }
    }

    @ViewBuilder
    private func expenseContent(_ reimbursements: TransactionReimbursementsResponse) -> some View {
        LabeledContent("Reimbursed", value: AppFormatters.euros(reimbursements.reimbursedTotalCents ?? 0))
        LabeledContent("Net cost", value: AppFormatters.euros(reimbursements.netCostCents ?? 0))
        let allocations = reimbursements.allocationsIn ?? []
        if allocations.isEmpty {
            Text("No reimbursements linked to this expense.")
                .foregroundStyle(.secondary)
        } else {
            ForEach(allocations) { allocation in
                reimbursementRow(
                    allocationID: allocation.allocationID,
                    title: allocation.reimbursementTransaction.title
                        ?? allocation.reimbursementTransaction.category?.name
                        ?? "Reimbursement #\(allocation.reimbursementTransaction.id)",
                    subtitle: transactionSubtitle(allocation.reimbursementTransaction),
                    amountCents: allocation.amountCents
                )
            }
        }
    }

    private func reimbursementRow(
        allocationID: Int,
        title: String,
        subtitle: String,
        amountCents: Int
    ) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text(AppFormatters.euros(amountCents))
                .foregroundStyle(ExpensesTheme.income(for: scheme))
            Button(role: .destructive) {
                pendingDeleteAllocationID = allocationID
            } label: {
                Image(systemName: "xmark.circle")
            }
            .buttonStyle(.borderless)
        }
    }

    private func expenseSearchRow(_ row: ReimbursementExpenseSearchItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.expense.title ?? row.expense.category?.name ?? "Expense #\(row.expense.id)")
                    Text("\(AppFormatters.day(row.expense.date)) · \(row.expense.category?.name ?? "Uncategorized")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(AppFormatters.euros(-row.expense.amountCents))
                    .foregroundStyle(ExpensesTheme.expense(for: scheme))
            }
            LabeledContent("Remaining", value: AppFormatters.euros(row.remainingUnreimbursedCents))
            HStack {
                TextField("Amount", text: amountBinding(for: row))
                    .keyboardType(.decimalPad)
                Button("Allocate") {
                    Task { await allocate(row) }
                }
                .disabled(allocationInput(for: row).isEmpty)
            }
        }
    }

    private func amountBinding(for row: ReimbursementExpenseSearchItem) -> Binding<String> {
        Binding(
            get: {
                allocationInput(for: row)
            },
            set: { allocationAmounts[row.expense.id] = $0 }
        )
    }

    private func allocate(_ row: ReimbursementExpenseSearchItem) async {
        let rawAmount = allocationInput(for: row)
        guard let amountCents = parseAmount(rawAmount), amountCents > 0 else {
            errorMessage = "Enter a valid allocation amount."
            return
        }
        errorMessage = nil
        if await onAllocate(row.expense.id, amountCents) {
            allocationAmounts.removeValue(forKey: row.expense.id)
        }
    }

    private func allocationInput(for row: ReimbursementExpenseSearchItem) -> String {
        allocationAmounts[row.expense.id]
            ?? (row.suggestedAmountCents > 0 ? centsToInput(row.suggestedAmountCents) : "")
    }

    private var deletePresented: Binding<Bool> {
        Binding(
            get: { pendingDeleteAllocationID != nil },
            set: { isPresented in
                if !isPresented {
                    pendingDeleteAllocationID = nil
                }
            }
        )
    }

    private func transactionSubtitle(_ transaction: ReimbursementTransactionSummary) -> String {
        var parts = [
            AppFormatters.day(transaction.date),
            transaction.category?.name ?? "Uncategorized",
        ]
        if transaction.deletedAt != nil {
            parts.append("Deleted")
        }
        return parts.joined(separator: " · ")
    }

    private func centsToInput(_ cents: Int) -> String {
        String(format: "%.2f", Double(cents) / 100.0)
    }

    private func parseAmount(_ raw: String) -> Int? {
        let normalized = raw.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value.isFinite else {
            return nil
        }
        return Int((value * 100).rounded())
    }
}

private struct AttachmentRow: View {
    let attachment: ReceiptAttachment
    var onPreview: () -> Void
    var onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text(attachment.originalFilename)
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                Text("\(attachment.mimeType) · \(fileSize)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                onPreview()
            } label: {
                Image(systemName: "eye")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Preview receipt")
            Button(role: .destructive) {
                onDelete()
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Delete receipt")
        }
        .swipeActions(edge: .trailing) {
            Button("Delete", role: .destructive) {
                onDelete()
            }
        }
        .swipeActions(edge: .leading) {
            Button("Preview") {
                onPreview()
            }
            .tint(.blue)
        }
    }

    private var fileSize: String {
        ByteCountFormatter.string(
            fromByteCount: Int64(attachment.sizeBytes),
            countStyle: .file
        )
    }

    private var iconName: String {
        if attachment.mimeType == "application/pdf" {
            return "doc.richtext"
        }
        if attachment.mimeType.starts(with: "image/") {
            return "photo"
        }
        return "paperclip"
    }
}
