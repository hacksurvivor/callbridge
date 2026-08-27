# MVP coverage register

This is an implementation-oriented register, not a product promise. Each row
is grounded in code, tests, or an explicit external gate.

| Area | Current evidence | Status |
| --- | --- | --- |
| Draft, revision and first-contact confirmation | `convex/callTasks.ts`, workflow/service tests | implemented |
| No booking, payment, terms, cancellation or irreversible commitment | permission validator and reservation gate | implemented, fail closed |
| Task sharing and friendly permissions | households, task access, sharing tests | implemented |
| Stop, retries, target local time | retry/task policy modules and tests | implemented |
| Cancellation fee disclosure and manual final confirmation | `convex/cancellations.ts` | implemented; no external executor |
| Dates and timezone guardrails | `dateResolution.ts` and tests | implemented |
| Quiet hours and meaningful morning brief delivery | preferences, deployed dev cron and notification outbox | implemented in dev; live Expo delivery remains gated |
| Sensitive courier disclosure | `sensitiveDisclosures.ts` | implemented, owner-only and single-use |
| Memory, visit summaries and post-stay review | relationship memories, scheduled prompt and retention purge | deployed in dev; external delivery remains disabled |
| Traveler groups and task snapshots | traveler-groups modules and tests | implemented |
| Category search versus notification preference | category automation preferences | implemented |
| Proactive findings | proactive findings approval gate | implemented; no external search adapter |
| Expo mobile concierge flow | `mobile/App.tsx`, task store and gated Convex gateway | integration prototype implemented; production UX intentionally deferred |
| Mobile activity, cancellation, retry, stop and disclosure controls | `mobile/App.tsx` | prototype only; provider data and final native UX remain pending |
| UX information architecture and references | `UX_SPECIFICATION.md`, `PRODUCT.md` | specified and represented in mobile preview; product validation remains ongoing |
| WorkOS authentication | `convex/auth.config.ts`, authenticated functions | isolated Staging environment configured in Convex dev; mobile sign-in flow pending |
| Billing webhook | deployed HTTP route, HMAC verifier, entitlement mutation | implemented and tested in dev; blocked on Lemon store/product and webhook secret |
| Live voice and telephony dispatch | durable Convex job plus tested `telephony-worker/` Twilio Media Streams bridge | Cloudflare deployment authorization and Twilio credentials pending; all effects disabled |
| General inquiry WebMCP flow | structured free-form inquiry contract, revision-bound confirmation, live activity and decision-ready result | implemented and browser-verified locally; no live provider call claimed |
| Result evidence and provider cost | provider-turn-only excerpts, signed ordered callbacks, pending-cost reservation and signed reconciliation | implemented and tested locally; activation remains gated |
| Translation and transcript retention | signed callback, tenant query and purge | backend implemented; live provider output pending |
| Push notifications | subscriptions, outbox, Expo worker, EAS project, server token and explicit client token module | dev foundation configured; APNs/FCM and physical-device registration pending |
| Gmail/Booking/public contact/messaging | deployed read-only Gmail OAuth and Booking Demand adapters, sourced public-contact search, and 30-day draft-only messaging | safe backends implemented; Google client/consent and Booking partner credentials pending; no send endpoint exists |
| Country/legal dispatch gate | `outboundCallPolicy.ts`, readiness and reservation gate | deployed fail-closed; approved country matrix and reviewed wording pending |
| Client application and visual design system | Expo prototype and `DESIGN.md` | prototype implemented; final UX/UI and accessibility approval pending |

## Verification baseline

Run `npm test`, `npm run build`, `npm --prefix web test`, `npm --prefix web run build`,
`npm --prefix telephony-worker test`, `npm --prefix telephony-worker run build`,
`npm --prefix mobile run typecheck`, and
`git diff --check` before integrating any new slice. A green local suite does
not imply a deployed provider, legal recording compliance, checkout, or a live
call.
The external-effects flag defaults off and is independent from provider credentials.
