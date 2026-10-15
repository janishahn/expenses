import Foundation

struct AIBackend: Codable, Equatable, Identifiable {
    let name: String
    let kind: String
    var id: String { name }
}

struct AIModelOption: Codable, Equatable, Identifiable {
    let id: String
    let name: String
}

struct AIModelCatalog: Codable { let models: [AIModelOption] }

struct AIFeatureSettings: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    var enabled: Bool
    var backend: String
    var model: String
    var thinking: String
}

struct AISettingsResponse: Codable, Equatable {
    let backends: [AIBackend]
    let features: [AIFeatureSettings]
}

struct AIFeatureChoice: Encodable {
    let enabled: Bool
    let backend: String
    let model: String
    let thinking: String
}

struct AISettingsUpdate: Encodable {
    let features: [String: AIFeatureChoice]
}
