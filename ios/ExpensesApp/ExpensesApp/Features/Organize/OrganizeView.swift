import SwiftUI

private struct ArchivedCategoriesView: View {
    @Environment(AppModel.self) private var model
    @State private var editingCategory: CategoryListItem?

    var body: some View {
        List {
            if model.identity?.authenticated != true {
                SignedOutStateSection()
            } else if let categories = model.categories {
                ArchivedCategoryList(categories: categories.categories.filter { $0.archivedAt != nil }) { category in
                    editingCategory = category
                } onRestore: { category in
                    Task {
                        await model.setCategoryArchived(category, archived: false)
                    }
                }
            } else if model.isLoading {
                LoadingStateSection(title: "Loading archived categories")
            } else {
                ArchivedCategoryList(categories: []) { category in
                    editingCategory = category
                } onRestore: { category in
                    Task {
                        await model.setCategoryArchived(category, archived: false)
                    }
                }
            }
        }
        .navigationTitle("Archived Categories")
        .expensesScreenStyle()
        .sheet(item: $editingCategory) { category in
            CategoryFormView(category: category)
                .themeAccentTint()
        }
        .task {
            await model.loadOrganizeData()
        }
        .refreshable {
            await model.loadOrganizeData()
        }
    }
}

struct OrganizeView: View {
    @Environment(AppModel.self) private var model
    @Binding private var quickAddTrigger: Int
    @State private var selection: OrganizeSection = .categories
    @State private var activeSheet: OrganizeSheet?
    @State private var pendingDeleteTag: TagRow?
    @State private var pendingDeleteTemplate: TemplateRow?
    @State private var pendingDeleteRule: RuleRow?

    init(quickAddTrigger: Binding<Int> = .constant(0)) {
        _quickAddTrigger = quickAddTrigger
    }

