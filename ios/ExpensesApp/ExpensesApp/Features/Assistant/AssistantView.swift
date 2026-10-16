import SwiftUI

/// The Assistant: one chat at a time, kept on the server, as on the web.
struct AssistantView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var input = ""
    @State private var sendTick = 0
    // Bumped to bring the newest question to the top of the screen.
    @State private var scrollRequest = 0
    @State private var scrollPosition = ScrollPosition(edge: .top)
    @State private var viewportHeight: CGFloat = 0
    @State private var latestQuestionHeight: CGFloat = 0
    @State private var latestAnswerHeight: CGFloat = 0
    // A transaction the answer linked as [title](transaction:<id>).
    @State private var linkedTransactionID: Int?

    var body: some View {
        Group {
            if model.aiFeatures.contains("spending_chat") {
                conversation
            } else {
                List {
                    UnavailableStateSection(
                        title: "Assistant unavailable",
                        systemImage: "bubble.left",
                        message: "The Assistant is turned off on this server."
                    )
                }
                .expensesScreenStyle()
            }
        }
        .navigationTitle("Assistant")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.aiFeatures.contains("spending_chat") {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    recentMenu
                    Button("New Chat", systemImage: "square.and.pencil") {
                        model.newAssistantChat()
                    }
                    .accessibilityIdentifier("assistant.newChat")
                }
            }
        }
        .task {
            await model.loadAssistantChats()
        }
        .sensoryFeedback(.error, trigger: liveFailureID) { _, failed in failed != nil }
    }

    private var recentMenu: some View {
        Menu {
            if model.assistantChats.isEmpty {
                Text("No chats yet")
            }
            ForEach(model.assistantChats) { chat in
                Button {
                    open(chat.id)
                } label: {
                    Text(chat.title)
                    Text(chatWhen(chat.updatedAt))
                }
            }
        } label: {
            Label("Recent Chats", systemImage: "clock.arrow.circlepath")
        }
        .accessibilityIdentifier("assistant.recent")
    }

    private var conversation: some View {
        transcript
            .safeAreaBar(edge: .bottom) {
                AssistantComposer(input: $input, send: send)
                    .sensoryFeedback(.impact(flexibility: .soft), trigger: sendTick)
            }
            .background(ExpensesBackground())
            .environment(\.openURL, OpenURLAction { url in
                guard url.scheme == "transaction",
                      let id = Int(url.absoluteString.dropFirst("transaction:".count))
                else { return .systemAction }
                linkedTransactionID = id
                return .handled
            })
            .navigationDestination(item: $linkedTransactionID) { id in
                TransactionDetailView(transactionID: id)
            }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                // Not lazy: scrolling to a turn must work before it has been laid out.
                VStack(alignment: .leading, spacing: 22) {
                    switch model.assistantChatState {
                    case .loading:
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .containerRelativeFrame(.vertical)
                    case let .failed(message):
                        Label(message, systemImage: "exclamationmark.circle")
                            .foregroundStyle(ExpensesTheme.expense(for: scheme))
                            .frame(maxWidth: .infinity)
                            .containerRelativeFrame(.vertical)
                    case .ready:
                        if model.assistantTurns.isEmpty {
                            recentList
                        } else {
                            turns
                        }
                    }
                    // Room below the newest exchange so a sent question can rest at the top of the
                    // screen with space for the answer. It shrinks as the answer grows.
                    Color.clear
                        .frame(height: bottomReserve)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
            .scrollPosition($scrollPosition)
            .scrollDismissesKeyboard(.interactively)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { viewportHeight = $0 }
            .onChange(of: scrollRequest) {
                guard let last = model.assistantTurns.last else { return }
                latestQuestionHeight = 0
                latestAnswerHeight = 0
                Task {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.25)) {
                        proxy.scrollTo("\(last.id)-q", anchor: .top)
                    }
                }
            }
            // A cleared thread would otherwise keep the old offset and show blank space.
            .onChange(of: model.assistantTurns.isEmpty) { _, empty in
                if empty {
                    scrollPosition.scrollTo(edge: .top)
                }
            }
            // An opened chat starts at its latest answer.
            .onChange(of: model.assistantChatState) { _, state in
                if state == .ready, !model.assistantTurns.isEmpty {
                    scrollPosition.scrollTo(edge: .bottom)
                }
            }
        }
    }

    @ViewBuilder
    private var turns: some View {
        ForEach(model.assistantTurns) { turn in
            AssistantQuestion(text: turn.userText)
                .id("\(turn.id)-q")
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 6)))
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                    if turn.id == model.assistantTurns.last?.id {
                        latestQuestionHeight = height
                    }
                }
            AssistantAnswer(turn: turn, isLast: turn.id == model.assistantTurns.last?.id) {
                model.retryLastAssistantTurn()
                scrollRequest += 1
            }
            .id(turn.id)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                if turn.id == model.assistantTurns.last?.id {
                    latestAnswerHeight = height
                }
            }
        }
    }

    // A new chat lists recent chats instead of suggested questions.
    private var recentList: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !model.assistantChats.isEmpty {
                Text("Recent")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 4)
                    .accessibilityAddTraits(.isHeader)
                ForEach(model.assistantChats.prefix(5)) { chat in
                    Button {
                        open(chat.id)
                    } label: {
                        HStack(spacing: 12) {
                            Text(chat.title)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(chatWhen(chat.updatedAt))
                                .font(.subheadline)
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity)
        .containerRelativeFrame(.vertical)
    }

    // The newest answer that failed while the screen was open.
    private var liveFailureID: String? {
        guard let last = model.assistantTurns.last, last.live, case .failed = last.status else { return nil }
        return last.id
    }

    // Only an answer streamed on this screen needs room; an opened chat ends at its last answer.
    private var bottomReserve: CGFloat {
        guard viewportHeight > 0, model.assistantTurns.last?.live == true else { return 0 }
        return max(0, viewportHeight - latestQuestionHeight - latestAnswerHeight - 40)
    }

    private func send() {
        guard !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !model.isAssistantStreaming else { return }
        sendTick += 1
        withAnimation(.easeOut(duration: 0.2)) {
            model.sendAssistantMessage(input)
        }
        input = ""
        scrollRequest += 1
    }

    private func open(_ id: String) {
        Task { await model.openAssistantChat(id) }
    }
}

