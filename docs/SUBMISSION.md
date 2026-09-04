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
general artifact-free tools:

- `create_call_draft`
- `update_call_draft`
- `read_call_draft`
- `get_call_status`
- `get_call_result`

For a repeatable judge-safe proof, `create_demo_call_draft` creates the same
general inquiry contract against Aurora Demo Hotel, a disclosed automated test
desk reached through the real phone network. The judge supplies original
information-only questions; the server owns its private number, safety policy,
maximum duration, one-attempt rule, and challenge credit.

Confirmation, dispatch, payment, booking, cancellation, and message sending are
not tools. The visible **Confirm call** button is trusted-user-action-only and is
bound to the exact execution revision and provider quote.

## Three-minute demo

1. Open the public judge URL and choose **Continue with ChatGPT**.
2. Ask ChatGPT: “Use the controlled demo hotel. Ask whether I can arrive after
   midnight, when breakfast is served, and whether renovation noise is scheduled.”
3. Show WebMCP creating the complete visible brief.
4. Review destination, questions, shareable context, authority, and ceiling;
   click **Confirm call** on the webpage.
5. Show the disclosed real PSTN call between CallBridge and the controlled AI
   hotel desk, including one intentionally unknown answer, and factual Activity.
6. Show the translated answer and proof receipt; ask ChatGPT to explain it.
7. Close with the eight-market fixture matrix to prove that the hotel is a demo,
   not a product boundary.

The public judge flow requires no Twilio account, provider credentials, API key,
or country-permission setup. CallBridge owns that infrastructure. Each judge
still reviews a fresh price and confirms one exact revision on the webpage.

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
- artifact-free five general tools plus one controlled-recipient creator;
- generalized inquiry flow rather than a hotel-only product;
- evidence-bound public result receipt;
- judge access, recovery, release gates, public packaging, and demo materials.

Commit history and the historical mobile design are preserved so the distinction
is auditable.

## Candidate acceptance

Run `npm run verify:submission` with the production public build variables. The
gate rejects an email-fallback browser/Convex WorkOS client mismatch, a Convex
deployment mismatch, or any callback other than the exact production callback.
The primary judge entry uses ChatGPT sign-in and exchanges the authenticated
ChatGPT identity for a five-minute, audience-bound Convex token. A candidate is
not promoted until both identity paths build, the public ChatGPT sign-in reaches
the official OpenAI authorization endpoint, the authenticated workspace is
checked in ChatGPT's target browser, and two separately confirmed post-fix
controlled calls pass without repetition, manual repair, or a hidden second
attempt.

The final public repository, live deployment, evidence, and video must all identify
the same candidate commit/build. Any runtime change invalidates the live proof.
