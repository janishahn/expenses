import SwiftUI
import UniformTypeIdentifiers

/// Exports the server builds, saved to Files, and CSV import with a preview first.
struct ImportExportView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    @State private var exporting: Export?
    @State private var exportedFile: URL?
    @State private var exportError: String?
    @State private var choosingFile = false
    @State private var file: URL?
    @State private var preview: CSVPreviewResponse?
    @State private var previewing = false
    @State private var importing = false
    @State private var importError: String?
    @State private var importedCount: Int?

    private enum Export {
        case csv
        case archive
    }

    private let previewRows = 15

    var body: some View {
        List {
            Section("Export") {
                exportButton("Transactions as CSV", systemImage: "tablecells", export: .csv)
                exportButton("Portable archive", systemImage: "archivebox", export: .archive)
                if let exportError {
                    FieldError(exportError)
                }
            }
            .expensesRowBackground()

            Section("Import CSV") {
                Button {
                    choosingFile = true
                } label: {
                    Label(file?.lastPathComponent ?? "Choose CSV file", systemImage: "doc.badge.plus")
                }
                .disabled(previewing || importing)

                if let file, let rows = preview?.rows, !rows.isEmpty {
                    Button(importing ? "Importing…" : "Import \(rows.count) \(rows.count == 1 ? "transaction" : "transactions")") {
                        Task { await commit(file) }
                    }
                    .fontWeight(.semibold)
                    .disabled(importing)
                }

                if previewing {
                    Text("Reading the file…")
                        .foregroundStyle(.secondary)
                }
                if let importError {
                    FieldError(importError)
                }
                if let importedCount {
                    Label {
                        Text("Imported \(importedCount) \(importedCount == 1 ? "transaction" : "transactions")")
                    } icon: {
                        Image(systemName: "checkmark.circle")
                            .foregroundStyle(ExpensesTheme.income(for: scheme))
                    }
                }

                if let preview {
                    ForEach(preview.errors.prefix(8), id: \.self) { message in
                        FieldError(message)
                    }
                    if preview.rows.isEmpty {
                        Text("The file has no rows to import.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(preview.rows.prefix(previewRows)) { row in
                        let category = model.knownCategories.first { $0.id == row.categoryID }
                        LedgerRow(
                            title: row.title,
                            detail: "\(AppFormatters.shortDay(row.date)) · \(row.category ?? "Uncategorized")",
                            categoryID: row.categoryID,
                            iconKey: category?.icon,
                            categoryName: row.category,
                            amountCents: row.amountCents,
                            income: row.type == "income"
                        )
                    }
                    if preview.rows.count > previewRows {
                        Text("\(preview.rows.count - previewRows) more rows are not shown.")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .expensesRowBackground()
        }
        .navigationTitle("Import and Export")
        .expensesScreenStyle()
        .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            switch result {
            case let .success(url):
                Task { await choose(url) }
            case let .failure(error):
                importError = error.localizedDescription
            }
        }
        .fileMover(
            isPresented: Binding(get: { exportedFile != nil }, set: { if !$0 { exportedFile = nil } }),
            file: exportedFile
        ) { result in
            if case let .failure(error) = result {
                exportError = error.localizedDescription
            }
            exportedFile = nil
        }
    }

    private func exportButton(_ title: String, systemImage: String, export: Export) -> some View {
        Button {
            Task { await run(export) }
        } label: {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                if exporting == export {
                    ProgressView()
                }
            }
        }
        .disabled(exporting != nil)
    }

    private func run(_ export: Export) async {
        exportError = nil
        exporting = export
        defer { exporting = nil }
        switch export {
        case .csv:
            guard let download = await model.exportUserCSV() else {
                exportError = model.lastError?.message ?? "Couldn't export the transactions."
                return
            }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(download.filename)
            do {
                try download.data.write(to: url, options: .atomic)
                exportedFile = url
            } catch {
                exportError = error.localizedDescription
            }
        case .archive:
            guard let url = await model.downloadPortableArchive() else {
                exportError = model.lastError?.message ?? "Couldn't export the archive."
                return
            }
            exportedFile = url
        }
    }

    private func choose(_ url: URL) async {
        file = url
        preview = nil
        importError = nil
        importedCount = nil
        previewing = true
        defer { previewing = false }
        preview = await model.previewCSV(fileURL: url)
        if preview == nil {
            importError = model.lastError?.message ?? "Couldn't read the file."
        }
    }

    private func commit(_ url: URL) async {
        importError = nil
        importing = true
        defer { importing = false }
        guard let response = await model.commitCSV(fileURL: url) else {
            importError = model.lastError?.message ?? "Couldn't import the file."
            return
        }
        importedCount = response.importedCount
        file = nil
        preview = nil
    }
}
