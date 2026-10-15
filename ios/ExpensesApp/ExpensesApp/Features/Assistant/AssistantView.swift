import SwiftUI

/// One conversation with the spending assistant, as on the web.
struct AssistantView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var input = ""
    @State private var sendTick = 0
    @State private var viewportHeight: CGFloat = 0
    @State private var latestUserHeight: CGFloat = 0
    @State private var latestAnswerHeight: CGFloat = 0

    private static let prompts = [
        "How much did I spend last month?",
        "What were my top spending categories this month?",
        "Compare this month's spending to last month",
        "Find my largest expenses this month",
    ]

    var body: some View {
        Group {
            if model.llmEnabled {
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
        .task { _ = try? await model.loadAISettings() }
        .navigationTitle("Assistant")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let usageURL {
                ToolbarItem(placement: .topBarTrailing) {
                    Link("ChatGPT Plan", destination: usageURL)
                }
            }
            if !model.assistantTurns.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New Chat", systemImage: "square.and.pencil") {
                        model.resetAssistantConversation()
                        input = ""
                    }
                    .disabled(model.isAssistantStreaming)
                    .accessibilityIdentifier("assistant.newChat")
                }
            }
        }
    }

    // The ChatGPT plan's usage page, when the assistant runs on it.
    private var usageURL: URL? {
        guard let settings = model.aiSettings,
              settings.features.first(where: { $0.id == "spending_chat" })?.provider == "chatgpt"
        else {
            return nil
        }
        return URL(string: settings.connection.usageURL)
    }

    private var conversation: some View {
        transcript
            .safeAreaBar(edge: .bottom) {
                AssistantComposer(input: $input, send: send)
                    .sensoryFeedback(.impact(weight: .light), trigger: sendTick)
            }
            .background(ExpensesBackground())
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
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
                Task {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.25)) {
                        proxy.scrollTo(newID, anchor: .top)
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Text("Ask about your spending")
                .font(.headline)
            VStack(spacing: 8) {
                ForEach(Self.prompts, id: \.self) { prompt in
                    Button {
                        send(prompt)
                    } label: {
                        Text(prompt)
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(ExpensesTheme.surface(for: scheme), in: .rect(cornerRadius: 17))
                            .overlay {
                                RoundedRectangle(cornerRadius: 17)
                                    .strokeBorder(Color.primary.opacity(0.14))
                            }
                            .expandedTouchArea(4)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .containerRelativeFrame(.vertical)
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

    private func send(_ text: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !model.isAssistantStreaming else {
            return
        }
        sendTick += 1
        model.sendAssistantMessage(text)
        input = ""
    }
}

/// The message field, in its own view so typing does not re-render the transcript.
private struct AssistantComposer: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .subheadline) private var sendSize = 32.0
    @Binding var input: String
    let send: (String) -> Void
    @FocusState private var inputFocused: Bool
    @State private var stopTick = 0

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Ask about your spending", text: $input, axis: .vertical)
                .lineLimit(1...6)
                .focused($inputFocused)
                .padding(.vertical, 6)
                .accessibilityLabel("Message the spending assistant")
                .accessibilityIdentifier("assistant.input")

            Button {
                if model.isAssistantStreaming {
                    stopTick += 1
                    model.cancelAssistantMessage()
                } else {
                    send(input)
                }
            } label: {
                Image(systemName: model.isAssistantStreaming ? "stop.fill" : "arrow.up")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(ExpensesTheme.surface(for: scheme))
                    .frame(width: sendSize, height: sendSize)
                    .background(ExpensesTheme.accent(for: scheme), in: .circle)
                    .expandedTouchArea(6)
            }
            .buttonStyle(.plain)
            .opacity(model.isAssistantStreaming || canSend ? 1 : 0.45)
            .disabled(!model.isAssistantStreaming && !canSend)
            .accessibilityLabel(model.isAssistantStreaming ? "Stop" : "Send")
            .accessibilityIdentifier(model.isAssistantStreaming ? "assistant.stop" : "assistant.send")
        }
        .sensoryFeedback(.impact(flexibility: .rigid), trigger: stopTick)
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(ExpensesTheme.surface(for: scheme), in: .rect(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22)
                .strokeBorder(Color.primary.opacity(0.1))
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isAssistantStreaming
    }
}

// Amounts in free text, masked like the web's: "€1,234.56", "1 234,56 €", "-12 EUR".
private let textAmount = #/(?:€|\$|\bEUR|\bUSD)\s?[-−]?\d(?:[\d.,\x{00A0}\x{202F} ]*\d)?|[-−]?\d(?:[\d.,\x{00A0}\x{202F} ]*\d)?\s?(?:€|\$|EUR\b|USD\b)/#

private func shown(_ text: String, amountsHidden: Bool) -> String {
    amountsHidden ? text.replacing(textAmount, with: "••••") : text
}

