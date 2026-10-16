import SwiftUI

extension MatchType {
    /// "contains", "starts with", "equals", "matches".
    var phrase: String {
        switch self {
        case .contains:
            "contains"
        case .startsWith:
            "starts with"
        case .equals:
            "equals"
        case .regex:
            "matches"
        }
    }
}

/// "contains “edeka”".
func titleCondition(_ matchType: MatchType, _ value: String) -> String {
    "\(matchType.phrase) “\(value)”"
}

/// A rule's amount bounds: "at least 5,00 €", "5,00 € – 30,00 €", "at most 30,00 €", or Any.
struct AmountCondition: View {
    let min: Int?
    let max: Int?

    var body: some View {
        HStack(spacing: 4) {
            if let min, let max {
                AmountText(min)
                Text("–")
                AmountText(max)
            } else if let min {
                Text("at least")
                AmountText(min)
            } else if let max {
                Text("at most")
                AmountText(max)
            } else {
                Text("Any")
            }
        }
    }
}

/// How a rule matches the title, and the text it looks for.
struct TitlePopover: View {
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    @State private var error: String?

    @State var matchType: MatchType
    @State var value: String
    let confirm: String
    let onDone: (MatchType, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Picker("Match", selection: $matchType) {
                ForEach(MatchType.allCases) { type in
                    Text(type.title).tag(type)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            TextField("Title text", text: $value)
                .font(.title3)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit(save)
                .fieldError(error)
            HStack {
                Spacer()
                Button(confirm, action: save)
                    .fontWeight(.semibold)
            }
        }
        .padding()
        .frame(width: 340)
        .presentationCompactAdaptation(.popover)
        .onAppear {
            focused = true
        }
    }

    private func save() {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            error = "Enter a match value."
            return
        }
        onDone(matchType, trimmed)
        dismiss()
    }
}

/// The amounts a rule applies between. An empty field leaves that side open.
struct AmountRangePopover: View {
    @Environment(\.dismiss) private var dismiss
    @State private var minText: String
    @State private var maxText: String
    @State private var error: String?

    let confirm: String
    let onDone: (Int?, Int?) -> Void

