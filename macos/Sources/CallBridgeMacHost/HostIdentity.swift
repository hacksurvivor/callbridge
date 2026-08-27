import CryptoKit
import Foundation
import Security

struct HostIdentity: Codable, Equatable, Sendable {
    let hostId: UUID
    let displayName: String
    let secret: String

    var secretHash: String {
        SHA256.hash(data: Data(secret.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    var pairingURL: URL? {
        var components = URLComponents()
        components.scheme = "callbridge"
        components.host = "pair"
        components.queryItems = [
            URLQueryItem(name: "host", value: hostId.uuidString.lowercased()),
            URLQueryItem(name: "secret", value: secret),
            URLQueryItem(name: "name", value: displayName),
        ]
        return components.url
    }
}

enum HostIdentityError: Error, LocalizedError {
    case randomGenerationFailed(OSStatus)
    case keychain(OSStatus)
    case pairingURL

    var errorDescription: String? {
        switch self {
        case .randomGenerationFailed(let status):
            return "Could not generate the host secret (Security status \(status))."
        case .keychain(let status):
            return "Could not access the host secret in Keychain (Security status \(status))."
        case .pairingURL:
            return "Could not create the pairing token."
        }
    }
}

struct HostIdentityStore {
    private let service = "com.callbridge.mac-host.remote-control"
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func loadOrCreate() throws -> HostIdentity {
        let hostId: UUID
        if let raw = defaults.string(forKey: "CallBridgeRemoteHostId"), let stored = UUID(uuidString: raw) {
            hostId = stored
        } else {
            hostId = UUID()
            defaults.set(hostId.uuidString, forKey: "CallBridgeRemoteHostId")
        }

        let displayName = Host.current().localizedName ?? "My Mac"
        if let secret = try readSecret(account: hostId.uuidString) {
            return HostIdentity(hostId: hostId, displayName: displayName, secret: secret)
        }

        let secret = try generateSecret()
        try saveSecret(secret, account: hostId.uuidString)
        return HostIdentity(hostId: hostId, displayName: displayName, secret: secret)
    }

    private func generateSecret() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else { throw HostIdentityError.randomGenerationFailed(status) }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func readSecret(account: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data, let secret = String(data: data, encoding: .utf8) else {
            throw HostIdentityError.keychain(status)
        }
        return secret
    }

    private func saveSecret(_ secret: String, account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(secret.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw HostIdentityError.keychain(status) }
    }
}
