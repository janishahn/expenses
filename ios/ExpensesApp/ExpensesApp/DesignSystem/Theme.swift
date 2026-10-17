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

    // Focus ring and checked state; the web's only chrome blue.
    static func focus(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(rgb: 0x7C95FF) : Color(rgb: 0x3B5BDB)
    }

    static func surface(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(rgb: 0x1F1D1A) : Color(rgb: 0xFFFFFF)
    }

    // Recurring spending and within-budget marks: a light ink.
    static func recurring(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(rgb: 0x5B5853) : Color(rgb: 0xC7C7C4)
    }

    // A recessed well inside a sheet, as behind a receipt preview.
    static func day(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(rgb: 0x1B1A17) : Color(rgb: 0xF2F2F0)
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
    /// Tints list selection circles with the focus blue. The circle's check is always
    /// white, so the light dark-mode ink would hide it.
    func checkedTint() -> some View {
        modifier(CheckedTint())
    }
}

private struct CheckedTint: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.tint(ExpensesTheme.focus(for: scheme))
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

    /// The name and amount at the top of a detail screen, on the background and in line
    /// with the cards' edges. The row spans the screen, so the cards' rounded corner
    /// doesn't clip the first letter.
    func detailHeadSection() -> some View {
        listRowBackground(Color.clear)
            .listSectionMargins(.horizontal, 0)
            .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
            .listRowSeparator(.hidden)
            .listSectionSeparator(.hidden)
    }
}
