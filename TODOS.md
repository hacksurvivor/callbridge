# TODOS

## Architecture

### Expand the controlled recipient into an adversarial call laboratory

**What:** Add versioned IVR, noisy-audio, voicemail, refusal, contradiction,
interruption, and multilingual recipient scenarios behind the isolated demo
recipient boundary.

**Why:** The deadline slice proves one deterministic judge flow, but it does not
exercise the failure diversity needed for repeatable long-term voice-agent
regression testing.

**Pros:** Reusable end-to-end quality infrastructure; measurable conversational
regressions; safer development without disturbing real businesses.

**Cons:** Additional scenario state, fixtures, provider cost, and operational
surface that would distract from the challenge submission if built now.

**Context:** Start from `docs/designs/controlled-ai-hotel-recipient.md` after the
submitted release is frozen. Preserve the receiver's atomic admission, closed fact
contract, exact terminal reasons, and no-retry behavior. Add one scenario at a time
with deterministic acceptance criteria and live-canary budgets.

**Effort:** XL
**Priority:** P3
**Depends on:** Submitted release preserved; controlled recipient proven through
two unchanged canaries; provider spend and retention controls operational.

### Reconcile exact controlled-recipient cost after terminal callbacks

**What:** Replace the judging-window conservative allowance with exact settlement
for inbound voice, ConversationRelay, and classifier usage.

**Why:** Admission-count × worst-case allowance is safe for a bounded hackathon,
but it is too coarse for productized regression infrastructure or customer-facing
cost reporting.

**Pros:** Accurate spend telemetry, recoverable unused reserves, and defensible
per-scenario cost trends.

**Cons:** Provider components settle asynchronously and require durable retry,
partial-cost semantics, and additional operational tests.

**Context:** The submission slice intentionally keeps receiver cost outside the
user's quote and holds a conservative worst-case allowance through the UTC window.
Extend the receiver terminal state with idempotent settlement only after exact
provider fields and delay behavior are verified.

**Effort:** L
**Priority:** P3
**Depends on:** Controlled recipient deployed; exact Twilio/ConversationRelay cost
sources verified; terminal callback and reconciliation fixtures available.

### Replace inherited slices with a full WebMCP-era architecture

**What:** Replace the inherited mobile/general-concierge backend slices with a clean web-first task, attempt, event, result, and telephony architecture behind the approved v1 contracts.

**Why:** The reuse-first submission minimizes deadline risk, but leaves long-term conceptual debt from the pre-WebMCP system.

**Context:** The challenge implementation deliberately reuses verified revision, ownership, confirmation, dispatch, Activity, retention, and telephony boundaries. Preserve that submission as an immutable release first. Then replace inherited slices one at a time behind the shared hotel-demo contracts, retaining the state-transition, authority, stopping, callback, and LLM-eval gates established for the submission.

**Effort:** XL
**Priority:** P3
**Depends on:** Submission deployed, tested, filmed, and preserved as an immutable release; complete contract, state-transition, browser E2E, and LLM-eval suites.

## Completed
