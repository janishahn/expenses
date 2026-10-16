import SwiftUI

/// How long the server keeps chats after their last message. Saves as soon as it changes.
struct AssistantSettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var enteredDays: Int?
    @State private var error: String?
    @State private var loadError: String?

    var body: some View {
        List {
            if let settings = model.assistantSettings {
                Section {
                    Picker("Keep Chats", selection: Binding(
                        get: { enteredDays ?? settings.chatDays },
                        set: { days in
                            enteredDays = days
                            Task { await save(days) }
                        }
                    )) {
                        ForEach([7, 14, 30, 90], id: \.self) { days in
                            Text("\(days) days").tag(days)
                        }
                    }
                    .pickerStyle(.menu)
                    .disabled(enteredDays != nil && error == nil)

                    if let error {
                        FieldError(error)
                    }
                }
                .expensesRowBackground()
            } else if let loadError {
                UnavailableStateSection(title: "Couldn't load Assistant settings", systemImage: "exclamationmark.triangle", message: loadError) {
                    await load()
                }
            } else {
                LoadingStateSection(title: "Loading Assistant settings")
            }
        }
        .navigationTitle("Assistant")
        .expensesScreenStyle()
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
    }

    private func load() async {
        await model.loadAssistantSettings()
        loadError = model.assistantSettings == nil ? model.lastError?.message ?? "The server didn't respond." : nil
    }

    private func save(_ days: Int) async {
        error = nil
        if await model.saveAssistantChatDays(days) {
            enteredDays = nil
        } else {
            error = model.lastError?.message ?? "Couldn't save how long chats are kept."
        }
    }
}