    var body: some View {
        List {
            if model.identity?.authenticated != true {
                SignedOutStateSection()
            } else {
                Section {
                    OrganizeSectionPicker(selection: $selection)
                }

                switch selection {
                case .categories:
                    CategoryList(categories: model.categories?.categories.filter { $0.archivedAt == nil } ?? []) { category in
                        activeSheet = .category(category)
                    } onArchiveToggle: { category in
                        Task {
                            await model.setCategoryArchived(category, archived: category.archivedAt == nil)
                        }
                    } onMerge: {
                        activeSheet = .mergeCategories
                    }
                    CategoryArchiveLink(archivedCount: model.categories?.categories.filter { $0.archivedAt != nil }.count ?? 0)
                case .tags:
                    TagList(tags: model.tags?.tags ?? []) { tag in
                        activeSheet = .tag(tag)
                    } onDelete: { tag in
                        pendingDeleteTag = tag
                    } onMerge: {
                        activeSheet = .mergeTags
                    }
                case .templates:
                    TemplateList(templates: model.templates?.templates ?? []) { template in
                        activeSheet = .template(template)
                    } onDelete: { template in
                        pendingDeleteTemplate = template
                    } onMove: { source, destination in
                        Task { await model.moveTemplate(from: source, to: destination) }
                    }
                case .rules:
                    if model.llmEnabled {
                        RuleSuggestionsSection(
                            suggestions: model.ruleSuggestions,
                            isLoading: model.isMiningRuleSuggestions,
                            status: model.ruleMiningStatus,
                            onMine: {
                                Task { await model.mineRuleSuggestions() }
                            },
                            onAccept: { suggestion in
                                Task { await model.acceptRuleSuggestion(suggestion) }
                            },
                            onReject: { suggestion in
                                Task { await model.rejectRuleSuggestion(suggestion) }
                            }
                        )
                    }
                    RuleList(rules: model.rules?.rules ?? []) { rule in
                        activeSheet = .rule(rule)
                    } onToggle: { rule in
                        Task {
                            await model.toggleRule(rule, enabled: !rule.enabled)
                        }
                    } onDelete: { rule in
                        pendingDeleteRule = rule
                    }
                }
            }
        }
        .navigationTitle("Organize")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    activeSheet = selection.newSheet
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add Item")
                .disabled(model.identity?.authenticated != true)
            }
        }
        .expensesScreenStyle()
        .sheet(item: $activeSheet) { sheet in
            Group {
                switch sheet {
                case .category(let category):
                    CategoryFormView(category: category)
                case .tag(let tag):
                    TagFormView(tag: tag)
                case .mergeCategories:
                    CategoryMergeView(categories: model.categories?.categories ?? [])
                case .mergeTags:
                    TagMergeView(tags: model.tags?.tags ?? [])
                case .template(let template):
                    TemplateFormView(template: template, categories: model.knownCategories)
                case .rule(let rule):
                    RuleFormView(
                        rule: rule,
                        categories: model.rules?.categories ?? model.knownCategories,
                        tags: model.rules?.tags ?? []
                    )
                }
            }
            .themeAccentTint()
        }
        .confirmationDialog("Delete tag?", isPresented: deleteTagPresented) {
            Button("Delete Tag", role: .destructive) {
                if let tag = pendingDeleteTag {
                    Task { await model.deleteTag(tag) }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete template?", isPresented: deleteTemplatePresented) {
            Button("Delete Template", role: .destructive) {
                if let template = pendingDeleteTemplate {
                    Task { await model.deleteTemplate(template) }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete rule?", isPresented: deleteRulePresented) {
            Button("Delete Rule", role: .destructive) {
                if let rule = pendingDeleteRule {
                    Task { await model.deleteRule(rule) }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .task {
            await model.loadOrganizeData()
        }
        .refreshable {
            await model.loadOrganizeData()
        }
        .onChange(of: quickAddTrigger) { _, _ in
            activeSheet = selection.newSheet
        }
    }

    private var deleteTagPresented: Binding<Bool> {
        Binding(
            get: { pendingDeleteTag != nil },
            set: { isPresented in
                if !isPresented {
                    pendingDeleteTag = nil
                }
            }
        )
    }

    private var deleteTemplatePresented: Binding<Bool> {
        Binding(
            get: { pendingDeleteTemplate != nil },
            set: { isPresented in
                if !isPresented {
                    pendingDeleteTemplate = nil
                }
            }
        )
    }

    private var deleteRulePresented: Binding<Bool> {
        Binding(
            get: { pendingDeleteRule != nil },
            set: { isPresented in
                if !isPresented {
                    pendingDeleteRule = nil
                }
            }
        )
    }
}

private enum CategorySheet: Identifiable {
    case category(CategoryListItem?)
    case merge

    var id: String {
        switch self {
        case .category(let category):
            "category-\(category?.id ?? 0)"
        case .merge:
            "merge"
        }
    }
}

private enum RuleSheet: Identifiable {
    case rule(RuleRow?)

    var id: String {
        switch self {
        case .rule(let rule):
            "rule-\(rule?.id ?? 0)"
        }
    }
}

private struct OrganizeSectionPicker: View {
    @Binding var selection: OrganizeSection

    var body: some View {
        Picker("Section", selection: $selection) {
            ForEach(OrganizeSection.allCases) { section in
                Text(section.title).tag(section)
            }
        }
        .pickerStyle(.segmented)
        .sensoryFeedback(.selection, trigger: selection)
    }
}

private struct RuleSuggestionsSection: View {
    let suggestions: [RuleSuggestion]
    let isLoading: Bool
    let status: RuleMiningStatus
    var onMine: () -> Void
    var onAccept: (RuleSuggestion) -> Void
    var onReject: (RuleSuggestion) -> Void

    var body: some View {
        Section {
            HStack(alignment: .center) {
                Text("Rule suggestions")
                    .font(.headline)
                if status == .noneFound, suggestions.isEmpty {
                    Text("No suggestions")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    onMine()
                } label: {
                    HStack(spacing: 6) {
                        if isLoading {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(isLoading ? "Mining" : "Mine")
                    }
                    .lineLimit(1)
                    .fixedSize()
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
                .disabled(isLoading)
            }
            .padding(.vertical, 4)
        }

        if !suggestions.isEmpty {
            Section {
                ForEach(suggestions) { suggestion in
                    RuleSuggestionReview(
                        suggestion: suggestion,
                        onAccept: { onAccept(suggestion) },
                        onReject: { onReject(suggestion) }
                    )
                }
            }
        }
    }
}

private struct RuleSuggestionReview: View {
    let suggestion: RuleSuggestion
    var onAccept: () -> Void
    var onReject: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(suggestion.name)
                    .font(.callout.weight(.semibold))
                Spacer()
                Text("\(Int((suggestion.confidence * 100).rounded()))%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            HStack {
                Button("Reject", role: .destructive, action: onReject)
                    .buttonStyle(.bordered)
                Spacer()
                Button("Accept", action: onAccept)
                    .buttonStyle(.borderedProminent)
            }
            .font(.caption.weight(.semibold))
        }
        .padding(12)
        .background(.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private enum OrganizeSection: String, CaseIterable, Identifiable {
    case categories
    case tags
    case templates
    case rules

    var id: String { rawValue }

    var title: String {
        switch self {
        case .categories:
            "Categories"
        case .tags:
            "Tags"
        case .templates:
            "Templates"
        case .rules:
            "Rules"
        }
    }

    var newSheet: OrganizeSheet {
        switch self {
        case .categories:
            .category(nil)
        case .tags:
            .tag(nil)
        case .templates:
            .template(nil)
        case .rules:
            .rule(nil)
        }
    }
}

private enum OrganizeSheet: Identifiable {
    case category(CategoryListItem?)
    case tag(TagRow?)
    case mergeCategories
    case mergeTags
    case template(TemplateRow?)
    case rule(RuleRow?)

    var id: String {
        switch self {
        case .category(let category):
            "category-\(category?.id ?? 0)"
        case .tag(let tag):
            "tag-\(tag?.id ?? 0)"
        case .mergeCategories:
            "merge-categories"
        case .mergeTags:
            "merge-tags"
        case .template(let template):
            "template-\(template?.id ?? 0)"
        case .rule(let rule):
            "rule-\(rule?.id ?? 0)"
        }
    }
}

private struct CategoryList: View {
    let categories: [CategoryListItem]
    var onEdit: (CategoryListItem) -> Void
    var onArchiveToggle: (CategoryListItem) -> Void
    var onMerge: () -> Void
    @State private var incomeSortMode: CategorySortMode = .usage
    @State private var expenseSortMode: CategorySortMode = .usage

    var body: some View {
        ForEach(CategoryTransactionType.allCases) { type in
            let rows = sortedRows(for: type)
            if !rows.isEmpty {
                Section {
                    ForEach(rows) { category in
                        Button {
                            onEdit(category)
                        } label: {
                            CategoryRow(category: category)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing) {
                            Button("Archive") {
                                onArchiveToggle(category)
                            }
                            .tint(.orange)
                        }
                        .swipeActions(edge: .leading) {
                            Button("Edit") {
                                onEdit(category)
                            }
                            .tint(.blue)
                        }
                    }
                } header: {
                    CategorySectionHeader(title: type.sectionTitle, sortMode: sortModeBinding(for: type))
                }
            }
        }
        Section("Merge") {
            Button {
                onMerge()
            } label: {
                Label("Merge categories", systemImage: "arrow.triangle.merge")
            }
            .disabled(categories.count < 2)
        }
    }

    private func sortedRows(for type: CategoryTransactionType) -> [CategoryListItem] {
        sortedCategories(categories.filter { $0.type == type.rawValue }, mode: sortMode(for: type))
    }

    private func sortMode(for type: CategoryTransactionType) -> CategorySortMode {
        switch type {
        case .income:
            incomeSortMode
        case .expense:
            expenseSortMode
        }
    }

    private func sortModeBinding(for type: CategoryTransactionType) -> Binding<CategorySortMode> {
        switch type {
        case .income:
            $incomeSortMode
        case .expense:
            $expenseSortMode
        }
    }
}

private struct ArchivedCategoryList: View {
    let categories: [CategoryListItem]
    var onEdit: (CategoryListItem) -> Void
    var onRestore: (CategoryListItem) -> Void
    @State private var incomeSortMode: CategorySortMode = .usage
    @State private var expenseSortMode: CategorySortMode = .usage

    var body: some View {
        if categories.isEmpty {
            Section {
                Text("No archived categories.")
                    .foregroundStyle(.secondary)
            }
        } else {
            ForEach(CategoryTransactionType.allCases) { type in
                let rows = sortedRows(for: type)
                if !rows.isEmpty {
                    Section {
                        ForEach(rows) { category in
                            Button {
                                onEdit(category)
                            } label: {
                                CategoryRow(
                                    category: category,
                                    detail: archivedDetail(for: category)
                                )
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing) {
                                Button("Restore") {
                                    onRestore(category)
                                }
                                .tint(.green)
                            }
                            .swipeActions(edge: .leading) {
                                Button("Edit") {
                                    onEdit(category)
                                }
                                .tint(.blue)
                            }
                        }
                    } header: {
                        CategorySectionHeader(title: type.archivedSectionTitle, sortMode: sortModeBinding(for: type))
                    }
                }
            }
        }
    }

    private func sortedRows(for type: CategoryTransactionType) -> [CategoryListItem] {
        sortedCategories(categories.filter { $0.type == type.rawValue }, mode: sortMode(for: type))
    }

    private func sortMode(for type: CategoryTransactionType) -> CategorySortMode {
        switch type {
        case .income:
            incomeSortMode
        case .expense:
            expenseSortMode
        }
    }

    private func sortModeBinding(for type: CategoryTransactionType) -> Binding<CategorySortMode> {
        switch type {
        case .income:
            $incomeSortMode
        case .expense:
            $expenseSortMode
        }
    }

    private func archivedDetail(for category: CategoryListItem) -> String? {
        guard let archivedAt = category.archivedAt else {
            return nil
        }
        return "Archived \(AppFormatters.day(archivedAt))"
    }
}

private struct CategoryArchiveLink: View {
    let archivedCount: Int

    var body: some View {
        Section("Archive") {
            NavigationLink {
                ArchivedCategoriesView()
            } label: {
                HStack {
                    Label("Archived categories", systemImage: "archivebox")
                    Spacer()
                    Text("\(archivedCount)")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

private struct CategoryRow: View {
    let category: CategoryListItem
    var detail: String?

    var body: some View {
        HStack {
            CategoryIconImage(iconKey: category.icon)
            VStack(alignment: .leading, spacing: 4) {
                Text(category.name)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text("\(category.usageCount)")
                .foregroundStyle(.secondary)
        }
    }
}

private struct CategorySectionHeader: View {
    let title: String
    @Binding var sortMode: CategorySortMode

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Picker("Sort by", selection: $sortMode) {
                ForEach(CategorySortMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.menu)
        }
    }
}

private enum CategoryTransactionType: String, CaseIterable, Identifiable {
    case expense
    case income

    var id: String { rawValue }

    var sectionTitle: String {
        switch self {
        case .income:
            "Income Categories"
        case .expense:
            "Expense Categories"
        }
    }

    var archivedSectionTitle: String {
        switch self {
        case .income:
            "Archived Income Categories"
        case .expense:
            "Archived Expense Categories"
        }
    }
}

private enum CategorySortMode: String, CaseIterable, Identifiable {
    case usage
    case name

    var id: String { rawValue }

    var title: String {
        switch self {
        case .usage:
            "Usage"
        case .name:
            "Name"
        }
    }
}

private func sortedCategories(_ categories: [CategoryListItem], mode: CategorySortMode) -> [CategoryListItem] {
    categories.sorted { lhs, rhs in
        if mode == .usage && lhs.usageCount != rhs.usageCount {
            return lhs.usageCount > rhs.usageCount
        }

        let nameComparison = lhs.name.localizedCaseInsensitiveCompare(rhs.name)
        if nameComparison != .orderedSame {
            return nameComparison == .orderedAscending
        }

        return lhs.id < rhs.id
    }
}

private struct TagList: View {
    let tags: [TagRow]
    var onEdit: (TagRow) -> Void
    var onDelete: (TagRow) -> Void
    var onMerge: () -> Void

    var body: some View {
        Section("Tags") {
            ForEach(tags) { tag in
                Button {
                    onEdit(tag)
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(tag.name)
                            if tag.isHiddenFromBudget {
                                Text("Hidden from budgets")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Text("\(tag.usageCount)")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing) {
                    Button("Delete", role: .destructive) {
                        onDelete(tag)
                    }
                }
                .swipeActions(edge: .leading) {
                    Button("Edit") {
                        onEdit(tag)
                    }
                    .tint(.blue)
                }
            }
        }
        Section("Merge") {
            Button {
                onMerge()
            } label: {
                Label("Merge tags", systemImage: "arrow.triangle.merge")
            }
            .disabled(tags.count < 2)
        }
    }
}

private struct CategoryMergeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let categories: [CategoryListItem]
    @State private var sourceID: Int?
    @State private var targetID: Int?
    @State private var previewCounts: [String: Int]?
    @State private var confirmMerge = false

    private var candidates: [CategoryListItem] {
        categories
            .filter { $0.archivedAt == nil }
            .sorted { lhs, rhs in
                if lhs.type != rhs.type {
                    return lhs.type < rhs.type
                }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
    }

    private var source: CategoryListItem? {
        candidates.first { $0.id == sourceID }
    }

    private var targets: [CategoryListItem] {
        guard let source else {
            return []
        }
        return candidates.filter { $0.id != source.id && $0.type == source.type }
    }

    private var canSubmit: Bool {
        sourceID != nil && targetID != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Source", selection: $sourceID) {
                        Text("Choose source").tag(Optional<Int>.none)
                        ForEach(candidates) { category in
                            Text("\(category.name) (\(category.type))").tag(Optional(category.id))
                        }
                    }
                    Picker("Target", selection: $targetID) {
                        Text("Choose target").tag(Optional<Int>.none)
                        ForEach(targets) { category in
                            Text(category.name).tag(Optional(category.id))
                        }
                    }
                    .disabled(sourceID == nil)
                }
                if let previewCounts {
                    MergeCountsSection(counts: previewCounts, labels: categoryMergeLabels)
                }
                if let error = model.lastError {
                    Section {
                        Text(error.message)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Merge Categories")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Merge") { confirmMerge = true }
                        .disabled(!canSubmit || model.isLoading)
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("Preview") {
                        Task { await previewMerge() }
                    }
                    .disabled(!canSubmit || model.isLoading)
                }
            }
            .onChange(of: sourceID) { _, _ in
                targetID = nil
                previewCounts = nil
            }
            .onChange(of: targetID) { _, _ in
                previewCounts = nil
            }
            .confirmationDialog("Merge category?", isPresented: $confirmMerge) {
                Button("Merge Category", role: .destructive) {
                    Task { await applyMerge() }
                }
                Button("Cancel", role: .cancel) {}
            }
            .onAppear { model.lastError = nil }
        }
    }

    private func previewMerge() async {
        guard let sourceID, let targetID else {
            return
        }
        previewCounts = await model.previewCategoryMerge(sourceID: sourceID, targetID: targetID)
    }

    private func applyMerge() async {
        guard let sourceID, let targetID else {
            return
        }
        if await model.mergeCategories(sourceID: sourceID, targetID: targetID) {
            dismiss()
        }
    }
}

private struct TagMergeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let tags: [TagRow]
    @State private var sourceID: Int?
    @State private var targetID: Int?
    @State private var previewCounts: [String: Int]?
    @State private var confirmMerge = false

    private var candidates: [TagRow] {
        tags.sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    private var targets: [TagRow] {
        guard let sourceID else {
            return []
        }
        return candidates.filter { $0.id != sourceID }
    }

    private var canSubmit: Bool {
        sourceID != nil && targetID != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Source", selection: $sourceID) {
                        Text("Choose source").tag(Optional<Int>.none)
                        ForEach(candidates) { tag in
                            Text(tag.name).tag(Optional(tag.id))
                        }
                    }
                    Picker("Target", selection: $targetID) {
                        Text("Choose target").tag(Optional<Int>.none)
                        ForEach(targets) { tag in
                            Text(tag.name).tag(Optional(tag.id))
                        }
                    }
                    .disabled(sourceID == nil)
                }
                if let previewCounts {
                    MergeCountsSection(counts: previewCounts, labels: tagMergeLabels)
                }
                if let error = model.lastError {
                    Section {
                        Text(error.message)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Merge Tags")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Merge") { confirmMerge = true }
                        .disabled(!canSubmit || model.isLoading)
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("Preview") {
                        Task { await previewMerge() }
                    }
                    .disabled(!canSubmit || model.isLoading)
                }
            }
            .onChange(of: sourceID) { _, _ in
                targetID = nil
                previewCounts = nil
            }
            .onChange(of: targetID) { _, _ in
                previewCounts = nil
            }
            .confirmationDialog("Merge tag?", isPresented: $confirmMerge) {
                Button("Merge Tag", role: .destructive) {
                    Task { await applyMerge() }
                }
                Button("Cancel", role: .cancel) {}
            }
            .onAppear { model.lastError = nil }
        }
    }

    private func previewMerge() async {
        guard let sourceID, let targetID else {
            return
        }
        previewCounts = await model.previewTagMerge(sourceID: sourceID, targetID: targetID)
    }

    private func applyMerge() async {
        guard let sourceID, let targetID else {
            return
        }
        if await model.mergeTags(sourceID: sourceID, targetID: targetID) {
            dismiss()
        }
    }
}

private struct MergeCountsSection: View {
    let counts: [String: Int]
    let labels: [String: String]

    var body: some View {
        Section("Preview") {
            ForEach(counts.keys.sorted(), id: \.self) { key in
                LabeledContent(labels[key] ?? key.replacingOccurrences(of: "_", with: " ").capitalized) {
                    Text("\(counts[key] ?? 0)")
                }
            }
        }
    }
}

private let categoryMergeLabels = [
    "transactions": "Transactions",
    "recurring_rules": "Recurring rules",
    "rules_set_category": "Rule category actions",
    "budget_templates": "Budget templates",
    "budget_overrides": "Budget overrides",
]

private let tagMergeLabels = [
    "transaction_links": "Transaction links",
    "budget_exclude_rules": "Budget exclude rules",
    "add_tags_rules_scanned": "Add-tags rules scanned",
]

private struct TemplateList: View {
    let templates: [TemplateRow]
    var onEdit: (TemplateRow) -> Void
    var onDelete: (TemplateRow) -> Void
    var onMove: (IndexSet, Int) -> Void

    var body: some View {
        Section("Templates") {
            ForEach(templates) { template in
                Button {
                    onEdit(template)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(template.name)
                            .font(.body.weight(.medium))
                        HStack(spacing: 6) {
                            Text(template.type.capitalized)
                            if let category = template.category {
                                Text(category.name)
                            }
                            if let amount = template.defaultAmountCents {
                                Text(AppFormatters.euros(amount))
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing) {
                    Button("Delete", role: .destructive) {
                        onDelete(template)
                    }
                }
                .swipeActions(edge: .leading) {
                    Button("Edit") {
                        onEdit(template)
                    }
                    .tint(.blue)
                }
            }
            .onMove(perform: onMove)
        }
    }
}

private struct RuleList: View {
    let rules: [RuleRow]
    var onEdit: (RuleRow) -> Void
    var onToggle: (RuleRow) -> Void
    var onDelete: (RuleRow) -> Void

    var body: some View {
        Section("Rules") {
            if rules.isEmpty {
                ContentUnavailableView(
                    "No rules yet",
                    systemImage: "wand.and.stars",
                    description: Text("Create rules to categorize matching transactions automatically.")
                )
            } else {
                ForEach(rules) { rule in
                    Button {
                        onEdit(rule)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(rule.name)
                                    .font(.body.weight(.medium))
                                Spacer()
                                Text(rule.enabled ? "On" : "Off")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(rule.enabled ? .green : .secondary)
                            }
                            Text("Priority \(rule.priority) · title \(rule.matchType.replacingOccurrences(of: "_", with: " ")) \"\(rule.matchValue)\"")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            RuleActionSummary(rule: rule)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .swipeActions(edge: .trailing) {
                        Button("Delete", role: .destructive) {
                            onDelete(rule)
                        }
                        Button(rule.enabled ? "Disable" : "Enable") {
                            onToggle(rule)
                        }
                        .tint(rule.enabled ? .orange : .green)
                    }
                    .swipeActions(edge: .leading) {
                        Button("Edit") {
                            onEdit(rule)
                        }
                        .tint(.blue)
                    }
                }
            }
        }
    }
}

private struct RuleActionSummary: View {
    let rule: RuleRow

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let type = rule.transactionType {
                Text(type.capitalized)
            }
            if let minAmount = rule.minAmountCents, let maxAmount = rule.maxAmountCents {
                Text("\(AppFormatters.euros(minAmount)) to \(AppFormatters.euros(maxAmount))")
            } else if let minAmount = rule.minAmountCents {
                Text("At least \(AppFormatters.euros(minAmount))")
            } else if let maxAmount = rule.maxAmountCents {
                Text("At most \(AppFormatters.euros(maxAmount))")
            }
            if let category = rule.setCategory {
                Text("Set category to \(category.name)")
            }
            if !rule.addTags.isEmpty {
                Text("Add tags: \(rule.addTags.joined(separator: ", "))")
            }
            if let tag = rule.budgetExcludeTag {
                Text("Budget exclude tag: \(tag.name)")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }
}

private struct CategoryFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let category: CategoryListItem?
    @State private var name: String
    @State private var type: String
    @State private var iconKey: String
    @State private var formError: String?

    init(category: CategoryListItem?) {
        self.category = category
        _name = State(initialValue: category?.name ?? "")
        _type = State(initialValue: category?.type ?? "expense")
        _iconKey = State(initialValue: category?.icon ?? defaultCategoryIconKey)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    if category == nil {
                        Picker("Type", selection: $type) {
                            Text("Expense").tag("expense")
                            Text("Income").tag("income")
                        }
                        .pickerStyle(.segmented)
                        .sensoryFeedback(.selection, trigger: type)
                    }
                    Picker("Icon", selection: $iconKey) {
                        if let current = category?.icon, categoryIconOption(for: current) == nil {
                            Label("Current custom", systemImage: categorySymbolName(for: current))
                                .tag(current)
                        }
                        ForEach(categoryIconOptions) { option in
                            Label(option.label, systemImage: option.symbolName)
                                .tag(option.key)
                        }
                    }
                }
                if let formError {
                    Section {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(category == nil ? "Add Category" : "Edit Category")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(model.isLoading)
                }
            }
        }
    }

    private func save() async {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty else {
            formError = "Name is required."
            return
        }
        let created = CategoryCreateRequest(
            name: cleanName,
            type: type,
            icon: iconKey,
            order: category?.order ?? 0
        )
        let updated = CategoryUpdateRequest(
            name: cleanName,
            icon: iconKey,
            order: category?.order ?? 0
        )
        if await model.saveCategory(id: category?.id, create: created, update: updated) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Category could not be saved."
        }
    }
}

private struct TagFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let tag: TagRow?
    @State private var name: String
    @State private var color: String
    @State private var hiddenFromBudget: Bool
    @State private var formError: String?

    init(tag: TagRow?) {
        self.tag = tag
        _name = State(initialValue: tag?.name ?? "")
        _color = State(initialValue: tag?.color ?? "")
        _hiddenFromBudget = State(initialValue: tag?.isHiddenFromBudget ?? false)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    TextField("Color", text: $color)
                        .textInputAutocapitalization(.never)
                    Toggle("Hidden from budgets", isOn: $hiddenFromBudget)
                        .sensoryFeedback(.selection, trigger: hiddenFromBudget)
                }
                if let formError {
                    Section {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(tag == nil ? "Add Tag" : "Edit Tag")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(model.isLoading)
                }
            }
        }
    }

    private func save() async {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty else {
            formError = "Name is required."
            return
        }
        let cleanColor = color.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = TagMutationRequest(
            name: cleanName,
            color: cleanColor.isEmpty ? nil : cleanColor,
            isHiddenFromBudget: hiddenFromBudget
        )
        if await model.saveTag(id: tag?.id, body: body) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Tag could not be saved."
        }
    }
}

