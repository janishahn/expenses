import Foundation
import SwiftUI

struct AssistantView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var input = ""
    @FocusState private var inputFocused: Bool

    private let bottomAnchor = "assistant.bottom"
    private static let starterPrompts = [
        "What changed in my spending this month?",
        "Where did I spend the most recently?",
        "How am I tracking against my budgets?",
    ]

    var body: some View {
        Group {
            if model.identity?.authenticated != true {
                List {
                    SignedOutStateSection()
                }
                .expensesScreenStyle()
            } else if model.llmEnabled {
                conversation
            } else {
                List {
                    ContentUnavailableView(
                        "Assistant unavailable",
                        systemImage: "sparkles",
                        description: Text("LLM features are turned off.")
                    )
                }
                .expensesScreenStyle()
            }
        }
        .navigationTitle("Assistant")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.identity?.authenticated == true, !model.assistantTurns.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        model.resetAssistantConversation()
                        input = ""
                    } label: {
                        Label("New chat", systemImage: "square.and.pencil")
                    }
                    .disabled(model.isAssistantStreaming)
                    .accessibilityIdentifier("assistant.newChat")
                }
            }
        }
    }

    private var conversation: some View {
        transcript
            .safeAreaInset(edge: .bottom, spacing: 0) {
                composer
            }
            .background(ExpensesBackground())
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    if model.assistantTurns.isEmpty {
                        emptyState
                    } else {
                        ForEach(model.assistantTurns) { turn in
                            AssistantTurnView(turn: turn)
                                .id(turn.id)
                        }
                    }
                    Color.clear
                        .frame(height: 1)
                        .id(bottomAnchor)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 18)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: scrollSignal) {
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo(bottomAnchor, anchor: .bottom)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.secondary)
            Text("Ask about your spending in plain language.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            ForEach(Self.starterPrompts, id: \.self) { prompt in
                Button(prompt) {
                    input = prompt
                    inputFocused = true
                }
                .disabled(model.isAssistantStreaming)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Ask about your spending...", text: $input, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(
                    ExpensesTheme.surface(for: scheme),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
                .focused($inputFocused)
                .accessibilityIdentifier("assistant.input")

            if model.isAssistantStreaming {
                Button {
                    model.cancelAssistantMessage()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .foregroundStyle(ExpensesTheme.expense(for: scheme))
                .accessibilityLabel("Stop")
                .accessibilityIdentifier("assistant.stop")
            } else {
                Button {
                    send()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28, weight: .semibold))
                        .frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .foregroundStyle(ExpensesTheme.accent(for: scheme))
                .opacity(canSend ? 1 : 0.4)
                .disabled(!canSend)
                .accessibilityLabel("Send")
                .accessibilityIdentifier("assistant.send")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isAssistantStreaming
    }

    private var scrollSignal: Int {
        model.assistantTurns.count
            + (model.assistantTurns.last?.content.count ?? 0)
            + (model.assistantTurns.last?.progressNarration.count ?? 0)
            + (model.assistantTurns.last?.tools.count ?? 0)
    }

    private func send() {
        guard canSend else {
            return
        }
        model.sendAssistantMessage(input)
        input = ""
    }
}

private struct AssistantTurnView: View {
    @Environment(\.colorScheme) private var scheme
    let turn: AssistantTurn