private struct AssistantTurnView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    let turn: AssistantTurn

    @State private var copied = false

    var body: some View {
        switch turn.role {
        case .user:
            HStack {
                Spacer(minLength: 48)
                Text(shown(turn.content, amountsHidden: model.amountsHidden))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        Color.primary.opacity(scheme == .dark ? 0.08 : 0.07),
                        in: .rect(cornerRadius: 18)
                    )
                    .contextMenu {
                        Button("Copy", systemImage: "doc.on.doc") {
                            UIPasteboard.general.string = turn.content
                        }
                    }
            }
        case .assistant:
            VStack(alignment: .leading, spacing: 6) {
                if !turn.tools.isEmpty {
                    AssistantActivityDisclosure(tools: turn.tools)
                }
                if !turn.content.isEmpty {
                    AssistantMarkdownText(content: shown(turn.content, amountsHidden: model.amountsHidden))
                        .equatable()
                } else if turn.isStreaming {
                    AssistantProgressLine(narration: shown(turn.progressNarration, amountsHidden: model.amountsHidden), tools: turn.tools)
                }
                if turn.isStopped {
                    Text("Stopped")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let errorMessage = turn.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(ExpensesTheme.expense(for: scheme))
                }
                if !turn.isStreaming, turn.isStopped || turn.errorMessage != nil || !turn.content.isEmpty {
                    actions
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var actions: some View {
        HStack(spacing: 4) {
            if turn.isStopped || turn.errorMessage != nil {
                Button("Try again", systemImage: "arrow.clockwise") {
                    model.retryAssistantTurn(turn.id)
                }
                .disabled(model.isAssistantStreaming)
                .frame(minHeight: 44)
            }
            if !turn.content.isEmpty {
                Button(copied ? "Copied" : "Copy response", systemImage: copied ? "checkmark" : "doc.on.doc") {
                    UIPasteboard.general.string = turn.content
                    copied = true
                }
                .labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44)
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .buttonStyle(.plain)
        .padding(.leading, turn.content.isEmpty ? 0 : -12)
        .sensoryFeedback(.success, trigger: copied) { _, copied in copied }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
    }
}

/// The line shown while a turn works. A freshly started tool's verb phrase holds for a
/// bounded window (`toolWindow`), then the latest narration, then "Thinking…". The backend
/// emits a narration just before each tool starts, so a running tool supersedes its own
/// lead-in; each new tool resets the window, so a slow tool never pins one label.
private struct AssistantProgressLine: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let narration: String
    let tools: [AssistantToolActivity]

    private static let toolWindow: Duration = .seconds(3)

    // The tool whose verb currently overrides the base phrase; cleared when its window lapses.
    @State private var overrideToolID: String?
    @State private var dimmed = false

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
            Circle()
                .fill(.tertiary)
                .frame(width: 8, height: 8)
                .opacity(dimmed ? 0.3 : 1)
            Text(phrase)
                .lineLimit(1)
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                dimmed = true
            }
        }
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

/// One line for a turn's tool use, such as "Reviewed 3 ledger views", that expands to the steps.
private struct AssistantActivityDisclosure: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let tools: [AssistantToolActivity]
    @State private var expanded = false
    @State private var stepsHeight: CGFloat = 0

    private var summary: String {
        if let running = tools.first(where: { $0.status == .running }) {
            return "\(running.label)…"
        }
        if let failed = tools.first(where: { $0.status == .failed }) {
            return "\(failed.label) failed"
        }
        return tools.count == 1 ? tools[0].label : "Reviewed \(tools.count) ledger views"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                if reduceMotion {
                    expanded.toggle()
                } else {
                    withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                    Text(summary)
                        .foregroundStyle(failedOnly ? ExpensesTheme.expense(for: scheme) : .secondary)
                }
                .font(.subheadline)
            }
            .buttonStyle(.plain)
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")

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
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var failedOnly: Bool {
        !tools.contains { $0.status == .running } && tools.contains { $0.status == .failed }
    }

    private var stepsList: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(tools) { tool in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    statusIcon(for: tool.status)
                        .glyphColumn(14, relativeTo: .footnote)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(tool.label) \(shown(tool.detail, amountsHidden: model.amountsHidden))")
                        if let summary = tool.summary {
                            Text(shown(summary, amountsHidden: model.amountsHidden))
                        }
                    }
                    .foregroundStyle(.secondary)
                }
                .font(.footnote)
                .accessibilityElement(children: .combine)
                .accessibilityValue(statusWord(for: tool.status))
            }
        }
        .padding(.top, 4)
        .padding(.leading, 20)
    }

    @ViewBuilder
    private func statusIcon(for status: AssistantToolStatus) -> some View {
        switch status {
        case .running:
            Image(systemName: "circle.dotted")
                .foregroundStyle(.secondary)
        case .success:
            Image(systemName: "checkmark")
                .foregroundStyle(.secondary)
        case .failed:
            Image(systemName: "exclamationmark.triangle")
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
/// Equatable, so a turn whose text has not changed is not parsed again.
private struct AssistantMarkdownText: View, Equatable {
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MarkdownBlock.parse(content).enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case let .paragraph(text):
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
        case let .heading(level, text):
            Text(text)
                .font(headingFont(for: level))
                .fixedSize(horizontal: false, vertical: true)
        case let .list(rows):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(rows.indices, id: \.self) { index in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(rows[index].marker)
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 16, alignment: .trailing)
                        Text(rows[index].text)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
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