private struct TemplateFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let template: TemplateRow?
    let categories: [CategorySummary]
    @State private var name: String
    @State private var type: String
    @State private var categoryID: Int?
    @State private var defaultAmount: String
    @State private var title: String
    @State private var tags: String
    @State private var formError: String?

    init(template: TemplateRow?, categories: [CategorySummary]) {
        self.template = template
        self.categories = categories
        _name = State(initialValue: template?.name ?? "")
        _type = State(initialValue: template?.type ?? "expense")
        _categoryID = State(initialValue: template?.categoryID)
        if let amount = template?.defaultAmountCents {
            _defaultAmount = State(initialValue: String(format: "%.2f", Double(amount) / 100.0))
        } else {
            _defaultAmount = State(initialValue: "")
        }
        _title = State(initialValue: template?.title ?? "")
        _tags = State(initialValue: template?.tags.joined(separator: ", ") ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                    Picker("Type", selection: $type) {
                        Text("Expense").tag("expense")
                        Text("Income").tag("income")
                    }
                    .pickerStyle(.segmented)
                    .sensoryFeedback(.selection, trigger: type)
                    .onChange(of: type) { _, nextType in
                        if !filteredCategories(for: nextType).contains(where: { $0.id == categoryID }) {
                            categoryID = filteredCategories(for: nextType).first?.id
                        }
                    }
                    Picker("Category", selection: $categoryID) {
                        Text("Select category").tag(Int?.none)
                        ForEach(filteredCategories(for: type)) { category in
                            Text(category.name).tag(Optional(category.id))
                        }
                    }
                }
                Section {
                    TextField("Default amount", text: $defaultAmount)
                        .keyboardType(.decimalPad)
                    TextField("Title", text: $title)
                    TextField("Tags", text: $tags)
                        .textInputAutocapitalization(.never)
                }
                if let formError {
                    Section {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(template == nil ? "Add Template" : "Edit Template")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(model.isLoading)
                }
            }
        }
    }

    private func save() async {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty else {
            formError = "Name is required."
            return
        }
        guard let categoryID else {
            formError = "Category is required."
            return
        }
        guard let amountCents = parseOptionalAmount(defaultAmount) else {
            formError = "Default amount is invalid."
            return
        }

        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = TemplateMutationRequest(
            name: cleanName,
            type: type,
            categoryID: categoryID,
            defaultAmountCents: amountCents,
            title: cleanTitle.isEmpty ? nil : cleanTitle,
            tags: tags
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        )
        if await model.saveTemplate(id: template?.id, body: body) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Template could not be saved."
        }
    }

    private func filteredCategories(for selectedType: String) -> [CategorySummary] {
        categories.filter { $0.type == selectedType }
    }

    private func parseOptionalAmount(_ raw: String) -> Int?? {
        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ",", with: ".")
        if normalized.isEmpty {
            return .some(nil)
        }
        guard let value = Double(normalized), value >= 0, value.isFinite else {
            return nil
        }
        return .some(Int((value * 100).rounded()))
    }
}

