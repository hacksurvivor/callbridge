# CallBridge

## One-line Summary

**The web has APIs. The rest of the world has phone numbers. CallBridge lets
ChatGPT make the inquiry call you do not want to make while the webpage keeps
you in control.**

## Problem

Many everyday services still require a phone call: checking appointment
availability, asking about accessibility, clarifying a bill, confirming a
delivery window, or speaking with a business in another language. These calls
are disproportionately difficult for people with phone anxiety, language
barriers, hearing or speech constraints, or simply limited time.

A chat assistant can help write a script, but the user still has to leave the
conversation, copy details into another product, configure a provider, place
the call, remember the answers, and translate the result. Giving an agent
unrestricted authority to call, book, pay, cancel, or agree to terms would solve
the inconvenience by creating a larger trust problem.

## Solution

CallBridge turns a natural-language request into a controlled, multilingual
information-gathering phone call.

ChatGPT uses WebMCP to create and revise a structured call plan on the signed-in
CallBridge page. The person sees the destination, questions, context, languages,
authority boundary, price ceiling, and exact revision. Only the person can press
**Confirm one call**. Confirmation is deliberately absent from the WebMCP tool
catalog.

The disclosed voice agent conducts one bounded inquiry, handles interruptions
and corrections, avoids repeating resolved questions, and asks at most one
clarification when an answer is incomplete. It cannot book, purchase, cancel,
accept a fee, or make a commitment. CallBridge returns a translated summary,
per-question answer status, evidence excerpts, duration, provider-reported cost,
disclosure status, and a one-attempt receipt. ChatGPT can then retrieve and
explain that result through WebMCP.

The user never configures Twilio, OpenAI credentials, calling countries, or API
keys. CallBridge owns the provider infrastructure; each call still requires a
fresh visible quote and exact human confirmation.

For repeatable judging, CallBridge also provides **Aurora Demo Hotel**, an
explicitly fictional automated test desk reached through the real phone
network. Judges can ask original questions. The recipient answers only from a
versioned server-owned fact sheet, says when information is unavailable, and
cannot book or take payment. This proves the same general phone-inquiry product
without repeatedly disturbing a real business.

## Why This Matters

CallBridge makes agents useful beyond websites without hiding consequential
actions from people. It creates a practical boundary between agent preparation
and human authority:

- The agent can do the tedious cognitive work: turn intent into a complete plan,
  revise it, monitor progress, and explain evidence.
- The person retains the consequential act: approving one exact call with known
  scope and price.
- The business being called receives an immediate AI disclosure and can refuse
  or decline to answer.
- Unanswered or uncertain information stays unanswered or uncertain; the system
  does not invent a clean result.

Before WebMCP, ChatGPT could describe the plan but could not safely manipulate
the authenticated, revisioned task visible on the webpage. With WebMCP, the same
conversation becomes an observable collaboration between the agent and the
human, while the page and backend preserve the trust boundary.

## How We Used AI

The live phone worker uses OpenAI Realtime (`gpt-realtime-2.1-mini`) for
low-latency multilingual conversation over a Twilio bidirectional Media Stream.
The session policy tracks every requested question as unasked, asked, answered,
or unavailable; processes corrections; supports barge-in; limits clarification;
and ends gracefully when the inquiry is complete.

A separate strict extraction step converts bounded call evidence into candidate
facts. Convex accepts signed events and deterministically produces the public
result. The model does not directly publish the final receipt and cannot grant
itself additional authority.

## How We Used Codex

Codex was our engineering collaborator throughout the WebMCP challenge slice. It
helped us:

- rethink a pre-existing mobile call-avoidance concept as a web-first WebMCP
  product;
- design the structured inquiry contract and exact-revision confirmation model;
- implement and test the React, Convex, Cloudflare Worker, Twilio Media Streams,
  and OpenAI Realtime boundaries;
- build the ChatGPT-style judge experience and responsive browser UI;
- characterize race conditions, disclosure interruptions, duplicate questions,
  provider uncertainty, stale confirmations, and forbidden authority;
- create deterministic acceptance fixtures, release gates, documentation, and
  the submission package.

Human decisions remained explicit for the product direction, legal terms,
external effects, candidate commits, deployments, and every real call.

## Key Features

- **Five general WebMCP tools:** create draft, update draft, read draft, read call
  status, and read call result.
