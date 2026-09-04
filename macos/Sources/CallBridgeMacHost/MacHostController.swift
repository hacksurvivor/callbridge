import AppKit
import Combine
import Foundation

@MainActor
final class MacHostController: ObservableObject {
    @Published private(set) var identity: HostIdentity?
    @Published private(set) var relayStatus = "Starting local host..."
    @Published private(set) var activeCommand = "Idle"
    @Published private(set) var lastResult = "No remote tasks have run."
    @Published private(set) var isPolling = false

    let history: HistoryController

    private let historyStore: HistoryStore
    private let agentRuntime = CodexAgentRuntime()
    private var pollingTask: Task<Void, Never>?
    private var localStopRequested = false

    init() {
        do {
            let store = try HistoryStore()
            historyStore = store
            history = HistoryController(store: store)
        } catch {
            fatalError("Concierge could not initialize local history storage: \(error.localizedDescription)")
        }

        do {
            identity = try HostIdentityStore().loadOrCreate()
            relayStatus = "Pairing token ready. Configure the relay URL to connect."
        } catch {
            relayStatus = error.localizedDescription
        }
    }

    deinit { pollingTask?.cancel() }

    var pairingToken: String? { identity?.pairingURL?.absoluteString }

    func start() {
        guard pollingTask == nil else { return }
        pollingTask = Task { [weak self] in await self?.pollRelay() }
    }

    func copyPairingToken() {
        guard let pairingToken else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairingToken, forType: .string)
        relayStatus = "Pairing token copied. Treat it like a password."
        Task {
            try? await Task.sleep(for: .seconds(60))
            if NSPasteboard.general.string(forType: .string) == pairingToken {
                NSPasteboard.general.clearContents()
            }
        }
    }

    func copyRecentSummary() {
        Task {
            let summary = await history.summarize()
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(summary.markdown, forType: .string)
            lastResult = "Copied a local summary of \(summary.eventCount) events."
        }
    }

    func stopActiveTask() {
        localStopRequested = true
        Task { await agentRuntime.cancel() }
    }

    private func pollRelay() async {
        guard let identity else { return }
        let bridge: RemoteBridgeClient
        do {
            bridge = try .configured(identity: identity)
        } catch {
            relayStatus = error.localizedDescription
            return
        }

        isPolling = true
        var lastHeartbeat = Date.distantPast
        while !Task.isCancelled {
            do {
                if lastHeartbeat == .distantPast {
                    try await bridge.register()
                    relayStatus = "Connected. The Mac is polling securely for iPhone tasks."
                    lastHeartbeat = Date()
                }
                if let command = try await bridge.claimNext() {
                    await execute(command, bridge: bridge)
                } else if Date().timeIntervalSince(lastHeartbeat) >= 15 {
                    try await bridge.heartbeat()
                    lastHeartbeat = Date()
                    relayStatus = "Connected. Waiting for iPhone tasks."
                }
                try await Task.sleep(for: .seconds(2))
            } catch is CancellationError {
                break
            } catch {
                relayStatus = error.localizedDescription
                try? await Task.sleep(for: .seconds(5))
                lastHeartbeat = .distantPast
            }
        }
        isPolling = false
    }

    private func execute(_ command: RemoteCommand, bridge: RemoteBridgeClient) async {
        localStopRequested = false
        activeCommand = command.kind.rawValue
        try? await bridge.appendEvent(commandId: command.commandId, kind: "status", message: "The Mac accepted this command.")
        do {
            let summary: String
            switch command.kind {
            case .agentTask:
                guard let instruction = command.instruction, !instruction.isEmpty else {
                    throw CodexAgentError.launchFailed("The remote task did not include an instruction.")
                }
                summary = try await runAgentTask(instruction: instruction, commandId: command.commandId, bridge: bridge)
            case .status:
                summary = "Mac host is online. History is \(history.isPaused ? "paused" : "active for \(history.includedBundleIdentifiers.count) opted-in apps"). Agent workspace: \(ProcessInfo.processInfo.environment["CALLBRIDGE_AGENT_WORKSPACE"] ?? FileManager.default.currentDirectoryPath)."
            case .pauseHistory:
                history.setPaused(true)
                summary = "Mac history capture is paused."
            case .resumeHistory:
                history.setPaused(false)
                summary = "Mac history capture resumed for opted-in apps."
            case .summarizeRecent:
                summary = await history.summarize().markdown
            }
            let state = try await bridge.commandState(commandId: command.commandId)
            let outcome: RemoteCommandState = state == .cancellationRequested ? .cancelled : .succeeded
            let finalSummary = outcome == .cancelled ? "The task was cancelled from the iPhone." : summary
            try await bridge.complete(commandId: command.commandId, outcome: outcome, summary: finalSummary)
            lastResult = finalSummary
        } catch {
            let state = try? await bridge.commandState(commandId: command.commandId)
            let cancelled = localStopRequested || state == .cancellationRequested || error is CancellationError
            let summary = cancelled ? "The task was cancelled from the iPhone." : error.localizedDescription
            try? await bridge.complete(commandId: command.commandId, outcome: cancelled ? .cancelled : .failed, summary: summary)
            lastResult = summary
        }
        activeCommand = "Idle"
        localStopRequested = false
    }

    private func runAgentTask(instruction: String, commandId: String, bridge: RemoteBridgeClient) async throws -> String {
        try await bridge.appendEvent(commandId: commandId, kind: "status", message: "Codex is working in the Mac workspace sandbox.")
        let runtime = agentRuntime
        let cancellationMonitor = Task { () -> Bool in
            var heartbeatTicks = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return false }
                heartbeatTicks += 1
                if heartbeatTicks >= 10 {
                    try? await bridge.heartbeat()
                    heartbeatTicks = 0
                }
                if (try? await bridge.commandState(commandId: commandId)) == .cancellationRequested {
                    await runtime.cancel()
                    return true
                }
            }
            return false
        }
        defer { cancellationMonitor.cancel() }
        let result = try await runtime.run(instruction: instruction)
        try await bridge.appendEvent(commandId: commandId, kind: "result", message: result.summary)
        return result.summary
    }
}
