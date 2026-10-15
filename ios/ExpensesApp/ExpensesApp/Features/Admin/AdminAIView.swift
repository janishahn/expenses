import SwiftUI

/// Which backend, model, and thinking level each AI feature uses, for the whole server.
struct AdminAIView: View {
    @Environment(AppModel.self) private var model

    @State private var stored: Result<AISettingsResponse, APIErrorInfo>?
    @State private var choices: [AIFeatureSettings] = []
    @State private var catalogs: [String: Result<[AIModelOption], APIErrorInfo>] = [:]
    @State private var saving = false
    @State private var saveError: String?

    private static let thinkingLevels = [
        ("auto", "Auto"), ("off", "Off"), ("low", "Low"), ("medium", "Medium"), ("high", "High"),
    ]

    var body: some View {
        List {
            switch stored {
            case nil:
                LoadingStateSection(title: "Loading AI settings")
            case .failure(let error) where error.statusCode == 403:
                AdminUnlockSection(title: "Admin access expired") {
                    await load()
                }
            case .failure(let error):
                UnavailableStateSection(title: "Couldn't load AI settings", systemImage: "exclamationmark.triangle", message: error.message) {
                    await load()
                }
            case .success(let settings):
                if settings.backends.isEmpty {
                    Section {
                        Text("No AI backends are configured. Set EXPENSES_AI_BACKENDS on the server to turn on AI features.")
                            .foregroundStyle(.secondary)
                    }
                    .expensesRowBackground()
                }
                ForEach($choices) { $choice in
                    featureSection($choice, backends: settings.backends)
                }
                Section {
                    Button(saving ? "Saving…" : "Save") {
                        Task { await save() }
                    }
                    .fontWeight(.semibold)
                    .disabled(saving || choices == settings.features)
                    .fieldError(saveError)
                }
                .expensesRowBackground()
            }
        }
        .navigationTitle("AI")
        .expensesScreenStyle()
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
        .onChange(of: choices.map(\.backend)) {
            saveError = nil
            Task { await loadModels() }
        }
    }

    private func featureSection(_ choice: Binding<AIFeatureSettings>, backends: [AIBackend]) -> some View {
        let feature = choice.wrappedValue
        return Section(feature.name) {
            Toggle("On", isOn: choice.enabled)

            // A model belongs to one backend, so switching backend clears it.
            Picker("Backend", selection: Binding(
                get: { choice.wrappedValue.backend },
                set: { choice.wrappedValue.backend = $0; choice.wrappedValue.model = "" }
            )) {
                Text("None").tag("")
                if !feature.backend.isEmpty && !backends.contains(where: { $0.name == feature.backend }) {
                    Text("\(feature.backend) (not configured)").tag(feature.backend)
                }
                ForEach(backends) { backend in
                    Text(backend.name).tag(backend.name)
                }
            }

            if !feature.backend.isEmpty {
                modelField(choice)
            }

            Picker("Thinking", selection: choice.thinking) {
                ForEach(Self.thinkingLevels, id: \.0) { level in
                    Text(level.1).tag(level.0)
                }
            }
        }
        .pickerStyle(.menu)
        .expensesRowBackground()
    }

    @ViewBuilder
    private func modelField(_ choice: Binding<AIFeatureSettings>) -> some View {
        let feature = choice.wrappedValue
        switch catalogs[feature.backend] {
        case .success(let models) where !models.isEmpty:
            Picker("Model", selection: choice.model) {
                if feature.model.isEmpty {
                    Text("Choose a model").tag("")
                } else if !models.contains(where: { $0.id == feature.model }) {
                    Text("\(feature.model) (not in current list)").tag(feature.model)
                }
                ForEach(models) { option in
                    Text(option.name).tag(option.id)
                }
            }
        case .failure(let error):
            TextField("Model ID", text: choice.model)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .fieldError("Couldn't list models: \(error.message) Enter a model ID instead.")
        case .success:
            TextField("Model ID", text: choice.model)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        case nil:
            LabeledContent("Model") {
                ProgressView()
            }
        }
    }

    private func load() async {
        let result = await model.chart { try await $0.adminAISettings(token: $1) }
        guard !Task.isCancelled else {
            return
        }
        stored = result
        if case .success(let settings) = result {
            choices = settings.features
            saveError = nil
            catalogs = [:]
            await loadModels()
        }
    }

    // Lists the models of each chosen backend once; a failed listing stays until a refresh.
    private func loadModels() async {
        for backend in Set(choices.map(\.backend)) where !backend.isEmpty && catalogs[backend] == nil {
            let result = await model.chart { try await $0.adminAIModels(backend: backend, token: $1) }
            guard !Task.isCancelled else {
                return
            }
            catalogs[backend] = result.map(\.models)
        }
    }

    private func save() async {
        saveError = nil
        saving = true
        defer { saving = false }
        let features = choices
        switch await model.chart({ try await $0.saveAdminAISettings(features, token: $1) }) {
        case .success(let settings):
            stored = .success(settings)
            choices = settings.features
            await model.refreshStatus()
        case .failure(let error) where error.statusCode == 403:
            stored = .failure(error)
        case .failure(let error):
            saveError = error.message
        }
    }
}