    var body: some View {
        switch turn.role {
        case .user:
            HStack {
                Spacer(minLength: 40)
                Text(turn.content)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        ExpensesTheme.accent(for: scheme).opacity(0.14),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                    )
            }
        case .assistant:
            VStack(alignment: .leading, spacing: 6) {
                if !turn.tools.isEmpty {
                    AssistantActivityDisclosure(tools: turn.tools)
                }
                HStack {
                    VStack(alignment: .leading, spacing: 8) {
                        assistantBody
                        if turn.isStopped {
                            Text("Stopped")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        if let errorMessage = turn.errorMessage {
                            Text(errorMessage)
                                .font(.footnote)
                                .foregroundStyle(ExpensesTheme.expense(for: scheme))
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        ExpensesTheme.surface(for: scheme),
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                    )
                    Spacer(minLength: 40)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var assistantBody: some View {
        if turn.content.isEmpty {
            if turn.isStreaming {
                AssistantWorkingStatus(
                    narration: turn.progressNarration,
                    toolLabel: toolTickerLabel
                )
            }
        } else {
            AssistantMarkdownText(content: turn.content, showsCaret: turn.isStreaming)
        }
    }

    private var toolTickerLabel: String? {
        turn.tools.last?.label
    }
}

private struct AssistantWorkingStatus: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let narration: String
    let toolLabel: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if reduceMotion {
                    ProgressView()
                        .controlSize(.mini)
                }
                ShimmerText(text: "Thinking…", active: !reduceMotion)
            }

            if !narration.isEmpty {
                Text(narration)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(reduceMotion ? .identity : .opacity)
            }

            if let toolLabel {
                AssistantToolTicker(label: toolLabel)
                    .transition(reduceMotion ? .identity : .opacity.combined(with: .move(edge: .top)))
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: narration)
        // Key on presence only; the ticker handles its own odometer roll between labels.
        .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: toolLabel == nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(narration.isEmpty ? "Assistant is working" : narration)
    }
}

private struct ShimmerText: View {
    let text: String
    var active: Bool
    @State private var phase: CGFloat = 0

    var body: some View {
        Text(text)
            .overlay {
                if active {
                    GeometryReader { geo in
                        let width = max(geo.size.width, 1)
                        let band = width * 0.4
                        LinearGradient(
                            colors: [.clear, Color.white.opacity(0.6), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: band)
                        .offset(x: -band + phase * (width + band))
                    }
                    .mask(alignment: .leading) { Text(text) }
                    .allowsHitTesting(false)
                }
            }
            .onAppear {
                guard active else { return }
                withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
    }
}

private struct AssistantToolTicker: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .caption) private var lineHeight: CGFloat = 18
    let label: String

    var body: some View {
        ZStack(alignment: .leading) {
            ShimmerText(text: label, active: !reduceMotion)
                .id(label)
                .lineLimit(1)
                .truncationMode(.tail)
                .transition(reduceMotion ? .identity : .push(from: .bottom).combined(with: .opacity))
        }
        .frame(minHeight: lineHeight, alignment: .leading)
        .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85), value: label)
        .clipped()
    }
}

/// A quiet, collapsed-by-default disclosure shown above the assistant bubble for turns
/// that used tools. It exposes only high-level activity labels and statuses — never raw
/// tool names or arguments — so the main chat flow stays uncluttered.
private struct AssistantActivityDisclosure: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let tools: [AssistantToolActivity]
    @State private var expanded = false
    @State private var stepsHeight: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                if reduceMotion {
                    expanded.toggle()
                } else {
                    withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                    Text("Activity")
                    Text("· \(tools.count) \(tools.count == 1 ? "step" : "steps")")
                        .foregroundStyle(.tertiary)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Activity")
            .accessibilityValue("\(tools.count) \(tools.count == 1 ? "step" : "steps")")
            .accessibilityHint(expanded ? "Collapse" : "Expand")

            // Reveal the steps by growing a top-anchored clip window so the list
            // unrolls from under the header instead of sliding over it. The list is
            // always laid out (fixedSize holds its natural height for measurement)
            // and clipped to zero height while collapsed.
            stepsList
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { stepsHeight = $0 }
                .frame(height: expanded ? stepsHeight : 0, alignment: .top)
                .clipped()
                .accessibilityHidden(!expanded)
        }
        .padding(.leading, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var stepsList: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(tools) { tool in
                HStack(spacing: 6) {
                    statusIcon(for: tool.status)
                        .font(.caption)
                        .frame(width: 14)
                    Text(tool.label)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(tool.label)
                .accessibilityValue(statusWord(for: tool.status))
            }
        }
        .padding(.top, 6)
        .padding(.leading, 1)
    }

    @ViewBuilder
    private func statusIcon(for status: AssistantToolStatus) -> some View {
        switch status {
        case .running:
            Image(systemName: "circle.dotted")
                .foregroundStyle(.secondary)
        case .success:
            Image(systemName: "checkmark.circle")
                .foregroundStyle(.secondary)
        case .failed:
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(ExpensesTheme.expense(for: scheme))
        }
    }

    private func statusWord(for status: AssistantToolStatus) -> String {
        switch status {
        case .running:
            "In progress"
        case .success:
            "Done"
        case .failed:
            "Failed"
        }
    }
}

/// Renders assistant Markdown with real block structure. `AttributedString(markdown:)`
/// folds paragraphs and lists into presentation-intent attributes that `Text` does not
/// turn into line breaks, which flattens multi-paragraph answers into one run and jams
/// sentences together. Splitting into blocks first and parsing only inline syntax per
/// block restores paragraph/list spacing while keeping bold, emphasis, code, and links.
private struct AssistantMarkdownText: View {
    let content: String
    var showsCaret = false

