# Concierge

> **The web has APIs. The rest of the world has phone numbers. Ask ChatGPT to call either.**

Concierge lets a person describe any legitimate information-gathering inquiry.
ChatGPT turns it into a visible structured call brief on the webpage; the person
reviews the exact revision and is the only one who can confirm it. Concierge
then places one disclosed multilingual call and returns an evidence-bound answer.

## WebMCP web app

`web/` is the primary Concierge surface. ChatGPT can use five stable
general page tools to create, replace, read, monitor, and retrieve the result of a
structured inquiry for any supported destination or service. The inquiry
itself is data: objective, ordered questions, private background, shareable
facts, languages, spending ceiling, information-only policy, and an optional
approved playbook.

The executable release matrix covers accommodation, repairs, clinic
administration, airline baggage, restaurant accessibility, utility procedures,
government documents, and delivery pickup across Asia, Europe, the Americas,
and post-Soviet markets. See [release acceptance](docs/RELEASE_ACCEPTANCE.md).

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

The hackathon submission adds `create_demo_call_draft`, a sixth server-owned
entry point for the controlled Aurora Demo Hotel recipient. It lets a judge ask
original questions while Concierge supplies the private destination, fixed
information-only authority, one-attempt limit, and a one-time challenge credit.
The five general tools and this controlled creator ship as one static,
artifact-free catalog. Convex remains authoritative for lifecycle permissions,
so stale or invalid mutation attempts fail closed. Dynamic lifecycle removal was
tested at the unit boundary but is not part of the candidate because the exact
target-browser abort/re-registration behavior could not be proven reliably before
the release cutoff.

## Evidence receipt

`get_call_result` and the webpage consume the same canonical `{ result, receipt }`
projection. The receipt binds the answer to the owned task, attempt, execution
revision, languages, answered/unresolved question IDs, accepted evidence event
IDs, duration, terminal reason, disclosure and commitment-safety states, and
provider-cost status. It excludes phone numbers, provider call IDs, raw transcript,
audio, credentials, private background, and hidden reasoning.

## Submission status

- Candidate code gate: `npm run verify:submission`
- Primary judge entry: [`avoider-3000.moloman.chatgpt.site`](https://avoider-3000.moloman.chatgpt.site)
  with **Continue with ChatGPT**; judges do not configure Twilio, OpenAI keys, or a calling provider
- Final external gates: deploy this exact candidate to the public judge entry,
  complete one target-browser WebMCP rehearsal, pass two consecutive post-fix
  controlled calls, reproduce from a clean public clone, and verify the public
  video and submission links
- Root `npm test` is not used as the submission gate because it also discovers two
  unshipped historical mobile suites whose local Expo config is unavailable; this
  limitation is disclosed rather than hidden

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
- ChatGPT sign-in with short-lived, audience-bound Convex JWTs; WorkOS AuthKit
  remains the email fallback
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

The primary judge URL is
[`avoider-3000.moloman.chatgpt.site`](https://avoider-3000.moloman.chatgpt.site),
which starts with **Continue with ChatGPT** and then loads the same authenticated
WebMCP workspace. The email fallback remains available at
[`callbridge-web.pages.dev`](https://callbridge-web.pages.dev). Final candidate
promotion requires that both web entries and the Convex deployment are bound to
the same reviewed source. The current
Twilio/OpenAI Realtime bridge is available at
[`callbridge-telephony.office-sergey-moloman.workers.dev`](https://callbridge-telephony.office-sergey-moloman.workers.dev/health).
A previous controlled Romanian PSTN canary completed successfully; it predates this
submission hardening and therefore does not count as final-candidate proof. Every
new call still requires a separate exact-revision webpage confirmation.

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
npm run verify:submission
npm run test:telephony
npm --prefix telephony-worker run build:evals
# Billable and opt-in; requires CALLBRIDGE_EVAL_OPENAI_API_KEY:
npm --prefix telephony-worker run eval:live
npm --prefix web test
npm --prefix web run build
npm --prefix web run build:production
npm --prefix web run deploy
npm --prefix web run dev
npm --prefix mobile run typecheck
npm --prefix mobile run web
swift build --package-path macos
swift test --package-path macos
```

See [the backend design](docs/backend-foundation.md) for the state and
integration boundaries.

## Challenge lineage

Concierge existed before the WebMCP Challenge as a mobile-first call-avoidance
prototype. The challenge work is the web-first WebMCP adapter and authenticated
review/confirmation/result experience, not a claim that the whole repository was
created during the event. See [the submission notes](docs/SUBMISSION.md) for the
exact judged slice.

Licensed under the [MIT License](LICENSE).
