# CallBridge — WebMCP Challenge submission

## One-line story

**The web has APIs. The rest of the world has phone numbers. Ask ChatGPT to call either.**

CallBridge converts a natural-language request into a controlled multilingual
information-gathering phone call. ChatGPT prepares and revises the structured
brief through WebMCP. The webpage keeps the consequential boundary: only the
signed-in person can confirm the exact revision. The call runs once and returns
an evidence-bound result that ChatGPT can read and explain.

## Why WebMCP is essential

Without WebMCP, ChatGPT can describe a call but cannot safely manipulate the
authenticated, revisioned call task visible to the user. CallBridge exposes five
artifact-free tools:

- `create_call_draft`
- `update_call_draft`
- `read_call_draft`
- `get_call_status`
- `get_call_result`

Confirmation, dispatch, payment, booking, cancellation, and message sending are
not tools. The visible **Confirm call** button is trusted-user-action-only and is
bound to the exact execution revision and provider quote.

## Three-minute demo

1. Ask ChatGPT: “Call this Japanese hotel. Ask whether I can arrive after
   midnight. Do not book anything or accept a fee.”
2. Show WebMCP creating the complete visible brief.
3. Review destination, questions, shareable context, authority, and ceiling;
   click **Confirm call** on the webpage.
4. Show one disclosed multilingual call and factual Activity.
5. Show the translated answer and proof receipt; ask ChatGPT to explain it.
6. Close with one non-live Moldova, India, or Thailand example using the same contract.

## Proof boundaries

- One exact-revision confirmation creates at most one attempt.
- Provider-creation uncertainty never authorizes a redial.
- The Realtime worker sees private call text; Convex publishes only accepted,
  bounded signed evidence and the deterministic result.
- The receipt contains canonical task/attempt/revision, languages, question
  coverage, evidence event IDs, terminal facts, disclosure/safety status, and
  provider cost state.
- The receipt never contains a raw transcript, audio, phone number, provider call
  ID, credentials, hidden reasoning, or private background.

## Pre-existing work and challenge work

The repository predates the challenge and includes a historical mobile concierge
prototype plus the generalized telephony/safety foundation. The judged challenge
slice is the WebMCP-era web application and its release hardening:

- authenticated WebMCP task creation/revision/status/result;
- visible exact-revision human confirmation;
- artifact-free five-tool submission catalog;
- generalized inquiry flow rather than a hotel-only product;
- evidence-bound public result receipt;
- judge access, recovery, release gates, public packaging, and demo materials.

Commit history and the historical mobile design are preserved so the distinction
is auditable.

## Candidate acceptance

Run `npm run verify:submission` with the production public build variables. The
gate rejects a browser/Convex WorkOS client mismatch, a Convex deployment
mismatch, or any callback other than the exact production callback. This is
configuration-consistency proof, not proof that WorkOS provisioned the client in
an isolated Production environment. A
candidate is not promoted until the code gate passes, isolated WorkOS Production
judge identities are rehearsed, the production URL is checked in ChatGPT's target
browser, and two separately confirmed post-fix controlled calls pass without
repetition, manual repair, or a hidden second attempt.

The final public repository, live deployment, evidence, and video must all identify
the same candidate commit/build. Any runtime change invalidates the live proof.
