import SwiftUI

/// A PDF report for a date range, with the sections, scope and notes it includes.
struct ReportsView: View {
    @Environment(AppModel.self) private var model

    private enum ReportSection: String, CaseIterable, Identifiable {
        case summary
        case categoryBreakdown = "category_breakdown"
        case topCategories = "top_categories"
        case trend
        case transactions = "recent_transactions"
        case upcomingRecurring = "recurring_upcoming"

        var id: String { rawValue }

        var title: String {
            switch self {
            case .summary: "Summary"
            case .categoryBreakdown: "Category breakdown"
            case .topCategories: "Top categories"
            case .trend: "Trend"
            case .transactions: "Transactions"
            case .upcomingRecurring: "Upcoming recurring"
            }
        }
    }

    private enum Sort: String {
        case newest
        case oldest
    }

    private enum CategoryScope {
        case all
        case selected
    }

    private enum TagScope {
        case all
        case include
        case exclude
    }

    private enum Problem {
        case range
        case sections
        case categories
        case tags

        var message: String {
            switch self {
            case .range: "The end must not be before the start."
            case .sections: "Select at least one report section."
            case .categories: "Select at least one category."
            case .tags: "Select at least one tag."
            }
        }
    }

    private struct GeneratedFile {
        let url: URL
        let name: String
        let at: Date
    }

    @State private var start = Calendar.current.dateInterval(of: .month, for: .now)?.start ?? .now
    @State private var end = Calendar.current.dateInterval(of: .month, for: .now)
        .flatMap { Calendar.current.date(byAdding: .day, value: -1, to: $0.end) } ?? .now
    @State private var sections: Set<ReportSection> = [.summary, .categoryBreakdown, .transactions]
    @State private var type: TransactionKind?
    @State private var sort = Sort.newest
    @State private var runningBalance = false
    @State private var categorySubtotals = false
    @State private var includeCents = true
    @State private var notes = ""
    @State private var categoryScope = CategoryScope.all
    @State private var categoryIDs: Set<Int> = []
    @State private var tagScope = TagScope.all
    @State private var tagIDs: Set<Int> = []
    @State private var tags: Result<[TagRow], APIErrorInfo>?
    @State private var generating = false
    @State private var problem: Problem?
    @State private var error: String?
    @State private var file: GeneratedFile?
    @State private var previewDocument: PreviewDocument?

