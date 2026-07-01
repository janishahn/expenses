import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct AuthView: View {
    @Environment(AppModel.self) private var model
    @State private var username = ""
    @State private var password = ""
    @State private var setupToken = ""
    @State private var deviceName = "iPhone"
    @State private var generatedIngestToken = ""
    @State private var statusText: String?
    @State private var formError: String?
    @State private var selectedAction: AccountAction?
    @State private var editingAnchor: BalanceAnchor?
    @State private var anchorDate = Date()
    @State private var anchorBalance = ""
    @State private var anchorNote = ""
    @State private var selectedCSVFile: URL?
    @State private var presentingCSVImporter = false

    var body: some View {
        Form {
            if let user = model.identity?.user {
                signedInSection(user)
                if model.settings == nil && model.isLoading {
                    LoadingStateSection(title: "Loading account")
                } else {
                    ingestTokenSection
                    csvImportSection
                    balanceAnchorsSection
                    mobileSessionsSection
                }

                if let statusText {
                    Section("Latest Result") {
                        Text(statusText)
                    }
                }

                if let formError {
                    Section("Error") {
                        Text(formError)
                            .foregroundStyle(.red)
                    }
                }
            } else {
                signedOutSection
            }

            appearanceSection

            if formError == nil, let error = model.lastError {
                ErrorDetailsView(error: error)
            }
        }
        .navigationTitle("Account")
        .expensesScreenStyle()
        .task {
            if model.identity?.authenticated == true {
                await model.loadAccountSettings()
            } else if model.status == nil {
                await model.testConnection()
            }
        }
        .refreshable {
            if model.identity?.authenticated == true {
                await model.loadAccountSettings()
            } else {
                await model.testConnection()
            }
        }
        .animation(.easeInOut(duration: 0.18), value: model.isLoading && model.settings == nil)
        .fileImporter(
            isPresented: $presentingCSVImporter,
            allowedContentTypes: [.data]
        ) { result in
            handleCSVSelection(result)
        }
        .confirmationDialog(
            selectedAction?.title ?? "Confirm",
            isPresented: selectedActionPresented,
            titleVisibility: .visible
        ) {
            if let selectedAction {
                Button(selectedAction.confirmLabel, role: selectedAction.role) {
                    Task { await perform(selectedAction) }
                }
            }
        } message: {
            if let selectedAction {
                Text(selectedAction.message)
            }
        }
    }

    private var selectedActionPresented: Binding<Bool> {
        Binding(
            get: { selectedAction != nil },
            set: { isPresented in
                if !isPresented {
                    selectedAction = nil
                }
            }
        )
    }

    private func signedInSection(_ user: AuthUser) -> some View {
        Section("Signed In") {
            LabeledContent("User", value: user.username)
            LabeledContent("Admin", value: user.isAdmin ? "Yes" : "No")
            if let session = model.identity?.session {
                LabeledContent("Device", value: session.deviceName)
                LabeledContent("Expires", value: AppFormatters.dateTime(session.expiresAt))
            }
            Button("Log out", role: .destructive) {
                Task { await model.logout() }
            }
        }
    }

    private var signedOutSection: some View {
        Group {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Image(systemName: "lock.shield")
                        .font(.system(size: 32, weight: .semibold))
                        .foregroundStyle(.tint)
                    Text("Connect to Expenses")
                        .font(.title3.weight(.semibold))
                    Text(authIntroText)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 8)
            }

            Section("Credentials") {
                TextField("Username", text: $username)
                    .textInputAutocapitalization(.never)
                    .textContentType(.username)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
                    .textContentType(.password)
                if model.status?.setupTokenRequired == true {
                    SecureField("Setup token", text: $setupToken)
                        .textContentType(.oneTimeCode)
                }
                TextField("Device name", text: $deviceName)
            }

            Section("Access") {
                Button {
                    Task {
                        await model.login(
                            username: username,
                            password: password,
                            deviceName: deviceName
                        )
                        await model.loadAccountSettings()
                    }
                } label: {
                    Label("Log in", systemImage: "person.crop.circle.badge.checkmark")
                }
                .fontWeight(.semibold)
                .disabled(authFieldsAreEmpty || model.isLoading)

                Button {
                    Task {
                        await model.setup(
                            username: username,
                            password: password,
                            deviceName: deviceName,
                            setupToken: setupToken.trimmingCharacters(in: .whitespacesAndNewlines)
                        )
                        await model.loadAccountSettings()
                    }
                } label: {
                    Label("Run first-time setup", systemImage: "wand.and.stars")
                }
                .disabled(
                    authFieldsAreEmpty ||
                        setupTokenIsRequiredAndMissing ||
                        model.status?.setupRequired != true ||
                        model.isLoading
                )

                Button {
                    Task {
                        await model.signup(
                            username: username,
                            password: password,
                            deviceName: deviceName
                        )
                        await model.loadAccountSettings()
                    }
                } label: {
                    Label("Create account", systemImage: "person.crop.circle.badge.plus")
                }
                .disabled(
                    authFieldsAreEmpty ||
                        model.status?.setupRequired == true ||
                        model.status?.signupAllowed != true ||
                        model.isLoading
                )

                if let setupRequired = model.status?.setupRequired {
                    Text(setupRequired ? "This tracker still needs first-time setup." : "First-time setup is complete.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else if model.isLoading {
                    Text("Checking tracker status...")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    HStack {
                        Text("Couldn't reach the tracker.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry") {
                            Task { await model.testConnection() }
                        }
                        .font(.footnote)
                    }
                }
            }
        }
    }

    private var authFieldsAreEmpty: Bool {
        username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || password.isEmpty
            || deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var setupTokenIsRequiredAndMissing: Bool {
        model.status?.setupTokenRequired == true
            && setupToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var authIntroText: String {
        if model.status?.setupRequired == true {
            return "Create the first admin account for this tracker. Your device will keep a local mobile session after setup."
        }
        return "Sign in to reuse this device as a trusted mobile session."
    }

    private var ingestTokenSection: some View {
        Section("Ingest Token") {
            if let token = model.settings?.ingestToken {
                LabeledContent("Token hint", value: token.tokenHint)
                LabeledContent("Updated", value: AppFormatters.dateTime(token.updatedAt))
                LabeledContent("Last used", value: token.lastUsedAt.map(AppFormatters.dateTime) ?? "Never")
            } else {
                Text("No ingest token configured.")
                    .foregroundStyle(.secondary)
            }

            Button {
                Task { await createOrRotateIngestToken() }
            } label: {
                Label(model.settings?.ingestToken == nil ? "Create token" : "Rotate token", systemImage: "key")
            }
            .disabled(model.isLoading)

            if model.settings?.ingestToken != nil {
                Button(role: .destructive) {
                    selectedAction = .revokeIngestToken
                } label: {
                    Label("Revoke token", systemImage: "trash")
                }
                .disabled(model.isLoading)
            }

            if !generatedIngestToken.isEmpty {
                TextField("Generated token", text: $generatedIngestToken)
                    .font(.footnote.monospaced())
                    .textSelection(.enabled)
                Button {
                    UIPasteboard.general.string = generatedIngestToken
                } label: {
                    Label("Copy generated token", systemImage: "doc.on.doc")
                }
            }
        }
    }

    private var csvImportSection: some View {
        Section("CSV Import") {
            Button {
                presentingCSVImporter = true
            } label: {
                Label(selectedCSVFile?.lastPathComponent ?? "Choose CSV", systemImage: "doc.badge.plus")
            }

            Button {
                Task { await previewCSV() }
            } label: {
                Label("Preview CSV", systemImage: "eye")
            }
            .disabled(selectedCSVFile == nil || model.isLoading)

            if let preview = model.csvPreview {
                LabeledContent("Rows", value: String(preview.rows.count))
                LabeledContent("Errors", value: String(preview.errors.count))
                ForEach(preview.errors, id: \.self) { error in
                    Text(error)
                        .foregroundStyle(.red)
                }
                ForEach(preview.rows.prefix(8)) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.title)
                            .font(.subheadline.weight(.semibold))
                        Text("\(AppFormatters.day(row.date)) · \(AppFormatters.euros(row.amountCents)) · \(row.category ?? "Uncategorized")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if preview.rows.count > 8 {
                    Text("\(preview.rows.count - 8) more rows")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button(role: .destructive) {
                    selectedAction = .commitCSV
                } label: {
                    Label("Commit CSV import", systemImage: "tray.and.arrow.down")
                }
                .disabled(!preview.errors.isEmpty || selectedCSVFile == nil || model.isLoading)
            }
        }
    }

    private var balanceAnchorsSection: some View {
        Section("Balance Snapshots") {
            if let settings = model.settings {
                LabeledContent("Current balance", value: AppFormatters.euros(settings.currentBalance))
            }

            DatePicker("As of", selection: $anchorDate)
            TextField("Balance", text: $anchorBalance)
                .keyboardType(.decimalPad)
            TextField("Note", text: $anchorNote)

            Button(editingAnchor == nil ? "Save snapshot" : "Update snapshot") {
                Task { await saveBalanceAnchor() }
            }
            .disabled(anchorBalance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isLoading)

            if editingAnchor != nil {
                Button("Cancel edit") {
                    resetAnchorForm()
                }
            }

            ForEach(model.settings?.balanceAnchors ?? []) { anchor in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(AppFormatters.euros(anchor.balanceCents))
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(AppFormatters.dateTime(anchor.asOfAt))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let note = anchor.note, !note.isEmpty {
                        Text(note)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Button("Edit") {
                            edit(anchor)
                        }
                        Button("Delete", role: .destructive) {
                            selectedAction = .deleteBalanceAnchor(anchor)
                        }
                    }
                    .font(.caption)
                    .buttonStyle(.borderless)
                }
            }
        }
    }

    private var mobileSessionsSection: some View {
        Section("Mobile Sessions") {
            ForEach(model.mobileSessions?.sessions ?? []) { session in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(session.deviceName)
                            .font(.subheadline.weight(.semibold))
                        if session.id == model.identity?.session?.id {
                            Text("Current")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.green)
                        }
                    }
                    Text("Expires \(AppFormatters.dateTime(session.expiresAt))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let revokedAt = session.revokedAt {
                        Text("Revoked \(AppFormatters.dateTime(revokedAt))")
                            .font(.caption)
                            .foregroundStyle(.red)
                    } else {
                        Button("Revoke", role: .destructive) {
                            selectedAction = .revokeMobileSession(session)
                        }
                        .font(.caption)
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
    }

    private var appearanceSection: some View {
        Section("Appearance") {
            Picker("Theme", selection: appearanceBinding) {
                Text("System").tag("system")
                Text("Light").tag("light")
                Text("Dark").tag("dark")
            }
            .pickerStyle(.segmented)
            .sensoryFeedback(.selection, trigger: appearanceBinding.wrappedValue)
        }
    }

    private var appearanceBinding: Binding<String> {
        Binding(
            get: { model.appearancePreference },
            set: { model.appearancePreference = $0 }
        )
    }

    private func createOrRotateIngestToken() async {
        formError = nil
        statusText = nil
        guard let response = await model.createOrRotateIngestToken() else {
            return
        }
        generatedIngestToken = response.token
        statusText = "Ingest token is shown once. Copy it now."
    }

    private func previewCSV() async {
        formError = nil
        statusText = nil
        guard let selectedCSVFile else {
            formError = "Choose a CSV file first."
            return
        }
        _ = await model.previewCSV(fileURL: selectedCSVFile)
    }

    private func saveBalanceAnchor() async {
        formError = nil
        guard let balanceCents = Self.parseCents(anchorBalance) else {
            formError = "Enter a valid balance."
            return
        }
        let request = BalanceAnchorRequest(
            asOfAt: Self.dateTimeString(anchorDate),
            balanceCents: balanceCents,
            note: anchorNote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : anchorNote
        )
        if await model.saveBalanceAnchor(id: editingAnchor?.id, body: request) {
            resetAnchorForm()
        }
    }

    private func edit(_ anchor: BalanceAnchor) {
        editingAnchor = anchor
        anchorDate = anchor.asOfAt
        anchorBalance = String(format: "%.2f", Double(anchor.balanceCents) / 100.0)
        anchorNote = anchor.note ?? ""
    }

    private func resetAnchorForm() {
        editingAnchor = nil
        anchorDate = Date()
        anchorBalance = ""
        anchorNote = ""
    }

    private func handleCSVSelection(_ result: Result<URL, Error>) {
        formError = nil
        statusText = nil
        model.csvPreview = nil
        switch result {
        case let .success(url):
            selectedCSVFile = url
        case let .failure(error):
            formError = error.localizedDescription
        }
    }

    private func perform(_ action: AccountAction) async {
        formError = nil
        statusText = nil
        switch action {
        case .revokeIngestToken:
            if await model.revokeIngestToken() {
                generatedIngestToken = ""
                statusText = "Ingest token revoked."
            }
        case let .revokeMobileSession(session):
            if await model.revokeMobileSession(session) {
                statusText = "Mobile session revoked."
            }
        case let .deleteBalanceAnchor(anchor):
            if await model.deleteBalanceAnchor(anchor) {
                statusText = "Balance snapshot deleted."
            }
        case .commitCSV:
            guard let selectedCSVFile else {
                formError = "Choose a CSV file first."
                return
            }
            if let response = await model.commitCSV(fileURL: selectedCSVFile) {
                statusText = "Imported \(response.importedCount) transactions."
                self.selectedCSVFile = nil
            }
        }
    }

    private static func parseCents(_ value: String) -> Int? {
        let normalized = value.replacingOccurrences(of: ",", with: ".")
        guard let decimal = Decimal(string: normalized.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return nil
        }
        return NSDecimalNumber(decimal: decimal * Decimal(100)).rounding(accordingToBehavior: nil).intValue
    }

    private static func dateTimeString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return formatter.string(from: date)
    }
}