- **One controlled demo creator:** `create_demo_call_draft` supplies the private
  recipient, fixed authority, one-attempt limit, and a one-time challenge credit
  while letting the judge author the questions.
- **Human-only execution:** WebMCP cannot confirm, dispatch, pay, book, cancel, or
  send messages.
- **Revision-bound consent:** any material change invalidates the previous
  confirmation.
- **One attempt:** provider uncertainty never silently authorizes a second call.
- **Natural inquiry intelligence:** resolved questions are not repeated;
  interruptions, corrections, uncertainty, refusal, and one bounded
  clarification are handled explicitly.
- **Evidence-bound result:** every requested question is answered, unanswered,
  or uncertain and links to accepted call evidence.
- **Transparent receipt:** duration, actual provider cost state, disclosure,
  terminal reason, language, and attempt identity are visible.
- **No provider onboarding:** judges and users do not need a Twilio account or an
  API key.
- **General-purpose inquiries:** the hotel scenario is a memorable demo, not a
  product restriction; the same contract covers arbitrary service inquiries.

## Architecture

1. **ChatGPT in-app browser** invokes five general tools plus one controlled
   demo creator registered through
   `document.modelContext.registerTool` on the CallBridge page.
2. **React/Vite** renders the shared human-agent workspace, confirmation boundary,
   live Activity, and evidence-bound result.
3. **ChatGPT OAuth or WorkOS AuthKit** establishes the user's identity. The
   ChatGPT bridge exchanges identity for a short-lived, audience-bound Convex
   token.
4. **Convex** owns task state, permissions, revisions, idempotency, attempt
   reservation, accepted evidence, Activity ordering, and deterministic result
   projection.
5. **Cloudflare Worker** owns the bounded realtime call session and signed result
   callbacks.
6. **Twilio Voice Media Streams** connects the calling agent to **OpenAI
   Realtime**. A separate Twilio ConversationRelay route powers the controlled
   facts-backed AI recipient; the two agents communicate over a real PSTN call.

The browser registers tools and renders state. Convex owns authority. The worker
handles temporary live audio. Only the webpage can confirm or stop a call.

## Testing Instructions

1. Open the public demo in ChatGPT's in-app browser.
2. Choose **Continue with ChatGPT**. No provider account or API key is required.
3. Ask ChatGPT: “Use the controlled demo hotel. Ask whether I can arrive after
   midnight, when breakfast is served, and whether renovation noise is
   scheduled. Do not book anything or accept a fee.”
4. Observe ChatGPT create the complete structured call plan through WebMCP.
5. Review the visible destination, questions, context, languages, authority, and
   price. The call is not placed yet.
6. Press **Confirm one call** on the webpage.
7. Watch the factual live Activity and, when complete, ask ChatGPT to retrieve
   and explain the result.

For judging safety, use the prefilled controlled destination unless the CallBridge
team has explicitly coordinated another consenting recipient. Do not use an
emergency number or request a purchase, booking, cancellation, payment, legal
commitment, medical decision, or other consequential action.

## Public Demo Link

