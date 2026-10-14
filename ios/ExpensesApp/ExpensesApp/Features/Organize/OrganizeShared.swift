import SwiftUI

/// "1 use", "12 uses".
func usesText(_ count: Int) -> String {
    count == 1 ? "1 use" : "\(count) uses"
}

/// A key a list sorts by, with a phrase for each direction.
protocol ListSortKey: Hashable, CaseIterable, Identifiable where AllCases == [Self] {
    var title: String { get }
    var ascendingTitle: String { get }
    var descendingTitle: String { get }
    var startsAscending: Bool { get }
}

struct ListSort<Key: ListSortKey>: Equatable {
    var key: Key
    var ascending: Bool
}

/// The sort key and direction, as a toolbar menu. A new key starts in its usual direction.
struct SortMenu<Key: ListSortKey>: View {
    @Binding var sort: ListSort<Key>

    var body: some View {
        Menu {
            Picker("Sort by", selection: Binding(get: { sort.key }, set: { sort = ListSort(key: $0, ascending: $0.startsAscending) })) {
                ForEach(Key.allCases) { key in
                    Text(key.title).tag(key)
                }
            }
            Picker("Order", selection: $sort.ascending) {
                Text(sort.key.ascendingTitle).tag(true)
                Text(sort.key.descendingTitle).tag(false)
            }
        } label: {
            Label("Sort", systemImage: "arrow.up.arrow.down")
        }
        .sensoryFeedback(.selection, trigger: sort)
    }
}

/// One value typed in a popover. `onSave` returns why the value was not accepted, or
/// nil to close.
struct ValuePopover: View {
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    @State private var error: String?

    let title: String
    @State var text: String
    var keyboard = UIKeyboardType.default
    let confirm: String
    let onSave: (String) -> String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            TextField(title, text: $text)
                .font(.title3)
                .keyboardType(keyboard)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit(save)
                .onChange(of: text) {
                    error = nil
                }
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
        error = onSave(text)
        if error == nil {
            dismiss()
        }
    }
}

/// Category icons in a grid; search reaches every icon the app can draw.
struct IconPickerSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var search = ""

    let selected: String?
    let onPick: (String) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: 8)], spacing: 8) {
                    ForEach(matches) { option in
                        Button {
                            onPick(option.key)
                            dismiss()
                        } label: {
                            VStack(spacing: 6) {
                                Image(systemName: option.symbolName)
                                    .font(.title3)
                                    .frame(height: 28)
                                Text(option.label)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, minHeight: 72)
                            .background(option.key == selected ? Color.primary.opacity(0.08) : .clear, in: .rect(cornerRadius: 12))
                            .contentShape(.rect(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(option.label)
                        .accessibilityAddTraits(option.key == selected ? .isSelected : [])
                    }
                }
                .padding()
            }
            .overlay {
                if matches.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Icon")
            .navigationBarTitleDisplayMode(.inline)
            .background(ExpensesTheme.surface(for: scheme))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                }
            }
        }
    }

    private var matches: [CategoryIconOption] {
        guard !search.isEmpty else {
            return categoryIconOptions
        }
        return allCategoryIconOptions.filter { $0.label.localizedCaseInsensitiveContains(search) }
    }
}

/// A category or tag another one can merge into.
struct MergeTarget: Identifiable {
    let id: Int
    let name: String
    var systemImage: String?
}

/// Merges a category or tag into another: choose the target, see what moves, then merge.
struct MergeSheet: View {
    @Environment(\.dismiss) private var dismiss

    let sourceName: String
    // "category" or "tag".
    let noun: String
    let targets: [MergeTarget]
    let preview: (Int) async -> Result<MergeResponse, APIErrorInfo>
    let countRows: ([String: Int]) -> [(label: String, value: String)]
    // Returns why the merge failed, or nil once it is done.
    let merge: (Int) async -> String?
    let onMerged: () -> Void

    @State private var targetID: Int?
    @State private var counts: Result<MergeResponse, APIErrorInfo>?
    @State private var merging = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Into", selection: $targetID) {
                        Text("Choose a \(noun)").tag(Int?.none)
                        ForEach(targets) { target in
                            if let systemImage = target.systemImage {
                                Label(target.name, systemImage: systemImage).tag(Optional(target.id))
                            } else {
                                Text(target.name).tag(Optional(target.id))
                            }
                        }
                    }
                    .pickerStyle(.menu)
                }
                .expensesRowBackground()

                if targetID != nil {
                    Section {
                        switch counts {
                        case nil:
                            Text("Loading…")
                                .foregroundStyle(.secondary)
                        case .failure(let failure):
                            FieldError(failure.message)
                        case .success(let response):
                            ForEach(countRows(response.counts), id: \.label) { row in
                                LabeledContent(row.label, value: row.value)
                            }
                        }
                    } footer: {
                        Text("\(sourceName) is archived after the merge.")
                    }
                    .expensesRowBackground()
                }

                if let error {
                    FieldError(error)
                        .listRowBackground(Color.clear)
                }
            }
            .navigationTitle("Merge \(sourceName)")
            .navigationBarTitleDisplayMode(.inline)
            .expensesScreenStyle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) {
                        dismiss()
                    }
                    .disabled(merging)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Merge", role: .confirm) {
                        Task { await submit() }
                    }
                    .disabled(merging)
                }
            }
            .task(id: targetID) {
                counts = nil
                error = nil
                guard let targetID else {
                    return
                }
                let result = await preview(targetID)
                if !Task.isCancelled {
                    counts = result
                }
            }
        }
        .interactiveDismissDisabled(merging)
    }

    private func submit() async {
        guard let targetID else {
            error = "Choose a \(noun) to merge into."
            return
        }
        merging = true
        defer { merging = false }
        error = await merge(targetID)
        if error == nil {
            dismiss()
            onMerged()
        }
    }
}
