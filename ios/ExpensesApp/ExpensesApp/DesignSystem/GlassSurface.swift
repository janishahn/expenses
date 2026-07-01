import SwiftUI
import UIKit

enum ExpensesTheme {
    static func accent(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.95, green: 0.69, blue: 0.32) : Color(red: 0.08, green: 0.55, blue: 0.63)
    }

    static func income(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.44, green: 0.78, blue: 0.58) : Color(red: 0.12, green: 0.55, blue: 0.34)
    }

    static func expense(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.88, green: 0.42, blue: 0.36) : Color(red: 0.76, green: 0.28, blue: 0.23)
    }

    static func surface(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(white: 0.085) : Color(uiColor: .secondarySystemGroupedBackground)
    }

    static func background(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(white: 0.005) : Color(uiColor: .systemGroupedBackground)
    }
}

extension View {
    /// Applies the app's theme accent as the tint using the current color scheme.
    /// Sheets don't inherit the root tint, so menu-style pickers inside a presented
    /// sheet otherwise fall back to the light accent regardless of appearance.
    func themeAccentTint() -> some View {
        modifier(ThemeAccentTint())
    }
}

private struct ThemeAccentTint: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.tint(ExpensesTheme.accent(for: scheme))
    }
}

struct ExpensesBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack(alignment: .top) {
            ExpensesTheme.background(for: scheme)
            LinearGradient(
                colors: [
                    ExpensesTheme.accent(for: scheme).opacity(scheme == .dark ? 0.045 : 0.06),
                    ExpensesTheme.background(for: scheme).opacity(0)
                ],
                startPoint: .topTrailing,
                endPoint: .bottom
            )
            .frame(height: 190)
            .ignoresSafeArea(edges: .top)
            RadialGradient(
                colors: [
                    Color.white.opacity(scheme == .dark ? 0.055 : 0.18),
                    Color.clear
                ],
                center: .topLeading,
                startRadius: 8,
                endRadius: 260
            )
            .frame(height: 220)
                .ignoresSafeArea(edges: .top)
        }
        .ignoresSafeArea()
    }
}

struct ExpensesScreenStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .contentMargins(.top, 8, for: .scrollContent)
            .contentMargins(.bottom, 96, for: .scrollContent)
            .listSectionSpacing(16)
            .background(ExpensesBackground())
    }
}

extension View {
    func expensesScreenStyle() -> some View {
        modifier(ExpensesScreenStyle())
    }
}

struct GlassSurface<Content: View>: View {
    @Environment(\.colorScheme) private var scheme

    var padding: CGFloat
    var content: Content

    init(padding: CGFloat = 18, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(ExpensesTheme.surface(for: scheme).opacity(scheme == .dark ? 0.82 : 0.74))
                    .shadow(color: .black.opacity(scheme == .dark ? 0.18 : 0.05), radius: 14, y: 8)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(.white.opacity(scheme == .dark ? 0.08 : 0.38), lineWidth: 0.75)
            }
            .glassEffect(.regular.tint(ExpensesTheme.accent(for: scheme).opacity(scheme == .dark ? 0.025 : 0.035)), in: .rect(cornerRadius: 18))
    }
}

struct UnavailableStateSection: View {
    let title: String
    let systemImage: String
    let message: String

    var body: some View {
        Section {
            GlassSurface {
                VStack(alignment: .leading, spacing: 14) {
                    Image(systemName: systemImage)
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 44, height: 44)
                        .background(.thinMaterial, in: Circle())

                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(.title3.weight(.semibold))
                        Text(message)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .listRowBackground(Color.clear)
    }
}

struct SignedOutStateSection: View {
    var body: some View {
        UnavailableStateSection(
            title: "Sign in required",
            systemImage: "lock",
            message: "Use Account to connect to your tracker."
        )
    }
}

struct LoadingStateSection: View {
    let title: String
    @State private var visible = false

    var body: some View {
        Section {
            GlassSurface {
                HStack(spacing: 14) {
                    ProgressView()
                    Text(title)
                        .font(.callout.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 72, alignment: .center)
            }
            .opacity(visible ? 1 : 0)
            .blur(radius: visible ? 0 : 3)
            .scaleEffect(visible ? 1 : 0.985)
            .onAppear {
                withAnimation(.easeOut(duration: 0.18)) {
                    visible = true
                }
            }
            .onDisappear {
                visible = false
            }
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
        .listRowBackground(Color.clear)
        .transition(.opacity.combined(with: .scale(scale: 0.985)))
    }
}

struct MetricPill: View {
    @Environment(\.colorScheme) private var scheme

    let title: String
    let value: String
    var systemImage: String
    var color: Color?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(color ?? ExpensesTheme.accent(for: scheme))
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.headline.monospacedDigit())
            }

            Spacer(minLength: 0)
        }
    }
}
