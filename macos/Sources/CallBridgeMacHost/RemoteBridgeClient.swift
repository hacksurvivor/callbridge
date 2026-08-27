import Foundation

enum RemoteCommandKind: String, Codable, Sendable {
    case agentTask = "agent_task"
    case status
    case pauseHistory = "pause_history"
    case resumeHistory = "resume_history"
    case summarizeRecent = "summarize_recent"
}

enum RemoteCommandState: String, Codable, Sendable {
    case pending
    case running
    case cancellationRequested = "cancellation_requested"
    case succeeded
    case failed
    case cancelled
}

struct RemoteCommand: Codable, Sendable {
    let commandId: String
    let hostId: String
    let clientRequestId: String
    let kind: RemoteCommandKind
    let instruction: String?
    let state: RemoteCommandState
    let requestedAt: String
}

struct RemoteHostStatus: Codable, Sendable {
    let hostId: String
    let displayName: String
    let state: String
    let lastSeenAt: String
}

struct RemoteCommandList: Codable, Sendable {
    let host: RemoteHostStatus
    let commands: [RemoteCommand]
}

enum RemoteBridgeError: Error, LocalizedError {
    case notConfigured
    case invalidResponse
    case rejected(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Set CALLBRIDGE_REMOTE_SITE_URL to the Convex HTTP Actions URL."
        case .invalidResponse:
            return "The remote relay returned an invalid response."
        case .rejected(let status, let message):
            return "Remote relay rejected the request (\(status)): \(message)"
        }
    }
}

struct RemoteBridgeClient: Sendable {
    private struct EmptyResponse: Decodable { let ok: Bool }
    private struct RegisterResponse: Decodable { let ok: Bool; let lastSeenAt: String }
    private struct ClaimResponse: Decodable { let ok: Bool; let command: RemoteCommand? }
    private struct StateResponse: Decodable { let ok: Bool; let state: RemoteCommandState }
    private struct ListResponse: Decodable { let ok: Bool; let host: RemoteHostStatus; let commands: [RemoteCommand] }
    private struct ErrorResponse: Decodable { let error: String? }

    let baseURL: URL
    let identity: HostIdentity

    static func configured(identity: HostIdentity, environment: [String: String] = ProcessInfo.processInfo.environment) throws -> Self {
        guard let raw = environment["CALLBRIDGE_REMOTE_SITE_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let url = URL(string: raw),
              url.scheme == "https" || url.host == "127.0.0.1" || url.host == "localhost" else {
            throw RemoteBridgeError.notConfigured
        }
        return Self(baseURL: url, identity: identity)
    }

    func register() async throws {
        let response: RegisterResponse = try await post("/api/remote/host/register", body: [
            "hostId": identity.hostId.uuidString.lowercased(),
            "displayName": identity.displayName,
        ])
        guard response.ok else { throw RemoteBridgeError.invalidResponse }
    }

    func heartbeat() async throws {
        let response: EmptyResponse = try await post("/api/remote/host/heartbeat", body: [
            "hostId": identity.hostId.uuidString.lowercased(),
        ])
        guard response.ok else { throw RemoteBridgeError.invalidResponse }
    }

    func claimNext() async throws -> RemoteCommand? {
        let response: ClaimResponse = try await post("/api/remote/commands/claim", body: [
            "hostId": identity.hostId.uuidString.lowercased(),
        ])
        guard response.ok else { throw RemoteBridgeError.invalidResponse }
        return response.command
    }

    func appendEvent(commandId: String, kind: String, message: String) async throws {
        let response: EmptyResponse = try await post("/api/remote/commands/event", body: [
            "hostId": identity.hostId.uuidString.lowercased(),
            "commandId": commandId,
            "kind": kind,
            "message": String(message.prefix(1_000)),
        ])
        guard response.ok else { throw RemoteBridgeError.invalidResponse }
    }

    func complete(commandId: String, outcome: RemoteCommandState, summary: String) async throws {
        let response: EmptyResponse = try await post("/api/remote/commands/complete", body: [
            "hostId": identity.hostId.uuidString.lowercased(),
            "commandId": commandId,
            "outcome": outcome.rawValue,
            "summary": String(summary.prefix(8_000)),
        ])
        guard response.ok else { throw RemoteBridgeError.invalidResponse }
    }

    func commandState(commandId: String) async throws -> RemoteCommandState {
        let response: StateResponse = try await post("/api/remote/commands/state", body: [
            "hostId": identity.hostId.uuidString.lowercased(),
            "commandId": commandId,
        ])
        guard response.ok else { throw RemoteBridgeError.invalidResponse }
        return response.state
    }

    func listCommands() async throws -> RemoteCommandList {
        let response: ListResponse = try await post("/api/remote/commands/list", body: [
            "hostId": identity.hostId.uuidString.lowercased(),
        ])
        guard response.ok else { throw RemoteBridgeError.invalidResponse }
        return RemoteCommandList(host: response.host, commands: response.commands)
    }

    private func post<Response: Decodable>(_ path: String, body: [String: String]) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else { throw RemoteBridgeError.notConfigured }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(identity.secret)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw RemoteBridgeError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw RemoteBridgeError.rejected(status: http.statusCode, message: error?.error ?? "Unknown relay error")
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