private enum AccountAction: Identifiable {
    case revokeIngestToken
    case revokeMobileSession(MobileSession)
    case deleteBalanceAnchor(BalanceAnchor)
    case commitCSV

    var id: String {
        switch self {
        case .revokeIngestToken:
            "revoke-ingest-token"
        case let .revokeMobileSession(session):
            "revoke-mobile-session-\(session.id)"
        case let .deleteBalanceAnchor(anchor):
            "delete-balance-anchor-\(anchor.id)"
        case .commitCSV:
            "commit-csv"
        }
    }

    var title: String {
        switch self {
        case .revokeIngestToken:
            "Revoke ingest token?"
        case .revokeMobileSession:
            "Revoke mobile session?"
        case .deleteBalanceAnchor:
            "Delete balance snapshot?"
        case .commitCSV:
            "Commit CSV import?"
        }
    }

    var message: String {
        switch self {
        case .revokeIngestToken:
            "External ingest clients using this token will stop working."
        case .revokeMobileSession:
            "The selected device will need to log in again."
        case .deleteBalanceAnchor:
            "The balance snapshot will be removed from account-balance calculations."
        case .commitCSV:
            "The previewed CSV rows will be imported as transactions."
        }
    }

    var confirmLabel: String {
        switch self {
        case .revokeIngestToken:
            "Revoke"
        case .revokeMobileSession:
            "Revoke"
        case .deleteBalanceAnchor:
            "Delete"
        case .commitCSV:
            "Import"
        }
    }

    var role: ButtonRole? {
        switch self {
        case .revokeIngestToken, .revokeMobileSession, .deleteBalanceAnchor, .commitCSV:
            .destructive
        }
    }
}
