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
/// fields the iOS surface needs are decoded; tool result previews and other
/// internal payloads are intentionally dropped so they cannot reach the UI.
enum AssistantStreamEvent: Decodable {
    case turnStarted
    case toolCallStart(toolCallID: String, toolName: String)
    case toolCallEnd(toolCallID: String, success: Bool)
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
        case success
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
                toolName: try container.decode(String.self, forKey: .toolName)
            )
        case "tool_call_end":
            self = .toolCallEnd(
                toolCallID: try container.decode(String.self, forKey: .toolCallID),
                success: try container.decode(Bool.self, forKey: .success)
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

    var label: String {
        switch toolName {
        case "get_spending_overview":
            "Spending overview"
        case "compare_spending_periods":
            "Comparing periods"
        case "breakdown_spending":
            "Breaking down spending"
        case "search_transactions":
            "Searching transactions"
        case "get_budget_context":
            "Budget context"
        case "get_transaction_detail":
            "Transaction detail"
        default:
            "Using tool"
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
