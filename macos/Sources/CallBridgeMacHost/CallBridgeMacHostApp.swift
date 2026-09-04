import AppKit
import SwiftUI

private final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
    }
}

@main
struct CallBridgeMacHostApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var controller = MacHostController()

    var body: some Scene {
        MenuBarExtra("Concierge Mac Host", systemImage: controller.isPolling ? "iphone.and.arrow.forward" : "laptopcomputer.slash") {
            MacHostMenu(controller: controller)
                .task { controller.start() }
        }
        .menuBarExtraStyle(.window)
    }
}

private struct MacHostMenu: View {
    @ObservedObject var controller: MacHostController
    @ObservedObject private var history: HistoryController

    init(controller: MacHostController) {
        self.controller = controller
        self.history = controller.history
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "laptopcomputer.and.iphone")
                    .font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Concierge Mac")
                        .font(.headline)
                    Text(controller.activeCommand)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Circle()
                    .fill(controller.isPolling ? Color.green : Color.orange)
                    .frame(width: 9, height: 9)
                    .accessibilityLabel(controller.isPolling ? "Connected" : "Not connected")
            }

            Text(controller.relayStatus)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Label("iPhone remote", systemImage: "iphone")
                    .font(.subheadline.weight(.semibold))
                Text(controller.identity?.displayName ?? "Host identity unavailable")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    controller.copyPairingToken()
                } label: {
                    Label("Copy pairing token", systemImage: "link")
                }
                .disabled(controller.pairingToken == nil)
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Label("Local computer history", systemImage: "clock.arrow.circlepath")
                    .font(.subheadline.weight(.semibold))
                Toggle("Pause history", isOn: Binding(
                    get: { history.isPaused },
                    set: { history.setPaused($0) }
                ))
                Toggle("Include \(history.currentApplicationName)", isOn: Binding(
                    get: { history.isCurrentApplicationIncluded },
                    set: { history.setCurrentApplicationIncluded($0) }
                ))
                .disabled(history.currentBundleIdentifier == nil)
                Text(history.lastCaptureDescription)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if !history.accessibilityGranted {
                    Button {
                        history.requestAccessibilityAccess()
                    } label: {
                        Label("Allow window titles", systemImage: "accessibility")
                    }
                }
                Button {
                    controller.copyRecentSummary()
                } label: {
                    Label("Copy recent summary", systemImage: "doc.on.doc")
                }
            }

            Divider()

            Text(controller.lastResult)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(4)

            HStack {
                Button {
                    controller.stopActiveTask()
                } label: {
                    Label("Stop task", systemImage: "stop.fill")
                }
                .disabled(controller.activeCommand == "Idle")
                Spacer()
                Button("Quit") { NSApplication.shared.terminate(nil) }
            }
        }
        .padding(16)
        .frame(width: 380)
    }
}
