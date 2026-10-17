import LocalAuthentication
import SwiftUI
import UIKit

struct LocalUnlockGate<Content: View>: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var unlockState: LocalUnlockState = .locked
    @State private var lastProtectedAt: Date?
    @State private var coversProtectedContent = false
    @State private var coverWindow = PrivacyCoverWindow()
    // Once shown, the content stays behind the lock, so unlocking returns to the last
    // screen. A password sign-in starts a new session, so its content starts over.
    @State private var keepsContent = false
    @State private var contentSession = 0

    let model: AppModel
    @ViewBuilder var content: () -> Content

    private let unlockGraceInterval: TimeInterval = 20

    var body: some View {
        ZStack {
            if keepsContent || !requiresLocalUnlock {
                content()
                    .id(contentSession)
                    .opacity(requiresLocalUnlock ? 0 : 1)
                    .allowsHitTesting(!requiresLocalUnlock)
                    .accessibilityHidden(requiresLocalUnlock)
                    .onAppear {
                        keepsContent = true
                    }
            }
            if requiresLocalUnlock {
                LockedSignInView(
                    model: model,
                    biometricLabel: biometricLabel,
                    biometricSystemImage: biometricSystemImage,
                    showsBiometricUnlock: unlockState != .unavailable,
                    isAuthenticating: isAuthenticating,
                    failure: failureMessage,
                    unlockWithBiometrics: {
                        Task { await unlock() }
                    },
                    signedIn: {
                        contentSession += 1
                        unlockState = .unlocked
                        lastProtectedAt = nil
                    }
                )
            }
        }
        .onChange(of: scenePhase) { _, phase in
            handleScenePhaseChange(phase)
        }
        .onChange(of: coversProtectedContent) { _, covering in
            coverWindow.update(visible: covering) {
                LockCover()
            }
        }
        .onChange(of: model.identity?.authenticated == true) { _, authenticated in
            if authenticated, scenePhase == .active, lastProtectedAt == nil {
                unlockState = .unlocked
            }
        }
        .task(id: unlockTaskID) {
            // Face ID starts by itself on a fresh lock, not again after it was canceled.
            if requiresLocalUnlock, scenePhase == .active, unlockState == .locked {
                await unlock()
            }
        }
    }

    private var unlockTaskID: String {
        "\(scenePhase)-\(requiresLocalUnlock)-\(model.hasSession)"
    }

    private var isUnlocked: Bool {
        if case .unlocked = unlockState {
            true
        } else {
            false
        }
    }

    private var isAuthenticating: Bool {
        if case .authenticating = unlockState {
            true
        } else {
            false
        }
    }

    private var failureMessage: String? {
        if case .failed(let message) = unlockState {
            message
        } else {
            nil
        }
    }

    private var didExceedReturnGrace: Bool {
        guard scenePhase == .active, let lastProtectedAt else {
            return false
        }
        return Date().timeIntervalSince(lastProtectedAt) >= unlockGraceInterval
    }

    private var requiresLocalUnlock: Bool {
        model.hasSession
            && !skipsLocalUnlockForSimulator
            && (!isUnlocked || didExceedReturnGrace)
    }

    private var biometricLabel: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
        switch context.biometryType {
        case .faceID:
            return "Face ID"
        case .touchID:
            return "Touch ID"
        case .opticID:
            return "Optic ID"
        default:
            return "Passcode"
        }
    }

    private var biometricSystemImage: String {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
        switch context.biometryType {
        case .faceID:
            return "faceid"
        case .touchID:
            return "touchid"
        default:
            return "lock.shield"
        }
    }

    private func handleScenePhaseChange(_ phase: ScenePhase) {
        guard model.hasSession, !skipsLocalUnlockForSimulator else {
            unlockState = .locked
            lastProtectedAt = nil
            coversProtectedContent = false
            return
        }

        switch phase {
        case .active:
            coversProtectedContent = false
            guard let lastProtectedAt else {
                return
            }
            if Date().timeIntervalSince(lastProtectedAt) >= unlockGraceInterval {
                concealPresentedContent()
                unlockState = .locked
            } else if isUnlocked {
                self.lastProtectedAt = nil
            }
        case .inactive, .background:
            if isUnlocked {
                if lastProtectedAt == nil {
                    lastProtectedAt = Date()
                }
                coversProtectedContent = true
            } else if phase == .background, !isAuthenticating {
                // Opening the app again starts with Face ID again, or offers it once a
                // device passcode was set.
                unlockState = .locked
            }
        @unknown default:
            break
        }
    }

    /// Sheets and alerts would show above the lock screen, and a focused field would
    /// keep its keyboard, so they close before the kept content locks.
    private func concealPresentedContent() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        let root = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?
            .rootViewController
        if root?.presentedViewController != nil {
            root?.dismiss(animated: false)
        }
    }

    private var skipsLocalUnlockForSimulator: Bool {
        #if DEBUG && targetEnvironment(simulator)
            ProcessInfo.processInfo.arguments.contains("--skip-local-unlock")
        #else
            false
        #endif
    }

    private func unlock() async {
        guard !isAuthenticating else {
            return
        }
        unlockState = .authenticating

        let context = LAContext()
        context.localizedCancelTitle = "Cancel"
        // Without a device passcode, only the account password unlocks the app.
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            unlockState = .unavailable
            return
        }

        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Unlock your expenses tracker."
            )
            unlockState = success ? .unlocked : .failed("Authentication failed.")
            if success {
                lastProtectedAt = nil
            }
        } catch let error as LAError where [.userCancel, .systemCancel, .appCancel].contains(error.code) {
            unlockState = .failed(nil)
        } catch {
            unlockState = .failed(error.localizedDescription)
        }
    }
}

