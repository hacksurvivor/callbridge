import Foundation

struct AgentRunResult: Equatable, Sendable {
    let summary: String
    let exitCode: Int32
}

enum CodexAgentError: Error, LocalizedError {
    case executableNotFound
    case invalidWorkspace(String)
    case launchFailed(String)
    case executionFailed(Int32, String)

    var errorDescription: String? {
        switch self {
        case .executableNotFound:
            return "The Codex CLI was not found in a supported local installation path."
        case .invalidWorkspace(let path):
            return "The configured agent workspace is not a directory: \(path)"
        case .launchFailed(let message):
            return "Could not launch Codex: \(message)"
        case .executionFailed(let code, let message):
            return "Codex exited with status \(code): \(message)"
        }
    }
}

private final class ProcessOutputBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()
    private let maximumBytes = 1_000_000

    func append(_ chunk: Data) {
        guard !chunk.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        data.append(chunk)
        if data.count > maximumBytes { data.removeFirst(data.count - maximumBytes) }
    }

    func string() -> String {
        lock.lock()
        defer { lock.unlock() }
        return String(data: data, encoding: .utf8) ?? ""
    }
}

actor CodexAgentRuntime {
    private var process: Process?

    func run(instruction: String, environment: [String: String] = ProcessInfo.processInfo.environment) async throws -> AgentRunResult {
        let executable = try Self.findExecutable(environment: environment)
        let workspace = try Self.workspace(environment: environment)

        let standardOutput = Pipe()
        let standardError = Pipe()
        let outputBuffer = ProcessOutputBuffer()
        let errorBuffer = ProcessOutputBuffer()
        standardOutput.fileHandleForReading.readabilityHandler = { handle in outputBuffer.append(handle.availableData) }
        standardError.fileHandleForReading.readabilityHandler = { handle in errorBuffer.append(handle.availableData) }

        let launched = Process()
        launched.executableURL = executable
        launched.currentDirectoryURL = workspace
        launched.arguments = Self.invocationArguments(instruction: instruction, workspace: workspace)
        launched.standardOutput = standardOutput
        launched.standardError = standardError
        launched.environment = environment
        process = launched

        do {
            try launched.run()
        } catch {
            process = nil
            standardOutput.fileHandleForReading.readabilityHandler = nil
            standardError.fileHandleForReading.readabilityHandler = nil
            throw CodexAgentError.launchFailed(error.localizedDescription)
        }

        do {
            while launched.isRunning {
                try Task.checkCancellation()
                try await Task.sleep(for: .milliseconds(250))
            }
        } catch {
            if launched.isRunning { launched.terminate() }
            launched.waitUntilExit()
            process = nil
            standardOutput.fileHandleForReading.readabilityHandler = nil
            standardError.fileHandleForReading.readabilityHandler = nil
            throw error
        }

        standardOutput.fileHandleForReading.readabilityHandler = nil
        standardError.fileHandleForReading.readabilityHandler = nil
        outputBuffer.append(standardOutput.fileHandleForReading.readDataToEndOfFile())
        errorBuffer.append(standardError.fileHandleForReading.readDataToEndOfFile())
        process = nil

        let output = outputBuffer.string()
        let errors = errorBuffer.string()
        let summary = Self.resultSummary(fromJSONLines: output, fallback: errors)
        guard launched.terminationStatus == 0 else {
            throw CodexAgentError.executionFailed(launched.terminationStatus, summary)
        }
        return AgentRunResult(summary: summary, exitCode: launched.terminationStatus)
    }

    static func invocationArguments(instruction: String, workspace: URL) -> [String] {
        [
            "exec",
            "--ignore-user-config",
            "--strict-config",
            "-c", "approval_policy=never",
            "-c", "sandbox_workspace_write.network_access=false",
            "-c", "shell_environment_policy.inherit=core",
            "--sandbox", "workspace-write",
            "--ephemeral",
            "--json",
            "--color", "never",
            "-C", workspace.path,
            authorityPrompt(instruction: instruction),
        ]
    }

    func cancel() {
        guard let process, process.isRunning else { return }
        process.interrupt()
        if process.isRunning { process.terminate() }
    }

    static func resultSummary(fromJSONLines output: String, fallback: String) -> String {
        var messages: [String] = []
        for line in output.split(separator: "\n") {
            guard let data = line.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  object["type"] as? String == "item.completed",
                  let item = object["item"] as? [String: Any],
                  item["type"] as? String == "agent_message",
                  let text = item["text"] as? String else { continue }
            messages.append(text)
        }
        let candidate = messages.last ?? fallback.trimmingCharacters(in: .whitespacesAndNewlines)
        if candidate.isEmpty { return "The Mac agent finished without a text summary." }
        return String(candidate.prefix(8_000))
    }

    private static func findExecutable(environment: [String: String]) throws -> URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        var candidates = [
            home.appendingPathComponent(".npm-global/bin/codex"),
            URL(fileURLWithPath: "/opt/homebrew/bin/codex"),
            URL(fileURLWithPath: "/usr/local/bin/codex"),
        ]
        if let explicit = environment["CALLBRIDGE_CODEX_PATH"], !explicit.isEmpty {
            candidates.insert(URL(fileURLWithPath: explicit), at: 0)
        }
        guard let executable = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0.path) }) else {
            throw CodexAgentError.executableNotFound
        }
        return executable
    }

    private static func workspace(environment: [String: String]) throws -> URL {
        let configured = environment["CALLBRIDGE_AGENT_WORKSPACE"] ?? FileManager.default.currentDirectoryPath
        let url = URL(fileURLWithPath: configured).standardizedFileURL
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw CodexAgentError.invalidWorkspace(url.path)
        }
        return url
    }

    private static func authorityPrompt(instruction: String) -> String {
        """
        You are running locally on the user's Mac after an authenticated remote instruction from their paired iPhone.

        Work only inside the configured workspace and obey the workspace's instructions. The workspace-write sandbox is a hard boundary. Do not weaken or bypass it. Do not place calls, send messages or email, make payments, book or cancel services, publish, deploy, change account security, expose secrets, or make other external commitments. If the request needs one of those actions, prepare a local draft or plan and explain the blocked action in the result. Never ask the relay or phone for credentials.

        Complete the authorized local task where possible, verify the result, and finish with a concise summary suitable for the iPhone remote.

        Remote instruction:
        \(instruction)
        """
    }
}