/// The message field, in its own view so typing does not re-render the transcript.
private struct AssistantComposer: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @ScaledMetric(relativeTo: .body) private var sendSize = 34.0
    @Binding var input: String
    let send: () -> Void
    @FocusState private var inputFocused: Bool
    @State private var stopTick = 0

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("Ask anything", text: $input, axis: .vertical)
                .lineLimit(1...6)
                .focused($inputFocused)
                .padding(.vertical, 7)
                .accessibilityLabel("Message the Assistant")
                .accessibilityIdentifier("assistant.input")

            Button {
                if model.isAssistantStreaming {
                    stopTick += 1
                    model.cancelAssistantMessage()
                } else {
                    send()
                }
            } label: {
                Image(systemName: model.isAssistantStreaming ? "stop.fill" : "arrow.up")
                    .font(.body.weight(.semibold))
                    .contentTransition(.symbolEffect(.replace))
                    .foregroundStyle(ExpensesTheme.surface(for: scheme))
                    .frame(width: sendSize, height: sendSize)
                    .background(ExpensesTheme.accent(for: scheme), in: .circle)
                    .expandedTouchArea(5)
            }
            .buttonStyle(.plain)
            .opacity(model.isAssistantStreaming || canSend ? 1 : 0.45)
            .disabled(!model.isAssistantStreaming && !canSend)
            .accessibilityLabel(model.isAssistantStreaming ? "Stop" : "Send")
            .accessibilityIdentifier(model.isAssistantStreaming ? "assistant.stop" : "assistant.send")
        }
        .sensoryFeedback(.impact(weight: .light), trigger: stopTick)
        .padding(.leading, 18)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
        .padding(.horizontal, 14)
        .padding(.bottom, 8)
    }

    private var canSend: Bool {
        !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.isAssistantStreaming
    }
}

