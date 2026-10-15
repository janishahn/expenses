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
    @Environment(\.dynamicTypeSize) private var typeSize
    // The total in the middle grows with the text, so the ring does too.
    @ScaledMetric(relativeTo: .footnote) private var diameter = 112.0

    let slices: [CategoryShare]
    @ViewBuilder let center: Center

    var body: some View {
        // At accessibility sizes the names go under the ring.
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 18))
            : AnyLayout(HStackLayout(spacing: 18))
        layout {
            Chart(slices) { slice in
                SectorMark(angle: .value("Amount", slice.cents), innerRadius: .ratio(0.64), angularInset: 1)
                    .foregroundStyle(ExpensesTheme.category(slice.categoryID, for: scheme))
                    .accessibilityLabel(slice.name)
                    .accessibilityValue(model.amountString(slice.cents))
            }
            .chartLegend(.hidden)
            .frame(width: diameter, height: diameter)
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
/// An amount never wraps, truncates or shrinks; a row that cannot fit it stacks instead.
struct AmountText: View {
    @Environment(AppModel.self) private var model

    private let text: String
    private let decimals: Bool
    private let currencyCode: String?

    /// `signed` puts + or − in front, as for changes and nets.
    init(_ cents: Int, decimals: Bool = true, signed: Bool = false) {
        text = signed ? AppFormatters.signedEuros(cents, decimals: decimals) : AppFormatters.euros(cents, decimals: decimals)
        self.decimals = decimals
        currencyCode = nil
    }

    init(_ cents: Int, currencyCode: String, signed: Bool = false) {
        text = signed
            ? AppFormatters.sign(cents) + AppFormatters.amount(abs(cents), currencyCode: currencyCode)
            : AppFormatters.amount(cents, currencyCode: currencyCode)
        decimals = true
        self.currencyCode = currencyCode
    }

    var body: some View {
        Group {
            if model.amountsHidden {
                Text(currencyCode.map { AppFormatters.amount(888_888, currencyCode: $0) } ?? AppFormatters.euros(888_888, decimals: decimals))
                    .textRenderer(BlurredText())
                    .accessibilityLabel("Hidden amount")
            } else {
                Text(text)
            }
        }
        .monospacedDigit()
        .fixedSize()
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

/// A label with its figures on one line, or stacked when the line doesn't fit, as at
/// large text sizes.
struct AdaptiveRow<Leading: View, Trailing: View>: View {
    var alignment = VerticalAlignment.center
    @ViewBuilder let leading: Leading
    @ViewBuilder let trailing: Trailing

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: alignment, spacing: 8) {
                leading
                Spacer(minLength: 0)
                // This line is only used when the figures fit whole, so a word between
                // them, as in "72 € of 800 €", must not give way to the label.
                trailing
                    .fixedSize()
            }
            VStack(alignment: .leading, spacing: 2) {
                leading
                trailing
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A list row: an optional glyph, text, and an amount or control at the trailing edge.
/// At accessibility sizes the trailing part moves under the text, the text wraps instead
/// of truncating, and the glyph stays beside the first line, as in `LedgerRow`.
struct TrailingRow<Glyph: View, Content: View, Trailing: View>: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    private let glyph: Glyph
    private let content: Content
    private let trailing: Trailing

    init(@ViewBuilder glyph: () -> Glyph, @ViewBuilder content: () -> Content, @ViewBuilder trailing: () -> Trailing) {
        self.glyph = glyph()
        self.content = content()
        self.trailing = trailing()
    }

    var body: some View {
        let stacked = typeSize.isAccessibilitySize
        HStack(alignment: stacked ? .firstTextBaseline : .center, spacing: 12) {
            glyph
            if stacked {
                VStack(alignment: .leading, spacing: 2) {
                    content
                        .lineLimit(3)
                    trailing
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                content
                    .lineLimit(1)
                Spacer(minLength: 8)
                trailing
            }
        }
    }
}

extension TrailingRow where Glyph == EmptyView {
    init(@ViewBuilder content: () -> Content, @ViewBuilder trailing: () -> Trailing) {
        self.init(glyph: { EmptyView() }, content: content, trailing: trailing)
    }
}

/// Holds a row's leading symbol in a column that grows with the text size, so titles
/// line up and a large symbol does not run into its title.
private struct GlyphColumn: ViewModifier {
    @ScaledMetric private var width: CGFloat

    init(width: CGFloat, relativeTo style: Font.TextStyle) {
        _width = ScaledMetric(wrappedValue: width, relativeTo: style)
    }

    func body(content: Content) -> some View {
        content.frame(width: width)
    }
}

extension View {
    func glyphColumn(_ width: CGFloat = 26, relativeTo style: Font.TextStyle = .callout) -> some View {
        modifier(GlyphColumn(width: width, relativeTo: style))
    }

    /// Widens a small control's touch area by `amount` on each side without moving it,
    /// toward the 44-point minimum. Apply it to a button's label.
    func expandedTouchArea(_ amount: CGFloat = 12) -> some View {
        padding(amount)
            .contentShape(.rect)
            .padding(-amount)
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
                AdaptiveRow {
                    Text(label)
                } trailing: {
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
    @Environment(\.dynamicTypeSize) private var typeSize

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
        // At accessibility sizes the title wraps and the amount moves under it.
        let stacked = typeSize.isAccessibilitySize
        HStack(alignment: stacked ? .firstTextBaseline : .center, spacing: 12) {
            CategoryGlyph(categoryID: categoryID, iconKey: iconKey, name: categoryName)
                // The glyph is the row's only sign of its category.
                .accessibilityRepresentation {
                    Text(categoryName ?? "Uncategorized")
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .lineLimit(stacked ? 3 : 1)
                if let detail {
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(stacked ? 3 : 1)
                }
                if stacked {
                    amount
                }
            }
            if !stacked {
                Spacer(minLength: 8)
                amount
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var amount: some View {
        AmountText(amountCents, signed: income)
            .foregroundStyle(income ? ExpensesTheme.income(for: scheme) : .primary)
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

/// A screen that could not load, or has nothing to show. A failed load passes `retry`.
struct UnavailableStateSection: View {
    let title: String
    let systemImage: String
    var message: String?
    var retry: (() async -> Void)?

    var body: some View {
        Section {
            ContentUnavailableView {
                Label(title, systemImage: systemImage)
            } description: {
                if let message {
                    Text(message)
                }
            } actions: {
                if let retry {
                    Button("Try Again") {
                        Task { await retry() }
                    }
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
                    SelectableRow(isSelected: tag.id != includedTagID && selectedIDs.contains(tag.id)) {
                        selectedIDs.formSymmetricDifference([tag.id])
                    } label: {
                        HStack {
                            Text(tag.name)
                            Spacer()
                            if tag.id == includedTagID {
                                Text("Included")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .disabled(tag.id == includedTagID)
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

/// Metrics in grid rows, or one under another at accessibility text sizes.
struct MetricGrid<Rows: View>: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @ViewBuilder let rows: Rows

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
            : AnyLayout(GridLayout(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 16))
        layout {
            rows
        }
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

/// Whole-euro labels on three grid lines, for full-page analysis charts. While amounts
/// are hidden only the grid lines show.
private struct AmountYAxis: ViewModifier {
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        content.chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 3)) { value in
                AxisGridLine()
                if !model.amountsHidden, let cents = value.as(Int.self) {
                    AxisValueLabel {
                        Text(AppFormatters.euros(cents, decimals: false))
                    }
                }
            }
        }
    }
}

extension View {
    func amountYAxis() -> some View {
        modifier(AmountYAxis())
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

/// A chart's legend items in one row, or one per line when the row doesn't fit.
struct ChartLegend<Items: View>: View {
    @ViewBuilder let items: Items

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) {
                items
            }
            VStack(alignment: .leading, spacing: 6) {
                items
            }
        }
    }
}

/// "25 %": a share as a whole percent in the device's format.
func percent(_ part: Int, of whole: Int) -> String {
    (Double(part) / Double(whole)).formatted(.percent.precision(.fractionLength(0)))
}

/// A sign-in screen: the form sits mid-screen and its buttons in a bottom bar, within
/// reach of a thumb. The bar rides above the keyboard.
struct AuthScreen<Content: View, Actions: View>: View {
    @ViewBuilder let content: Content
    @ViewBuilder let actions: Actions

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 24) {
                    content
                }
                .padding(16)
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .safeAreaBar(edge: .bottom) {
            VStack(spacing: 8) {
                actions
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
        .background(ExpensesBackground())
    }
}

/// Form rows on one rounded card with separators between them, as in a Form section.
struct AuthCard<Rows: View>: View {
    @Environment(\.colorScheme) private var scheme
    @ViewBuilder let rows: Rows

    var body: some View {
        VStack(spacing: 0) {
            Group(subviews: rows) { subviews in
                ForEach(subviews) { row in
                    if row.id != subviews.first?.id {
                        Divider()
                            .padding(.horizontal, 16)
                    }
                    row
                }
            }
        }
        .background(ExpensesTheme.surface(for: scheme), in: .rect(cornerRadius: 26))
    }
}

/// A sign-in screen's main button. The ink tint is light in dark mode, so the label
/// takes the page color.
struct AuthPrimaryButton: View {
    @Environment(\.colorScheme) private var scheme
    let title: String
    let action: () -> Void

    init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .fontWeight(.semibold)
                .foregroundStyle(ExpensesTheme.background(for: scheme))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
    }
}

/// A full-width text button below a sign-in screen's main button.
struct AuthTextButton<Label: View>: View {
    let action: () -> Void
    @ViewBuilder let label: Label

    var body: some View {
        Button(action: action) {
            label
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(.rect)
        }
    }
}

extension View {
    /// A Form-height row on an `AuthCard`.
    func authRow() -> some View {
        padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: 52)
    }

    /// A field's `AuthCard` row, which focuses the field from anywhere in the row as a
    /// Form row does.
    func authFieldRow<Field: Hashable>(_ field: Field, focus: FocusState<Field?>.Binding) -> some View {
        focused(focus, equals: field)
            .authRow()
            .contentShape(.rect)
            .onTapGesture { focus.wrappedValue = field }
    }
}
