import Foundation
import Testing
@testable import CallBridgeMacHost

@Test func historySanitizerRemovesURLSecretsAndPrivateWindows() throws {
    let event = try #require(HistorySanitizer.event(
        capturedAt: Date(timeIntervalSince1970: 100),
        bundleIdentifier: "com.apple.Safari",
        applicationName: "Safari",
        windowTitle: "Project notes",
        documentURL: "https://example.com/work?token=secret#section"
    ))
    #expect(event.documentURL == "https://example.com/work")
    #expect(HistorySanitizer.event(
        capturedAt: Date(),
        bundleIdentifier: "com.apple.Safari",
        applicationName: "Safari",
        windowTitle: "Private Browsing",
        documentURL: nil
    ) == nil)
}

@Test func historyStorePurgesRawEventsAfterFortyEightHours() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try HistoryStore(directory: directory)
    let now = Date(timeIntervalSince1970: 1_000_000)
    try await store.append(HistoryEvent(capturedAt: now.addingTimeInterval(-49 * 60 * 60), bundleIdentifier: "old", applicationName: "Old", windowTitle: nil, documentURL: nil))
    try await store.append(HistoryEvent(capturedAt: now.addingTimeInterval(-60), bundleIdentifier: "new", applicationName: "New", windowTitle: "Current", documentURL: nil))
    try await store.purgeExpired(now: now)
    let recent = try await store.recent(since: .distantPast)
    #expect(recent.map(\.bundleIdentifier) == ["new"])
}

@Test func codexJSONLinesReturnsLastAgentMessage() {
    let output = """
    {"type":"item.completed","item":{"type":"agent_message","text":"first"}}
    {"type":"item.completed","item":{"type":"agent_message","text":"done"}}
    """
    #expect(CodexAgentRuntime.resultSummary(fromJSONLines: output, fallback: "fallback") == "done")
}

@Test func codexInvocationPinsTheRemoteAuthorityBoundary() {
    let arguments = CodexAgentRuntime.invocationArguments(
        instruction: "Update the local README",
        workspace: URL(fileURLWithPath: "/tmp/allowed-workspace")
    )
    #expect(arguments.contains("--ignore-user-config"))
    #expect(arguments.contains("approval_policy=never"))
    #expect(arguments.contains("sandbox_workspace_write.network_access=false"))
    #expect(arguments.contains("shell_environment_policy.inherit=core"))
    #expect(arguments.contains("workspace-write"))
    #expect(!arguments.contains("--dangerously-bypass-approvals-and-sandbox"))
    #expect(!arguments.contains("--add-dir"))
}

@Test func remoteBridgeRequiresHTTPSOutsideLocalDevelopment() throws {
    let identity = HostIdentity(hostId: UUID(), displayName: "Test Mac", secret: String(repeating: "a", count: 43))
    #expect(throws: RemoteBridgeError.self) {
        try RemoteBridgeClient.configured(identity: identity, environment: ["CALLBRIDGE_REMOTE_SITE_URL": "http://example.com"])
    }
    let client = try RemoteBridgeClient.configured(identity: identity, environment: ["CALLBRIDGE_REMOTE_SITE_URL": "https://example.convex.site"])
    #expect(client.baseURL.absoluteString == "https://example.convex.site")
}