// "Today", "Yesterday", a weekday within the week, then the date.
private func chatWhen(_ date: Date, now: Date = .now) -> String {
    let calendar = Calendar.current
    if calendar.isDateInToday(date) { return "Today" }
    if calendar.isDateInYesterday(date) { return "Yesterday" }
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
    if days < 7 { return date.formatted(.dateTime.weekday(.abbreviated)) }
    if calendar.isDate(date, equalTo: now, toGranularity: .year) {
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
    return date.formatted(.dateTime.day().month(.abbreviated).year())
}

// Amounts in free text, masked like the web's: "€1,234.56", "1 234,56 €", "-12 EUR".
private let textAmount = #/(?:€|\$|\bEUR|\bUSD)\s?[-−]?\d(?:[\d.,\x{00A0}\x{202F} ]*\d)?|[-−]?\d(?:[\d.,\x{00A0}\x{202F} ]*\d)?\s?(?:€|\$|EUR\b|USD\b)/#

private func shown(_ text: String, amountsHidden: Bool) -> String {
    amountsHidden ? text.replacing(textAmount, with: "••••") : text
}

private struct AssistantQuestion: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    let text: String

    var body: some View {
        HStack {
            Spacer(minLength: 48)
            Text(shown(text, amountsHidden: model.amountsHidden))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Color.primary.opacity(scheme == .dark ? 0.08 : 0.07), in: .rect(cornerRadius: 20))
                .contextMenu {
                    Button("Copy", systemImage: "doc.on.doc") {
                        UIPasteboard.general.string = text
                    }
                }
        }
    }
}

/// Reasoning, notes, and ledger reads between answer text and approval cards fold into one
/// activity line each.
private enum AnswerPart: Identifiable {
    case activity([AssistantItem])
    case text(AssistantItem)
    case approval(AssistantItem)

    var id: String {
        switch self {
        case let .activity(items): items[0].id
        case let .text(item), let .approval(item): item.id
        }
    }

    static func parts(of items: [AssistantItem]) -> [AnswerPart] {
        var parts: [AnswerPart] = []
        for item in items {
            if item.kind == .text {
                parts.append(.text(item))
            } else if item.kind == .approval {
                parts.append(.approval(item))
            } else if case let .activity(steps) = parts.last {
                parts[parts.count - 1] = .activity(steps + [item])
            } else {
                parts.append(.activity([item]))
            }
        }
        return parts
    }
}

