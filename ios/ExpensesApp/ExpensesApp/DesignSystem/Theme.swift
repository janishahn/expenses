import SwiftUI
import UIKit

// Colors from the web design tokens (DESIGN.md), so both apps read as one product.
enum ExpensesTheme {
    static func accent(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(rgb: 0xEEEBE6) : Color(rgb: 0x1C1C1A)
    }

    static func income(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(rgb: 0x4CC38A) : Color(rgb: 0x18704A)
    }

    static func expense(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(rgb: 0xF07A63) : Color(rgb: 0xB83A26)
    }

    static func surface(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(rgb: 0x1F1D1A) : Color(rgb: 0xFFFFFF)
    }

    static func background(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(rgb: 0x181715) : Color(rgb: 0xF5F5F3)
    }

    // The web's categoryColor: eight hues by category id, gray for uncategorized.
    static func category(_ id: Int?, for scheme: ColorScheme) -> Color {
        guard let id else {
            return scheme == .dark ? Color(rgb: 0x77776F) : Color(rgb: 0x86867F)
        }
        let palette: [UInt32] = scheme == .dark
            ? [0x7B86E8, 0x45B882, 0xEC8A57, 0xD872A6, 0x45B5CC, 0xE0BB4A, 0x9A80E6, 0xC99645]
            : [0x5563D1, 0x278A5C, 0xC75F2A, 0xC2508A, 0x21879C, 0xA8801A, 0x7A5BD0, 0x9A6A22]
        return Color(rgb: palette[abs(id) % palette.count])
    }
}

private extension Color {
    init(rgb: UInt32) {
        self.init(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
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
        ExpensesTheme.background(for: scheme)
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

// List rows on the warm sheet color; system cells are a cooler gray in dark mode.
struct ExpensesRowBackground: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.listRowBackground(ExpensesTheme.surface(for: scheme))
    }
}

extension View {
    func expensesScreenStyle() -> some View {
        modifier(ExpensesScreenStyle())
    }

    func expensesRowBackground() -> some View {
        modifier(ExpensesRowBackground())
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

struct SignedOutStateSection: View {
    var body: some View {
        UnavailableStateSection(
            title: "Sign in required",
            systemImage: "lock",
            message: "Use Account to connect to your tracker."
        )
    }
}
