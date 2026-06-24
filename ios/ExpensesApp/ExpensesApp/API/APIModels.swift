import Foundation

struct MobileStatus: Codable, Equatable {
    let app: String
    let version: String
    let setupRequired: Bool
    let setupTokenRequired: Bool
    let signupAllowed: Bool
    let timezone: String
    let receiptMaxBytes: Int

    enum CodingKeys: String, CodingKey {
        case app
        case version
        case setupRequired = "setup_required"
        case setupTokenRequired = "setup_token_required"
        case signupAllowed = "signup_allowed"
        case timezone
        case receiptMaxBytes = "receipt_max_bytes"
    }
}

struct MobileAuthRequest: Codable {
    let username: String
    let password: String
    let deviceID: String
    let deviceName: String

    enum CodingKeys: String, CodingKey {
        case username
        case password
        case deviceID = "device_id"
        case deviceName = "device_name"
    }
}

struct MobileAuthIdentity: Codable, Equatable {
    let authenticated: Bool
    let user: AuthUser?
    let token: String?
    let session: MobileSession?

    func withoutToken() -> MobileAuthIdentity {
        MobileAuthIdentity(
            authenticated: authenticated,
            user: user,
            token: nil,
            session: session
        )
    }
}

struct AuthUser: Codable, Equatable {
    let id: Int
    let username: String
    let isAdmin: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case username
        case isAdmin = "is_admin"
    }
}

struct MobileSession: Codable, Equatable, Identifiable {
    let id: Int
    let deviceID: String
    let deviceName: String
    let createdAt: Date
    let lastUsedAt: Date?
    let expiresAt: Date
    let revokedAt: Date?
    let elevatedUntil: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case deviceID = "device_id"
        case deviceName = "device_name"
        case createdAt = "created_at"
        case lastUsedAt = "last_used_at"
        case expiresAt = "expires_at"
        case revokedAt = "revoked_at"
        case elevatedUntil = "elevated_until"
    }
}

struct AdminElevationResponse: Codable, Equatable {
    let elevated: Bool
    let elevatedUntil: Date?

    enum CodingKeys: String, CodingKey {
        case elevated
        case elevatedUntil = "elevated_until"
    }
}

struct AdminElevationRequest: Codable, Equatable {
    let password: String
}

struct APIErrorInfo: Error, Equatable {
    var message: String
    var statusCode: Int?
    var requestID: String?
}
