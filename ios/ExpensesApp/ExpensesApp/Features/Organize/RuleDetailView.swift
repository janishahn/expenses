import SwiftUI

/// One rule, edited in place: when it applies, what it sets, and the recent
/// transactions it would match. Each change saves the whole rule, one after another.
struct RuleDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let ruleID: Int

    @State private var saves = FieldSaves<Field, RuleMutationRequest>()
    @State private var nameDraft = ""
    @FocusState private var nameFocused: Bool
    @State private var choosingPriority = false
    @State private var choosingTitle = false
    @State private var choosingAmount = false
    @State private var choosingCategory = false
    @State private var choosingTags = false
    @State private var deleting = false
    @State private var deleteError: String?
    @State private var matches: Result<RulePreview, APIErrorInfo>?

    // In the order entered values apply, so a category chosen after a type change stays.
    private enum Field: CaseIterable, Hashable {
        case name
        case enabled
        case priority
        case type
        case title
        case amount
        case category
        case tags
        case budgets
    }

    private var rule: RuleRow? {
        model.rules?.rules.first { $0.id == ruleID }
    }

    var body: some View {
        List {
            if let rule, let rules = model.rules {
                let shown = shown(rule)
                head
                general(shown)
                when(shown)
                then(rule, shown, rules: rules)
                matchesSection
            } else if model.rules != nil {
                ContentUnavailableView("This rule no longer exists", systemImage: "wand.and.stars")
                    .listRowBackground(Color.clear)
            } else {
                LoadingStateSection(title: "Loading rule")
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .expensesScreenStyle()
        .toolbar {
            if rule != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Delete Rule", systemImage: "trash", role: .destructive) {
                            deleting = true
                        }
                    } label: {
                        Label("More actions", systemImage: "ellipsis")
                    }
                }
            }
        }
        .sheet(isPresented: $choosingCategory) {
            if let rule, let rules = model.rules {
                let shown = shown(rule)
                CategoryPickerSheet(
                    title: "Category",
                    categories: rules.categories.filter { category in shown.transactionType.map { category.type == $0.rawValue } ?? true },
                    selectedID: shown.setCategoryID,
                    noneTitle: "Keep category",
                    noneSymbol: "minus",
                    onSelectNone: { changeCategory(nil, shown) }
                ) { category in
                    changeCategory(category.id, shown)
                }
            }
        }
        .sheet(isPresented: $choosingTags) {
            if let rule, let rules = model.rules {
                let shown = shown(rule)
                TagPickerSheet(title: "Add Tags", options: rules.tags.filter { !$0.isHiddenFromBudget }.map(\.name), selected: shown.addTags) { names in
                    if names != shown.addTags || saves.errors[.tags] != nil {
                        save(.tags) { $0.addTags = names }
                    }
                }
            }
        }
        .alert("Delete rule “\(rule?.name ?? "")”?", isPresented: $deleting) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task { await delete() }
            }
        }
        .failureAlert("Couldn't delete the rule", message: $deleteError)
        .onChange(of: nameFocused) { _, focused in
            if !focused {
                commitName()
            }
        }
        // Back can close the screen before the field reports losing focus.
        .onDisappear {
            commitName()
        }
        .task {
            if model.rules == nil {
                _ = await model.loadRules()
            }
        }
        .onChange(of: rule == nil, initial: true) {
            nameDraft = rule?.name ?? ""
        }
        .task(id: rule.map { shown($0) }) {
            guard let rule else {
                return
            }
            let request = shown(rule)
            let result = await model.chart { try await $0.previewRule(request, token: $1) }
            if !Task.isCancelled {
                matches = result
            }
        }
    }

    // MARK: Sections

    private var head: some View {
        Section {
            TextField("Name", text: $nameDraft, axis: .vertical)
                .focused($nameFocused)
                .detailNameField($nameDraft) { nameFocused = false }
                .fieldError(saves.errors[.name])
        }
        .detailHeadSection()
    }

    private func general(_ shown: RuleMutationRequest) -> some View {
        Section {
            Toggle("Enabled", isOn: Binding(get: { shown.enabled }, set: { enabled in
                save(.enabled) { $0.enabled = enabled }
            }))
            .fieldError(saves.errors[.enabled])

            Button {
                choosingPriority = true
            } label: {
                LabeledContent("Priority") {
                    Text("\(shown.priority)")
                        .monospacedDigit()
                        .foregroundStyle(.primary)
                }
            }
            .tint(.primary)
            .popover(isPresented: $choosingPriority) {
                ValuePopover(title: "Priority", text: String(shown.priority), keyboard: .numberPad, confirm: "Save") { raw in
                    switch parsePriority(raw) {
                    case .success(let priority):
                        if priority != shown.priority || saves.errors[.priority] != nil {
                            save(.priority) { $0.priority = priority }
                        }
                        return nil
                    case .failure(let error):
                        return error.message
                    }
                }
            }
            .fieldError(saves.errors[.priority])
        }
        .expensesRowBackground()
    }

    private func when(_ shown: RuleMutationRequest) -> some View {
        Section("When") {
            Picker("Type", selection: Binding(get: { shown.transactionType }, set: { changeType($0, shown) })) {
                Text("Any").tag(TransactionKind?.none)
                Text("Expense").tag(Optional(TransactionKind.expense))
                Text("Income").tag(Optional(TransactionKind.income))
            }
            .pickerStyle(.menu)
            .fieldError(saves.errors[.type])

            Button {
                choosingTitle = true
            } label: {
                LabeledContent("Title") {
                    Text(titleCondition(shown.matchType, shown.matchValue))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                }
            }
            .tint(.primary)
            .popover(isPresented: $choosingTitle) {
                TitlePopover(matchType: shown.matchType, value: shown.matchValue, confirm: "Save") { matchType, value in
                    if matchType != shown.matchType || value != shown.matchValue || saves.errors[.title] != nil {
                        save(.title) {
                            $0.matchType = matchType
                            $0.matchValue = value
                        }
                    }
                }
            }
            .fieldError(saves.errors[.title])

            Button {
                choosingAmount = true
            } label: {
                LabeledContent("Amount") {
                    AmountCondition(min: shown.minAmountCents, max: shown.maxAmountCents)
                        .foregroundStyle(shown.minAmountCents == nil && shown.maxAmountCents == nil ? .secondary : .primary)
                }
            }
            .tint(.primary)
            .popover(isPresented: $choosingAmount) {
                AmountRangePopover(min: shown.minAmountCents, max: shown.maxAmountCents, confirm: "Save") { min, max in
                    if min != shown.minAmountCents || max != shown.maxAmountCents || saves.errors[.amount] != nil {
                        save(.amount) {
                            $0.minAmountCents = min
                            $0.maxAmountCents = max
                        }
                    }
                }
            }
            .fieldError(saves.errors[.amount])
        }
        .expensesRowBackground()
    }

    private func then(_ rule: RuleRow, _ shown: RuleMutationRequest, rules: RulesResponse) -> some View {
        let hiddenTags = rules.tags.filter(\.isHiddenFromBudget)
        let category = shown.setCategoryID.flatMap { id in rules.categories.first { $0.id == id } ?? rule.setCategory }
        return Section("Then") {
            Button {
                choosingCategory = true
            } label: {
                LabeledContent("Category") {
                    if let category {
                        HStack(spacing: 4) {
                            CategoryGlyph(categoryID: category.id, iconKey: category.icon, name: category.name)
                            Text(category.name)
                                .foregroundStyle(.primary)
                        }
                    } else {
                        Text("Keep category")
                    }
                }
            }
            .tint(.primary)
            .fieldError(saves.errors[.category])

            Button {
                choosingTags = true
            } label: {
                LabeledContent("Add tags") {
                    Text(shown.addTags.isEmpty ? "None" : shown.addTags.joined(separator: ", "))
                        .foregroundStyle(shown.addTags.isEmpty ? .secondary : .primary)
                        .lineLimit(1)
                }
            }
            .tint(.primary)
            .fieldError(saves.errors[.tags])

            if hiddenTags.isEmpty && shown.budgetExcludeTagID == nil {
                LabeledContent("Budgets", value: "Included")
            } else {
                Picker("Budgets", selection: Binding(get: { shown.budgetExcludeTagID }, set: { tagID in
                    save(.budgets) { $0.budgetExcludeTagID = tagID }
                })) {
                    Text("Included").tag(Int?.none)
                    ForEach(hiddenTags) { tag in
                        Text("Excluded with \(tag.name)").tag(Optional(tag.id))
                    }
                    // A tag no longer hidden from budgets stays shown while the rule uses it.
                    if let current = rule.budgetExcludeTag, !hiddenTags.contains(where: { $0.id == current.id }) {
                        Text("Excluded with \(current.name)").tag(Optional(current.id))
                    }
                }
                .pickerStyle(.menu)
                .fieldError(saves.errors[.budgets])
            }
        }
        .expensesRowBackground()
    }

    private var matchesSection: some View {
        Section {
            switch matches {
            case nil:
                Text("Loading…")
                    .foregroundStyle(.secondary)
            case .failure(let error):
                FieldError(error.message)
            case .success(let preview) where preview.sample.isEmpty:
                Text("No recent matches")
                    .foregroundStyle(.secondary)
            case .success(let preview):
                ForEach(preview.sample) { match in
                    NavigationLink {
                        TransactionDetailView(transactionID: match.id)
                    } label: {
                        MatchRow(match: match)
                    }
                    .navigationLinkIndicatorVisibility(.hidden)
                }
            }
        } header: {
            HStack {
                Text("Matches")
                Spacer()
                if case .success(let preview) = matches {
                    Text("\(preview.matchesCount) recent")
                }
            }
        }
        .expensesRowBackground()
    }

    // MARK: Saving

    private func shown(_ rule: RuleRow) -> RuleMutationRequest {
        saves.shown(RuleMutationRequest(rule))
    }

    private func save(_ field: Field, _ change: @escaping (inout RuleMutationRequest) -> Void) {
        saves.save(field, stored: { rule.map { RuleMutationRequest($0) } }, commit: { body in
            await model.saveRule(id: ruleID, body: body) ? nil : model.lastError?.message ?? "Unable to save the change."
        }, change)
    }

    // A category of the other type could never apply, so a new type clears it.
    private func changeType(_ next: TransactionKind?, _ shown: RuleMutationRequest) {
        guard next != shown.transactionType else {
            return
        }
        let category = shown.setCategoryID.flatMap { id in model.rules?.categories.first { $0.id == id } }
        let keepsCategory = next == nil || category == nil || category?.type == next?.rawValue
        save(.type) {
            $0.transactionType = next
            if !keepsCategory {
                $0.setCategoryID = nil
            }
        }
    }

    private func changeCategory(_ categoryID: Int?, _ shown: RuleMutationRequest) {
        if categoryID != shown.setCategoryID || saves.errors[.category] != nil {
            save(.category) { $0.setCategoryID = categoryID }
        }
    }

    private func commitName() {
        guard let rule else {
            return
        }
        let name = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            saves.errors[.name] = "Enter a rule name."
            return
        }
        nameDraft = name
        if name != shown(rule).name || saves.errors[.name] != nil {
            save(.name) { $0.name = name }
        }
    }

    private func delete() async {
        if await model.deleteRule(id: ruleID) {
            dismiss()
        } else {
            deleteError = model.lastError?.message ?? "Unable to delete the rule."
        }
    }
}

/// A transaction a rule would match: its title, the category change, and its amount.
private struct MatchRow: View {
    @Environment(\.colorScheme) private var scheme

    let match: RulePreviewSample

    var body: some View {
        TrailingRow {
            VStack(alignment: .leading, spacing: 2) {
                Text(match.title ?? "Untitled")
                if match.beforeCategory != match.afterCategory {
                    HStack(spacing: 4) {
                        Text(match.beforeCategory)
                        Image(systemName: "arrow.right")
                            .accessibilityLabel("to")
                        Text(match.afterCategory)
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
            }
        } trailing: {
            AmountText(match.amountCents, signed: match.type == "income")
                .foregroundStyle(match.type == "income" ? ExpensesTheme.income(for: scheme) : .primary)
        }
        .contentShape(Rectangle())
    }
}
