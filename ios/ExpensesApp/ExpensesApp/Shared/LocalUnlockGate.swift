import LocalAuthentication
import SwiftUI
import UIKit

struct LocalUnlockGate<Content: View>: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var unlockState: LocalUnlockState = .locked
    @State private var lastProtectedAt: Date?
    @State private var coversProtectedContent = false
    @State private var coverWindow = PrivacyCoverWindow()

    let model: AppModel
    @ViewBuilder var content: () -> Content

    private let unlockGraceInterval: TimeInterval = 20

    var body: some View {
        Group {
            if requiresLocalUnlock {
                lockView(state: unlockState)
            } else {
                content()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            handleScenePhaseChange(phase)
        }
        .onChange(of: coversProtectedContent) { _, covering in
            coverWindow.update(visible: covering) {
                lockView(state: isUnlocked ? .locked : unlockState)
            }
        }
        .onChange(of: model.identity?.authenticated == true) { _, authenticated in
            if authenticated, scenePhase == .active, lastProtectedAt == nil {
                unlockState = .unlocked
            }
        }
        .task(id: unlockTaskID) {
            if requiresLocalUnlock, scenePhase == .active {
                await unlock()
            }
        }
    }

    private func lockView(state: LocalUnlockState) -> some View {
        LocalUnlockView(
            state: state,
            biometricLabel: biometricLabel,
            biometricSystemImage: biometricSystemImage,
            retry: {
                Task { await unlock() }
            }
        )
    }

    private var unlockTaskID: String {
        "\(scenePhase)-\(requiresLocalUnlock)-\(model.hasStoredToken)"
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

    private var didExceedReturnGrace: Bool {
        guard scenePhase == .active, let lastProtectedAt else {
            return false
        }
        return Date().timeIntervalSince(lastProtectedAt) >= unlockGraceInterval
    }

    private var requiresLocalUnlock: Bool {
        model.hasStoredToken
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
            return "device authentication"
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
        guard model.hasStoredToken, !skipsLocalUnlockForSimulator else {
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
            }
        @unknown default:
            break
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
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            unlockState = .unavailable(error?.localizedDescription ?? "Device authentication is unavailable.")
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
    case failed(String)
    case unavailable(String)
}

private struct LocalUnlockView: View {
    let state: LocalUnlockState
    let biometricLabel: String
    let biometricSystemImage: String
    var retry: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Spacer()

            Image(systemName: iconName)
                .font(.system(size: 46, weight: .semibold))
                .foregroundStyle(iconColor)
                .symbolEffect(.pulse, options: .repeating, value: isAuthenticating)

            VStack(spacing: 8) {
                Text(title)
                    .font(.title2.weight(.semibold))
                Text(message)
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 28)

            if isAuthenticating {
                ProgressView()
                    .controlSize(.regular)
            } else {
                Button(action: primaryAction) {
                    Label(buttonTitle, systemImage: buttonSystemImage)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }

            if let detail {
                Text(detail)
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(detailColor)
                    .padding(.horizontal, 28)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ExpensesBackground())
        .animation(.easeInOut(duration: 0.18), value: state)
    }

    private var isAuthenticating: Bool {
        state == .authenticating
    }

    private var iconName: String {
        switch state {
        case .unavailable:
            "exclamationmark.lock"
        case .failed:
            "lock.trianglebadge.exclamationmark"
        default:
            biometricSystemImage
        }
    }

    private var iconColor: Color {
        switch state {
        case .failed, .unavailable:
            .red
        default:
            .accentColor
        }
    }

    private var title: String {
        switch state {
        case .authenticating:
            "Unlocking Expenses"
        case .failed:
            "Try Again"
        case .unavailable:
            "Unlock Unavailable"
        case .locked, .unlocked:
            "Unlock Expenses"
        }
    }

    private var message: String {
        switch state {
        case .authenticating:
            "Complete \(biometricLabel) or enter your device passcode."
        case .failed:
            "Expenses is still locked. Try \(biometricLabel) again or use your device passcode."
        case .unavailable:
            "Device authentication must be available before the saved mobile session can be used."
        case .locked, .unlocked:
            "Use \(biometricLabel) or your device passcode to access the saved mobile session."
        }
    }

    private var buttonTitle: String {
        switch state {
        case .failed:
            "Try Again"
        case .unavailable:
            "Check Settings"
        default:
            "Unlock"
        }
    }

    private var buttonSystemImage: String {
        if case .unavailable = state {
            "gearshape"
        } else {
            biometricSystemImage
        }
    }

    private func primaryAction() {
        if case .unavailable = state, let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        } else {
            retry()
        }
    }

    private var detail: String? {
        switch state {
        case .failed(let message), .unavailable(let message):
            message
        default:
            nil
        }
    }

    private var detailColor: Color {
        switch state {
        case .failed, .unavailable:
            .red
        default:
            .secondary
        }
    }
}

#Preview("Unlock Ready") {
    LocalUnlockView(state: .locked, biometricLabel: "Face ID", biometricSystemImage: "faceid") {}
}

#Preview("Unlocking") {
    LocalUnlockView(state: .authenticating, biometricLabel: "Face ID", biometricSystemImage: "faceid") {}
}

#Preview("Unlock Failed") {
    LocalUnlockView(state: .failed("Authentication was canceled."), biometricLabel: "Face ID", biometricSystemImage: "faceid") {}
}

#Preview("Unlock Unavailable") {
    LocalUnlockView(state: .unavailable("Face ID is not enrolled."), biometricLabel: "Face ID", biometricSystemImage: "faceid") {}
}
