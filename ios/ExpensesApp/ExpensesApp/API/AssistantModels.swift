import Foundation

struct AssistantMessageRequest: Encodable {
    let chatID: String?
    let message: String

    enum CodingKeys: String, CodingKey {
        case chatID = "chat_id"
        case message
    }
}

/// How long the server keeps chats after their last message.
struct AssistantSettings: Codable, Equatable {
    var chatDays: Int

    enum CodingKeys: String, CodingKey {
        case chatDays = "chat_days"
    }
}

struct AssistantDecisionRequest: Encodable {
    let itemID: String
    let approve: Bool

    enum CodingKeys: String, CodingKey {
        case itemID = "item_id"
        case approve
    }
}

/// What a proposed change does, row by row, as its approval card shows it.
struct AssistantApprovalCard: Decodable, Equatable {
    struct Row: Decodable, Equatable {
        struct Category: Decodable, Equatable {
            let id: Int
            let name: String
            let icon: String?
        }

        let title: String
        let detail: String?
        let category: Category?
        /// Transaction rows only.
        let date: Date?
        let amountCents: Int?
        /// Shown as "amount of ofCents", such as an allocation of an expense.
        let ofCents: Int?
        let income: Bool

        enum CodingKeys: String, CodingKey {
            case title, detail, category, date, income
            case amountCents = "amount_cents"
            case ofCents = "of_cents"
        }
    }

    let title: String
    let meta: String?
    /// The approve button, such as Add, and the state after it, such as Added.
    let verb: String
    let done: String
    let rows: [Row]
    let more: Int
    let totalCents: Int?
    let totalOfCents: Int?

    enum CodingKeys: String, CodingKey {
        case title, meta, verb, done, rows, more
        case totalCents = "total_cents"
        case totalOfCents = "total_of_cents"
    }
}

/// One step or block of an answer, as the server stores and streams it.
struct AssistantItem: Decodable, Identifiable, Equatable {
    enum Kind: String, Decodable {
        /// Reasoning. Its text is empty when the provider keeps reasoning hidden.
        case thinking
        /// What the model says about its next step before it reads the ledger.
        case note
        /// A ledger read.
        case tool
        /// Answer text.
        case text
        /// A change the Assistant proposed. Nothing changes until the user approves it.
        case approval
    }

    /// Every kind's states: thinking and note are active or done, a tool is running, done,
    /// failed, or stopped, text is streaming or done, and an approval is pending, applied,
    /// dismissed, or failed.
    enum State: String, Decodable {
        case active, done, running, failed, stopped, streaming, pending, applied, dismissed
    }

    let kind: Kind
    let id: String
    var text: String
    var state: State
    /// Thinking only, once it ends.
    let seconds: Int?
    /// Tool only, such as "Spending by category, May 2026".
    let label: String
    /// Tool only, what the read found, such as "3 categories · 1 234,56 €".
    let detail: String?
    /// Approval only.
    let card: AssistantApprovalCard?
    /// Approval only, why an approved change couldn't be applied.
    let message: String?

    enum CodingKeys: String, CodingKey {
        case kind, id, text, state, seconds, label, detail, card, message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(Kind.self, forKey: .kind)
        id = try container.decode(String.self, forKey: .id)
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
        state = try container.decode(State.self, forKey: .state)
        seconds = try container.decodeIfPresent(Int.self, forKey: .seconds)
        label = try container.decodeIfPresent(String.self, forKey: .label) ?? ""
        detail = try container.decodeIfPresent(String.self, forKey: .detail)
        card = try container.decodeIfPresent(AssistantApprovalCard.self, forKey: .card)
        message = try container.decodeIfPresent(String.self, forKey: .message)
    }

    var isOpen: Bool {
        state == .active || state == .running || state == .streaming
    }
}

enum AssistantTurnStatus: String, Decodable {
    case completed, stopped, failed
}

/// One line of the Assistant's `application/x-ndjson` stream.
enum AssistantStreamEvent: Decodable {
    case start(chatID: String)
    /// Adds the item, or replaces the one with its id.
    case item(AssistantItem)
    /// Appends text to an item.
    case delta(id: String, text: String)
    case end(status: AssistantTurnStatus, message: String?)
    case unknown

    private enum CodingKeys: String, CodingKey {
        case type
        case chatID = "chat_id"
        case item, id, text, status, message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "start":
            self = .start(chatID: try container.decode(String.self, forKey: .chatID))
        case "item":
            self = .item(try container.decode(AssistantItem.self, forKey: .item))
        case "delta":
            self = .delta(
                id: try container.decode(String.self, forKey: .id),
                text: try container.decode(String.self, forKey: .text)
            )
        case "end":
            self = .end(
                status: try container.decode(AssistantTurnStatus.self, forKey: .status),
                message: try container.decodeIfPresent(String.self, forKey: .message)
            )
        default:
            self = .unknown
        }
    }
}

struct AssistantChatSummary: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id, title
        case updatedAt = "updated_at"
    }
}

struct AssistantChat: Decodable {
    struct Turn: Decodable {
        let id: Int
        let userText: String
        let items: [AssistantItem]
        let status: AssistantTurnStatus

        enum CodingKeys: String, CodingKey {
            case id, items, status
            case userText = "user_text"
        }
    }

    let id: String
    let turns: [Turn]
}

/// A question and its answer as the Assistant screen shows them.
struct AssistantTurn: Identifiable, Equatable {
    enum Status: Equatable {
        case streaming
        case completed
        case stopped
        case failed(String)
    }

    let id: String
    let userText: String
    var items: [AssistantItem]
    var status: Status
    /// Streamed while the screen was open, so new answer text fades in.
    var live: Bool

    var answer: String {
        items.filter { $0.kind == .text }.map(\.text).joined(separator: "\n\n")
    }

    /// An answer that changed data can't run again; undoing goes through the Assistant.
    var changedData: Bool {
        items.contains { $0.kind == .approval && $0.state == .applied }
    }
}

/// Whether the open chat is ready to show, still loading, or failed to load.
enum AssistantChatState: Equatable {
    case ready
    case loading
    case failed(String)
}
