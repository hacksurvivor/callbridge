# CallBridge UX Specification

Status: discovery consolidated; production UI and visual-world approval are pending.

This document is the canonical interaction specification for the current iOS UX target. It records confirmed product decisions only. Mobbin references are functional evidence, not permission to copy another product's brand or visual identity.

## 1. Canonical UX decision map

| Confirmed decision | Screen or state that carries it | Required behavior |
| --- | --- | --- |
| Start from human language, not a category | Home | One `Что нужно сделать?` composer accepts text, voice, link, and photo. Suggestions are optional accelerators. |
| Categories are inferred | Home and contextual sidebar | Never block intake on a category picker; expose inferred categories only as contextual organization. |
| Ask only blocking questions | Intake and clarification | State why the answer matters. Mandatory missing data blocks external research or contact; preferences may be offered as choices. |
| No immediate call from Home | Intake -> Draft transition | Submitting creates or updates a draft. The first external contact is a later, explicit action. |
| Dates and timezone must be certain | Draft review | Show the contact target, task goal, confirmed date/time/timezone, constraints, sensitive disclosures, and known consequences before contact. |
| First contact always requires approval | First-contact confirmation | Require explicit `Подтвердить звонок`, even under Full Access. |
| Live work must be readable | Active task feed | Interleave short assistant text with compact factual action, status, and result cards, then the next text update. Show a live timeline without exposing chain-of-thought. |
| Transcript is secondary evidence | Transcript sheet | Open the translated transcript on demand; keep the primary feed concise. |
| Finish silently only when no decision remains | Completed result | Notify `готово` and show facts only. |
| Consequential outcomes require a choice | Decision result card | Show comparable facts and `Подтвердить`, `Изменить`, `Обсудить`; allow follow-up context. |
| Cancellation consequences precede action | Change/cancel sheet | Show known fee or consequence before any cancellation call. If a fee is possible, require final manual confirmation. |
| Stop is not cancellation | Active feed and task card | Stop future retries/proactivity while preserving existing commitments and explaining what remains active. |
| Sensitive saved information needs fresh consent | Disclosure confirmation | Reconfirm before revealing a door code, access instruction, or similar saved detail. |
| Proactivity never grants execution authority | Activity, monitor detail, and settings | Separate search from notifications. Findings may notify, but contact, negotiation, reservation, or purchase still needs task-specific approval. |
| Collaboration stays legible | Share sheet and connection detail | Use plain-language roles, task-level sharing, owner-controlled memory, and invitee-controlled notifications. |
| Relationship memory is optional | Post-stay review and memory controls | Ask for a lightweight review one day after checkout; use visit summaries later only when configured and permitted. |

## 2. Shallow navigation and state map

```text
Home
├─ Contextual sidebar
│  ├─ Activity
│  ├─ My trips
│  ├─ Categories (inferred, never required for intake)
│  └─ Connections
└─ Task conversation
   ├─ Intake / clarification
   ├─ Draft review
   │  └─ First-contact confirmation sheet
   ├─ Active task feed
   │  ├─ Full translated transcript sheet
   │  ├─ Contextual change / cancel sheet
   │  ├─ Sensitive-disclosure confirmation sheet
   │  └─ Stop confirmation / remaining-commitment notice
   └─ Result
      ├─ Completed facts
      └─ Decision card + follow-up context
```

Onboarding and profile/settings are supporting flows for quiet hours, morning brief, memory, permissions, and notification controls. They do not become permanent task-category tabs. The task remains one navigation-stack thread from intake through outcome; focused confirmations use native sheets.

### Task state model

```text
Drafting
  -> Blocked for required information
  -> Ready for review
  -> Awaiting first-contact confirmation
  -> Active research / call
  -> Awaiting urgent user decision
  -> Active follow-up
  -> Completed: facts only
  -> Completed: user choice required
  -> Stopped: future work halted, commitment state disclosed
  -> Failed / unavailable: factual reason and recovery options
```

