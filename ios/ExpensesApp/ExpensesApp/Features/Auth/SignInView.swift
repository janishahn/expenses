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
            && !(mode == .setup && model.status?.setupTokenRequired == true && setupToken.isEmpty)
            && !model.isLoading
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Server address", text: $server)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit { Task { await connect() } }
                    if model.status == nil {
                        if model.isLoading {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            HStack {
                                Text("Can't reach this server")
                                    .foregroundStyle(ExpensesTheme.expense(for: scheme))
                                Spacer()
                                Button("Retry") {
                                    Task { await connect() }
                                }
                            }
                        }
                    }
                }
                .expensesRowBackground()

                Section {
                    TextField("Username", text: $username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(mode == .signIn ? .password : .newPassword)
                        .submitLabel(.go)
                        .onSubmit {
                            if canSubmit {
                                Task { await submit() }
                            }
                        }
                    if mode == .setup && model.status?.setupTokenRequired == true {
                        SecureField("Setup token", text: $setupToken)
                            .textContentType(.oneTimeCode)
                    }
                    if model.status != nil, let error = model.lastError {
                        Text(error.message)
                            .foregroundStyle(ExpensesTheme.expense(for: scheme))
                    }
                }
                .expensesRowBackground()

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        Text(title)
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(!canSubmit)

                    if mode != .setup && model.status?.signupAllowed == true {
                        Button(createsAccount ? "Sign in instead" : "Create account") {
                            createsAccount.toggle()
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets())
            }
            .navigationTitle(title)
            .expensesScreenStyle()
        }
        .onAppear {
            server = model.baseURLString
        }
    }

    // A new address replaces the old server's session state, so it applies on submit only.
    private func connect() async {
        let address = server.trimmingCharacters(in: .whitespacesAndNewlines)
        if address != model.baseURLString {
            model.baseURLString = address
        }
        await model.testConnection()
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
            await model.setup(username: name, password: password, deviceName: device, setupToken: setupToken)
        }
    }
}
