import CoreLocation
import SwiftUI

struct TransactionFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let mode: TransactionFormMode
    let categories: [CategorySummary]
    var onSaved: () -> Void = {}

    @State private var type: String
    @State private var occurredAt: Date
    @State private var amount: String
    @State private var categoryID: Int?
    @State private var title: String
    @State private var description: String
    @State private var selectedTags: [String]
    @State private var excludedScheduledTags: Set<String> = []
    @State private var isReimbursement: Bool
    @State private var includeCurrentLocation = false
    @State private var storedCoordinate: CLLocationCoordinate2D?
    @State private var coordinate: CLLocationCoordinate2D?
    @State private var formError: String?
    @State private var tagSchedulesLoaded: Bool
    @State private var tagScheduleLoadError: String?
    @State private var saveAttempts = 0
    @State private var lastSaveSucceeded = false
    @State private var locationProvider = LocationProvider()

    init(mode: TransactionFormMode, categories: [CategorySummary], onSaved: @escaping () -> Void = {}) {
        self.mode = mode
        self.categories = categories
        self.onSaved = onSaved

        let seed = mode.seed
        _type = State(initialValue: seed.type)
        _occurredAt = State(initialValue: seed.occurredAt)
        _amount = State(initialValue: seed.amount)
        _categoryID = State(initialValue: seed.categoryID)
        _title = State(initialValue: seed.title)
        _description = State(initialValue: seed.description)
        _selectedTags = State(initialValue: seed.tags)
        _isReimbursement = State(initialValue: seed.isReimbursement)
        _storedCoordinate = State(initialValue: seed.coordinate)
        _coordinate = State(initialValue: seed.coordinate)
        if case .create = mode {
            _tagSchedulesLoaded = State(initialValue: false)
        } else {
            _tagSchedulesLoaded = State(initialValue: true)
        }
        _tagScheduleLoadError = State(initialValue: nil)
    }

    var body: some View {
        NavigationStack {
            Form {
                if case .create = mode, let templates = model.templates?.templates, !templates.isEmpty {
                    Section("Templates") {
                        ForEach(templates) { template in
                            Button {
                                applyTemplate(template)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(template.name)
                                        if let category = template.category {
                                            Text(category.name)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()
                                    if let amount = template.defaultAmountCents {
                                        Text(AppFormatters.euros(amount))
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Section {
                    Picker("Type", selection: $type) {
                        Text("Expense").tag("expense")
                        Text("Income").tag("income")
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: type) { _, nextType in
                        if !filteredCategories(for: nextType).contains(where: { $0.id == categoryID }) {
                            categoryID = nil
                        }
                        if nextType != "income" {
                            isReimbursement = false
                        }
                    }
                    .sensoryFeedback(.selection, trigger: type)

                    DatePicker("Date", selection: $occurredAt)

                    TextField("Amount", text: $amount)
                        .keyboardType(.decimalPad)

                    Picker("Category", selection: $categoryID) {
                        Text("Uncategorized").tag(Int?.none)
                        ForEach(filteredCategories(for: type)) { category in
                            Text(category.name).tag(Optional(category.id))
                        }
                    }
                }

                Section {
                    TextField("Title", text: $title)
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(3...8)
                    NavigationLink {
                        TagSelectionView(
                            available: model.tags?.tags ?? [],
                            selected: resolvedSelectedTags,
                            scheduled: Set(
                                activeScheduledTagNames.map { $0.lowercased() }
                            ),
                            onToggle: toggleTag
                        )
                    } label: {
                        LabeledContent("Tags") {
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(tagsSummary)
                                    .lineLimit(1)
                                if !scheduledSelectedTags.isEmpty {
                                    Text("Scheduled")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                if type == "income" {
                    Section {
                        Toggle("This is a reimbursement", isOn: $isReimbursement)
                            .sensoryFeedback(.selection, trigger: isReimbursement)
                    }
                }

                Section {
                    Toggle("Use current location", isOn: $includeCurrentLocation)
                        .onChange(of: includeCurrentLocation) { _, enabled in
                            if enabled {
                                Task { await loadCurrentLocation() }
                            } else {
                                coordinate = storedCoordinate
                            }
                        }
                        .sensoryFeedback(.selection, trigger: includeCurrentLocation)
                    if let storedCoordinate, !includeCurrentLocation {
                        Label(
                            "Stored location: \(coordinateLabel(storedCoordinate))",
                            systemImage: "location"
                        )
                        .foregroundStyle(.secondary)
                        Button("Remove stored location", role: .destructive) {
                            self.storedCoordinate = nil
                            coordinate = nil
                        }
                    }
                    if includeCurrentLocation {
                        if coordinate != nil {
                            Label("Current location ready", systemImage: "location.fill")
                                .foregroundStyle(.secondary)
                        } else {
                            ProgressView("Resolving location")
                        }
                    }
                }

                if let formError {
                    Section {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }

                if let tagScheduleLoadError {
                    Section {
                        Text(tagScheduleLoadError)
                            .foregroundStyle(.red)
                        Button("Retry") {
                            Task { await loadTagSchedules() }
                        }
                    }
                }
            }
            .navigationTitle(mode.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(model.isLoading || !tagSchedulesLoaded)
                }
            }
            .task {
                await loadTagSchedules()
            }
            .sensoryFeedback(trigger: saveAttempts) { _, _ in
                lastSaveSucceeded ? .success : .error
            }
            .themeAccentTint()
        }
    }

    private var availableCategories: [CategorySummary] {
        model.activeKnownCategories.isEmpty ? categories : model.activeKnownCategories
    }

    private func applyTemplate(_ template: TemplateRow) {
        type = template.type
        categoryID = template.categoryID
        if let amount = template.defaultAmountCents {
            self.amount = String(format: "%.2f", Double(amount) / 100.0)
        } else {
            self.amount = ""
        }
        title = template.title ?? ""
        description = ""
        selectedTags = template.tags
        isReimbursement = false
    }

    private var tagsSummary: String {
        resolvedSelectedTags.isEmpty
            ? "None"
            : resolvedSelectedTags.joined(separator: ", ")
    }

    private var activeScheduledTagNames: [String] {
        guard case .create = mode else {
            return []
        }
        let transactionDate = TransactionFormDateFormatter.dateOnly(occurredAt)
        return (model.tags?.tags ?? []).compactMap { tag in
            guard let period = tag.autoAttachPeriod,
                  period.start <= transactionDate,
                  period.end >= transactionDate
            else {
                return nil
            }
            return tag.name
        }
    }

    private var resolvedSelectedTags: [String] {
        var resolved = selectedTags.filter {
            !excludedScheduledTags.contains($0.lowercased())
        }
        var seen = Set(resolved.map { $0.lowercased() })
        for name in activeScheduledTagNames {
            let normalized = name.lowercased()
            if !excludedScheduledTags.contains(normalized) && seen.insert(normalized).inserted {
                resolved.append(name)
            }
        }
        return resolved
    }

    private var scheduledSelectedTags: [String] {
        let selected = Set(resolvedSelectedTags.map { $0.lowercased() })
        return activeScheduledTagNames.filter { selected.contains($0.lowercased()) }
    }

    private func toggleTag(_ name: String) {
        let normalized = name.lowercased()
        let isSelected = resolvedSelectedTags.contains {
            $0.lowercased() == normalized
        }
        if isSelected {
            selectedTags.removeAll { $0.lowercased() == normalized }
            if activeScheduledTagNames.contains(where: {
                $0.lowercased() == normalized
            }) {
                excludedScheduledTags.insert(normalized)
            }
            return
        }

        if !selectedTags.contains(where: { $0.lowercased() == normalized }) {
            selectedTags.append(name)
        }
        excludedScheduledTags.remove(normalized)
    }

    private func save() async {
        formError = nil
        guard tagSchedulesLoaded else {
            formError = "Tags must load before this transaction can be saved."
            return
        }
        guard let payload = makePayload() else {
            return
        }

        let saved: Bool
        switch mode {
        case .create:
            saved = await model.createTransaction(payload)
        case .edit(let transaction):
            saved = await model.updateTransaction(id: transaction.id, body: payload)
        }

        if saved {
            lastSaveSucceeded = true
            saveAttempts += 1
            onSaved()
            dismiss()
        } else {
            lastSaveSucceeded = false
            saveAttempts += 1
            formError = model.lastError?.message ?? "Transaction could not be saved."
        }
    }

    private func makePayload() -> TransactionMutationRequest? {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            formError = "Title is required."
            return nil
        }
        guard let amountCents = parseAmount(amount) else {
            formError = "Amount is invalid."
            return nil
        }
        if includeCurrentLocation && coordinate == nil {
            formError = "Location is still unavailable."
            return nil
        }

        let trimmedDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
        return TransactionMutationRequest(
            date: TransactionFormDateFormatter.dateOnly(occurredAt),
            occurredAt: TransactionFormDateFormatter.dateTime(occurredAt),
            type: type,
            isReimbursement: type == "income" && isReimbursement,
            amountCents: amountCents,
            categoryID: categoryID,
            title: trimmedTitle,
            description: trimmedDescription.isEmpty ? nil : trimmedDescription,
            latitude: coordinate?.latitude,
            longitude: coordinate?.longitude,
            tags: resolvedSelectedTags
        )
    }

    private func loadCurrentLocation() async {
        formError = nil
        do {
            coordinate = try await locationProvider.currentCoordinate()
        } catch {
            includeCurrentLocation = false
            coordinate = storedCoordinate
            formError = error.localizedDescription
        }
    }

    private func loadTagSchedules() async {
        let loaded = await model.loadOrganizeData()
        guard case .create = mode else {
            return
        }
        tagSchedulesLoaded = loaded
        tagScheduleLoadError = loaded
            ? nil
            : model.lastError?.message ?? "Tags could not be loaded."
    }

    private func coordinateLabel(_ coordinate: CLLocationCoordinate2D) -> String {
        String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude)
    }

    private func filteredCategories(for selectedType: String) -> [CategorySummary] {
        availableCategories.filter { $0.type == selectedType }
    }

    private func parseAmount(_ raw: String) -> Int? {
        let normalized = raw.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: ".")
        guard let value = Double(normalized), value >= 0, value.isFinite else {
            return nil
        }
        return Int((value * 100).rounded())
    }
}

private struct TagSelectionView: View {
    let available: [TagRow]
    let selected: [String]
    let scheduled: Set<String>
    let onToggle: (String) -> Void
    @State private var search = ""

    private var allNames: [String] {
        // Newest tags first so a freshly created one-off (e.g. a trip) is at the
        // top. Any already-attached tag no longer in the active list (e.g.
        // archived) is kept so editing never silently drops it.
        let sorted = available.sorted { $0.id > $1.id }.map(\.name)
        let availableLower = Set(sorted.map { $0.lowercased() })
        var names = selected.filter { !availableLower.contains($0.lowercased()) }
        names.append(contentsOf: sorted)
        return names
    }

    private var displayNames: [String] {
        let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else {
            return allNames
        }
        return allNames.filter { $0.lowercased().contains(trimmed) }
    }

    var body: some View {
        List {
            if allNames.isEmpty {
                ContentUnavailableView(
                    "No Tags",
                    systemImage: "tag",
                    description: Text("Create tags in Organize to assign them here.")
                )
            } else {
                ForEach(displayNames, id: \.self) { name in
                    Button {
                        onToggle(name)
                    } label: {
                        HStack {
                            Text(name)
                                .foregroundStyle(.primary)
                            Spacer()
                            if scheduled.contains(name.lowercased()) {
                                Text("Auto")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                            if isSelected(name) {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.tint)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .searchable(
            text: $search,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search tags"
        )
        .navigationTitle("Tags")
        .navigationBarTitleDisplayMode(.inline)
        .themeAccentTint()
    }

    private func isSelected(_ name: String) -> Bool {
        selected.contains { $0.lowercased() == name.lowercased() }
    }

}

enum TransactionFormMode {
    case create
    case edit(TransactionDetail)

    var title: String {
        switch self {
        case .create:
            "Add Transaction"
        case .edit:
            "Edit Transaction"
        }
    }

    var seed: TransactionFormSeed {
        switch self {
        case .create:
            let now = Date()
            return TransactionFormSeed(
                type: "expense",
                occurredAt: now,
                amount: "",
                categoryID: nil,
                title: "",
                description: "",
                tags: [],
                isReimbursement: false,
                coordinate: nil
            )
        case .edit(let transaction):
            let coordinate: CLLocationCoordinate2D?
            if let latitude = transaction.latitude, let longitude = transaction.longitude {
                coordinate = CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
            } else {
                coordinate = nil
            }
            return TransactionFormSeed(
                type: transaction.type,
                occurredAt: transaction.occurredAt ?? transaction.date,
                amount: String(format: "%.2f", Double(transaction.amountCents) / 100.0),
                categoryID: transaction.categoryID,
                title: transaction.title,
                description: transaction.description ?? "",
                tags: transaction.tags,
                isReimbursement: transaction.isReimbursement,
                coordinate: coordinate
            )
        }
    }
}

struct TransactionFormSeed {
    let type: String
    let occurredAt: Date
    let amount: String
    let categoryID: Int?
    let title: String
    let description: String
    let tags: [String]
    let isReimbursement: Bool
    let coordinate: CLLocationCoordinate2D?
}

enum TransactionFormDateFormatter {
    private static let dateOnlyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let dateTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return formatter
    }()

    static func dateOnly(_ date: Date) -> String {
        dateOnlyFormatter.string(from: date)
    }

    static func dateTime(_ date: Date) -> String {
        dateTimeFormatter.string(from: date)
    }
}