    var body: some View {
        let blocks = MarkdownBlock.parse(content)
        let lastIndex = blocks.count - 1
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                blockView(block, isLast: index == lastIndex)
            }
        }
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock, isLast: Bool) -> some View {
        let caret = showsCaret && isLast
        switch block {
        case let .paragraph(text):
            caretText(text, caret: caret, font: nil)
                .fixedSize(horizontal: false, vertical: true)
        case let .heading(level, text):
            caretText(text, caret: caret, font: headingFont(for: level))
                .fixedSize(horizontal: false, vertical: true)
        case let .list(rows):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(rows.indices, id: \.self) { index in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(rows[index].marker)
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 16, alignment: .trailing)
                        caretText(rows[index].text, caret: caret && index == rows.count - 1, font: nil)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func caretText(_ text: AttributedString, caret: Bool, font: Font?) -> some View {
        if caret {
            StreamingCaretText(text: text, font: font)
        } else {
            Text(text).font(font)
        }
    }

    private func headingFont(for level: Int) -> Font {
        switch level {
        case 1:
            .title3.weight(.semibold)
        case 2:
            .headline
        default:
            .subheadline.weight(.semibold)
        }
    }
}

/// A streamed text fragment with a trailing typing caret as its final inline glyph, so the
/// caret hugs the end of the answer as it wraps. The caret blinks by toggling color (not
/// width, so text never reflows); under Reduce Motion it holds steady. The caret glyph is
/// kept out of VoiceOver by overriding the spoken label with the plain text.
private struct StreamingCaretText: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    let text: AttributedString
    let font: Font?

    var body: some View {
        let plain = String(text.characters)
        if reduceMotion {
            composed(caretVisible: true)
                .accessibilityLabel(plain)
        } else {
            TimelineView(.periodic(from: .now, by: 0.6)) { context in
                let visible = Int(context.date.timeIntervalSinceReferenceDate / 0.6).isMultiple(of: 2)
                composed(caretVisible: visible)
                    .accessibilityLabel(plain)
            }
        }
    }

    private func composed(caretVisible: Bool) -> Text {
        let caret = Text(verbatim: "\u{200A}\u{258F}")
            .font(font)
            .foregroundStyle(caretVisible ? ExpensesTheme.accent(for: scheme) : Color.clear)
        return Text("\(text)\(caret)").font(font)
    }
}

private enum MarkdownBlock {
    case paragraph(AttributedString)
    case heading(level: Int, AttributedString)
    case list(rows: [ListRow])

    struct ListRow {
        let marker: String
        let text: AttributedString
    }

    static func parse(_ content: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraphLines: [String] = []
        var listRows: [ListRow] = []

        func flushParagraph() {
            guard !paragraphLines.isEmpty else { return }
            blocks.append(.paragraph(inline(paragraphLines.joined(separator: " "))))
            paragraphLines.removeAll(keepingCapacity: true)
        }
        func flushList() {
            guard !listRows.isEmpty else { return }
            blocks.append(.list(rows: listRows))
            listRows.removeAll(keepingCapacity: true)
        }

        for rawLine in content.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine).trimmingCharacters(in: .whitespaces)

            if line.isEmpty {
                flushParagraph()
                flushList()
            } else if let heading = parseHeading(line) {
                flushParagraph()
                flushList()
                blocks.append(heading)
            } else if let item = parseBullet(line) {
                flushParagraph()
                listRows.append(ListRow(marker: "•", text: inline(item)))
            } else if let (number, rest) = parseNumbered(line) {
                flushParagraph()
                listRows.append(ListRow(marker: "\(number).", text: inline(rest)))
            } else {
                flushList()
                paragraphLines.append(line)
            }
        }
        flushParagraph()
        flushList()
        return blocks
    }

    private static func parseHeading(_ line: String) -> MarkdownBlock? {
        guard line.first == "#" else { return nil }
        var level = 0
        var index = line.startIndex
        while index < line.endIndex, line[index] == "#", level < 6 {
            level += 1
            index = line.index(after: index)
        }
        guard index < line.endIndex, line[index] == " " else { return nil }
        return .heading(level: level, inline(String(line[line.index(after: index)...])))
    }

    private static func parseBullet(_ line: String) -> String? {
        for marker in ["- ", "* ", "+ "] where line.hasPrefix(marker) {
            return String(line.dropFirst(marker.count))
        }
        return nil
    }

    private static func parseNumbered(_ line: String) -> (Int, String)? {
        var digits = ""
        var index = line.startIndex
        while index < line.endIndex, line[index].isNumber {
            digits.append(line[index])
            index = line.index(after: index)
        }
        guard !digits.isEmpty, let number = Int(digits),
              index < line.endIndex, line[index] == "."
        else { return nil }
        let afterDot = line.index(after: index)
        guard afterDot < line.endIndex, line[afterDot] == " " else { return nil }
        return (number, String(line[line.index(after: afterDot)...]))
    }

    /// Parses only inline syntax (bold/emphasis/code/links) and preserves whitespace so a
    /// partially streamed block degrades to literal text instead of collapsing.
    private static func inline(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: false,
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

#Preview {
    NavigationStack {
        AssistantView()
            .environment(AppModel())
    }
}
