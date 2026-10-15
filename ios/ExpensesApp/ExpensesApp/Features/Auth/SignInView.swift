import SwiftUI
import UIKit

/// The root screen without a session: server address, then sign in, create an
/// account, or create the first admin account on a new server.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var server = ""
    @State private var username = ""
    @State private var password = ""
    @State private var setupToken = ""
    @State private var createsAccount = false
    // The last status check failed. Until a check finishes, the screen shows progress.
    @State private var statusCheckFailed = false
    @FocusState private var focusedField: Field?

    private enum Field {
        case server
        case username
        case password
        case setupToken
    }

    private enum Mode {
        case signIn
        case createAccount
        case setup
    }

    private var mode: Mode {
        if model.status?.setupRequired == true {
            return .setup
        }
        return createsAccount && model.status?.signupAllowed == true ? .createAccount : .signIn
    }

    private var title: String {
        switch mode {
        case .signIn:
            "Sign in"
        case .createAccount:
            "Create account"
        case .setup:
            "Create the admin account"
        }
    }

    private var canSubmit: Bool {
        !username.trimmingCharacters(in: .whitespaces).isEmpty
            && !password.isEmpty
            && model.status != nil
            && !(mode == .setup && model.status?.setupTokenRequired == true && trimmedSetupToken.isEmpty)
            && !model.isLoading
    }

    var body: some View {
        AuthScreen {
            Text(title)
                .font(.title.bold())
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)

            VStack(alignment: .leading, spacing: 16) {
                AuthCard {
                    TextField("Server address", text: $server)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit { Task { await connect() } }
                        .authFieldRow(.server, focus: $focusedField)
                    if model.status == nil {
                        if statusCheckFailed {
                            HStack {
                                Text("Can't reach this server")
                                    .foregroundStyle(ExpensesTheme.expense(for: scheme))
                                Spacer()
                                Button("Retry") {
                                    Task { await connect() }
                                }
                            }
                            .authRow()
                        } else {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .authRow()
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    AuthCard {
                        TextField("Username", text: $username)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.next)
                            .onSubmit { focusedField = .password }
                            .authFieldRow(.username, focus: $focusedField)
                        SecureField("Password", text: $password)
                            .textContentType(mode == .signIn ? .password : .newPassword)
                            .submitLabel(.go)
                            .onSubmit {
                                if canSubmit {
                                    Task { await submit() }
                                }
                            }
                            .authFieldRow(.password, focus: $focusedField)
                        if mode == .setup && model.status?.setupTokenRequired == true {
                            SecureField("Setup token", text: $setupToken)
                                .textContentType(.oneTimeCode)
                                .authFieldRow(.setupToken, focus: $focusedField)
                        }
                    }

                    if model.status != nil, let error = model.lastError {
                        Text(error.message)
                            .foregroundStyle(ExpensesTheme.expense(for: scheme))
                            .padding(.horizontal, 16)
                    }
                }
            }
        } actions: {
            AuthPrimaryButton(title) {
                Task { await submit() }
            }
            .disabled(!canSubmit)

            if mode != .setup && model.status?.signupAllowed == true {
                AuthTextButton {
                    createsAccount.toggle()
                } label: {
                    Text(createsAccount ? "Sign in instead" : "Create account")
                }
            }
        }
        .onAppear {
            server = model.baseURLString
        }
        // The server may have finished setup since its status was last read.
        .task {
            if model.status == nil {
                await checkStatus()
            } else {
                await model.refreshStatus()
            }
        }
    }

    private var trimmedSetupToken: String {
        setupToken.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // A new address replaces the old server's session state, so it applies on submit only.
    private func connect() async {
        let address = server.trimmingCharacters(in: .whitespacesAndNewlines)
        if address != model.baseURLString {
            model.baseURLString = address
        }
        await checkStatus()
    }

    private func checkStatus() async {
        statusCheckFailed = false
        await model.testConnection()
        statusCheckFailed = model.status == nil
    }

    private func submit() async {
        if server.trimmingCharacters(in: .whitespacesAndNewlines) != model.baseURLString {
            await connect()
            guard model.status != nil else {
                return
            }
        }
        let name = username.trimmingCharacters(in: .whitespaces)
        let device = UIDevice.current.name
        switch mode {
        case .signIn:
            await model.login(username: name, password: password, deviceName: device)
        case .createAccount:
            await model.signup(username: name, password: password, deviceName: device)
        case .setup:
            await model.setup(username: name, password: password, deviceName: device, setupToken: trimmedSetupToken)
        }
    }
}
