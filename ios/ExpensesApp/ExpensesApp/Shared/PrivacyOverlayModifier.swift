import SwiftUI

struct PrivacyOverlayModifier: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .overlay {
                if scenePhase != .active {
                    ZStack {
                        ExpensesBackground()
                        Image(systemName: "lock.fill")
                            .font(.largeTitle.weight(.medium))
                            .foregroundStyle(.secondary)
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
