# CallBridge

Multilingual AI-assisted call delegation. The backend turns typed context,
voice notes/transcripts, URLs, and screenshots into an editable task draft for
accommodation, restaurants, services, transport, delivery, marketplaces,
property, vehicles, and other communication tasks. A draft must be explicitly
confirmed before the server can hand it to a future call agent.

## WebMCP web app

`web/` is now the primary CallBridge surface. ChatGPT can use five stable
page tools to create, replace, read, monitor, and retrieve the result of a
structured inquiry for any supported destination or service. The inquiry
itself is data: objective, ordered questions, private background, shareable
facts, languages, spending ceiling, information-only policy, and an optional
approved playbook.

Call confirmation is intentionally absent from WebMCP. It requires the visible
authenticated **Confirm call** button and is bound to the exact canonical
execution revision. A material edit revokes that confirmation. The approved
browser fixture is available during development at
`http://127.0.0.1:5173/?visualFixture=approved`; it cannot place a phone call.

This web-first inquiry path does not inherit the older mobile retry policy.
Confirmation creates exactly one attempt. Dispatch is persisted as `pending`,
`leased`, `accepted`, `definitely_not_created`, or `creation_uncertain`. A
provider timeout is never treated as permission to dial again: the attempt
stops in `creation_uncertain` until an internal provider lookup proves that the
call exists or definitely does not. Only the latter releases the reserved call
credit; neither outcome creates a second attempt.

## Backend foundation

- Generic category, target, dynamic-details, and delivery-instructions model
- Per-task Full Access, retry, local-call-window, and negotiation settings
- Explicit 30-day memory or no-save mode, acknowledged before a call
- Revision-checked draft creation and replacement
- Explicit confirmation bound to the exact reviewed revision
- Household invitations and per-task sharing with friendly permission levels
- Fee-aware cancellation preparation and confirmation; no cancellation executor
- One-time, revision-bound owner consent before a courier can receive saved entry
  instructions or an intercom code
- Hard-coded `gather_options_only` permissions; booking, payment, accepting
  terms, cancellation, and any irreversible commitment are structurally forbidden
- WorkOS AuthKit identity port and fail-closed Convex JWT configuration
- Convex schema, authenticated queries/mutations, realtime indexes, and an
  internal-only confirmed-task reservation gate
- HMAC-verified Lemon Squeezy HTTP webhook and idempotent entitlement store
- Provider-abstract server-only realtime/telephony gateway port. The launch
  default is `openai_realtime` / `gpt-realtime-2.1-mini`
- Durable option-gathering jobs with an external-effects kill switch, HTTPS-only
  dispatch, idempotency, two bounded retries, and signed result callbacks
- Cron-driven morning briefs, post-stay prompts, retention purge, notification
  outbox processing, and Expo push delivery behind explicit runtime gates
- Tenant-checked translated transcript storage with the same retention purge
- Read-only Gmail OAuth/context and Booking Demand accommodation adapters,
  sourced public-contact web search, and expiring draft-only messaging storage
- A separately deployable Cloudflare Worker bridge in `telephony-worker/` for
  Twilio bidirectional Media Streams and OpenAI Realtime. Its own effects flag
  also defaults to false.

The Convex development deployment, isolated WorkOS Staging project, OpenAI
Realtime credential, Expo server token, and linked EAS project are configured.
The Gmail read-only adapter is deployed but awaits Google OAuth client credentials
and user consent. There is no production deployment, checkout UI, deployed PSTN
bridge, Booking partner credentials, or live provider session. External effects remain
disabled unless
`CALLBRIDGE_EXTERNAL_EFFECTS_ENABLED=true` and all capability requirements in
`.env.example` are present.

## Historical mobile preview

`mobile/` is an Expo / React Native client for the approved conversational
flow: compose a request, review a draft, explicitly confirm a call, follow
factual activity, then decide whether to call back, amend, or cancel. It also
includes the first safe controls for retry, stopping future work, sensitive
courier disclosure, quiet hours, morning briefs, and relationship memory.

It is deliberately a **local preview** until `EXPO_PUBLIC_CONVEX_URL`, a
verified WorkOS-backed authenticated session, and
`EXPO_PUBLIC_ENABLE_REMOTE_SYNC=true` are configured. A URL alone never turns
on mobile writes. In preview mode it cannot call, message, pay, book, or
cancel anything externally.
Voice, link, photo, transcript, and provider-result surfaces remain explicit
prototype/mock states until their native integrations are added.

## Mac remote host

`macos/` contains the first laptop-hosted agent runtime. The native menu-bar
process keeps an outbound connection to the Convex relay, stores pairing
credentials in Keychain, captures opt-in local computer history, and runs
authenticated iPhone instructions through the local Codex CLI inside one
workspace-write sandbox. The iPhone **Mac** tab pairs through iOS Keychain,
queues tasks, follows progress and results, and can request cancellation.

The bridge does not grant call, message, payment, booking, cancellation,
publishing, or deployment authority. See
[the Mac remote bridge design](docs/MAC_REMOTE_BRIDGE.md) for setup, privacy,
and packaging boundaries.

## Commands

```sh
npm install
npm run build
npm test
npm run test:telephony
npm --prefix web test
npm --prefix web run build
npm --prefix web run dev
npm --prefix mobile run typecheck
npm --prefix mobile run web
swift build --package-path macos
swift test --package-path macos
```

See [the backend design](docs/backend-foundation.md) for the state and
integration boundaries.
