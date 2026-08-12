# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Expo / React Native ships the adaptive iOS and Android client, with iOS-first interaction quality. The application data layer is Convex, with authenticated server-side integrations for realtime voice and telephony.

## Users

People who feel anxious or uncomfortable making calls, face a language barrier, or do not want to navigate an uncertain purchase, booking, delivery, service, or property interaction alone. They often arrive while travelling or when a live call feels stressful. Families and collaborators may be invited to a task with plain-language permissions; the task owner remains authoritative.

## Product Purpose

CallBridge turns a human-language request, voice note, link, or photo into a clarified task, a reviewable contact draft, an explicitly authorised first contact, a readable live activity feed, and a factual result or choice. It removes the hassle and uncertainty of calls without adding a control panel, hidden commitments, or avoidable questions.

## Positioning

An agent that takes care of questions involving phone calls. It can carry a conversation across languages, return an understandable outcome, and follow the person's permissions. Long-term, it is a premium personal AI concierge that can research relevant opportunities, negotiate and coordinate across travel, restaurants, services, and marketplaces while respecting the person's boundaries.

## Operating Context

- Common inferred categories include Travel, Restaurants, Marketplace, Services, Property, and Delivery. Categories organise context but are never required before a person can ask for help.
- The core journey is Home -> intake and clarification -> draft -> explicit first-contact confirmation -> active task -> result or options.
- Confirmed dates and timezone are visible before contact. Quiet hours and a morning brief are configured during onboarding; routine notices wait, while an urgent live decision or mismatch may interrupt.
- Delivery tasks can use reusable per-location instructions such as leave location, entry/intercom, landmark, and contact preference. Saved sensitive instructions are never disclosed without explicit reconfirmation.
- A lightweight review may appear one day after checkout. Relationship memory from visit summaries is used later only when configured and may mention a past visit or negotiation tactic only with the user's permission.

## Capabilities and Constraints

- Home uses one clear `Что нужно сделать?` composer with text, voice, link, and photo input plus light suggestions. There is no immediate call from Home.
- A contextual mobile sidebar may expose Activity, My trips, Categories, and Connections. Permanent category tabs are out of scope.
- Mandatory missing data blocks external research or contact. Preferences may be gathered as comparable options. A blocking question states why the answer matters.
- The first external contact always requires draft review and explicit `Подтвердить звонок`, including under Full Access. The product cannot book, pay, accept terms, or make other irreversible commitments without explicit confirmation.
- The initial realtime provider is GPT Realtime 2.1 Mini; the provider layer remains replaceable. Call language is guided by destination and actual speech, with an English fallback and user override.
- The active task is a readable feed: short assistant text and compact factual action, status, or result cards. It shows operational facts, never hidden chain-of-thought. A translated transcript opens on demand.
- A completed, unambiguous request ends with a clear success update. When money, terms, booking, purchase, or another commitment requires a decision, a factual choice card offers `Подтвердить`, `Изменить`, and `Обсудить`.
- Change and cancel remain contextual in the active task and task card. A known fee or its unknown status is shown before any cancellation contact. If a fee is possible, final cancellation is always manually confirmed.
- `Stop` is visible in both the feed and task card. It halts future retries and proactive work but never silently cancels an existing commitment.
- Proactive findings may notify the user, but the agent never contacts, negotiates, reserves, purchases, or makes another commitment without task-specific approval. Search and notification controls are separate.
- Raw call audio is not retained. Summaries and transcripts follow per-task retention controls; users can choose not to save a task. Delivery instructions and other address/contact details follow the same retention and deletion controls.
- Plain-language collaboration permissions are `Может управлять всем`, `Может помогать с задачами`, and `Может только смотреть`; sharing may be limited to one task.
- The agent introduces itself using a category-appropriate role such as `ассистент по путешествиям [имя]` and answers honestly if asked whether it is AI.

## Brand Commitments

`CallBridge` is a working name, not an approved identity. Product language is personal, friendly, calm, clear, and nontechnical. The experience should feel as simple as a familiar conversational assistant, never like a professional operations console.

## Evidence on Hand

- `docs/UX_SPECIFICATION.md` records confirmed UX decisions, navigation, state behaviour, Mobbin evidence, screen inventory, and unresolved decisions.
- The product is at an early build stage. There is no approved final name, logo, visual identity, customer testimonial, production UI asset, pricing, benchmark, or commercial claim; none may be fabricated.

## Product Principles

1. Remove hassle; never create a new management burden.
2. Keep consequential control visible.
3. Let the agent carry complexity and ask the person only for decisions that matter.
4. Make language barriers and uncertain calls manageable.
5. Show operational facts and decisions, not hidden reasoning or technical machinery.

## Accessibility & Inclusion

The product must reduce cognitive load for people anxious about calls and support language-barrier use through plain language, translated task updates, and an on-demand translated transcript. Fees, dates, timezone, permissions, urgency, and irreversible consequences must be understandable without technical vocabulary or colour alone. A native implementation must preserve Dynamic Type, VoiceOver semantics, sufficient touch targets, Dark Mode, and Reduce Motion behaviour.
