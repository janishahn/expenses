import SwiftUI
import UIKit

/// The signed-in user, the ingest token for external clients, and the devices signed in.
struct AccountSettingsView: View {
    @Environment(AppModel.self) private var model

    @State private var newToken: String?
    @State private var copiedToken = 0
    @State private var tokenError: String?
    @State private var tokenBusy = false
    @State private var revokingToken = false
    @State private var revokingSession: MobileSession?
    @State private var sessionError: String?
    @State private var loadError: String?
    @State private var signOutError: String?

    var body: some View {
        List {
            if let user = model.identity?.user {
                Section {
                    LabeledContent("Username", value: user.username)
                    Button("Sign out", role: .destructive) {
                        Task { await signOut() }
                    }
                    if let signOutError {
                        FieldError(signOutError)
                    }
                }
                .expensesRowBackground()
            }

            if let settings = model.settings, model.mobileSessions != nil {
                tokenSection(settings.ingestToken)
                sessionsSection
            } else if let loadError {
                UnavailableStateSection(title: "Couldn't load your account", systemImage: "exclamationmark.triangle", message: loadError) {
                    await load()
                }
            } else {
                LoadingStateSection(title: "Loading account")
            }
        }
        .navigationTitle("Account")
        .expensesScreenStyle()
        .task {
            await load()
        }
        .refreshable {
            await load()
        }
        .alert("Revoke the ingest token?", isPresented: $revokingToken) {
            Button("Cancel", role: .cancel) {}
            Button("Revoke", role: .destructive) {
                Task { await revokeToken() }
            }
        } message: {
            Text("Clients that use it stop working.")
        }
        .alert(
            "Revoke “\(revokingSession?.deviceName ?? "")”?",
            isPresented: Binding(get: { revokingSession != nil }, set: { if !$0 { revokingSession = nil } }),
            presenting: revokingSession
        ) { session in
            Button("Cancel", role: .cancel) {}
            Button("Revoke", role: .destructive) {
                Task { await revoke(session) }
            }
        } message: { _ in
            Text("The device has to sign in again.")
        }
    }

    private func tokenSection(_ token: IngestTokenMetadata?) -> some View {
        Section("Ingest token") {
            if let token {
                LabeledContent(
                    "Ending in \(token.tokenHint)",
                    value: token.lastUsedAt.map { "Used \(AppFormatters.shortDay($0))" } ?? "Not used yet"
                )
            } else {
                Text("No token")
                    .foregroundStyle(.secondary)
            }

            if let newToken {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(newToken)
                            .textSelection(.enabled)
                        Text("Copy the new token now. It is shown once.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Button("Copy token", systemImage: "doc.on.doc") {
                        UIPasteboard.general.string = newToken
                        copiedToken += 1
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .sensoryFeedback(.success, trigger: copiedToken)
                }
            }

            Button(token == nil ? "Create token" : "Rotate token") {
                Task { await rotateToken() }
            }
            .disabled(tokenBusy)

            if token != nil {
                Button("Revoke token", role: .destructive) {
                    revokingToken = true
                }
                .disabled(tokenBusy)
            }

            if let tokenError {
                FieldError(tokenError)
            }
        }
        .expensesRowBackground()
    }

    private var sessionsSection: some View {
        Section("Devices") {
            ForEach(activeSessions) { session in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.deviceName)
                        Text(sessionDetail(session))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if session.id != model.identity?.session?.id {
                        Button("Revoke", role: .destructive) {
                            revokingSession = session
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }
            if let sessionError {
                FieldError(sessionError)
            }
        }
        .expensesRowBackground()
    }

    private var activeSessions: [MobileSession] {
        model.mobileSessions?.sessions.filter { $0.revokedAt == nil && $0.expiresAt > .now } ?? []
    }

    private func sessionDetail(_ session: MobileSession) -> String {
        if session.id == model.identity?.session?.id {
            return "This device"
        }
        return session.lastUsedAt.map { "Last used \(AppFormatters.shortDay($0))" } ?? "Not used yet"
    }

    private func load() async {
        await model.loadAccountSettings()
        loadError = model.settings == nil || model.mobileSessions == nil ? model.lastError?.message ?? "The server didn't respond." : nil
    }

    // The session stays until the server revokes it, so a failed sign-out shows why.
    private func signOut() async {
        signOutError = nil
        await model.logout()
        if model.hasSession {
            signOutError = model.lastError?.message ?? "Couldn't sign out."
        }
    }

    private func rotateToken() async {
        tokenError = nil
        tokenBusy = true
        defer { tokenBusy = false }
        guard let response = await model.createOrRotateIngestToken() else {
            tokenError = model.lastError?.message ?? "Couldn't create the ingest token."
            return
        }
        newToken = response.token
    }

    private func revokeToken() async {
        tokenError = nil
        tokenBusy = true
        defer { tokenBusy = false }
        if await model.revokeIngestToken() {
            newToken = nil
        } else {
            tokenError = model.lastError?.message ?? "Couldn't revoke the ingest token."
        }
    }

    private func revoke(_ session: MobileSession) async {
        sessionError = nil
        if !(await model.revokeMobileSession(session)) {
            sessionError = model.lastError?.message ?? "Couldn't revoke the device."
        }
    }
}