    var body: some View {
        List {
            if let file {
                Section {
                    HStack {
                        Button {
                            previewDocument = PreviewDocument(url: file.url)
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(file.name)
                                        .lineLimit(1)
                                    Text("Generated \(AppFormatters.time(file.at))")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            } icon: {
                                Image(systemName: "doc.richtext")
                            }
                        }
                        .tint(.primary)
                        Spacer(minLength: 8)
                        ShareLink(item: file.url) {
                            Label("Share", systemImage: "square.and.arrow.up")
                                .labelStyle(.iconOnly)
                        }
                        .buttonStyle(.borderless)
                    }
                }
                .expensesRowBackground()
            }

            Section {
                DatePicker("From", selection: $start, displayedComponents: .date)
                DatePicker("Until", selection: $end, displayedComponents: .date)
                    .fieldError(problem == .range ? Problem.range.message : nil)
                Picker("Type", selection: $type) {
                    Text("All").tag(TransactionKind?.none)
                    Text("Income").tag(TransactionKind?.some(.income))
                    Text("Expense").tag(TransactionKind?.some(.expense))
                }
                if runningBalance {
                    LabeledContent("Sort", value: "Oldest first")
                } else {
                    Picker("Sort", selection: $sort) {
                        Text("Newest first").tag(Sort.newest)
                        Text("Oldest first").tag(Sort.oldest)
                    }
                }
                Toggle("Running balance", isOn: $runningBalance)
                Toggle("Category subtotals", isOn: $categorySubtotals)
                Toggle("Cents in tables", isOn: $includeCents)
            }
            .expensesRowBackground()

            Section("Sections") {
                ForEach(ReportSection.allCases) { section in
                    Toggle(section.title, isOn: sectionBinding(section))
                }
                if problem == .sections {
                    FieldError(Problem.sections.message)
                }
            }
            .expensesRowBackground()

            scopeSection

            Section("Notes") {
                TextField("Shown at the top of the report", text: $notes, axis: .vertical)
                    .lineLimit(3...6)
            }
            .expensesRowBackground()
        }
        .navigationTitle("Reports")
        .expensesScreenStyle()
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(generating ? "Generating…" : "Generate") {
                    Task { await generate() }
                }
                .disabled(generating)
            }
        }
        .task {
            if model.categories == nil {
                _ = await model.loadCategories()
            }
            let result = await model.chart { try await $0.tags(period: .all, token: $1).tags }
            guard !Task.isCancelled else {
                return
            }
            tags = result
        }
        .onChange(of: start) { clear(.range) }
        .onChange(of: end) { clear(.range) }
        .onChange(of: sections) { clear(.sections) }
        .onChange(of: categoryIDs) { clear(.categories) }
        .onChange(of: categoryScope) { clear(.categories) }
        .onChange(of: tagIDs) { clear(.tags) }
        .onChange(of: tagScope) { clear(.tags) }
        .sheet(item: $previewDocument) { document in
            DocumentPreviewView(url: document.url)
        }
        .failureAlert("Couldn't generate the report", message: $error)
    }

    private var scopeSection: some View {
        Section("Scope") {
            Picker("Categories", selection: $categoryScope) {
                Text("All").tag(CategoryScope.all)
                Text("Selected").tag(CategoryScope.selected)
            }
            if categoryScope == .selected {
                NavigationLink {
                    ChoiceList(title: "Categories", groups: categoryGroups, selection: $categoryIDs)
                } label: {
                    LabeledContent("Categories to include", value: count(categoryIDs))
                }
                .navigationLinkIndicatorVisibility(.hidden)
                .fieldError(problem == .categories ? Problem.categories.message : nil)
            }
            Picker("Tags", selection: $tagScope) {
                Text("All").tag(TagScope.all)
                Text("Only include").tag(TagScope.include)
                Text("Exclude").tag(TagScope.exclude)
            }
            if tagScope != .all {
                switch tags {
                case nil:
                    LabeledContent(tagChoiceTitle) {
                        ProgressView()
                    }
                case .failure(let failure):
                    FieldError(failure.message)
                case .success:
                    NavigationLink {
                        ChoiceList(title: "Tags", groups: [(nil, tagChoices)], selection: $tagIDs)
                    } label: {
                        LabeledContent(tagChoiceTitle, value: count(tagIDs))
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                    .fieldError(problem == .tags ? Problem.tags.message : nil)
                }
            }
        }
        .expensesRowBackground()
    }

    private func sectionBinding(_ section: ReportSection) -> Binding<Bool> {
        Binding(get: { sections.contains(section) }, set: { _ in sections.formSymmetricDifference([section]) })
    }

    private var activeCategories: [CategoryListItem] {
        model.categories?.categories.filter { $0.archivedAt == nil } ?? []
    }

    private var categoryGroups: [(String?, [ChoiceList.Choice])] {
        let groups: [(String?, [ChoiceList.Choice])] = [TransactionKind.expense, .income].map { kind in
            let choices = activeCategories.filter { $0.type == kind }.map { ChoiceList.Choice(id: $0.id, name: $0.name, detail: nil) }
            return (kind == .income ? "Income" : "Expense", choices)
        }
        return groups.filter { !$0.1.isEmpty }
    }

    // Archived tags stay choosable for past periods; they sort last.
    private var filterTags: [TagRow] {
        let visible = ((try? tags?.get()) ?? []).filter { !$0.isHiddenFromFilters }
        return visible.sorted { first, second in
            if (first.archivedAt == nil) != (second.archivedAt == nil) {
                return first.archivedAt == nil
            }
            return first.name.localizedStandardCompare(second.name) == .orderedAscending
        }
    }

    private var tagChoices: [ChoiceList.Choice] {
        filterTags.map { ChoiceList.Choice(id: $0.id, name: $0.name, detail: $0.archivedAt == nil ? nil : "Archived") }
    }

    private var tagChoiceTitle: String {
        tagScope == .exclude ? "Tags to exclude" : "Tags to include"
    }

    private func count(_ ids: Set<Int>) -> String {
        ids.isEmpty ? "None" : ids.count.formatted()
    }

    private func clear(_ cleared: Problem) {
        if problem == cleared {
            problem = nil
        }
    }

    private func generate() async {
        problem = nil
        error = nil
        let activeIDs = Set(activeCategories.map(\.id))
        let chosenCategories = categoryIDs.intersection(activeIDs).sorted()
        let chosenTags = tagIDs.intersection(filterTags.map(\.id)).sorted()
        if Calendar.current.compare(end, to: start, toGranularity: .day) == .orderedAscending {
            problem = .range
        } else if sections.isEmpty {
            problem = .sections
        } else if categoryScope == .selected, chosenCategories.isEmpty {
            problem = .categories
        } else if tagScope != .all, chosenTags.isEmpty {
            problem = .tags
        }
        guard problem == nil else {
            return
        }

        generating = true
        defer { generating = false }
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let request = ReportOptionsRequest(
            start: AppFormatters.isoDay(start),
            end: AppFormatters.isoDay(end),
            sections: ReportSection.allCases.filter(sections.contains).map(\.rawValue),
            includeCents: includeCents,
            notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
            transactionType: type?.rawValue,
            categoryIDs: categoryScope == .selected && chosenCategories.count < activeIDs.count ? chosenCategories : nil,
            tagIDs: tagScope == .include ? chosenTags : [],
            excludedTagIDs: tagScope == .exclude ? chosenTags : [],
            transactionsSort: runningBalance ? Sort.oldest.rawValue : sort.rawValue,
            showRunningBalance: runningBalance,
            includeCategorySubtotals: categorySubtotals
        )
        guard let download = await model.generateReportPDF(request) else {
            error = model.lastError?.message ?? "The server didn't return a report."
            return
        }
        do {
            let url = try writeTemporaryFile(download)
            file = GeneratedFile(url: url, name: url.lastPathComponent, at: .now)
            previewDocument = PreviewDocument(url: url)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func writeTemporaryFile(_ download: AttachmentDownload) throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ExpensesReports", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(Self.safeFilename(download.filename, fallback: "expense_report.pdf"))
        try download.data.write(to: url, options: .atomic)
        return url
    }

    private static func safeFilename(_ raw: String, fallback: String) -> String {
        let basename = raw.components(separatedBy: CharacterSet(charactersIn: "/\\")).last ?? ""
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " ._-"))
        let cleaned = basename.unicodeScalars
            .map { allowed.contains($0) ? String($0) : "_" }
            .joined()
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty || cleaned == "." || cleaned == ".." {
            return fallback
        }
        return String(cleaned.prefix(120))
    }
}