private struct RuleFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let rule: RuleRow?
    let categories: [CategorySummary]
    let tags: [RuleTag]
    @State private var name: String
    @State private var enabled: Bool
    @State private var priority: Int
    @State private var matchType: String
    @State private var matchValue: String
    @State private var transactionType: String
    @State private var minAmount: String
    @State private var maxAmount: String
    @State private var setCategoryID: Int?
    @State private var addTags: String
    @State private var budgetExcludeTagID: Int?
    @State private var preview: RulePreview?
    @State private var formError: String?

    init(rule: RuleRow?, categories: [CategorySummary], tags: [RuleTag]) {
        self.rule = rule
        self.categories = categories
        self.tags = tags
        _name = State(initialValue: rule?.name ?? "")
        _enabled = State(initialValue: rule?.enabled ?? true)
        _priority = State(initialValue: rule?.priority ?? 100)
        _matchType = State(initialValue: rule?.matchType ?? "contains")
        _matchValue = State(initialValue: rule?.matchValue ?? "")
        _transactionType = State(initialValue: rule?.transactionType ?? "")
        if let amount = rule?.minAmountCents {
            _minAmount = State(initialValue: String(format: "%.2f", Double(amount) / 100.0))
        } else {
            _minAmount = State(initialValue: "")
        }
        if let amount = rule?.maxAmountCents {
            _maxAmount = State(initialValue: String(format: "%.2f", Double(amount) / 100.0))
        } else {
            _maxAmount = State(initialValue: "")
        }
        _setCategoryID = State(initialValue: rule?.setCategoryID)
        _addTags = State(initialValue: rule?.addTags.joined(separator: ", ") ?? "")
        _budgetExcludeTagID = State(initialValue: rule?.budgetExcludeTagID)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Rule") {
                    TextField("Name", text: $name)
                    Toggle("Apply automatically", isOn: $enabled)
                        .sensoryFeedback(.selection, trigger: enabled)
                    Stepper("Priority \(priority)", value: $priority, in: 0...10_000)
                }

                Section("Match") {
                    Picker("Match type", selection: $matchType) {
                        Text("Contains").tag("contains")
                        Text("Starts with").tag("starts_with")
                        Text("Equals").tag("equals")
                        Text("Regex").tag("regex")
                    }
                    TextField("Title text", text: $matchValue)
                    Picker("Transaction type", selection: $transactionType) {
                        Text("Any").tag("")
                        Text("Expense").tag("expense")
                        Text("Income").tag("income")
                    }
                    .onChange(of: transactionType) { _, _ in
                        if let setCategoryID, !filteredCategories.contains(where: { $0.id == setCategoryID }) {
                            self.setCategoryID = nil
                        }
                    }
                    TextField("Min amount", text: $minAmount)
                        .keyboardType(.decimalPad)
                    TextField("Max amount", text: $maxAmount)
                        .keyboardType(.decimalPad)
                }

                Section("Actions") {
                    Picker("Set category", selection: $setCategoryID) {
                        Text("Leave unchanged").tag(Int?.none)
                        ForEach(filteredCategories) { category in
                            Text(category.name).tag(Optional(category.id))
                        }
                    }
                    TextField("Add tags", text: $addTags)
                        .textInputAutocapitalization(.never)
                    Picker("Exclude from budget", selection: $budgetExcludeTagID) {
                        Text("No").tag(Int?.none)
                        ForEach(hiddenBudgetTags) { tag in
                            Text(tag.name).tag(Optional(tag.id))
                        }
                    }
                }

                if let formError {
                    Section {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task { await previewMatches() }
                    } label: {
                        Label("Preview Matches", systemImage: "list.bullet.clipboard")
                    }
                    .disabled(model.isLoading)
                }

                if let preview {
                    RulePreviewSection(preview: preview)
                }
            }
            .navigationTitle(rule == nil ? "Add Rule" : "Edit Rule")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(model.isLoading)
                }
            }
        }
    }

    private var filteredCategories: [CategorySummary] {
        categories.filter { category in
            transactionType.isEmpty || category.type == transactionType
        }
    }

    private var hiddenBudgetTags: [RuleTag] {
        tags.filter(\.isHiddenFromBudget)
    }

    private func previewMatches() async {
        guard let body = buildBody() else {
            return
        }
        preview = await model.previewRule(body)
        if preview == nil {
            formError = model.lastError?.message ?? "Rule preview failed."
        }
    }

    private func save() async {
        guard let body = buildBody() else {
            return
        }
        if await model.saveRule(id: rule?.id, body: body) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Rule could not be saved."
        }
    }

    private func buildBody() -> RuleMutationRequest? {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanMatchValue = matchValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty else {
            formError = "Name is required."
            return nil
        }
        guard !cleanMatchValue.isEmpty else {
            formError = "Title text is required."
            return nil
        }
        guard let minCents = parseOptionalAmount(minAmount) else {
            formError = "Min amount is invalid."
            return nil
        }
        guard let maxCents = parseOptionalAmount(maxAmount) else {
            formError = "Max amount is invalid."
            return nil
        }
        formError = nil
        return RuleMutationRequest(
            name: cleanName,
            enabled: enabled,
            priority: priority,
            matchType: matchType,
            matchValue: cleanMatchValue,
            transactionType: transactionType.isEmpty ? nil : transactionType,
            minAmountCents: minCents,
            maxAmountCents: maxCents,
            setCategoryID: setCategoryID,
            addTags: addTags
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty },
            budgetExcludeTagID: budgetExcludeTagID
        )
    }

    private func parseOptionalAmount(_ raw: String) -> Int?? {
        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ",", with: ".")
        if normalized.isEmpty {
            return .some(nil)
        }
        guard let value = Double(normalized), value >= 0, value.isFinite else {
            return nil
        }
        return .some(Int((value * 100).rounded()))
    }
}

private struct RulePreviewSection: View {
    let preview: RulePreview

    var body: some View {
        Section {
            LabeledContent("Recent matches", value: "\(preview.matchesCount)")
            if preview.sample.isEmpty {
                Text("No recent transactions match this rule.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(preview.sample) { row in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(row.title ?? "Untitled")
                                .font(.body.weight(.medium))
                            Spacer()
                            Text(AppFormatters.euros(row.amountCents))
                                .font(.callout.monospacedDigit())
                        }
                        Text("\(row.beforeCategory) to \(row.afterCategory)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if !row.addTags.isEmpty {
                            Text("Tags: \(row.addTags.joined(separator: ", "))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        } header: {
            Text("Preview")
        }
    }
}
