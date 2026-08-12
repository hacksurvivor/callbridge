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
| Quiet hours and meaningful morning brief preparation | communication preferences and morning-brief delivery tests | implemented; no provider delivery |
| Sensitive courier disclosure | `sensitiveDisclosures.ts` | implemented, owner-only and single-use |
| Memory, visit summaries and post-stay review | relationship memories and post-stay reviews | implemented; scheduled prompt/deletion needs deployment scheduler |
| Traveler groups and task snapshots | traveler-groups modules and tests | implemented |
| Category search versus notification preference | category automation preferences | implemented |
| Proactive findings | proactive findings approval gate | implemented; no external search adapter |
| Expo mobile concierge flow | `mobile/App.tsx`, `mobile/src/task-store.ts`, `mobile/src/convex-client.ts` | implemented as a local, no-side-effect preview; typechecked and visually reviewed |
| Mobile activity, cancellation, retry, stop and disclosure controls | `mobile/App.tsx` | implemented as safe local UI; live mutation requires configured Convex/auth/provider integration |
| UX information architecture and references | `UX_SPECIFICATION.md`, `PRODUCT.md` | specified and represented in mobile preview; product validation remains ongoing |
| Live voice, telephony, translation, messaging, Gmail/Booking connectors | provider ports only | blocked on provider choices, credentials, and deployment |
| Client application and visual design system | UX spec only | blocked on platform and visual approval |

## Verification baseline

Run `npm test`, `npm run build`, `npm --prefix mobile run typecheck`, and
`git diff --check` before integrating any new slice. A green local suite does
not imply a deployed provider, legal recording compliance, checkout, or a live
call.
