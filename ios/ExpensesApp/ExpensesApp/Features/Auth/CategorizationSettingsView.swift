import SwiftUI

/// Automatic categorization. Both settings save as soon as they change; a failed save
/// keeps the entered value next to the error.
struct CategorizationSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    @State private var enteredEnabled: Bool?
    @State private var enteredThreshold: Double?
    @State private var saving = false
    @State private var error: String?
    @State private var choosingThreshold = false
    @State private var loadError: String?

    var body: some View {
        List {
            if let settings = model.settings?.autoCategorization {
                let threshold = enteredThreshold ?? settings.threshold
                Section {
                    Toggle("Categorize new expenses", isOn: Binding(
                        get: { enteredEnabled ?? settings.enabled },
                        set: { enabled in
                            enteredEnabled = enabled
                            Task { await save(settings) }
                        }
                    ))

                    if settings.enabled {
                        status(settings)
                    }

                    Button {
                        choosingThreshold = true
                    } label: {
                        LabeledContent("Minimum confidence") {
                            Text(threshold.formatted(.percent.precision(.fractionLength(0...2))))
                                .monospacedDigit()
                                .foregroundStyle(.primary)
                        }
                    }
                    .tint(.primary)
                    .popover(isPresented: $choosingThreshold) {
                        ValuePopover(
                            title: "Minimum confidence",
                            text: (threshold * 100).formatted(.number.precision(.fractionLength(0...2)).grouping(.never)),
                            keyboard: .numberPad,
                            confirm: "Save"
                        ) { raw in
                            guard let percent = Int(raw.trimmingCharacters(in: .whitespaces)), (0...100).contains(percent) else {
                                return "Enter a whole number from 0 to 100."
                            }
                            if Double(percent) / 100 != threshold || error != nil {
                                enteredThreshold = Double(percent) / 100
                                Task { await save(settings) }
                            }
                            return nil
                        }
                    }

                    if let error {
                        FieldError(error)
                    }
                }
                .disabled(saving)
                .expensesRowBackground()
            } else if let loadError {
                UnavailableStateSection(title: "Couldn't load categorization", systemImage: "exclamationmark.triangle", message: loadError) {
                    await load()
                }
            } else {
                LoadingStateSection(title: "Loading categorization")
            }
        }
        .navigationTitle("Categorization")
        .expensesScreenStyle()
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
        // Training takes seconds; the status follows it until it settles.
        .task(id: training) {
            while training {
                try? await Task.sleep(for: .seconds(2))
                if Task.isCancelled {
                    return
                }
                await model.loadAccountSettings()
            }
        }
    }

    private var training: Bool {
        guard let settings = model.settings?.autoCategorization else {
            return false
        }
        return settings.enabled && settings.trainingStatus == .training
    }

    private func status(_ settings: AutoCategorizationSettings) -> some View {
        let previous = settings.trainedAt.map { "using the model from \(AppFormatters.shortDay($0))" }
        return Group {
            switch settings.trainingStatus {
            case .ready:
                Label {
                    Text(settings.trainedAt.map { "Active · trained \(AppFormatters.dateTime($0))" } ?? "Active")
                } icon: {
                    Image(systemName: "checkmark.circle")
                        .foregroundStyle(ExpensesTheme.income(for: scheme))
                }
            case .training:
                Label {
                    Text(previous == nil ? "Training" : "Active · retraining")
                } icon: {
                    ProgressView()
                }
            case .insufficientData:
                Label(
                    "\(previous.map { "Not enough history to retrain · \($0)" } ?? "Not enough history") · needs \(settings.minHistory) categorized expenses with titles in 2 categories",
                    systemImage: "exclamationmark.circle"
                )
            case .failed:
                Label {
                    Text(previous.map { "Training failed · \($0)" } ?? "Training failed · retries at the next weekly check")
                } icon: {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(ExpensesTheme.expense(for: scheme))
                }
            case .untrained:
                Label("Waiting for the first training", systemImage: "hourglass")
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }

    private func load() async {
        await model.loadAccountSettings()
        loadError = model.settings == nil ? model.lastError?.message ?? "The server didn't respond." : nil
    }

    private func save(_ settings: AutoCategorizationSettings) async {
        error = nil
        saving = true
        defer { saving = false }
        if await model.saveAutoCategorization(
            enabled: enteredEnabled ?? settings.enabled,
            threshold: enteredThreshold ?? settings.threshold
        ) {
            enteredEnabled = nil
            enteredThreshold = nil
        } else {
            error = model.lastError?.message ?? "Couldn't save automatic categorization."
        }
    }
}