    init(min: Int?, max: Int?, confirm: String, onDone: @escaping (Int?, Int?) -> Void) {
        _minText = State(initialValue: min.map(AppFormatters.amountInput) ?? "")
        _maxText = State(initialValue: max.map(AppFormatters.amountInput) ?? "")
        self.confirm = confirm
        self.onDone = onDone
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            LabeledContent("At least") {
                TextField("Any", text: $minText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent("At most") {
                TextField("Any", text: $maxText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
            }
            if let error {
                FieldError(error)
            }
            HStack {
                Spacer()
                Button(confirm, action: save)
                    .fontWeight(.semibold)
            }
        }
        .padding()
        .frame(width: 340)
        .presentationCompactAdaptation(.popover)
    }

    private func save() {
        let min = DefaultAmount(minText)
        let max = DefaultAmount(maxText)
        if min == .invalid {
            error = "Invalid min amount."
        } else if max == .invalid {
            error = "Invalid max amount."
        } else {
            onDone(min.cents, max.cents)
            dismiss()
        }
    }
}

/// A rule priority from 0 to 10000, or why the text is not one.
func parsePriority(_ raw: String) -> Result<Int, PriorityError> {
    guard let value = Int(raw.trimmingCharacters(in: .whitespaces)), (0...10_000).contains(value) else {
        return .failure(PriorityError())
    }
    return .success(value)
}

struct PriorityError: Error {
    let message = "Enter a priority from 0 to 10000."
}

/// Rules set a category or tags on new and imported transactions, in priority order.
struct RulesView: View {
    @Environment(AppModel.self) private var model
    @State private var adding = false
    @State private var loadFailed = false
    @State private var pendingSuggestion: Int?
    @State private var noSuggestionsFound = false
    @State private var actionError: String?

    var body: some View {
        List {
            if let rules = model.rules {
                let suggestions = model.aiFeatures.contains("rule_mining") ? model.ruleSuggestions : []
                if rules.rules.isEmpty && suggestions.isEmpty {
                    ContentUnavailableView {
                        Label("No rules yet", systemImage: "wand.and.stars")
                    } actions: {
                        Button("Add rule") {
                            adding = true
                        }
                    }
                    .listRowBackground(Color.clear)
                } else {
                    if !suggestions.isEmpty {
                        suggestionsSection(suggestions, categories: rules.categories)
                    }
                    if !rules.rules.isEmpty {
                        Section {
                            ForEach(rules.rules) { rule in
                                NavigationLink {
                                    RuleDetailView(ruleID: rule.id)
                                } label: {
                                    RuleListRow(rule: rule)
                                }
                                .navigationLinkIndicatorVisibility(.hidden)
                            }
                        } header: {
                            if !suggestions.isEmpty {
                                Text("Rules")
                            }
                        }
                        .expensesRowBackground()
                    }
                }
            } else if loadFailed {
                UnavailableStateSection(title: "Couldn't load rules", systemImage: "exclamationmark.triangle", message: model.lastError?.message) {
                    loadFailed = !(await model.loadRules())
                }
            } else {
                LoadingStateSection(title: "Loading rules")
            }
        }
        .refreshable {
            loadFailed = !(await model.loadRules())
        }
        .navigationTitle("Rules")
        .expensesScreenStyle()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Add rule", systemImage: "plus") {
                    adding = true
                }
                .disabled(model.rules == nil)
                if model.aiFeatures.contains("rule_mining") {
                    Menu {
                        Button(model.isMiningRuleSuggestions ? "Finding Rule Suggestions…" : "Find Rule Suggestions", systemImage: "lightbulb") {
                            Task { await mine() }
                        }
                        .disabled(model.isMiningRuleSuggestions)
                    } label: {
                        Label("More", systemImage: "ellipsis")
                    }
                }
            }
        }
        .sheet(isPresented: $adding) {
            if let rules = model.rules {
                AddRuleSheet(rules: rules)
            }
        }
        .alert("No rule suggestions found", isPresented: $noSuggestionsFound) {
            Button("OK", role: .cancel) {}
        }
        .failureAlert("Couldn't update the suggestions", message: $actionError)
        .task {
            loadFailed = !(await model.loadRules())
        }
    }

    private func suggestionsSection(_ suggestions: [RuleSuggestion], categories: [CategorySummary]) -> some View {
        Section("Suggestions") {
            ForEach(suggestions) { suggestion in
                let category = categories.first {
                    $0.name == suggestion.setCategoryName && (suggestion.transactionType == nil || $0.type == suggestion.transactionType?.rawValue)
                }
                HStack(spacing: 12) {
                    Image(systemName: "lightbulb")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .glyphColumn()
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Title \(titleCondition(suggestion.matchType, suggestion.matchValue))")
                            .lineLimit(1)
                        HStack(spacing: 4) {
                            if let category {
                                RuleCategoryLabel(category: category)
                            } else {
                                Text(suggestion.setCategoryName ?? "Keep category")
                            }
                            Text("·")
                            Text(suggestion.confidence.formatted(.percent.precision(.fractionLength(0))))
                                .monospacedDigit()
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    Button {
                        Task { await decide(suggestion, accept: true) }
                    } label: {
                        Image(systemName: "checkmark")
                            .frame(width: 32, height: 32)
                            .expandedTouchArea(6)
                    }
                    .accessibilityLabel("Accept \(suggestion.name)")
                    Button {
                        Task { await decide(suggestion, accept: false) }
                    } label: {
                        Image(systemName: "xmark")
                            .frame(width: 32, height: 32)
                            .expandedTouchArea(6)
                    }
                    .accessibilityLabel("Reject \(suggestion.name)")
                }
                .buttonStyle(.borderless)
                .disabled(pendingSuggestion != nil)
            }
        }
        .expensesRowBackground()
    }

    private func mine() async {
        if await model.mineRuleSuggestions() {
            noSuggestionsFound = model.ruleSuggestions.isEmpty
        } else {
            actionError = model.lastError?.message ?? "Unable to find rule suggestions."
        }
    }

    private func decide(_ suggestion: RuleSuggestion, accept: Bool) async {
        pendingSuggestion = suggestion.id
        defer { pendingSuggestion = nil }
        let done = accept ? await model.acceptRuleSuggestion(suggestion) : await model.rejectRuleSuggestion(suggestion)
        if !done {
            actionError = model.lastError?.message ?? "Unable to \(accept ? "accept" : "reject") the suggestion."
        }
    }
}

/// A category's glyph and name, inline in a line of text.
struct RuleCategoryLabel: View {
    @Environment(\.colorScheme) private var scheme

    let category: CategorySummary

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: categorySymbolName(for: resolvedCategoryIconKey(category.icon, name: category.name)))
                .foregroundStyle(ExpensesTheme.category(category.id, for: scheme))
                .accessibilityHidden(true)
            Text(category.name)
        }
    }
}

/// A rule in the list: its priority, name, what it sets, and whether it is off.
private struct RuleListRow: View {
    let rule: RuleRow

