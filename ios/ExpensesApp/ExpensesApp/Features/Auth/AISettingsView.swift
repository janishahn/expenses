import SwiftUI
import UIKit

/// The ChatGPT connection and each AI feature's provider, model, and thinking level.
/// Every change saves at once; a failed save keeps the choices next to the error.
struct AISettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var choices: [AIFeatureSettings] = []
    @State private var enteringModelID: Set<String> = []
    @State private var catalogs: [String: [AIModelOption]] = [:]
    @State private var catalogErrors: [String: String] = [:]
    @State private var loadingModels = false
    @State private var saving = false
    @State private var saveError: String?
    @State private var pairing: ChatGPTPairingResponse?
    @State private var connecting = false
    @State private var disconnecting = false
    @State private var confirmingDisconnect = false
    @State private var connectionError: String?
    @State private var loadError: String?
    @FocusState private var editingModelID: String?

    private static let providerLabels = ["configured": "Local / API", "chatgpt": "ChatGPT plan"]

    var body: some View {
        List {
            if let settings = model.aiSettings {
                if !settings.enabled {
                    Section {
                        Label("AI features are off on this server. Set EXPENSES_LLM_ENABLED to turn them on.", systemImage: "exclamationmark.circle")
                            .foregroundStyle(.secondary)
                    }
                    .expensesRowBackground()
                }
                connectionSection(settings)
                ForEach($choices) { $choice in
                    featureSection($choice, settings: settings)
                }
                notesSection(settings)
            } else if let loadError {
                UnavailableStateSection(title: "Couldn't load AI settings", systemImage: "exclamationmark.triangle", message: loadError) {
                    await load()
                }
            } else {
                LoadingStateSection(title: "Loading AI settings")
            }
        }
        .navigationTitle("AI")
        .expensesScreenStyle()
        .toolbar {
            if let settings = model.aiSettings {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh models", systemImage: "arrow.clockwise") {
                        Task { await refreshModels(settings) }
                    }
                    .disabled(!settings.enabled || loadingModels)
                }
            }
        }
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
        // Stored choices replace the shown ones when they change, as after a save.
        .onChange(of: model.aiSettings?.features) { _, features in
            if let features {
                choices = features
            }
        }
        .onChange(of: editingModelID) { previous, _ in
            if let previous {
                commitModelID(previous)
            }
        }
        // While a pairing code is valid, the connection shows up once the helper finishes.
        .task(id: pairing?.pairingCode) {
            while let pairing, pairing.expiresAt > .now {
                try? await Task.sleep(for: .seconds(2))
                if Task.isCancelled {
                    return
                }
                _ = try? await model.loadAISettings()
            }
        }
        .alert("Disconnect ChatGPT?", isPresented: $confirmingDisconnect) {
            Button("Cancel", role: .cancel) {}
            Button("Disconnect", role: .destructive) {
                Task { await disconnect() }
            }
        } message: {
            Text("Features set to ChatGPT plan stop working until they use another provider.")
        }
    }

    // MARK: Sections

    private func connectionSection(_ settings: AISettingsResponse) -> some View {
        let connection = settings.connection
        return Section("ChatGPT") {
            VStack(alignment: .leading, spacing: 2) {
                Text(connectionLabel(connection))
                if connection.status == "connected" && !connection.planAuthorized {
                    Text("Plan access not granted")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            if connection.status == "connected", let usage = URL(string: connection.usageURL) {
                Link(destination: usage) {
                    Label("Usage", systemImage: "arrow.up.right")
                }
            }

            Button(connection.status == "disconnected" ? "Continue with ChatGPT" : "Reconnect") {
                Task { await connect() }
            }
            .disabled(!settings.enabled || connecting)

            if connection.status != "disconnected" {
                Button("Disconnect", role: .destructive) {
                    confirmingDisconnect = true
                }
                .disabled(disconnecting)
            }

            if let pairing {
                let command = "uv run connect-chatgpt --server \(model.baseURLString)"
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("On a computer, run this from an Expenses checkout")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text(command)
                            .textSelection(.enabled)
                    }
                    Spacer(minLength: 8)
                    Button("Copy command", systemImage: "doc.on.doc") {
                        UIPasteboard.general.string = command
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Enter this code when asked, then approve access in ChatGPT")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(pairing.pairingCode)
                        .font(.title3.weight(.semibold))
                        .textSelection(.enabled)
                        .accessibilityLabel("Pairing code \(pairing.pairingCode)")
                    Text("Expires at \(AppFormatters.time(pairing.expiresAt))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Button("I’ve finished connecting") {
                    self.pairing = nil
                    Task { await load() }
                }
            }

            if let connectionError {
                FieldError(connectionError)
            }
        }
        .expensesRowBackground()
    }

    private func featureSection(_ choice: Binding<AIFeatureSettings>, settings: AISettingsResponse) -> some View {
        let feature = choice.wrappedValue
        let models = catalogs[feature.provider] ?? []
        let selectedModel = models.first { $0.id == feature.model }
        let custom = feature.provider == "chatgpt"
            && (enteringModelID.contains(feature.id) || (!feature.model.isEmpty && selectedModel == nil && catalogs[feature.provider] != nil))
        let supported = selectedModel?.reasoningEfforts ?? []
        let efforts = supported.isEmpty ? ["auto", "none", "minimal", "low", "medium", "high", "xhigh"] : ["auto"] + supported

        return Section(feature.name) {
            Picker("Provider", selection: Binding(get: { feature.provider }, set: { changeProvider(feature.id, to: $0) })) {
                Text("Local / API").tag("configured")
                Text("ChatGPT plan").tag("chatgpt")
            }

            Picker("Model", selection: Binding(
                get: { custom ? "__custom__" : feature.model },
                set: { value in
                    let entering = value == "__custom__"
                    if entering {
                        enteringModelID.insert(feature.id)
                    } else {
                        enteringModelID.remove(feature.id)
                    }
                    change(feature.id, persist: !entering) {
                        $0.model = entering ? "" : value
                        $0.reasoningEffort = "auto"
                    }
                }
            )) {
                Text(feature.provider == "configured" ? "Server default (\(settings.configuredModel))" : "Choose a model").tag("")
                if !feature.model.isEmpty && selectedModel == nil && !custom {
                    Text("\(feature.model) (not in current list)").tag(feature.model)
                }
                ForEach(models) { option in
                    Text(option.name).tag(option.id)
                }
                if feature.provider == "chatgpt" {
                    Text("Enter model ID…").tag("__custom__")
                }
            }

            if custom {
                TextField("Model ID", text: choice.model)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($editingModelID, equals: feature.id)
                    .submitLabel(.done)
            }

            Picker("Thinking level", selection: Binding(
                get: { feature.reasoningEffort },
                set: { effort in
                    change(feature.id, persist: !custom || !feature.model.trimmingCharacters(in: .whitespaces).isEmpty) {
                        $0.reasoningEffort = effort
                    }
                }
            )) {
                if !efforts.contains(feature.reasoningEffort) {
                    Text("\(effortLabel(feature.reasoningEffort)) (unavailable)").tag(feature.reasoningEffort)
                }
                ForEach(efforts, id: \.self) { effort in
                    Text(effortLabel(effort)).tag(effort)
                }
            }
        }
        .pickerStyle(.menu)
        .disabled(!settings.enabled || saving)
        .expensesRowBackground()
    }

    @ViewBuilder
    private func notesSection(_ settings: AISettingsResponse) -> some View {
        let providers = Set(choices.map(\.provider))
        let chatGPTReady = settings.connection.status == "connected" && settings.connection.planAuthorized
        let errors = providers.sorted().compactMap { provider in
            catalogErrors[provider].map { (provider, $0) }
        }
        if loadingModels || (providers.contains("chatgpt") && !chatGPTReady) || !errors.isEmpty || !enteringModelID.isEmpty || saveError != nil {
            Section {
                if loadingModels {
                    Text("Loading models…")
                        .foregroundStyle(.secondary)
                }
                if providers.contains("chatgpt") && !chatGPTReady {
                    Text("Connect ChatGPT and allow plan access to load its models.")
                        .foregroundStyle(.secondary)
                }
                ForEach(errors, id: \.0) { provider, message in
                    FieldError("\(Self.providerLabels[provider] ?? provider): \(message)\(provider == "configured" ? " The server default stays available." : "")")
                }
                if !enteringModelID.isEmpty {
                    Text("Saving a model ID sends a short test request to ChatGPT.")
                        .foregroundStyle(.secondary)
                }
                if let saveError {
                    FieldError(saveError)
                }
            }
            .expensesRowBackground()
        }
    }

    // MARK: Changes

    private func change(_ featureID: String, persist: Bool = true, _ update: (inout AIFeatureSettings) -> Void) {
        guard let index = choices.firstIndex(where: { $0.id == featureID }) else {
            return
        }
        update(&choices[index])
        saveError = nil
        if persist {
            Task { await save() }
        }
    }

    // A typed model ID saves when the field is left.
    private func commitModelID(_ featureID: String) {
        guard let typed = choices.first(where: { $0.id == featureID })?.model else {
            return
        }
        let stored = model.aiSettings?.features.first { $0.id == featureID }?.model
        if !typed.trimmingCharacters(in: .whitespaces).isEmpty && typed != stored {
            Task { await save() }
        }
    }

    // A ChatGPT plan starts on a suggested model and thinking level for the feature.
    private func changeProvider(_ featureID: String, to provider: String) {
        enteringModelID.remove(featureID)
        let models = catalogs[provider] ?? []
        let preferred = featureID == "spending_chat" ? "gpt-6.1-sol" : "gpt-6-luna"
        change(featureID) {
            $0.provider = provider
            $0.model = provider == "chatgpt" ? (models.first { $0.id == preferred }?.id ?? models.first?.id ?? "") : ""
            $0.reasoningEffort = provider == "chatgpt" ? (featureID == "spending_chat" ? "medium" : "low") : "auto"
        }
    }

    private func effortLabel(_ effort: String) -> String {
        switch effort {
        case "auto":
            "Model default"
        case "xhigh":
            "Extra high"
        default:
            effort.capitalized
        }
    }

    private func connectionLabel(_ connection: AIConnectionStatus) -> String {
        switch connection.status {
        case "connected":
            connection.email.map { "Connected as \($0)" } ?? "Connected"
        case "reauth_required":
            "The connection needs to be renewed"
        default:
            "Not connected"
        }
    }

    // MARK: Requests

    private func load() async {
        do {
            let settings = try await model.loadAISettings()
            choices = settings.features
            enteringModelID = []
            loadError = nil
            await refreshModels(settings)
        } catch is CancellationError {
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func refreshModels(_ settings: AISettingsResponse) async {
        guard settings.enabled else {
            return
        }
        loadingModels = true
        defer { loadingModels = false }
        for provider in ["configured", "chatgpt"] {
            let available = provider == "configured"
                ? settings.configuredAvailable
                : settings.connection.status == "connected" && settings.connection.planAuthorized
            guard available else {
                catalogs[provider] = nil
                catalogErrors[provider] = nil
                continue
            }
            do {
                catalogs[provider] = try await model.aiModels(provider: provider)
                catalogErrors[provider] = nil
            } catch {
                catalogErrors[provider] = error.localizedDescription
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            _ = try await model.saveAISettings(choices)
        } catch {
            saveError = error.localizedDescription
        }
    }

    private func connect() async {
        connectionError = nil
        connecting = true
        defer { connecting = false }
        do {
            pairing = try await model.createChatGPTPairing()
        } catch {
            connectionError = error.localizedDescription
        }
    }

    private func disconnect() async {
        connectionError = nil
        disconnecting = true
        defer { disconnecting = false }
        do {
            _ = try await model.disconnectChatGPT()
            pairing = nil
            catalogs["chatgpt"] = nil
        } catch {
            connectionError = error.localizedDescription
        }
    }
}
