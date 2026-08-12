# CallBridge

Multilingual AI-assisted call delegation. The backend turns typed context,
voice notes/transcripts, URLs, and screenshots into an editable task draft for
accommodation, restaurants, services, transport, delivery, marketplaces,
property, vehicles, and other communication tasks. A draft must be explicitly
confirmed before the server can hand it to a future call agent.

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
- WorkOS AuthKit identity port with fail-closed application behavior
- Convex schema, authenticated queries/mutations, realtime indexes, and an
  internal-only confirmed-task reservation gate
- Lemon Squeezy verified-webhook and idempotent entitlement-store ports
- Provider-abstract server-only realtime/telephony gateway port. The launch
  default is `openai_realtime` / `gpt-realtime-2.1-mini` (no implementation)

No provider credentials, HTTP webhook endpoint, checkout, telephony, OpenAI
session creation, or live deployment is included.

## Mobile preview

`mobile/` is an Expo / React Native client for the approved conversational
flow: compose a request, review a draft, explicitly confirm a call, follow
factual activity, then decide whether to call back, amend, or cancel. It also
includes the first safe controls for retry, stopping future work, sensitive
courier disclosure, quiet hours, morning briefs, and relationship memory.

It is deliberately a **local preview** until `EXPO_PUBLIC_CONVEX_URL`, an
authenticated session, and the legal/provider integrations are configured. In
that mode it cannot call, message, pay, book, or cancel anything externally.

## Commands

```sh
npm install
npm run build
npm test
npm --prefix mobile run typecheck
npm --prefix mobile run web
```

See [the backend design](docs/backend-foundation.md) for the state and
integration boundaries.
