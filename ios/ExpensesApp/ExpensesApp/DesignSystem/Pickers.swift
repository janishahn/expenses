import SwiftUI

/// A list row that picks or ticks a value, with a checkmark while it is selected. The
/// checkmark keeps its space, so the label does not move when it changes.
struct SelectableRow<Label: View>: View {
    let isSelected: Bool
    let action: () -> Void
    @ViewBuilder let label: Label

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                label
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "checkmark")
                    .fontWeight(.semibold)
                    .foregroundStyle(.tint)
                    .opacity(isSelected ? 1 : 0)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .tint(.primary)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Categories grouped by type, with search. Choosing one dismisses the sheet.
/// With `onSelectNone`, a first row stands for no category: Uncategorized, or
/// `noneTitle` such as Keep category.
struct CategoryPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var search = ""

    let title: String
    let categories: [CategorySummary]
    var selectedID: Int?
    var noneTitle = "Uncategorized"
    var noneSymbol = "questionmark"
    var onSelectNone: (() -> Void)?
    let onSelect: (CategorySummary) -> Void

    var body: some View {
        NavigationStack {
            List {
                if let onSelectNone, search.isEmpty {
                    Section {
                        SelectableRow(isSelected: selectsNone) {
                            onSelectNone()
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: noneSymbol)
                                    .font(.callout)
                                    .foregroundStyle(ExpensesTheme.category(nil, for: scheme))
                                    .glyphColumn()
                                    .accessibilityHidden(true)
                                Text(noneTitle)
                            }
                        }
                    }
                    .expensesRowBackground()
                }
                ForEach(groups, id: \.title) { group in
                    Section(group.title) {
                        ForEach(group.categories) { category in
                            SelectableRow(isSelected: category.id == selectedID) {
                                onSelect(category)
                                dismiss()
                            } label: {
                                HStack(spacing: 12) {
                                    CategoryGlyph(categoryID: category.id, iconKey: category.icon, name: category.name)
                                    Text(category.name)
                                }
                            }
                        }
                    }
                    .expensesRowBackground()
                }
            }
            .overlay {
                if groups.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .expensesScreenStyle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                }
            }
        }
    }

    // The server files a transaction without a category under its Uncategorized one.
    private var selectsNone: Bool {
        selectedID == nil || categories.contains { $0.id == selectedID && Self.isUncategorized($0) }
    }

    private static func isUncategorized(_ category: CategorySummary) -> Bool {
        category.name.lowercased() == "uncategorized"
    }

    private var groups: [(title: String, categories: [CategorySummary])] {
        let listed = onSelectNone == nil ? categories : categories.filter { !Self.isUncategorized($0) }
        let matches = listed.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }
        return [
            ("Expense", matches.filter { $0.type != "income" }),
            ("Income", matches.filter { $0.type == "income" }),
        ]
        .filter { !$0.categories.isEmpty }
    }
}

/// Tag names to choose from, with search. Applies the chosen names on Done.
struct TagPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var selected: [String]

    let title: String
    let options: [String]
    let onApply: ([String]) -> Void

    init(title: String, options: [String], selected: [String] = [], onApply: @escaping ([String]) -> Void) {
        self.title = title
        // A chosen tag missing from the options, such as an archived one, stays listed.
        self.options = selected.filter { name in !options.contains { $0.caseInsensitiveCompare(name) == .orderedSame } } + options
        self.onApply = onApply
        _selected = State(initialValue: selected)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(matches, id: \.self) { name in
                        SelectableRow(isSelected: selected.contains(name)) {
                            if let index = selected.firstIndex(of: name) {
                                selected.remove(at: index)
                            } else {
                                selected.append(name)
                            }
                        } label: {
                            Text(name)
                        }
                    }
                }
                .expensesRowBackground()
            }
            .overlay {
                if options.isEmpty {
                    ContentUnavailableView("No tags", systemImage: "tag")
                } else if matches.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .expensesScreenStyle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", role: .confirm) {
                        onApply(selected)
                        dismiss()
                    }
                }
            }
        }
    }

    private var matches: [String] {
        options.filter { search.isEmpty || $0.localizedCaseInsensitiveContains(search) }
    }
}

/// Tags to include or exclude. The server takes one mode at a time.
struct TagFilterSection: View {
    @Binding var mode: TagFilterMode
    @Binding var ids: Set<Int>
    let tags: [TransactionTag]

    var body: some View {
        Section("Tags") {
            Picker("Tag filter", selection: $mode) {
                Text("Only include").tag(TagFilterMode.include)
                Text("Exclude").tag(TagFilterMode.exclude)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            if tags.isEmpty {
                Text("No tags")
                    .foregroundStyle(.secondary)
            }
            ForEach(tags) { tag in
                SelectableRow(isSelected: ids.contains(tag.id)) {
                    ids.formSymmetricDifference([tag.id])
                } label: {
                    Text(tag.name)
                }
            }
        }
        .expensesRowBackground()
    }
}
