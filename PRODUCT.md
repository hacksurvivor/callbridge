# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Expo React Native for iOS and Android; Convex for the application data layer. The backend also uses authenticated server-side integrations for realtime voice and telephony.

## Users

People who feel anxious or uncomfortable making phone calls, do not share the local language, or do not want to navigate an uncertain purchase, booking, delivery, or service interaction alone. They often arrive while travelling or when a live call feels stressful.

## Product Purpose

The product lets a person state what they need and delegates the phone conversation to an agent. The agent asks questions, gathers and explains options, and can pursue a better price when appropriate, while the person remains in control of consequential actions.

## Positioning

An agent that takes care of any questions involving phone calls. Unlike a generic chat assistant, it can carry the conversation across languages, return an understandable outcome, and follow the person's stated permissions.

## Operating Context

Typical tasks include hotel availability, restaurants, deliveries and couriers, local services, purchases, transport, and other calls. A delivery task can use reusable, per-location instructions such as leave location, entry/intercom, landmark, and contact preference.

## Capabilities and Constraints

- The first call always needs explicit confirmation after an editable draft.
- The product cannot book, pay, accept terms, or make other irreversible commitments without the person's explicit confirmation.
- A cancellation with a possible fee shows the fee or its unknown status before contact, and always requires final user confirmation.
- A completed, unambiguous request ends with a clear success update, not an unnecessary confirmation. A decision card appears only when a commitment or meaningful choice remains; it offers confirm, change with added context, or discussion before a follow-up call/message.
- The initial realtime provider is GPT Realtime 2.1 Mini; the provider layer remains replaceable.
- Call language is guided by the destination and actual speech, with an English fallback and user override.
- Raw call audio is not retained. Summaries and transcripts follow per-task retention controls; users can choose not to save a task.
- Delivery instructions and other address/contact details are sensitive data and follow the same retention and deletion controls.

## Brand Commitments

CallBridge is a working name only. The brand voice is personal, friendly, calm, and clear. The experience should feel like a simple conversation with ChatGPT or Claude, not a professional control panel or a complicated service.

## Evidence on Hand

The product is at an early build stage. There is no approved final name, logo, visual identity, customer testimonial, or production UI asset yet; none may be fabricated.

## Product Principles

- Reduce anxiety before adding capability.
- Keep the person's control visible at every consequential step.
- Let the agent carry complexity; ask the person only for decisions that matter.
- Make language barriers and uncertain calls manageable.
- Prefer one clear conversation path over dense navigation and configuration.

## Interaction Direction

The task experience is a familiar agent conversation: short human-readable updates alternate with compact action/result cards, such as “checking the booking details,” “the hotel confirmed 13:00 check-in,” or “waiting for your decision.” It shows operational progress and results, not private model reasoning. Full translated transcripts are available on demand rather than competing with the main progress feed.

## Accessibility & Inclusion

The product must work for people who do not speak the local language and for people who find phone calls stressful. Important instructions and outcomes must be understandable in the person's chosen language.
