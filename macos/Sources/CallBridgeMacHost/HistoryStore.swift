import Foundation

struct HistoryEvent: Codable, Equatable, Sendable {
    let capturedAt: Date
    let bundleIdentifier: String
    let applicationName: String
    let windowTitle: String?
    let documentURL: String?
}

struct HistorySummary: Equatable, Sendable {
    let markdown: String
    let eventCount: Int
}

actor HistoryStore {
    static let rawRetention: TimeInterval = 48 * 60 * 60

    private let directory: URL
    private let eventsURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(directory: URL? = nil) throws {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CallBridge", isDirectory: true)
            .appendingPathComponent("History", isDirectory: true)
        self.directory = base
        self.eventsURL = base.appendingPathComponent("events.jsonl")
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: base.path)
    }

    func append(_ event: HistoryEvent) throws {
        var data = try encoder.encode(event)
        data.append(0x0A)
        if !FileManager.default.fileExists(atPath: eventsURL.path) {
            try data.write(to: eventsURL, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: eventsURL.path)
            return
        }
        let handle = try FileHandle(forWritingTo: eventsURL)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
    }

    func purgeExpired(now: Date = Date()) throws {
        let retained = try readAll().filter { now.timeIntervalSince($0.capturedAt) <= Self.rawRetention }
        try rewrite(retained)
    }

    func recent(since: Date) throws -> [HistoryEvent] {
        try readAll().filter { $0.capturedAt >= since }.sorted { $0.capturedAt < $1.capturedAt }
    }

    func summarizeRecent(hours: Int = 4, now: Date = Date()) throws -> HistorySummary {
        let clampedHours = max(1, min(hours, 48))
        let events = try recent(since: now.addingTimeInterval(TimeInterval(-clampedHours * 60 * 60)))
        guard !events.isEmpty else {
            return HistorySummary(markdown: "No opted-in Mac history was recorded in the last \(clampedHours) hours.", eventCount: 0)
        }

        var lines = ["# Recent Mac activity", ""]
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        for event in events {
            let title = event.windowTitle.map { " - \($0)" } ?? ""
            lines.append("- \(formatter.string(from: event.capturedAt)) | \(event.applicationName)\(title)")
        }
        return HistorySummary(markdown: lines.joined(separator: "\n"), eventCount: events.count)
    }

    private func readAll() throws -> [HistoryEvent] {
        guard FileManager.default.fileExists(atPath: eventsURL.path) else { return [] }
        let data = try Data(contentsOf: eventsURL)
        return data.split(separator: 0x0A).compactMap { try? decoder.decode(HistoryEvent.self, from: Data($0)) }
    }

    private func rewrite(_ events: [HistoryEvent]) throws {
        var data = Data()
        for event in events {
            data.append(try encoder.encode(event))
            data.append(0x0A)
        }
        try data.write(to: eventsURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: eventsURL.path)
    }
}

enum HistorySanitizer {
    private static let sensitiveTerms = ["private browsing", "incognito", "password", "passcode", "one-time code", "2fa", "secret"]

    static func event(
        capturedAt: Date,
        bundleIdentifier: String,
        applicationName: String,
        windowTitle: String?,
        documentURL: String?
    ) -> HistoryEvent? {
        let bundle = bundleIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
        let app = applicationName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !bundle.isEmpty, !app.isEmpty else { return nil }
        let title = clean(windowTitle, limit: 240)
        if let title, sensitiveTerms.contains(where: { title.localizedCaseInsensitiveContains($0) }) { return nil }
        return HistoryEvent(
            capturedAt: capturedAt,
            bundleIdentifier: String(bundle.prefix(240)),
            applicationName: String(app.prefix(120)),
            windowTitle: title,
            documentURL: sanitizeURL(documentURL)
        )
    }

    private static func clean(_ value: String?, limit: Int) -> String? {
        guard let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        let normalized = raw.replacingOccurrences(of: "[\\r\\n\\t]+", with: " ", options: .regularExpression)
        return String(normalized.prefix(limit))
    }

    private static func sanitizeURL(_ value: String?) -> String? {
        guard let value = clean(value, limit: 2_048), var components = URLComponents(string: value) else { return nil }
        components.query = nil
        components.fragment = nil
        return components.string.map { String($0.prefix(1_024)) }
    }
}
