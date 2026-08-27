import AppKit
import ApplicationServices
import Combine
import Foundation

@MainActor
final class HistoryController: ObservableObject {
    @Published private(set) var currentApplicationName = "No active application"
    @Published private(set) var currentBundleIdentifier: String?
    @Published private(set) var accessibilityGranted = AXIsProcessTrusted()
    @Published private(set) var lastCaptureDescription = "History is local and opt-in per app."
    @Published var isPaused: Bool {
        didSet { defaults.set(isPaused, forKey: Self.pausedKey) }
    }
    @Published private(set) var includedBundleIdentifiers: Set<String>

    private static let pausedKey = "CallBridgeHistoryPaused"
    private static let includedKey = "CallBridgeHistoryIncludedBundles"
    private let store: HistoryStore
    private let defaults: UserDefaults
    private var activationObserver: NSObjectProtocol?
    private var captureTimer: Timer?
    private var purgeTimer: Timer?
    private var lastSignature: String?
    private var lastCaptureAt = Date.distantPast

    init(store: HistoryStore, defaults: UserDefaults = .standard) {
        self.store = store
        self.defaults = defaults
        self.isPaused = defaults.bool(forKey: Self.pausedKey)
        self.includedBundleIdentifiers = Set(defaults.stringArray(forKey: Self.includedKey) ?? [])

        let center = NSWorkspace.shared.notificationCenter
        activationObserver = center.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
            Task { @MainActor [weak self] in self?.record(application) }
        }
        captureTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let application = NSWorkspace.shared.frontmostApplication else { return }
                self?.record(application)
            }
        }
        if let application = NSWorkspace.shared.frontmostApplication { record(application) }
        Task { try? await store.purgeExpired() }
        purgeTimer = Timer.scheduledTimer(withTimeInterval: 60 * 60, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { try? await self.store.purgeExpired() }
        }
    }

    deinit {
        if let activationObserver { NSWorkspace.shared.notificationCenter.removeObserver(activationObserver) }
        captureTimer?.invalidate()
        purgeTimer?.invalidate()
    }

    var isCurrentApplicationIncluded: Bool {
        guard let currentBundleIdentifier else { return false }
        return includedBundleIdentifiers.contains(currentBundleIdentifier)
    }

    func setCurrentApplicationIncluded(_ included: Bool) {
        guard let bundle = currentBundleIdentifier else { return }
        if included {
            includedBundleIdentifiers.insert(bundle)
        } else {
            includedBundleIdentifiers.remove(bundle)
        }
        defaults.set(Array(includedBundleIdentifiers).sorted(), forKey: Self.includedKey)
        objectWillChange.send()
        if let application = NSWorkspace.shared.frontmostApplication { record(application) }
    }

    func requestAccessibilityAccess() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        accessibilityGranted = AXIsProcessTrustedWithOptions(options)
    }

    func setPaused(_ paused: Bool) {
        isPaused = paused
        lastCaptureDescription = paused ? "History paused." : "History resumed for opted-in apps."
    }

    func summarize(hours: Int = 4) async -> HistorySummary {
        do {
            return try await store.summarizeRecent(hours: hours)
        } catch {
            return HistorySummary(markdown: "Could not read local history: \(error.localizedDescription)", eventCount: 0)
        }
    }

    private func record(_ application: NSRunningApplication) {
        currentApplicationName = application.localizedName ?? "Unknown application"
        currentBundleIdentifier = application.bundleIdentifier
        accessibilityGranted = AXIsProcessTrusted()
        guard !isPaused,
              let bundle = application.bundleIdentifier,
              includedBundleIdentifiers.contains(bundle) else { return }

        let attributes = accessibilityGranted ? focusedWindowAttributes(processIdentifier: application.processIdentifier) : (nil, nil)
        guard let event = HistorySanitizer.event(
            capturedAt: Date(),
            bundleIdentifier: bundle,
            applicationName: currentApplicationName,
            windowTitle: attributes.0,
            documentURL: attributes.1
        ) else { return }

        let signature = [event.bundleIdentifier, event.windowTitle ?? "", event.documentURL ?? ""].joined(separator: "|")
        guard signature != lastSignature || Date().timeIntervalSince(lastCaptureAt) >= 60 else { return }
        lastSignature = signature
        lastCaptureAt = Date()
        lastCaptureDescription = event.windowTitle.map { "Captured \(event.applicationName): \($0)" } ?? "Captured \(event.applicationName)"
        Task { try? await store.append(event) }
    }

    private func focusedWindowAttributes(processIdentifier: pid_t) -> (String?, String?) {
        let application = AXUIElementCreateApplication(processIdentifier)
        var windowValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute as CFString, &windowValue) == .success,
              let windowValue else { return (nil, nil) }
        let window = windowValue as! AXUIElement
        return (
            stringAttribute(window, attribute: kAXTitleAttribute),
            stringAttribute(window, attribute: kAXDocumentAttribute)
        )
    }

    private func stringAttribute(_ element: AXUIElement, attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }
}
