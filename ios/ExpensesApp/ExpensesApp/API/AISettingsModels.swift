import Foundation

struct AIModelOption: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let reasoningEfforts: [String]
    enum CodingKeys: String, CodingKey {
        case id, name
        case reasoningEfforts = "reasoning_efforts"
    }
}

struct AIModelCatalog: Codable { let models: [AIModelOption] }

struct AIFeatureSettings: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    var provider: String
    var model: String
    var reasoningEffort: String
    enum CodingKeys: String, CodingKey {
        case id, name, provider, model
        case reasoningEffort = "reasoning_effort"
    }
}

struct AIConnectionStatus: Codable, Equatable {
    let status: String
    let email: String?
    let planAuthorized: Bool
    let usageURL: String
    enum CodingKeys: String, CodingKey {
        case status, email
        case planAuthorized = "plan_authorized"
        case usageURL = "usage_url"
    }
}

struct AISettingsResponse: Codable, Equatable {
    let enabled: Bool
    let configuredAvailable: Bool
    let configuredModel: String
    let connection: AIConnectionStatus
    let features: [AIFeatureSettings]
    enum CodingKeys: String, CodingKey {
        case enabled, connection, features
        case configuredAvailable = "configured_available"
        case configuredModel = "configured_model"
    }
}

struct AISettingsUpdate: Encodable {
    let features: [String: AIFeatureSettings]
}

struct ChatGPTPairingResponse: Codable {
    let pairingCode: String
    let expiresAt: String
    enum CodingKeys: String, CodingKey {
        case pairingCode = "pairing_code"
        case expiresAt = "expires_at"
    }
}

struct ChatGPTDisconnectResponse: Codable {
    let message: String
    let revocationConfirmed: Bool
    enum CodingKeys: String, CodingKey {
        case message
        case revocationConfirmed = "revocation_confirmed"
    }
}
