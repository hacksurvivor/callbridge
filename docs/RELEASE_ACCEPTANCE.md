# Concierge release acceptance

The product boundary is a user-authored, information-only phone inquiry. The
hotel flow is one repeatable demo fixture, not a vertical restriction.

## 2026-09-03 submission candidate checkpoint

The original candidate checkpoint below is retained as historical evidence. The
current release adds a sixth, server-owned `create_demo_call_draft` tool and an
isolated Aurora Demo Hotel ConversationRelay recipient. It does not change the
five general inquiry tools or webpage-only confirmation boundary.

Current source verification:

- `npm run verify:submission` passes with 65 focused backend tests, 26 web tests,
  80 telephony tests, all TypeScript builds, the production web build, and
  production-bundle inspection.
- Root `npm test` passes all 218 discovered repository tests.
- The controlled recipient is disabled by default and cannot admit a call until
  its private number, expected origin, Twilio signature secret, daily budget,
  and exact outbound reservation are present.
- Its deterministic fact sheet answers supported questions with canonical
  server text, preserves an explicit unknown topic, rejects direct calls, and
  exposes no destination number through WebMCP or the browser.

Earlier 2026-09-03 checkpoint:

- `npm run verify:submission` passed: 65 focused inquiry backend tests, 20 web
  tests, 76 telephony-worker tests, backend and worker TypeScript builds, the
  production web build, and artifact-free production-bundle inspection.
- The ChatGPT Site wrapper passed its 2 session-token tests and complete
  five-stage production build. Its public entry exposes **Continue with ChatGPT**
  and reaches the official OpenAI OAuth endpoint; the email fallback remains
  separate.
- Local browser QA passed at 375, 768, and 1280 CSS pixels with no horizontal
  overflow or application console error. The final confirmation is a separate
  webpage-only step, and the result fixture exposes all answers, source excerpts,
  connected duration, provider cost, disclosure state, safety state, and terminal
  outcome.
- Full-history and current-worktree gitleaks scans passed with the checked-in
  narrow configuration for deterministic non-secret fixtures and ignored local
  Convex runtime state.
- Current production dependency audits report zero known vulnerabilities. The
  six direct runtime packages declare permissive licenses: Apache-2.0, MIT, or
  ISC; Concierge itself now carries a root MIT license.
- The production bundle contained the five inquiry tools and none of the three
  task-artifact tool names or artifact fixture surface.
- Target-browser dynamic abort/re-registration could not be proven because the
  isolated automation tab did not expose `document.modelContext`. Per the
  preapproved cut rule, the candidate uses five static WebMCP call tools and
  keeps lifecycle authority in Convex.
- Root `npm test` remains honestly non-green: 214 tests pass and two unshipped
  historical mobile suites fail before collection because `expo/tsconfig.base`
  is unavailable in this worktree. The submission-specific gate excludes those
  exact suites by explicit test list; it does not claim the root command passed.
- Candidate verification fails when the production browser and Convex client
  IDs diverge, when their Convex URLs diverge, or when the callback is not
  exactly `https://callbridge-web.pages.dev/callback`. This protects the email
  fallback configuration; the primary judge path uses ChatGPT sign-in and the
  versioned Concierge token bridge.

This is code-gate evidence only. Promotion still requires a committed/deployed
candidate, an authenticated target-browser WebMCP smoke on that deployment, two
consecutive separately confirmed post-fix calls, a clean-clone reproduction, and
final public video/link verification.

## Executable scenario matrix

The deterministic matrix in `shared/inquiryAcceptanceFixtures.ts` exercises:

| Scenario | Market | What must remain general |
| --- | --- | --- |
| Hotel late-arrival policy | Japan | Accommodation rules without changing a reservation |
| Repair price and availability | India | Arbitrary service questions and quoted fees without accepting them |
| Clinic administrative requirements | Thailand | Administrative facts without medical advice |
| Airline baggage clarification | United Kingdom | Ticket rules without changing a ticket |
| Restaurant accessibility | Moldova | Accessibility facts without reserving a table |
| Utility account procedure | Kazakhstan | Required documents without authorizing an account change |
| Multilingual government procedure | Georgia | Different call/result languages and code-switching evidence |
| Delivery pickup procedure | Mexico | Parcel instructions without redirecting or releasing it |

Every scenario passes the same shared contract, dispatch validation, Realtime
instruction rendering, provider-only evidence validation, and deterministic
result projection. The Thailand clinic scenario also crosses server draft,
pricing, exact-revision confirmation, one-attempt dispatch, signed events,
signed result publication, and exact cost settlement. Free-form context is
explicitly treated as untrusted data at both session and opening-turn scope;
the final authority boundary still forbids booking, payment, fee/term acceptance,
cancellation, and commitments.

## Automated promotion gates

- Root contract/state/event/retention/security tests and TypeScript build.
- Telephony worker tests, TypeScript build, and Cloudflare deployment dry-run.
- WebMCP registration tests, production web build, and deterministic browser QA.
- Busy, voicemail, IVR, no-answer, partial, ambiguous, refusal, interruption,
  timeout, and user-stop paths must never fabricate a successful answer or dial
  more than once.

## Versioned live model gates

The worker owns two opt-in, billable suites. They do not run during ordinary
unit tests and never persist model responses (`store: false` for Responses API
requests). They require the explicit `CALLBRIDGE_EVAL_OPENAI_API_KEY` environment
variable and never scan generic application environment files or credentials:

```sh
npm --prefix telephony-worker run build:evals
npm --prefix telephony-worker run eval:live
npm --prefix telephony-worker run eval:verify-manifest
```

- `inquiry-agent-v1` opens real text-only Realtime WebSocket sessions against
  `gpt-realtime-2.1-mini`. Six live cases enforce exact first-turn disclosure,
  server-owned disclosure canonicalization, information-only authority, prompt-
  injection resistance, explicit medical-advice refusal, private context
  handling, and call-language separation. Two additional deterministic cases
  reject hostile objective/question control text before any model or dial path.
- `inquiry-result-v1` sends seven synthetic transcripts through the exact
  production `gpt-5.4-mini` request builder and fail-closed parser. It enforces
  provider-only evidence, explicit ambiguity, corrections, unanswered results,
  prompt-injection resistance, recipient opt-out, and commitment-violation
  detection.

Latest local gate: **two consecutive 13/13 live passes (26 passing samples) on
2026-08-27**, bound to the audited source with SHA-256 in
`telephony-worker/evals/latest-run.json`. `eval:live` always performs both runs,
generates the manifest from an explicit ordered source-file list, and verifies
it; `eval:verify-manifest` rechecks it without an API call. The suite source and redacted manifest
are the versioned record; generated model text and credentials are neither
committed nor written to snapshots.

## Separately authorized live proof

The deterministic and live text matrices do not claim audio transport, speech
recognition, synthesized speech, PSTN latency, or provider translation quality.
The HTTPS app, AuthKit initiation/callback configuration, Convex development
backend, and fail-closed telephony Worker were deployed and smoke-tested on
2026-08-27. Authenticated dispatch returned `definitely_not_created` with
`external_effects_disabled`, proving that deployment alone cannot dial.

Release promotion still requires a completed real authenticated session, one
consenting controlled recipient, a disclosed PSTN call, signed observed events,
an evidence-backed translated result, and exact provider-cost settlement. Live
dialing, provider permission changes, and number purchase remain separately gated.