@MainActor
private final class PrivacyCoverWindow {
    private var window: UIWindow?

    func update<Cover: View>(visible: Bool, @ViewBuilder content: () -> Cover) {
        guard visible else {
            window?.isHidden = true
            return
        }
        if window == nil {
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first
            else {
                return
            }
            let created = UIWindow(windowScene: scene)
            created.windowLevel = .alert + 1
            created.isUserInteractionEnabled = false
            window = created
        }
        let host = UIHostingController(rootView: content())
        host.view.backgroundColor = .clear
        window?.rootViewController = host
        window?.isHidden = false
    }
}

private enum LocalUnlockState: Equatable {
    case locked
    case authenticating
    case unlocked
    // Canceled, with no message, or failed; the sign-in screen waits for the person.
    case failed(String?)
    case unavailable
}

/// The locked app's sign-in screen: the account password, or Face ID again.
private struct LockedSignInView: View {
    @Environment(\.colorScheme) private var scheme
    @State private var username = ""
    @State private var password = ""
    @State private var signInError: String?
    @FocusState private var focusedField: Field?

    private enum Field {
        case username
        case password
    }

    let model: AppModel
    let biometricLabel: String
    let biometricSystemImage: String
    let showsBiometricUnlock: Bool
    let isAuthenticating: Bool
    let failure: String?
    var unlockWithBiometrics: () -> Void
    var signedIn: () -> Void

    private var canSubmit: Bool {
        !username.trimmingCharacters(in: .whitespaces).isEmpty
            && !password.isEmpty
            && !model.isLoading
            && !isAuthenticating
    }

    var body: some View {
        AuthScreen {
            VStack(spacing: 12) {
                Image(systemName: "lock.fill")
                    .font(.largeTitle.weight(.medium))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text("Unlock Expenses")
                    .font(.title.bold())
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.isHeader)
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
                        .textContentType(.password)
                        .submitLabel(.go)
                        .onSubmit {
                            if canSubmit {
                                Task { await signIn() }
                            }
                        }
                        .authFieldRow(.password, focus: $focusedField)
                }

                if let message = signInError ?? failure {
                    Text(message)
                        .foregroundStyle(ExpensesTheme.expense(for: scheme))
                        .padding(.horizontal, 16)
                }
            }
        } actions: {
            AuthPrimaryButton("Sign in") {
                Task { await signIn() }
            }
            .disabled(!canSubmit)

            if showsBiometricUnlock {
                AuthTextButton(action: unlockWithBiometrics) {
                    Label("Unlock with \(biometricLabel)", systemImage: biometricSystemImage)
                }
                .disabled(isAuthenticating || model.isLoading)
            }
        }
        .onAppear {
            username = model.sessionUsername ?? ""
        }
    }

    private func signIn() async {
        signInError = nil
        await model.login(
            username: username.trimmingCharacters(in: .whitespaces),
            password: password,
            deviceName: UIDevice.current.name
        )
        if let error = model.lastError {
            signInError = error.message
        } else {
            signedIn()
        }
    }
}

/// Covers the app in the app switcher.
private struct LockCover: View {
    var body: some View {
        Image(systemName: "lock.fill")
            .font(.largeTitle.weight(.medium))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(ExpensesBackground())
    }
}

#Preview("Locked") {
    LockedSignInView(
        model: AppModel(),
        biometricLabel: "Face ID",
        biometricSystemImage: "faceid",
        showsBiometricUnlock: true,
        isAuthenticating: false,
        failure: nil,
        unlockWithBiometrics: {},
        signedIn: {}
    )
}
