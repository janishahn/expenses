import SwiftUI

struct AISettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var features: [AIFeatureSettings] = []
    @State private var catalogs: [String: [AIModelOption]] = [:]
    @State private var catalogErrors: [String: String] = [:]
    @State private var pairing: ChatGPTPairingResponse?
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var confirmDisconnect = false

    var body: some View {
        Form {
            if let settings = model.aiSettings {
                if !settings.enabled {
                    Section {
                        Text("AI features are disabled on this server. Enable EXPENSES_LLM_ENABLED to configure them.")
                    }
                }
                connectionSection(settings)
                ForEach($features) { $feature in
                    AIFeatureSettingsSection(
                        feature: $feature,
                        models: catalogs[feature.provider] ?? [],
                        serverDefault: settings.configuredModel,
                        catalogError: catalogErrors[feature.provider],
                        connected: settings.connection.status == "connected" && settings.connection.planAuthorized
                    )
                    .disabled(busy || !settings.enabled)
                }
                Section {
                    Button("Save AI settings") { Task { await save() } }
                        .disabled(busy || !settings.enabled)
                    Button("Refresh models") { Task { await refreshModels(settings) } }
                        .disabled(busy || !settings.enabled)
                } footer: {
                    Text("Lower thinking levels can use less allowance. Model support varies; Model default uses the provider or feature default.")
                }
            } else if busy {
                Section { ProgressView("Loading AI settings…") }
            }
            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                    Button("Retry") { Task { await load() } }
                }
            }
            if let statusMessage {
                Section { Text(statusMessage) }
            }
        }
        .navigationTitle("AI settings")
        .expensesScreenStyle()
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("Disconnect ChatGPT?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { Task { await disconnect() } }
        } message: {
            Text("Features assigned to ChatGPT will need another provider or a new connection.")
        }
    }

    private func connectionSection(_ settings: AISettingsResponse) -> some View {
        Section {
            LabeledContent("Connection", value: connectionLabel(settings.connection))
            if let email = settings.connection.email { Text(email).foregroundStyle(.secondary) }
            Button(settings.connection.status == "connected" ? "Reconnect ChatGPT" : "Continue with ChatGPT") {
                Task { await startPairing() }
            }
            .disabled(busy || !settings.enabled)
            if settings.connection.status != "disconnected" {
                Button("Disconnect", role: .destructive) { confirmDisconnect = true }
                    .disabled(busy)
            }
            Link("Manage usage", destination: URL(string: "https://chatgpt.com/settings/usage")!)
            if let pairing {
                Text("Finish connecting on your computer").font(.headline)
                Text("From an Expenses checkout on the computer running your browser, run:")
                Text("uv run connect-chatgpt --server \(model.baseURLString)")
                    .font(.caption.monospaced()).textSelection(.enabled)
                Text("Enter this pairing code when prompted, then approve access in ChatGPT. The code expires in 10 minutes.")
                Text(pairing.pairingCode).font(.caption.monospaced()).textSelection(.enabled)
                    .accessibilityLabel("ChatGPT pairing code: \(pairing.pairingCode)")
                Button("I’ve finished connecting") { Task { pairingCompleted(); await load() } }
            }
        } header: {
            Text("ChatGPT connection")
        } footer: {
            Text("Eligible requests use your ChatGPT Plus or Pro allowance. The financial details needed for each request go to OpenAI. Your connection is stored securely on your Expenses server and belongs only to your Expenses account.")
        }
    }

    private func pairingCompleted() { pairing = nil }

    private func connectionLabel(_ connection: AIConnectionStatus) -> String {
        if connection.status == "connected" { return connection.planAuthorized ? "Connected" : "Plan access not granted" }
        return connection.status == "reauth_required" ? "Reconnect required" : "Not connected"
    }

    private func load() async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            let settings = try await model.loadAISettings()
            try Task.checkCancellation()
            features = settings.features
            await refreshModels(settings)
        } catch is CancellationError {
        } catch { errorMessage = error.localizedDescription }
    }

    private func refreshModels(_ settings: AISettingsResponse) async {
        guard settings.enabled else { return }
        for provider in ["configured", "chatgpt"] {
            let available = provider == "configured" ? settings.configuredAvailable : settings.connection.status == "connected" && settings.connection.planAuthorized
            guard available else { catalogs[provider] = []; continue }
            do {
                catalogs[provider] = try await model.aiModels(provider: provider)
                catalogErrors[provider] = nil
            } catch { catalogErrors[provider] = error.localizedDescription }
        }
    }

    private func save() async {
        busy = true
        errorMessage = nil
        statusMessage = nil
        defer { busy = false }
        do {
            let settings = try await model.saveAISettings(features)
            features = settings.features
            statusMessage = "AI settings saved."
        } catch { errorMessage = error.localizedDescription }
    }

    private func startPairing() async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do { pairing = try await model.createChatGPTPairing() }
        catch { errorMessage = error.localizedDescription }
    }

    private func disconnect() async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            let result = try await model.disconnectChatGPT()
            pairing = nil
            catalogs["chatgpt"] = []
            statusMessage = result.message
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct AIFeatureSettingsSection: View {
    @Binding var feature: AIFeatureSettings
    let models: [AIModelOption]
    let serverDefault: String
    let catalogError: String?
    let connected: Bool

    private var efforts: [String] {
        let supported = models.first { $0.id == feature.model }?.reasoningEfforts ?? []
        return supported.isEmpty ? ["auto", "none", "minimal", "low", "medium", "high", "xhigh"] : ["auto"] + supported
    }

    var body: some View {
        Section(feature.name) {
            Picker("Provider", selection: Binding(get: { feature.provider }, set: { value in
                feature.provider = value
                feature.model = ""
                feature.reasoningEffort = "auto"
            })) {
                Text("Local / API provider").tag("configured")
                Text("ChatGPT plan").tag("chatgpt")
            }
            Picker("Model", selection: Binding(get: { feature.model }, set: { value in
                feature.model = value
                feature.reasoningEffort = "auto"
            })) {
                Text(feature.provider == "configured" ? "Server default (\(serverDefault))" : "Choose a model").tag("")
                if !feature.model.isEmpty && !models.contains(where: { $0.id == feature.model }) {
                    Text("\(feature.model) (not in current list)").tag(feature.model)
                }
                ForEach(models) { item in Text(item.name).tag(item.id) }
            }
            Picker("Thinking level", selection: $feature.reasoningEffort) {
                if !efforts.contains(feature.reasoningEffort) {
                    Text("\(feature.reasoningEffort) (unavailable)").tag(feature.reasoningEffort)
                }
                ForEach(efforts, id: \.self) { effort in
                    Text(effort == "auto" ? "Model default" : effort == "xhigh" ? "Extra high" : effort.capitalized).tag(effort)
                }
            }
            if feature.provider == "chatgpt" && !connected {
                Text("Connect ChatGPT and allow plan usage to load models.").font(.footnote).foregroundStyle(.secondary)
            }
            if let catalogError { Text(catalogError).font(.footnote).foregroundStyle(.red) }
        }
    }
}
