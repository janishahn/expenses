import SwiftUI

@main
struct ExpensesApp: App {
    @State private var model = AppModel()

    init() {
        // The web switch's knob is the sheet color; a white one vanishes on the light dark-mode ink.
        UISwitch.appearance().thumbTintColor = UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(red: 0x1F / 255, green: 0x1D / 255, blue: 0x1A / 255, alpha: 1) : .white
        }
    }

    var body: some Scene {
        WindowGroup {
            LocalUnlockGate(model: model) {
                RootView()
                    .environment(model)
            }
            .protectSensitiveSnapshots()
        }
    }
}
