# CallBridge implementation roadmap

Updated: 2026-08-27

## Current stage

The repository is a deployed development technical-alpha foundation. Convex dev,
WorkOS Staging, the public Cloudflare Pages WebMCP app, the fail-closed telephony
Worker, OpenAI Realtime credentials and the EAS project are configured. No external
effect is enabled and no live call has been made.

## Completed locally

- Revision-bound confirmation and inquiry-only authority.
- Tenant-aware Convex schema, queries, mutations and internal gates.
- WorkOS AuthKit JWT configuration.
- Durable option-gathering jobs, HTTPS dispatch, idempotency and two retries.
- Signed telephony callback, factual result and translated transcript retention.
- HMAC-verified Lemon Squeezy webhook with idempotent entitlement application.
- Five-minute maintenance cron for morning briefs, review prompts and retention.
- Notification outbox, push-token registry and gated Expo push worker.
- Purge of raw task context, activity, transcript and sensitive disclosures.
- Gmail read-only OAuth adapter with PKCE, one-time state, encrypted refresh-token
  storage and bounded thread parsing; Booking Demand 3.2 sandbox-first,
  accommodation-details-only adapter; read-only/draft-only contracts for contacts
  and messaging.
- Sourced public-contact web search through OpenAI Responses; only contacts backed
  by consulted HTTPS sources survive validation.
- AI-assisted message drafts stored for 30 days with no send endpoint.
- Expo integration prototype with honest mock states.
- Web-first general inquiry flow with a structured free-form contract, WebMCP
  tools, revision-bound human confirmation, live activity and decision-ready results.
- Provider-only result evidence, durable recipient opt-out, signed callback
  delivery recovery, and fail-closed provider-cost reconciliation.

## Completed development activation

- Convex development deployment in EU/Ireland.
- Isolated WorkOS `CallBridge` Staging environment wired to Convex AuthKit.
- OpenAI Realtime model credential verified and stored server-side.
- EAS project linked; Expo server token, notification native module and explicit
  registration helper added.
- Country/policy/transcription/retention gate deployed fail-closed.
- Authenticated production-mode web bundle deployed at `https://callbridge-web.pages.dev`;
  AuthKit initiation and the exact HTTPS callback configuration were browser-verified.
- Twilio Media Streams to OpenAI Realtime Worker deployed with provider credentials,
  policy configuration, and `EXTERNAL_EFFECTS_ENABLED=false` verified by its live
  health and authenticated dispatch endpoints.
- Isolated Twilio `CallBridge` subaccount and calls-create-only API key configured.
- Twilio Media Streams to OpenAI Realtime Cloudflare Worker implemented and dry-run validated; provider effects default off.
- Google Cloud `CallBridge` project and Gmail API created; read-only OAuth callback
  is deployed in Convex dev and its refresh-token encryption key is configured.

## Remaining external activation gates

1. Select a Twilio number country and approve the exact phone-number price before purchase.
2. Complete one authenticated, disclosed, consenting controlled PSTN call through
   the deployed web/Convex/Worker path and reconcile its exact provider cost.
3. Approve launch countries and call/transcription disclosure and retention wording; then populate the policy gate.
4. Configure APNs/FCM and register a real device token; the Expo server token is configured.
5. Complete Lemon Squeezy 2FA, then create the store/products/checkout and set the webhook secret.
6. Accept Google API Services User Data Policy, create the web OAuth client with
   the deployed callback URI, and complete one read-only test consent. The server
   adapter itself is deployed.
7. Complete Booking Managed Affiliate onboarding and obtain the Demand API key
   and affiliate ID. The sandbox-first, accommodation-details-only server adapter
   is deployed and does not expose create, modify, cancel or payment operations.
8. Approve launch wedge, brand, pricing, production UX and accessibility acceptance.

Only after the relevant gates pass should `CALLBRIDGE_EXTERNAL_EFFECTS_ENABLED` be set
to exactly `true`. Credentials alone never enable calls, sends or external effects.

## Next acceptance milestone

One authenticated user-authored inquiry completes end to end in a controlled test environment;
the hotel scenario remains only a repeatable demo fixture:

`free-form request -> structured draft -> exact revision confirmation -> provider dispatch -> PSTN test call -> signed live events -> evidence-backed result -> translated decision card -> exact cost settlement`

Acceptance requires an audit trail, no forbidden action, the correct local call window,
retention scheduling, and successful stop/retry failure-path tests.
