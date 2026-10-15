import Foundation

// The opaque Pydantic AI `message_history` is carried as `[JSONValue]` (defined
// in DomainModels) so it round-trips across turns without being inspected.

struct AssistantStreamMessage: Encodable {
    let role: String
    let content: String
}

struct AssistantStreamRequest: Encodable {
    let messages: [AssistantStreamMessage]
    let messageHistory: [JSONValue]

    enum CodingKeys: String, CodingKey {
        case messages
        case messageHistory = "message_history"
    }
}

/// One decoded line of the `application/x-ndjson` spending chat stream. Only the
/// fields the iOS surface needs are decoded; raw tool result previews and other
/// internal payloads are intentionally dropped so they cannot reach the UI.
enum AssistantStreamEvent: Decodable {
    case turnStarted
    case toolCallStart(toolCallID: String, toolName: String, arguments: [String: JSONValue])
    case toolCallEnd(toolCallID: String, success: Bool, summary: String?)
    case progressNarration(content: String)
    case textChunk(content: String)
    case textCommit
    case result(assistantMessage: String, messageHistory: [JSONValue])
    case done
    case error(message: String)
    case unknown

    private enum CodingKeys: String, CodingKey {
        case type
        case toolCallID = "tool_call_id"
        case toolName = "tool_name"
        case arguments
        case success
        case resultSummary = "result_summary"
        case content
        case assistantMessage = "assistant_message"
        case messageHistory = "message_history"
        case message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "turn_started":
            self = .turnStarted
        case "tool_call_start":
            self = .toolCallStart(
                toolCallID: try container.decode(String.self, forKey: .toolCallID),
                toolName: try container.decode(String.self, forKey: .toolName),
                arguments: try container.decodeIfPresent([String: JSONValue].self, forKey: .arguments) ?? [:]
            )
        case "tool_call_end":
            self = .toolCallEnd(
                toolCallID: try container.decode(String.self, forKey: .toolCallID),
                success: try container.decode(Bool.self, forKey: .success),
                summary: try container.decodeIfPresent(String.self, forKey: .resultSummary)
            )
        case "progress_narration":
            self = .progressNarration(
                content: try container.decode(String.self, forKey: .content)
            )
        case "text_chunk":
            self = .textChunk(content: try container.decode(String.self, forKey: .content))
        case "text_commit":
            self = .textCommit
        case "result":
            self = .result(
                assistantMessage: try container.decode(String.self, forKey: .assistantMessage),
                messageHistory: try container.decodeIfPresent(
                    [JSONValue].self,
                    forKey: .messageHistory
                ) ?? []
            )
        case "done":
            self = .done
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        default:
            self = .unknown
        }
    }
}

enum AssistantRole {
    case user
    case assistant
}

enum AssistantToolStatus: Equatable {
    case running
    case success
    case failed
}

struct AssistantToolActivity: Identifiable, Equatable {
    let id: String
    let toolName: String
    var status: AssistantToolStatus
    // What the tool looked at, such as "Sep 1 – 30, 2026 · by category".
    let detail: String
    // The server's one-line result, such as "€2,870.49 spent · €5,230.00 income".
    var summary: String?

    init(id: String, toolName: String, arguments: [String: JSONValue]) {
        self.id = id
        self.toolName = toolName
        status = .running
        detail = Self.detail(from: arguments)
    }

    // The web's step detail; arguments come from the model, so missing or odd values are skipped.
    private static func detail(from arguments: [String: JSONValue]) -> String {
        func text(_ key: String) -> String? {
            guard case let .string(value) = arguments[key], !value.isEmpty else { return nil }
            return value
        }
        func number(_ key: String) -> Int? {
            guard case let .number(value) = arguments[key] else { return nil }
            return Int(value)
        }
        var parts: [String] = []
        if let start = text("start"), let end = text("end") {
            parts.append(range(start, end))
        }
        if let start = text("current_start"), let end = text("current_end") {
            parts.append(range(start, end))
        }
        if let query = text("query") {
            parts.append(query)
        }
        if let type = text("transaction_type") {
            parts.append(type)
        }
        if let groupBy = text("group_by") {
            parts.append("by \(groupBy)")
        }
        if let sort = text("sort") {
            parts.append(sort.replacingOccurrences(of: "_", with: " "))
        }
        if let limit = number("limit") {
            parts.append("\(limit) rows")
        }
        if let transactionID = number("transaction_id") {
            parts.append("transaction \(transactionID)")
        }
        return parts.joined(separator: " · ")
    }

    // Only well-formed, ordered days get the readable range.
    private static func range(_ start: String, _ end: String) -> String {
        let day = Date.ISO8601FormatStyle().year().month().day()
        guard let from = try? Date(start, strategy: day), let to = try? Date(end, strategy: day), from <= to else {
            return "\(start) to \(end)"
        }
        return (from ..< to).formatted(Date.IntervalFormatStyle(date: .abbreviated, time: .omitted, timeZone: .gmt))
    }

    /// The web's noun label for the activity line and its step list. The progress line
    /// uses `spinnerPhrase` instead.
    var label: String {
        switch toolName {
        case "get_spending_overview":
            "Spending overview"
        case "compare_spending_periods":
            "Period comparison"
        case "breakdown_spending":
            "Spending breakdown"
        case "search_transactions":
            "Transaction search"
        case "get_budget_context":
            "Budget context"
        case "get_transaction_detail":
            "Transaction detail"
        default:
            toolName.replacingOccurrences(of: "_", with: " ")
        }
    }

    /// Verb phrase shown in the single-line progress spinner while the tool runs.
    var spinnerPhrase: String {
        switch toolName {
        case "get_spending_overview":
            "Getting spending overview…"
        case "compare_spending_periods":
            "Comparing periods…"
        case "breakdown_spending":
            "Breaking down spending…"
        case "search_transactions":
            "Searching transactions…"
        case "get_budget_context":
            "Checking your budgets…"
        case "get_transaction_detail":
            "Looking up the transaction…"
        default:
            "Working on your request…"
        }
    }
}

struct AssistantTurn: Identifiable {
    let id: Int
    let role: AssistantRole
    var content: String
    var progressNarration: String
    var tools: [AssistantToolActivity]
    var isStreaming: Bool
    var isStopped: Bool
    var errorMessage: String?
}