    var body: some View {
        let tags = rule.addTags + (rule.budgetExcludeTag.map { [$0.name] } ?? [])
        HStack(spacing: 12) {
            Text("\(rule.priority)")
                .font(.subheadline)
                .monospacedDigit()
                .foregroundStyle(.tertiary)
                .frame(minWidth: 32, alignment: .trailing)
            VStack(alignment: .leading, spacing: 2) {
                Text(rule.name)
                    .lineLimit(1)
                    .foregroundStyle(rule.enabled ? .primary : .secondary)
                HStack(spacing: 4) {
                    if let category = rule.setCategory {
                        RuleCategoryLabel(category: category)
                    } else {
                        Text("Keep category")
                    }
                    if !tags.isEmpty {
                        Text("+ \(tags.joined(separator: ", "))")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 8)
            if !rule.enabled {
                Text("Off")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .contentShape(Rectangle())
    }
}

/// Adds a rule: what it applies to, its name and the title it looks for, chips for its
/// conditions and actions, and how many recent transactions it would match.
private struct AddRuleSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let rules: RulesResponse

    @State private var draft = RuleMutationRequest(
        name: "",
        enabled: true,
        priority: 100,
        matchType: .contains,
        matchValue: "",
        transactionType: nil,
        minAmountCents: nil,
        maxAmountCents: nil,
        setCategoryID: nil,
        addTags: [],
        budgetExcludeTagID: nil
    )
    @State private var choosingAmount = false
    @State private var choosingCategory = false
    @State private var choosingTags = false
    @State private var choosingPriority = false
    @State private var preview: Result<RulePreview, APIErrorInfo>?
    @State private var nameError: String?
    @State private var valueError: String?
    @State private var formError: String?
    @State private var saving = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    TextField("Name", text: $draft.name)
                        .font(.title3)
                        .focused($nameFocused)
                        .fieldError(nameError)

                    TextField("Title \(draft.matchType.phrase)…", text: $draft.matchValue)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .fieldError(valueError)

                    ChipFlow {
                        Menu {
                            Picker("Match", selection: $draft.matchType) {
                                ForEach(MatchType.allCases) { type in
                                    Text(type.title).tag(type)
                                }
                            }
                        } label: {
                            EntryChip(draft.matchType.title, systemImage: "textformat", isSet: true)
                        }
                        .accessibilityLabel("Match")
                        .accessibilityValue(draft.matchType.title)

                        Button {
                            choosingAmount = true
                        } label: {
                            if draft.minAmountCents == nil && draft.maxAmountCents == nil {
                                EntryChip("Any amount", systemImage: "eurosign", isSet: false)
                            } else {
                                EntryChip(isSet: true) {
                                    Image(systemName: "eurosign")
                                } title: {
                                    AmountCondition(min: draft.minAmountCents, max: draft.maxAmountCents)
                                }
                            }
                        }
                        .popover(isPresented: $choosingAmount) {
                            AmountRangePopover(min: draft.minAmountCents, max: draft.maxAmountCents, confirm: "Done") { min, max in
                                draft.minAmountCents = min
                                draft.maxAmountCents = max
                            }
                        }

                        Button {
                            choosingCategory = true
                        } label: {
                            if let category {
                                EntryChip(category.name, isSet: true) {
                                    CategoryGlyph(categoryID: category.id, iconKey: category.icon, name: category.name)
                                        .glyphColumn(18)
                                }
                            } else {
                                EntryChip("Keep category", systemImage: "square.on.circle", isSet: false)
                            }
                        }
                        .accessibilityLabel("Category")
                        .accessibilityValue(category?.name ?? "Keep category")

                        Button {
                            choosingTags = true
                        } label: {
                            EntryChip(draft.addTags.isEmpty ? "Tags" : draft.addTags.joined(separator: ", "), systemImage: "tag", isSet: !draft.addTags.isEmpty)
                        }
                        .accessibilityLabel("Tags")
                        .accessibilityValue(draft.addTags.joined(separator: ", "))

                        if !hiddenTags.isEmpty {
                            Menu {
                                Picker("Budgets", selection: $draft.budgetExcludeTagID) {
                                    Text("Included").tag(Int?.none)
                                    ForEach(hiddenTags) { tag in
                                        Text("Excluded with \(tag.name)").tag(Optional(tag.id))
                                    }
                                }
                            } label: {
                                EntryChip(excludeTag.map { "Excluded with \($0.name)" } ?? "In budgets", systemImage: "wallet.bifold", isSet: excludeTag != nil)
                            }
                        }

                        Button {
                            choosingPriority = true
                        } label: {
                            EntryChip("Priority \(draft.priority)", systemImage: "list.number", isSet: draft.priority != 100)
                        }
                        .popover(isPresented: $choosingPriority) {
                            ValuePopover(title: "Priority", text: String(draft.priority), keyboard: .numberPad, confirm: "Done") { raw in
                                switch parsePriority(raw) {
                                case .success(let priority):
                                    draft.priority = priority
                                    return nil
                                case .failure(let error):
                                    return error.message
                                }
                            }
                        }

                        Button {
                            draft.enabled.toggle()
                        } label: {
                            EntryChip("Enabled", systemImage: "checkmark", isSet: draft.enabled)
                        }
                        .accessibilityAddTraits(draft.enabled ? .isSelected : [])
                    }
                    .buttonStyle(.plain)

                    if let previewText {
                        Text(previewText)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    if let formError {
                        FieldError(formError)
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(ExpensesTheme.surface(for: scheme))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    DiscardButton(hasChanges: hasInput)
                }
                ToolbarItem(placement: .principal) {
                    Picker("Applies to", selection: appliesTo) {
                        Text("Any").tag(TransactionKind?.none)
                        Text("Expenses").tag(Optional(TransactionKind.expense))
                        Text("Income").tag(Optional(TransactionKind.income))
                    }
                    .pickerStyle(.segmented)
                    .fixedSize()
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", role: .confirm) {
                        Task { await submit() }
                    }
                    .disabled(saving)
                }
            }
            .sheet(isPresented: $choosingCategory) {
                CategoryPickerSheet(
                    title: "Category",
                    categories: offered,
                    selectedID: draft.setCategoryID,
                    noneTitle: "Keep category",
                    noneSymbol: "minus",
                    onSelectNone: { draft.setCategoryID = nil }
                ) { category in
                    draft.setCategoryID = category.id
                }
            }
            .sheet(isPresented: $choosingTags) {
                TagPickerSheet(title: "Add Tags", options: tagOptions, selected: draft.addTags) { draft.addTags = $0 }
            }
        }
        .interactiveDismissDisabled(hasInput || saving)
        .task {
            nameFocused = true
        }
        // The preview follows the match text after a pause in typing.
        .task(id: previewBody) {
            guard let request = previewBody else {
                preview = nil
                return
            }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else {
                return
            }
            let result = await model.chart { try await $0.previewRule(request, token: $1) }
            if !Task.isCancelled {
                preview = result
            }
        }
    }

