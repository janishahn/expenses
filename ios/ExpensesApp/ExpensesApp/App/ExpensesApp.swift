import SwiftUI

@main
struct ExpensesApp: App {
    @State private var model = AppModel()

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