private struct AssistantAnswer: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    let turn: AssistantTurn
    let isLast: Bool
    let retry: () -> Void
    @State private var copied = false

    var body: some View {
        let streaming = turn.status == .streaming
        let parts = AnswerPart.parts(of: turn.items)
        VStack(alignment: .leading, spacing: 10) {
            if streaming && parts.isEmpty {
                AssistantActivity(items: [], working: true)
            }
            ForEach(parts) { part in
                switch part {
                case let .activity(items):
                    AssistantActivity(items: items, working: streaming && part.id == parts.last?.id)
                case let .text(item):
                    AssistantMarkdownText(
                        content: shown(item.text, amountsHidden: model.amountsHidden),
                        partial: item.state == .streaming,
                        fadesIn: turn.live
                    )
                    .equatable()
                case let .approval(item):
                    if let card = item.card {
                        AssistantApprovalCardView(item: item, card: card, enters: turn.live) { approve in
                            model.decideAssistantApproval(itemID: item.id, approve: approve)
                        }
                    }
                }
            }
            switch turn.status {
            case .stopped:
                Text("Stopped")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            case let .failed(message):
                Label(message, systemImage: "exclamationmark.circle")
                    .font(.subheadline)
                    .foregroundStyle(ExpensesTheme.expense(for: scheme))
            case .streaming, .completed:
                EmptyView()
            }
            if !streaming && (!turn.answer.isEmpty || canRetry) {
                actions
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // An answer that changed data can't run again; undoing goes through the Assistant.
    private var canRetry: Bool {
        isLast && !turn.changedData
    }

    private var actions: some View {
        HStack(spacing: 4) {
            if !turn.answer.isEmpty {
                Button(copied ? "Copied" : "Copy Response", systemImage: copied ? "checkmark" : "doc.on.doc") {
                    UIPasteboard.general.string = turn.answer
                    copied = true
                }
                .labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44)
            }
            if canRetry {
                if case .failed = turn.status {
                    Button("Retry", systemImage: "arrow.clockwise", action: retry)
                    .frame(minHeight: 44)
                } else {
                    Button("Retry", systemImage: "arrow.clockwise", action: retry)
                    .labelStyle(.iconOnly)
                    .frame(minWidth: 44, minHeight: 44)
                }
            }
        }
        .disabled(model.isAssistantStreaming)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .buttonStyle(.plain)
        .padding(.leading, turn.answer.isEmpty ? 0 : -12)
        .sensoryFeedback(.success, trigger: copied) { _, copied in copied }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
    }
}

/// A change the Assistant proposed. Nothing changes until the user approves it; the card then
/// keeps the outcome in place of its buttons.
private struct AssistantApprovalCardView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let item: AssistantItem
    let card: AssistantApprovalCard
    /// Cards streamed while the screen is open rise in; opened chats show them as they are.
    let enters: Bool
    let decide: (Bool) -> Void
    @State private var appeared = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(shown(card.title, amountsHidden: model.amountsHidden))
                    .font(.body.weight(.semibold))
                if let meta = card.meta {
                    Text(shown(meta, amountsHidden: model.amountsHidden))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 4)

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(card.rows.enumerated()), id: \.offset) { _, row in
                    rowView(row)
                }
                if card.more > 0 {
                    Text("\(card.more) more")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.leading, 52)
                        .padding(.vertical, 4)
                }
            }
            .opacity(item.state == .dismissed ? 0.55 : 1)

            HStack(spacing: 8) {
                if let total = card.totalCents, let totalOf = card.totalOfCents {
                    HStack(spacing: 0) {
                        AmountText(total)
                            .fontWeight(.medium)
                        Text(" of ")
                            .foregroundStyle(.secondary)
                        AmountText(totalOf)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                if item.state == .pending {
                    choices
                        .transition(.opacity)
                } else {
                    outcome
                        .transition(.opacity)
                }
            }
            .font(.subheadline)
            .padding(.leading, 16)
            .padding(.trailing, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 58)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ExpensesTheme.surface(for: scheme), in: .rect(cornerRadius: 20))
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: item.state)
        .sensoryFeedback(.success, trigger: item.state) { _, state in state == .applied }
        .opacity(appeared || !enters ? 1 : 0)
        .offset(y: appeared || !enters || reduceMotion ? 0 : 6)
        .scaleEffect(appeared || !enters || reduceMotion ? 1 : 0.985, anchor: .top)
        .onAppear {
            withAnimation(.easeOut(duration: 0.26)) {
                appeared = true
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(shown(card.title, amountsHidden: model.amountsHidden))
    }

    private func rowView(_ row: AssistantApprovalCard.Row) -> some View {
        let sub = [row.detail.map { shown($0, amountsHidden: model.amountsHidden) }, row.date.map(AppFormatters.bookingDay)]
            .compactMap { $0 }
            .joined(separator: " · ")
        return HStack(spacing: 10) {
            if row.category != nil || row.date != nil {
                // A transaction without a category shows a question mark.
                CategoryGlyph(categoryID: row.category?.id, iconKey: row.category?.icon, name: row.category?.name)
            } else {
                Color.clear.glyphColumn()
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(row.title)
                    .lineLimit(1)
                if !sub.isEmpty {
                    Text(sub)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            HStack(spacing: 0) {
                if let amount = row.amountCents {
                    AmountText(amount, signed: row.income)
                        .fontWeight(.medium)
                        .foregroundStyle(row.income ? ExpensesTheme.income(for: scheme) : .primary)
                }
                if let of = row.ofCents {
                    Text(" of ")
                        .foregroundStyle(.secondary)
                    AmountText(of)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .frame(minHeight: 50)
        .accessibilityElement(children: .combine)
    }

    private var choices: some View {
        HStack(spacing: 4) {
            Button {
                decide(false)
            } label: {
                Text("Dismiss")
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 38)
                    .contentShape(.capsule)
            }
            .accessibilityIdentifier("assistant.dismiss")
            Button {
                decide(true)
            } label: {
                Text(card.verb)
                    .foregroundStyle(ExpensesTheme.surface(for: scheme))
                    .padding(.horizontal, 16)
                    .frame(minHeight: 38)
                    .background(ExpensesTheme.accent(for: scheme), in: .capsule)
            }
            .accessibilityIdentifier("assistant.approve")
        }
        .fontWeight(.medium)
        .buttonStyle(.plain)
        .expandedTouchArea(3)
        .disabled(model.isAssistantStreaming)
        .opacity(model.isAssistantStreaming ? 0.45 : 1)
    }

    @ViewBuilder
    private var outcome: some View {
        switch item.state {
        case .applied:
            Label {
                Text(card.done)
            } icon: {
                Image(systemName: "checkmark.circle")
                    .foregroundStyle(ExpensesTheme.income(for: scheme))
            }
            .foregroundStyle(.secondary)
        case .failed:
            Label {
                Text(shown(item.message ?? "Not applied", amountsHidden: model.amountsHidden))
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.circle")
                    .foregroundStyle(ExpensesTheme.expense(for: scheme))
            }
            .foregroundStyle(.secondary)
        default:
            Text("Dismissed")
                .foregroundStyle(.secondary)
        }
    }
}

/// One line for reasoning, notes, and ledger reads. While the Assistant works it names the
/// current step; once the answer starts it folds into a summary that opens to list the steps.
private struct AssistantActivity: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let items: [AssistantItem]
    let working: Bool
    @State private var expanded = false

    private var labelKey: String {
        working ? items.last?.id ?? "start" : "done"
    }

    private var label: String {
        let text: String
        if working {
            text = items.last.map(Self.liveLabel) ?? "Thinking"
        } else {
            let tools = items.filter { $0.kind == .tool }
            let seconds = items.reduce(0) { $0 + ($1.kind == .thinking ? $1.seconds ?? 0 : 0) }
            if tools.count > 1 {
                text = "Reviewed \(tools.count) ledger views"
            } else if let tool = tools.first {
                text = tool.label
            } else if seconds > 0 {
                text = "Thought for \(seconds)s"
            } else {
                text = items.last.map(Self.liveLabel) ?? "Thought"
            }
        }
        return shown(text, amountsHidden: model.amountsHidden)
    }

    private var expandable: Bool {
        guard let last = items.last else { return false }
        return items.count > 1 || last.kind == .tool || (last.kind == .thinking && !last.text.isEmpty)
    }

    static func liveLabel(_ item: AssistantItem) -> String {
        switch item.kind {
        case .thinking: "Thinking"
        case .note, .text: item.text
        case .tool: item.label
        case .approval: item.card?.title ?? ""
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if expandable {
                Button {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) {
                        expanded.toggle()
                    }
                } label: {
                    head
                }
                .buttonStyle(.plain)
                .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            } else {
                head
            }
            if expanded && expandable {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(items) { item in
                        AssistantStep(item: item, working: working)
                    }
                }
                .padding(.vertical, 2)
                .transition(.opacity)
            }
        }
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var head: some View {
        HStack(spacing: 6) {
            ZStack(alignment: .leading) {
                WorkingLabel(text: label, working: working)
                    .id(labelKey)
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .asymmetric(
                                insertion: .opacity.combined(with: .offset(y: 5)),
                                removal: .opacity.combined(with: .offset(y: -5))
                            )
                    )
            }
            .animation(.easeOut(duration: 0.22), value: labelKey)
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.tertiary)
                .rotationEffect(.degrees(expanded ? 90 : 0))
                .opacity(expandable ? 1 : 0)
                .accessibilityHidden(true)
        }
        .frame(minHeight: 28)
        .contentShape(.rect)
    }
}