    // The match type, priority and other settings are defaults, so they alone are no input to lose.
    private var hasInput: Bool {
        !draft.name.isEmpty || !draft.matchValue.isEmpty || draft.minAmountCents != nil || draft.maxAmountCents != nil
            || draft.setCategoryID != nil || !draft.addTags.isEmpty
    }

    // A category of the other type could never apply, so a new type clears it.
    private var appliesTo: Binding<TransactionKind?> {
        Binding(
            get: { draft.transactionType },
            set: { next in
                draft.transactionType = next
                if let next, let category, category.type != next.rawValue {
                    draft.setCategoryID = nil
                }
            }
        )
    }

    private var offered: [CategorySummary] {
        rules.categories.filter { category in draft.transactionType.map { category.type == $0.rawValue } ?? true }
    }

    private var category: CategorySummary? {
        rules.categories.first { $0.id == draft.setCategoryID }
    }

    private var tagOptions: [String] {
        rules.tags.filter { !$0.isHiddenFromBudget }.map(\.name)
    }

    private var hiddenTags: [RuleTag] {
        rules.tags.filter(\.isHiddenFromBudget)
    }

    private var excludeTag: RuleTag? {
        hiddenTags.first { $0.id == draft.budgetExcludeTagID }
    }

    private var previewBody: RuleMutationRequest? {
        let value = draft.matchValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            return nil
        }
        var request = draft
        request.matchValue = value
        let name = request.name.trimmingCharacters(in: .whitespacesAndNewlines)
        request.name = name.isEmpty ? value : name
        return request
    }

    private var previewText: String? {
        switch preview {
        case nil:
            nil
        case .failure(let error):
            error.message
        case .success(let preview):
            preview.matchesCount == 0
                ? "No recent matches"
                : "Matches \(preview.matchesCount) recent \(preview.matchesCount == 1 ? "transaction" : "transactions")"
        }
    }

    private func submit() async {
        var request = draft
        request.name = request.name.trimmingCharacters(in: .whitespacesAndNewlines)
        request.matchValue = request.matchValue.trimmingCharacters(in: .whitespacesAndNewlines)
        nameError = request.name.isEmpty ? "Enter a rule name." : nil
        valueError = request.matchValue.isEmpty ? "Enter a match value." : nil
        formError = nil
        guard nameError == nil, valueError == nil else {
            return
        }
        saving = true
        defer { saving = false }
        if await model.saveRule(id: nil, body: request) {
            dismiss()
        } else {
            formError = model.lastError?.message ?? "Unable to create rule."
        }
    }
}
