import SwiftUI

/// The settings sections, as the web lists them, and Diagnostics for this device.
struct SettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        List {
            Section {
                link("Account", systemImage: "person.crop.circle") { AccountSettingsView() }
                Picker(selection: $model.appearancePreference) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                } label: {
                    Label("Appearance", systemImage: "circle.lefthalf.filled")
                }
                .pickerStyle(.menu)
            }
            .expensesRowBackground()

            Section {
                link("Categorization", systemImage: "square.on.circle") { CategorizationSettingsView() }
                link("AI", systemImage: "sparkles") { AISettingsView() }
                link("Balance Snapshots", systemImage: "scalemass") { BalanceSnapshotsView() }
                link("Import and Export", systemImage: "arrow.up.arrow.down") { ImportExportView() }
            }
            .expensesRowBackground()

            Section {
                link("Diagnostics", systemImage: "stethoscope") { DiagnosticsView() }
            }
            .expensesRowBackground()
        }
        .navigationTitle("Settings")
        .expensesScreenStyle()
    }

    private func link<Destination: View>(
        _ title: String,
        systemImage: String,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        NavigationLink(destination: destination) {
            Label(title, systemImage: systemImage)
        }
        .navigationLinkIndicatorVisibility(.hidden)
    }
}
