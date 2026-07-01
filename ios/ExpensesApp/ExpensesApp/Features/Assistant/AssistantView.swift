import Foundation
import SwiftUI

struct AssistantView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @State private var input = ""
    @FocusState private var inputFocused: Bool
    @State private var sendTick = 0
    @State private var stopTick = 0
    @State private var viewportHeight: CGFloat = 0
    @State private var latestUserHeight: CGFloat = 0
    @State private var latestAnswerHeight: CGFloat = 0

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
                    UnavailableStateSection(
                        title: "Assistant unavailable",
                        systemImage: "sparkles",
                        message: "LLM features are turned off."
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
                                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                                    if turn.id == latestUserTurnID {
                                        latestUserHeight = height
                                    } else if turn.id == latestAssistantTurnID {
                                        latestAnswerHeight = height
                                    }
                                }
                        }
                    }
                    // Reserve room below the newest exchange so a freshly sent question can rest at
                    // the top of the viewport with space for the reply, instead of the reply starting
                    // at the bottom. Shrinks as the answer grows; gone once the exchange fills the screen.
                    Color.clear
                        .frame(height: bottomReserve)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 18)
            }
            .scrollDismissesKeyboard(.interactively)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewportHeight = $0 }
            .onChange(of: latestUserTurnID) { _, newID in
                guard let newID else { return }
                // Reset the measured heights so the reserve is at full height for the near-empty
                // new exchange, then scroll on the next layout pass so the question reaches the top.
                latestUserHeight = 0
                latestAnswerHeight = 0
                DispatchQueue.main.async {
                    withAnimation(.easeOut(duration: 0.25)) {
                        proxy.scrollTo(newID, anchor: .top)
                    }
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
        HStack(alignment: .bottom, spacing: 6) {
            TextField("Ask about your spending...", text: $input, axis: .vertical)
                .lineLimit(1...5)
                .focused($inputFocused)
                .accessibilityIdentifier("assistant.input")
                .padding(.leading, 16)
                .padding(.vertical, 11)

            if model.isAssistantStreaming {
                Button {
                    stopTick += 1
                    model.cancelAssistantMessage()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 40, height: 44)
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
                        .frame(width: 40, height: 44)
                }
                .buttonStyle(.plain)
                .foregroundStyle(ExpensesTheme.accent(for: scheme))
                .opacity(canSend ? 1 : 0.4)
                .disabled(!canSend)
                .accessibilityLabel("Send")
                .accessibilityIdentifier("assistant.send")
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: sendTick)
        .sensoryFeedback(.impact(flexibility: .rigid), trigger: stopTick)
        .padding(.trailing, 6)
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(ExpensesTheme.surface(for: scheme).opacity(scheme == .dark ? 0.82 : 0.74))
                .shadow(color: .black.opacity(scheme == .dark ? 0.18 : 0.06), radius: 14, y: 6)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(.white.opacity(scheme == .dark ? 0.08 : 0.38), lineWidth: 0.75)
        }
        .glassEffect(
            .regular.tint(ExpensesTheme.accent(for: scheme).opacity(scheme == .dark ? 0.025 : 0.035)),
            in: .rect(cornerRadius: 24)
        )
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isAssistantStreaming
    }

    private var latestUserTurnID: Int? {
        model.assistantTurns.last(where: { $0.role == .user })?.id
    }

    private var latestAssistantTurnID: Int? {
        model.assistantTurns.last(where: { $0.role == .assistant })?.id
    }

    // Space to leave below the newest exchange so its question can sit at the top of the
    // viewport. As the answer streams and grows, the reserve shrinks to keep the total near
    // one screen; once the exchange is taller than the screen no reserve is needed.
    private var bottomReserve: CGFloat {
        guard viewportHeight > 0, latestUserTurnID != nil else { return 0 }
        return max(0, viewportHeight - latestUserHeight - latestAnswerHeight)
    }

    private func send() {
        guard canSend else {
            return
        }
        sendTick += 1
        model.sendAssistantMessage(input)
        input = ""
    }
}