/// Items to tick, in optional groups, such as the categories a report includes.
private struct ChoiceList: View {
    struct Choice: Identifiable {
        let id: Int
        let name: String
        let detail: String?
    }

    let title: String
    let groups: [(String?, [Choice])]
    @Binding var selection: Set<Int>

    var body: some View {
        List {
            ForEach(groups, id: \.0) { title, choices in
                Section {
                    ForEach(choices) { choice in
                        Button {
                            selection.formSymmetricDifference([choice.id])
                        } label: {
                            HStack {
                                Text(choice.name)
                                Spacer()
                                if let detail = choice.detail {
                                    Text(detail)
                                        .foregroundStyle(.secondary)
                                }
                                if selection.contains(choice.id) {
                                    Image(systemName: "checkmark")
                                        .fontWeight(.semibold)
                                        .foregroundStyle(.tint)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .tint(.primary)
                        .accessibilityAddTraits(selection.contains(choice.id) ? .isSelected : [])
                    }
                } header: {
                    if let title {
                        Text(title)
                    }
                }
                .expensesRowBackground()
            }
        }
        .overlay {
            if groups.allSatisfy(\.1.isEmpty) {
                ContentUnavailableView("No \(title.lowercased())", systemImage: "checklist")
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .sensoryFeedback(.selection, trigger: selection)
    }
}

#Preview {
    NavigationStack {
        ReportsView()
    }
    .environment(AppModel())
}
