# Mac Remote Bridge

Concierge's first remote-agent proof runs on macOS. The iPhone is a remote
control; it does not execute agent tools.

## Runtime shape

1. The Mac menu-bar host creates a 256-bit capability secret, stores it in
   Keychain, registers its hash with Convex, and keeps an outbound polling
   connection. The laptop does not expose an inbound port.
2. The iPhone imports the pairing URL and stores the capability in
   iOS Keychain through `expo-secure-store`.
3. The phone queues a bounded command in Convex. The Mac claims it, reports
   progress, and writes the final result back for the phone to display.
4. General tasks run through the installed Codex CLI with `--sandbox
   workspace-write` and `--ephemeral`, rooted at
   `CALLBRIDGE_AGENT_WORKSPACE`. User config is ignored for the subprocess,
   approval escalation and network access are explicitly disabled, and shell
   commands inherit only the core environment.

Convex is the relay/server plane. The Mac is the only worker and full agent
runtime in this prototype.

## Authority boundaries

- Pairing is possession of a high-entropy capability. Convex stores only its
  SHA-256 hash. Treat the pairing URL like a password; the Mac removes it from
  the clipboard after 60 seconds when it is still unchanged.
- A remote agent task can change files only inside the configured workspace.
  The host never launches Codex with an approval or sandbox bypass.
- The host prompt also rejects calls, messages, email, payments, bookings,
  cancellations, publishing, deployment, account-security changes, and secret
  disclosure. Existing Concierge external-effect gates remain disabled and
  independent of this bridge.
- Commands expire after seven days, are idempotent per phone request ID, and
  support cancellation before or during execution.
- The relay limits instructions, results, progress messages, request bodies,
  command history pages, and events per command.

This capability model proves the host protocol before mobile-side execution.
A production release should additionally bind each host to an authenticated
WorkOS account, add abuse-rate limits to host registration, support capability
rotation/revocation, and use an App Store packaged and signed Mac target.

## Computer history

History is local-only and off by default for every application. The user must
opt in the current application from the menu-bar app. Accessibility permission
is requested only when the user selects **Allow window titles**.

The prototype records app activation, a sanitized focused-window title, and a
URL without query or fragment. It does not record screenshots, audio, typed
keys, clipboard contents, or document bodies. Private/incognito and common
credential-window titles are excluded. Raw JSONL is mode `0600`, its directory
is mode `0700`, and events older than 48 hours are removed. Recent summaries
are deterministic local Markdown.

## Local build

The checked-in target is a Swift Package executable for fast validation, not a
signed `.app` bundle.

```sh
swift build --package-path macos
swift test --package-path macos
```

After the Convex functions have been synchronized to an authorized development
deployment, run the host with that deployment's HTTP Actions URL:

```sh
CALLBRIDGE_REMOTE_SITE_URL=https://your-deployment.convex.site \
CALLBRIDGE_AGENT_WORKSPACE=/absolute/path/to/an/allowed/workspace \
swift run --package-path macos CallBridgeMacHost
```

Configure the same site URL in `mobile/.env` as
`EXPO_PUBLIC_CONVEX_SITE_URL`, launch the native iOS build, open the **Mac**
tab, and paste the token copied from the menu-bar host.

No Convex deployment is performed by the repository build or test commands.