Change and cancel are contextual transitions, not global destinations. Cancelling an existing commitment and stopping CallBridge's future work are distinct states.

## 3. Mobbin evidence pack

The screenshots below were inspected as actual iOS captures. Takeaways describe the specific interaction evidence used here.

### Conversational intake

- [ChatGPT empty conversation](https://mobbin.com/screens/154c98be-dad0-40f4-868f-72f1c2f6e635): establishes a near-empty first screen where one bottom composer is the unmistakable primary action.
- [Claude multimodal home](https://mobbin.com/screens/c703ff9a-3e8e-4332-8987-8831b723fc6a): shows an attachment preview living inside the composer instead of becoming a separate upload workflow.
- [Gemini empty home and suggestions](https://mobbin.com/screens/9690ddb3-faf3-4b2a-baf9-ad2c105948d5): demonstrates lightweight task starters above a persistent multimodal composer without requiring a category decision.

### Agent activity and results

- [ChatGPT research progress](https://mobbin.com/screens/1b34f932-9df1-4d93-8e27-c9a7ac490ba5): groups a named task into readable checklist progress with a visible stop affordance; useful for live timeline hierarchy, not for copying its research terminology.
- [ChatGPT code activity](https://mobbin.com/screens/d3e5f342-f871-44fc-9dc9-f47b8ace05a4): interleaves short human-readable text with compact operational actions and a persistent stop control. This is the closest inspected Mobbin analogue to the confirmed Codex-like feed.
- [Wabi action/result feed](https://mobbin.com/screens/4c413262-80a9-4e7f-9167-587ea5d001ae): shows factual versioned action cards between assistant messages, supporting compact result cards rather than a technical log.
- [Manus multi-step agent progress](https://mobbin.com/screens/59294d00-2e82-406d-a422-a8efa4cd10ab): shows a short plan, current step, completed state, and an interrupt control in one conversational surface.

Mobbin did not return direct native Codex or Qood app entries in the current search. ChatGPT code activity, Wabi, and Manus are recorded as pattern analogues only; no exact Codex/Qood visual claim is made.

### Consequence-first cancellation

- [Airbnb cancellation flow](https://mobbin.com/flows/1fc3307f-6975-43c7-a067-5b35865f3dbd): separates change from cancel, then moves through reservation context, confirmation, refund detail, and final outcome.
- [Airbnb confirmation with refund](https://mobbin.com/screens/ebc6e8b6-4379-4812-ad23-c8174f7a8869): places reservation identity, policy summary, amount paid, and expected refund before the destructive action.
- [Uber reservation cancellation flow](https://mobbin.com/flows/7476e6b7-36ea-4a61-8da5-7fa55fcb41f0): keeps cancel contextual to an active reservation and uses a focused consequence sheet.
- [Uber consequence-first confirmation](https://mobbin.com/screens/452cde4a-8c5b-4df0-82d6-4f6307e7b6de): states the fee consequence before confirmation and makes keeping the reservation the strongest recovery action.

## 4. Screen inventory and later approval gates

| Surface or state | Purpose | Later visual approval required for |
| --- | --- | --- |
| Home | Start any task with one multimodal composer | Information density, suggestion behavior, sidebar entry point, working-name treatment |
| Contextual sidebar | Reach Activity, My trips, inferred Categories, Connections | Whether all four destinations earn top-level visibility and how recent tasks appear |
| Intake / clarification | Resolve only blocking information conversationally | Blocking-question explanation, option presentation, attachment states, long-content behavior |
| Draft review | Make the proposed first contact legible and editable | Summary hierarchy, dates/timezone, sensitive fields, autonomy scope, edit affordances |
| First-contact confirmation | Enforce explicit authorization | Native sheet composition, final wording, error/loading/retry states |
| Active task feed | Show readable operational progress | Text/card rhythm, event grouping, live-call timeline, urgency treatment, stop placement |
| Action/status/result card system | Express factual operational events | Card taxonomy, collapsed/expanded behavior, accessibility labels, overflow rules |
| Full translated transcript | Provide complete evidence on demand | Sheet vs pushed screen, speaker labeling, search/copy/export policy, partial transcript state |
| Completed result | Close tasks that need no decision | Fact hierarchy, notification handoff, follow-up context entry |
| Decision result | Present money/terms/booking choices | Comparison density, primary/secondary actions, expiry/availability changes |
| Change/cancel | Preserve control and disclose consequences | Unknown-fee behavior, manual confirmation hierarchy, recoverability |
| Stop state | Halt future work without implying cancellation | Remaining-commitment notice and resume/restart behavior |
| Activity / task card | Show active and recent work outside the feed | Status vocabulary, compact progress, stop/change entry points, empty state |
| Onboarding preferences | Set quiet hours and meaningful morning brief | Minimum required steps, skip behavior, permission timing |
| Sharing and Connections | Invite people with understandable authority | Permission matrix, task-level scope, notification ownership, revoked access states |
| Sensitive disclosure | Reconfirm saved access instructions | Redaction, confirmation wording, audit visibility, expired consent |
| Proactive monitor | Separate search from notifications and action authority | Toggle relationships, finding cards, reminders, task-specific approval path |
| Post-stay review and memory | Capture optional relationship memory | Consent, edit/delete controls, one-day timing, future-use disclosure |

No surface has approved visual composition, palette, typography, iconography, motion, or production assets. Mobbin evidence constrains interaction behavior only. A later Impeccable visual-world and three-comp approval cycle is required before implementation.

## 5. Conflict and gap audit

Ask these one at a time through the coordinator. Later answers may eliminate later questions.

1. **Launch wedge:** Is the first release limited to hotel/travel calls, as the README states, or must it launch across Travel, Restaurants, Marketplace, Services, Property, and Delivery?
2. **Platform and delivery:** Is the first production client iOS-only, or an adaptive iOS/Android product, and is Expo/React Native the approved implementation stack?
3. **Live authority:** During a live call, which decisions may CallBridge make without interrupting, and which exact changes to price, timing, terms, substitution, or commitment always require approval?
4. **Transaction boundary:** In the first release, may CallBridge complete a reservation or purchase after approval, or may it only present confirmed options and leave the final transaction outside the product?
5. **Unknown cancellation consequence:** If a provider cannot state the fee before contact, may CallBridge call only to learn the consequence, or must cancellation stop until the consequence is independently known?
6. **Transcript consent and retention:** Which jurisdictions and languages launch first, what recording/transcription disclosure is required, and how long are audio and translated transcripts retained?
7. **Sensitive information policy:** Which saved details count as sensitive, who may authorize disclosure in shared tasks, and how long does a disclosure confirmation remain valid?
8. **Family authority matrix:** What concrete actions sit behind each plain-language collaborator role, especially spending, cancellation, sensitive disclosure, memory editing, and inviting others?
9. **Memory default:** Is relationship memory opt-in globally, opt-in per task/category, or off until the post-stay review, and what deletion/export controls are required at launch?

## 6. Explicitly not implemented

- No production UI, Expo/React Native scaffold, SwiftUI code, navigation code, components, design tokens, or automated UI tests.
- No backend workflow, API contract, database model, authentication, task engine, scheduler, notification service, or audit implementation.
- No telephony, recording, transcription, translation, provider, messaging, payment, booking, purchasing, credential, or live external connection.
- No cancellation, fee calculation, reservation mutation, contact attempt, retry, monitoring, or proactive action.
- No production visual assets, logo, brand identity, palette, typography system, icons, motion system, screenshots, or new visual concepts.
- No approved visual composition for any screen; the earlier scratchpad concept is non-production exploration and is not a committed artifact in this repository.
- No claim that Mobbin contains direct Codex or Qood native-app evidence; only inspected analogues are cited.
- No resolution of the nine open decisions above.