/// The current step's name. While the Assistant works a highlight sweeps across it; with
/// Reduce Motion it stays still, and the words alone say what is happening.
private struct WorkingLabel: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let text: String
    let working: Bool

    var body: some View {
        if working && !reduceMotion {
            TimelineView(.animation) { context in
                let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.8) / 1.8
                let start = -1.5 * phase
                Text(text)
                    .lineLimit(1)
                    .foregroundStyle(
                        LinearGradient(
                            stops: [
                                .init(color: Color(uiColor: .secondaryLabel), location: 0),
                                .init(color: Color(uiColor: .secondaryLabel), location: 0.35),
                                .init(color: .primary, location: 0.5),
                                .init(color: Color(uiColor: .secondaryLabel), location: 0.65),
                                .init(color: Color(uiColor: .secondaryLabel), location: 1),
                            ],
                            startPoint: UnitPoint(x: start, y: 0.5),
                            endPoint: UnitPoint(x: start + 2.5, y: 0.5)
                        )
                    )
            }
        } else {
            Text(text)
                .lineLimit(1)
                .foregroundStyle(.secondary)
        }
    }
}

private struct AssistantStep: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    let item: AssistantItem
    let working: Bool
    @State private var summaryShown = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            lead
                .font(.footnote)
                .glyphColumn(16, relativeTo: .footnote)
            VStack(alignment: .leading, spacing: 2) {
                if item.kind == .thinking && !item.text.isEmpty {
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { summaryShown.toggle() }
                    } label: {
                        WorkingLabel(text: title, working: running)
                    }
                    .buttonStyle(.plain)
                    .accessibilityValue(summaryShown ? "Expanded" : "Collapsed")
                } else {
                    WorkingLabel(text: title, working: running)
                }
                if let detail = item.detail {
                    Text(shown(detail, amountsHidden: model.amountsHidden))
                        .font(.footnote)
                        .foregroundStyle(.tertiary)
                }
                if summaryShown {
                    AssistantMarkdownText(content: shown(item.text, amountsHidden: model.amountsHidden), partial: false, fadesIn: false)
                        .equatable()
                        .font(.footnote)
                        .foregroundStyle(.tertiary)
                        .transition(.opacity)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var running: Bool {
        working && item.isOpen
    }

    private var title: String {
        switch item.kind {
        case .thinking:
            if item.state == .active { return "Thinking" }
            return item.seconds.map { "Thought for \($0)s" } ?? "Thought"
        case .note, .text:
            return shown(item.text, amountsHidden: model.amountsHidden)
        case .tool:
            return shown(item.label, amountsHidden: model.amountsHidden)
        case .approval:
            return shown(item.card?.title ?? "", amountsHidden: model.amountsHidden)
        }
    }

    @ViewBuilder
    private var lead: some View {
        if item.kind == .note || item.isOpen {
            Color.clear.frame(width: 1, height: 1)
        } else if item.state == .failed {
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(ExpensesTheme.expense(for: scheme))
                .accessibilityLabel("Failed")
        } else if item.state == .stopped {
            Image(systemName: "minus.circle")
                .foregroundStyle(.tertiary)
                .accessibilityLabel("Stopped")
        } else {
            Image(systemName: "checkmark.circle")
                .foregroundStyle(.tertiary)
                .accessibilityLabel("Done")
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
    /// Still streaming: markup opened but not yet closed is closed for display.
    let partial: Bool
    /// New blocks fade in as they stream.
    let fadesIn: Bool

    var body: some View {
        let blocks = MarkdownBlock.parse(partial ? Self.healed(content) : content)
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
                    .transition(.opacity)
            }
        }
        .animation(fadesIn ? .easeOut(duration: 0.24) : nil, value: blocks.count)
        .textSelection(.enabled)
    }

    // Half-written bold or code would show its markers until the stream closes them.
    private static func healed(_ text: String) -> String {
        var healed = text
        if healed.components(separatedBy: "`").count.isMultiple(of: 2) {
            healed += "`"
        }
        if healed.components(separatedBy: "**").count.isMultiple(of: 2) {
            healed = healed.hasSuffix("**") ? String(healed.dropLast(2)) : healed + "**"
        }
        return healed
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
        var attributed = (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
        // Links take the app's tint, which matches the text, so they carry an underline as on the web.
        for range in attributed.runs.filter({ $0.link != nil }).map(\.range) {
            attributed[range].underlineStyle = Text.LineStyle(pattern: .solid, color: Color(uiColor: .tertiaryLabel))
        }
        return attributed
    }
}

#Preview {
    NavigationStack {
        AssistantView()
            .environment(AppModel())
    }
}