private struct AssistantTurnView: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let turn: AssistantTurn

    var body: some View {
        switch turn.role {
        case .user:
            UserMessageBubble(text: turn.content)
        case .assistant:
            // Progress lives above/outside the bubble: the Activity disclosure, then the
            // single-line spinner while the turn is still working. The answer bubble only
            // materializes once final user-visible content exists, so thinking, tool calls,
            // and intermediate reasoning never render inside a bubble.
            VStack(alignment: .leading, spacing: 6) {
                if !turn.tools.isEmpty {
                    AssistantActivityDisclosure(tools: turn.tools)
                }
                if showsSpinner {
                    AssistantProgressSpinner(
                        narration: turn.progressNarration,
                        tools: turn.tools
                    )
                    .padding(.leading, 14)
                    .transition(reduceMotion ? .identity : .opacity)
                }
                if !turn.content.isEmpty {
                    answerBubble
                        .transition(reduceMotion ? .identity : .opacity)
                } else {
                    terminalStatus
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: turn.content.isEmpty)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: turn.isStreaming)
        }
    }

    private var showsSpinner: Bool {
        turn.isStreaming && turn.content.isEmpty && turn.errorMessage == nil
    }

    private var answerBubble: some View {
        HStack {
            VStack(alignment: .leading, spacing: 8) {
                AssistantMarkdownText(content: turn.content, showsCaret: turn.isStreaming)
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

    // A finished turn that produced no answer text reads as a quiet status line rather than
    // an empty bubble: the stop/error/no-response outcome shown where the spinner used to be.
    @ViewBuilder
    private var terminalStatus: some View {
        if !turn.isStreaming {
            Group {
                if let errorMessage = turn.errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(ExpensesTheme.expense(for: scheme))
                } else if turn.isStopped {
                    Text("Stopped")
                        .foregroundStyle(.secondary)
                } else {
                    Text("No response")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.footnote)
            .padding(.leading, 14)
        }
    }
}

/// A right-aligned user turn. Ordinary questions render in full; only extremely long ones
/// collapse to a few lines behind a "See more" toggle so a pasted wall of text can't dominate
/// the transcript. Assistant answers are never truncated this way.
private struct UserMessageBubble: View {
    @Environment(\.colorScheme) private var scheme
    let text: String
    @State private var expanded = false

    private var isCollapsible: Bool { text.count > 600 }

    var body: some View {
        HStack {
            Spacer(minLength: 40)
            VStack(alignment: .trailing, spacing: 6) {
                Text(text)
                    .lineLimit(expanded || !isCollapsible ? nil : 6)
                    .fixedSize(horizontal: false, vertical: true)
                if isCollapsible {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
                    } label: {
                        HStack(spacing: 3) {
                            Text(expanded ? "See less" : "See more")
                            Image(systemName: "chevron.down")
                                .rotationEffect(.degrees(expanded ? 180 : 0))
                        }
                        .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(expanded ? "See less" : "See more")
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                ExpensesTheme.accent(for: scheme).opacity(0.14),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
        }
    }
}

/// The single shimmering progress line shown above the answer bubble while a turn works.
/// Exactly one phrase is visible at a time, chosen by a small precedence rule:
///   1. a freshly started tool's verb phrase, shown for a bounded window (`toolWindow`);
///   2. otherwise the latest user-visible intermediate reasoning (`narration`);
///   3. otherwise the default "Thinking…".
/// The backend emits a `progress_narration` immediately before each `tool_call_start`, so a
/// running tool intentionally supersedes its own lead-in narration with the crisp verb. When
/// a tool runs longer than the window with nothing newer, the phrase falls back so a slow tool
/// never pins one label; each new tool resets the window, which also debounces rapid tool
/// bursts into a smooth text roll instead of blinking back to "Thinking…".
private struct AssistantProgressSpinner: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .subheadline) private var lineHeight: CGFloat = 20
    let narration: String
    let tools: [AssistantToolActivity]

    private static let toolWindow: Duration = .seconds(2)

    // The tool whose verb currently overrides the base phrase; cleared when its window lapses.
    @State private var overrideToolID: String?

    private var phrase: String {
        if let overrideToolID, let tool = tools.first(where: { $0.id == overrideToolID }) {
            return tool.spinnerPhrase
        }
        if !narration.isEmpty {
            return narration
        }
        return "Thinking…"
    }

    var body: some View {
        HStack(spacing: 8) {
            if reduceMotion {
                ProgressView()
                    .controlSize(.mini)
            }
            ZStack(alignment: .leading) {
                ShimmerText(text: phrase, active: !reduceMotion)
                    .id(phrase)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .transition(reduceMotion ? .identity : .push(from: .bottom).combined(with: .opacity))
            }
            .frame(minHeight: lineHeight, alignment: .leading)
            .clipped()
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85), value: phrase)
        .onChange(of: tools.last?.id) { _, newID in
            if let newID {
                overrideToolID = newID
            }
        }
        .task(id: overrideToolID) {
            guard overrideToolID != nil else { return }
            try? await Task.sleep(for: Self.toolWindow)
            if !Task.isCancelled {
                overrideToolID = nil
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Assistant is working")
        .accessibilityValue(phrase.replacingOccurrences(of: "…", with: ""))
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
