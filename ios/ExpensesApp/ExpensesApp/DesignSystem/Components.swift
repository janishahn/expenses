import SwiftUI

/// A euro amount that follows privacy mode. While amounts are hidden it shows a blurred
/// fixed placeholder, so neither the digits nor the length of the real amount show.
struct AmountText: View {
    @Environment(AppModel.self) private var model

    private let text: String
    private let placeholder: String

    /// `signed` puts + or − in front, as for changes and nets.
    init(_ cents: Int, decimals: Bool = true, signed: Bool = false) {
        text = signed ? AppFormatters.signedEuros(cents, decimals: decimals) : AppFormatters.euros(cents, decimals: decimals)
        placeholder = AppFormatters.euros(888_888, decimals: decimals)
    }

    init(_ cents: Int, currencyCode: String) {
        text = AppFormatters.amount(cents, currencyCode: currencyCode)
        placeholder = AppFormatters.amount(888_888, currencyCode: currencyCode)
    }

    var body: some View {
        Group {
            if model.amountsHidden {
                Text(placeholder)
                    .textRenderer(BlurredText())
                    .accessibilityLabel("Hidden amount")
            } else {
                Text(text)
            }
        }
        .monospacedDigit()
        .transition(.blurReplace)
    }
}

extension AppModel {
    /// An amount for accessibility values and other plain strings, hidden in privacy mode.
    func amountString(_ cents: Int, decimals: Bool = true) -> String {
        amountsHidden ? "Hidden amount" : AppFormatters.euros(cents, decimals: decimals)
    }
}

// Blurs by a share of the line height, so large and small amounts look equally soft.
private struct BlurredText: TextRenderer {
    var displayPadding: EdgeInsets {
        EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12)
    }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            var lineContext = context
            lineContext.addFilter(.blur(radius: line.typographicBounds.rect.height * 0.26))
            lineContext.draw(line)
        }
    }
}

/// A section header that opens the full screen for its content.
struct SectionLink: View {
    let title: String
    let destination: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title)
                Spacer()
                Image(systemName: "chevron.forward")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .tint(.primary)
        .accessibilityHint("Opens \(destination)")
    }
}

/// Spent against a budget, with a tick at even pace through the period when it is
/// under way.
struct BudgetBar: View {
    @Environment(\.colorScheme) private var scheme

    let spentCents: Int
    let budgetCents: Int
    let pace: Double?

    private var ratio: Double {
        if budgetCents > 0 {
            return Double(spentCents) / Double(budgetCents)
        }
        return spentCents > 0 ? 1 : 0
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.08))
                Capsule()
                    .fill(spentCents > budgetCents ? ExpensesTheme.expense(for: scheme) : Color.primary.opacity(0.55))
                    .frame(width: geometry.size.width * min(max(ratio, 0), 1))
                if let pace {
                    Rectangle()
                        .fill(Color.primary)
                        .frame(width: 1.5, height: 11)
                        .offset(x: geometry.size.width * pace - 0.75)
                }
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

/// A transaction as one ledger line: category glyph, title, and amount. Income is
/// green with a plus; an expense is ink with no sign.
struct LedgerRow: View {
    @Environment(\.colorScheme) private var scheme

    let title: String
    let detail: String?
    let categoryID: Int?
    let iconKey: String?
    let categoryName: String?
    let amountCents: Int
    let income: Bool

    init(transaction: TransactionListItem, category: CategorySummary?) {
        self.init(
            title: transaction.title ?? category?.name ?? "Untitled",
            categoryID: category?.id,
            iconKey: category?.icon,
            categoryName: category?.name,
            amountCents: transaction.amountCents,
            income: transaction.type == "income"
        )
    }

    /// `detail` is a second line, such as when a deleted transaction went to Trash.
    init(
        title: String,
        detail: String? = nil,
        categoryID: Int?,
        iconKey: String?,
        categoryName: String?,
        amountCents: Int,
        income: Bool
    ) {
        self.title = title
        self.detail = detail
        self.categoryID = categoryID
        self.iconKey = iconKey
        self.categoryName = categoryName
        self.amountCents = amountCents
        self.income = income
    }

    var body: some View {
        HStack(spacing: 12) {
            CategoryGlyph(categoryID: categoryID, iconKey: iconKey, name: categoryName)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .lineLimit(1)
                if let detail {
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            AmountText(amountCents, signed: income)
                .foregroundStyle(income ? ExpensesTheme.income(for: scheme) : .primary)
        }
        .contentShape(Rectangle())
    }
}

extension View {
    /// An alert for an action that failed, with the server's message.
    func failureAlert(_ title: String, message: Binding<String?>) -> some View {
        alert(
            title,
            isPresented: Binding(
                get: { message.wrappedValue != nil },
                set: { presented in
                    if !presented {
                        message.wrappedValue = nil
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message.wrappedValue ?? "")
        }
    }
}

/// A one-line state inside a chart or card: loading, unavailable, or empty.
struct ChartMessage: View {
    let text: String

    var body: some View {
        Text(text)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 120)
    }
}

/// "2026-10" → the locale's short month name.
func shortMonth(_ month: String) -> String {
    Calendar.current.shortStandaloneMonthSymbols[Int(month.suffix(2))! - 1]
}

/// A screen's first load. The spinner waits 250 ms, so fast loads don't flash.
struct LoadingStateSection: View {
    let title: String
    @State private var visible = false

    var body: some View {
        Section {
            ProgressView()
                .frame(maxWidth: .infinity, minHeight: 160)
                .opacity(visible ? 1 : 0)
                .accessibilityLabel(title)
                .task {
                    try? await Task.sleep(for: .milliseconds(250))
                    visible = true
                }
        }
        .listRowBackground(Color.clear)
    }
}

/// A screen that could not load, or has nothing to show.
struct UnavailableStateSection: View {
    let title: String
    let systemImage: String
    var message: String?

    var body: some View {
        Section {
            ContentUnavailableView {
                Label(title, systemImage: systemImage)
            } description: {
                if let message {
                    Text(message)
                }
            }
        }
        .listRowBackground(Color.clear)
    }
}

struct TagExclusionSection: View {
    let tags: [TransactionTag]
    @Binding var selectedIDs: Set<Int>
    var includedTagID: Int?

    var body: some View {
        Section("Exclude tags") {
            if tags.isEmpty {
                Text("No tags")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(tags) { tag in
                    Button {
                        if selectedIDs.contains(tag.id) {
                            selectedIDs.remove(tag.id)
                        } else {
                            selectedIDs.insert(tag.id)
                        }
                    } label: {
                        HStack {
                            Text(tag.name)
                                .foregroundStyle(tag.id == includedTagID ? .secondary : .primary)
                            Spacer()
                            if tag.id == includedTagID {
                                Text("Included")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else if selectedIDs.contains(tag.id) {
                                Image(systemName: "checkmark")
                                    .fontWeight(.semibold)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(tag.id == includedTagID)
                    .accessibilityValue(selectedIDs.contains(tag.id) ? "Excluded" : "Included")
                }
            }
        }
        .expensesRowBackground()
    }
}
