import Charts
import SwiftUI

/// One category's part of a total, with its share already worded.
struct CategoryShare: Identifiable {
    let id: String
    let categoryID: Int?
    let name: String
    let cents: Int
    let share: String
}

/// Category shares as a donut, with the five largest named beside it.
struct CategoryShareDonut<Center: View>: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme

    let slices: [CategoryShare]
    @ViewBuilder let center: Center

    var body: some View {
        HStack(spacing: 18) {
            Chart(slices) { slice in
                SectorMark(angle: .value("Amount", slice.cents), innerRadius: .ratio(0.64), angularInset: 1)
                    .foregroundStyle(ExpensesTheme.category(slice.categoryID, for: scheme))
                    .accessibilityLabel(slice.name)
                    .accessibilityValue(model.amountString(slice.cents))
            }
            .chartLegend(.hidden)
            .frame(width: 112, height: 112)
            .overlay {
                center
            }

            VStack(alignment: .leading, spacing: 5) {
                ForEach(slices.prefix(5)) { slice in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(ExpensesTheme.category(slice.categoryID, for: scheme))
                            .frame(width: 8, height: 8)
                        Text(slice.name)
                            .lineLimit(1)
                        Spacer()
                        Text(slice.share)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                }
                if slices.count > 5 {
                    Text("\(slices.count - 5) more")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 6)
    }
}

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

    init(_ cents: Int, currencyCode: String, signed: Bool = false) {
        text = signed
            ? AppFormatters.sign(cents) + AppFormatters.amount(abs(cents), currencyCode: currencyCode)
            : AppFormatters.amount(cents, currencyCode: currencyCode)
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
        .buttonStyle(.plain)
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

/// A budget in a summary list: its scope, what is left or over, and the bar.
struct BudgetPulseRow: View {
    @Environment(\.colorScheme) private var scheme

    let categoryID: Int?
    let iconKey: String?
    let label: String
    let spentCents: Int
    let budgetCents: Int
    let pace: Double?

    var body: some View {
        let remaining = budgetCents - spentCents
        HStack(spacing: 12) {
            ScopeGlyph(categoryID: categoryID, iconKey: iconKey, name: label)
            VStack(spacing: 8) {
                HStack {
                    Text(label)
                        .lineLimit(1)
                    Spacer()
                    HStack(spacing: 4) {
                        AmountText(abs(remaining), decimals: false)
                            .foregroundStyle(remaining < 0 ? ExpensesTheme.expense(for: scheme) : .secondary)
                        Text(remaining < 0 ? "over" : "left")
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                BudgetBar(spentCents: spentCents, budgetCents: budgetCents, pace: pace)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
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

/// A figure in a screen's summary: its label, the value, and an optional detail line.
struct Metric<Value: View, Detail: View>: View {
    let label: String
    let value: Value
    let detail: Detail

    init(_ label: String, @ViewBuilder value: () -> Value, @ViewBuilder detail: () -> Detail) {
        self.label = label
        self.value = value()
        self.detail = detail()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(.secondary)
            value
                .font(.title3.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            detail
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        // A grid row sizes before a detail wraps; without this the detail truncates
        // and the value shrinks.
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The values at a chart's chosen point, floating over the chart.
struct ChartTooltip<Rows: View>: View {
    @Environment(\.colorScheme) private var scheme

    let title: String
    @ViewBuilder let rows: Rows

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .fontWeight(.semibold)
            rows
        }
        .font(.footnote)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .fixedSize()
        .background(ExpensesTheme.surface(for: scheme), in: .rect(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.primary.opacity(0.08))
        }
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    }
}

struct TooltipRow<Value: View>: View {
    let label: String
    let color: Color?
    @ViewBuilder let value: Value

    var body: some View {
        HStack(spacing: 6) {
            if let color {
                Circle()
                    .fill(color)
                    .frame(width: 7, height: 7)
            }
            Text(label)
                .foregroundStyle(.secondary)
            Spacer(minLength: 16)
            value
        }
    }
}

struct ChartLegendItem: View {
    enum Mark {
        case line
        case dash
        case area
    }

    let title: String
    let color: Color
    let mark: Mark

    var body: some View {
        HStack(spacing: 6) {
            switch mark {
            case .line:
                Capsule()
                    .fill(color)
                    .frame(width: 14, height: 2)
            case .dash:
                Path { path in
                    path.move(to: CGPoint(x: 0, y: 1))
                    path.addLine(to: CGPoint(x: 14, y: 1))
                }
                .stroke(color, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                .frame(width: 14, height: 2)
            case .area:
                RoundedRectangle(cornerRadius: 2)
                    .fill(color)
                    .frame(width: 10, height: 10)
            }
            Text(title)
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
    }
}

/// "25 %": a share as a whole percent in the device's format.
func percent(_ part: Int, of whole: Int) -> String {
    (Double(part) / Double(whole)).formatted(.percent.precision(.fractionLength(0)))
}
