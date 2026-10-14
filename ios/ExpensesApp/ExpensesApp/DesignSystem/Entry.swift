import SwiftUI

/// Places chips left to right and wraps to a new row when one is full.
struct ChipFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(for: subviews, width: proposal.width ?? .infinity)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(for: subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    // A chip wider than the row gets the whole row and truncates.
    private func rows(for subviews: Subviews, width: CGFloat) -> [(indices: [Int], width: CGFloat, height: CGFloat)] {
        var rows: [(indices: [Int], width: CGFloat, height: CGFloat)] = []
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil))
            if let last = rows.last, last.width + spacing + size.width <= width {
                rows[rows.count - 1].indices.append(index)
                rows[rows.count - 1].width += spacing + size.width
                rows[rows.count - 1].height = max(last.height, size.height)
            } else {
                rows.append(([index], size.width, size.height))
            }
        }
        return rows
    }
}

/// A capsule in the add sheet's chip row. A set chip has a light ink fill; an unset
/// one is outlined.
struct EntryChip<Leading: View>: View {
    @Environment(\.colorScheme) private var scheme

    let title: String
    let isSet: Bool
    let leading: Leading

    init(_ title: String, isSet: Bool, @ViewBuilder leading: () -> Leading) {
        self.title = title
        self.isSet = isSet
        self.leading = leading()
    }

    var body: some View {
        HStack(spacing: 6) {
            leading
                .foregroundStyle(.secondary)
            Text(title)
                .lineLimit(1)
        }
        .font(.subheadline)
        .foregroundStyle(.primary)
        .padding(.horizontal, 12)
        .frame(minHeight: 34)
        .background(
            isSet ? Color.primary.opacity(scheme == .dark ? 0.08 : 0.07) : ExpensesTheme.surface(for: scheme),
            in: .capsule
        )
        .overlay {
            Capsule()
                .strokeBorder(Color.primary.opacity(isSet ? 0 : 0.14), lineWidth: 1)
        }
        .contentShape(.capsule)
    }
}

extension EntryChip where Leading == Image {
    init(_ title: String, systemImage: String, isSet: Bool) {
        self.init(title, isSet: isSet) {
            Image(systemName: systemImage)
        }
    }
}

/// An amount typed in large figures, green for income.
struct EntryAmountField: View {
    @Environment(\.colorScheme) private var scheme

    @Binding var text: String
    let income: Bool

    var body: some View {
        TextField("Amount", text: $text, prompt: Text(AppFormatters.euros(0)))
            .font(.system(size: 34, weight: .semibold))
            .monospacedDigit()
            .keyboardType(.decimalPad)
            .foregroundStyle(income ? ExpensesTheme.income(for: scheme) : .primary)
    }
}

/// Why a field's value was not accepted or did not save.
struct FieldError: View {
    @Environment(\.colorScheme) private var scheme

    let message: String

    init(_ message: String) {
        self.message = message
    }

    var body: some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(ExpensesTheme.expense(for: scheme))
    }
}

extension View {
    /// Shows `message` under the view when there is one.
    func fieldError(_ message: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            self
            if let message {
                FieldError(message)
            }
        }
    }
}