[https://avoider-3000.moloman.chatgpt.site/](https://avoider-3000.moloman.chatgpt.site/)

Fallback web deployment:
[https://callbridge-web.pages.dev/](https://callbridge-web.pages.dev/)

## Public Repository Link

[https://github.com/hacksurvivor/callbridge](https://github.com/hacksurvivor/callbridge)

The repository contains the source, operating instructions, challenge-work
attribution, and an MIT license at the root.

## Demo Video

**Status:** required; public YouTube URL to be added after the exact deployed
candidate passes both final canaries.

### Under-three-minute edit plan

- **0:00–0:12 — Show the product working immediately.** Start already signed in.
  Ask ChatGPT for a bounded inquiry and show the visible plan appear through
  WebMCP.
- **0:12–0:35 — Make the trust boundary obvious.** Show questions, context,
  language, forbidden actions, price, revision, and the human-only confirmation.
- **0:35–0:55 — Confirm exactly once.** Press the webpage button and show factual
  live Activity. State that the model cannot invoke confirmation.
- **0:55–1:25 — Show the real call.** Use tightly edited real footage with audio;
  retain the disclosure, one answer, a correction or interruption, and graceful
  completion. Cut ringing, waiting, and dead air.
- **1:25–2:05 — Show the end result.** Display per-question status, translated
  summary, evidence excerpt, duration, actual cost, disclosure, and one-attempt
  receipt. Ask ChatGPT to retrieve and explain it through WebMCP.
- **2:05–2:30 — Explain why WebMCP is essential.** Agent prepares and reads;
  webpage confirms; Convex enforces; the worker calls.
- **2:30–2:50 — Prove breadth.** Flash the arbitrary-inquiry contract and
  multilingual market fixtures. Close on: “The web has APIs. The rest of the
  world has phone numbers.”

## Screenshot Shot List

1. ChatGPT and CallBridge side-by-side with a WebMCP-created plan.
2. Exact call brief with language, scope, forbidden actions, quote, revision, and
   **Confirm one call**.
3. Live Activity during the disclosed call.
4. Completed result with per-question evidence, translated summary, duration,
   cost, disclosure, and one-attempt receipt.
5. Responsive mobile result view.
6. Architecture/trust-boundary diagram for the repository and Devpost gallery.

## Official Form Answers

- **Submitter Type (28249):** Individual — confirm before submission.
- **Country of residence (28250):** REQUIRED USER INPUT; do not infer from current
  location or phone number.
- **Organization (28251):** Not applicable unless the user specifies one.
- **App Status (28252):** Existing.
- **Existing-project update (28253):** CallBridge began as a mobile-first
  call-avoidance prototype before the challenge. During the submission period we
  built the web-first WebMCP application: five authenticated general task tools,
  one controlled-recipient demo creator, visible exact-revision human
  confirmation, generalized inquiry contracts, evidence-bound results, ChatGPT
  sign-in, responsive judge onboarding, and release/test hardening. The
  historical mobile work and challenge additions
  remain distinguishable in the repository history and documentation.
- **Live URL (28254):** https://avoider-3000.moloman.chatgpt.site/
- **Private testing instructions (28255):** Use Continue with ChatGPT. No Twilio,
  API-key, or provider configuration is needed. Use the controlled prefilled
  destination and follow the numbered testing instructions above.
- **Public repository (28256):** https://github.com/hacksurvivor/callbridge
- **Agents/clients tested (28257):** ChatGPT in-app browser with page WebMCP; the
  deterministic WebMCP host test harness; Google Chrome-compatible browser
  fallback.
- **AI tools used (28258):** OpenAI Codex for product and engineering
  collaboration; OpenAI Realtime (`gpt-realtime-2.1-mini`) for the live voice
  inquiry; ChatGPT as the user-facing WebMCP agent.
- **Learning level (28259):** Significant.
- **Career AI value (28260):** Yes.

## Submission Readiness Notes

Verified on the local candidate:

- 324 automated backend, web, and telephony tests pass.
- Backend and worker TypeScript checks pass.
- Web and ChatGPT Site production builds pass.
- Desktop and mobile browser acceptance pass for draft, confirmation, Activity,
  result, and artifact fixtures.
- The published judge URL, fallback URL, and public repository return HTTP 200.
- Focused secret scanning passes.
- Production dependency audits report zero known vulnerabilities.

Release gates still required before submission:

- deployment of that exact commit to the public Site and backend/worker;
- authenticated target-browser WebMCP rehearsal on the deployed candidate;
- two separately confirmed unchanged canary calls with no repeated resolved
  question, manual repair, or hidden second attempt;
- public YouTube video shorter than three minutes with audio;
- final incognito repository/license and live-URL check;
- final Devpost form review and explicit submission.

## Known Limitations

- The product performs bounded information-gathering calls. It deliberately does
  not book, purchase, pay, cancel, sign, or accept terms.
- Confirmation is webpage-only, so an agent cannot complete the flow without a
  person reviewing the exact plan.
- Destination availability, carrier restrictions, local calling rules, and
  provider pricing vary by country and number type; the backend fails closed and
  the page requires a fresh quote.
- No raw transcript or call audio is included in the public WebMCP result.
- SMS, WhatsApp, Telegram, and iMessage are roadmap channels, not submission
  claims.

## TODO Official Form Fields

- Confirm the submitter's country of residence.
- Add the final public YouTube URL.
- Reconfirm the final public repository URL after the candidate push.
- Add final private judge instructions if a controlled destination changes.
- Codex session ID: `01a03bef-8188-7470-a492-047b0045ba09`.

### Not submitted yet

Nothing has been sent to Devpost.
