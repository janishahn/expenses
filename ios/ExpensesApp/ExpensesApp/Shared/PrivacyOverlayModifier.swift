import SwiftUI

struct PrivacyOverlayModifier: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .overlay {
                if scenePhase != .active {
                    ZStack {
                        Rectangle()
                            .fill(.regularMaterial)
                            .ignoresSafeArea()
                        VStack(spacing: 12) {
                            Image(systemName: "lock.shield")
                                .font(.system(size: 42))
                            Text("Expenses")
                                .font(.title2.bold())
                        }
                    }
                }
            }
    }
}

extension View {
    func protectSensitiveSnapshots() -> some View {
        modifier(PrivacyOverlayModifier())
    }
}
