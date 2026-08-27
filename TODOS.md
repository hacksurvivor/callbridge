# TODOS

## Architecture

### Replace inherited slices with a full WebMCP-era architecture

**What:** Replace the inherited mobile/general-concierge backend slices with a clean web-first task, attempt, event, result, and telephony architecture behind the approved v1 contracts.

**Why:** The reuse-first submission minimizes deadline risk, but leaves long-term conceptual debt from the pre-WebMCP system.

**Context:** The challenge implementation deliberately reuses verified revision, ownership, confirmation, dispatch, Activity, retention, and telephony boundaries. Preserve that submission as an immutable release first. Then replace inherited slices one at a time behind the shared hotel-demo contracts, retaining the state-transition, authority, stopping, callback, and LLM-eval gates established for the submission.

**Effort:** XL
**Priority:** P3
**Depends on:** Submission deployed, tested, filmed, and preserved as an immutable release; complete contract, state-transition, browser E2E, and LLM-eval suites.

## Completed
