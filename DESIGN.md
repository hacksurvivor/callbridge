# CallBridge design direction

## Intent

CallBridge should feel like a calm personal concierge for people who find calls stressful, not like an operations dashboard. The user writes naturally; the agent carries the work; the user only sees facts and decisions that genuinely need them.

## Visual thesis

**Stagecraft cyclorama dawn** — an ink-black iOS surface with a cobalt horizon that makes active work feel present but contained. White is deliberately reserved for a decision sheet. Rose appears only for stop and cancellation states.

This gives the product a distinct world without inventing a decorative brand system: a quiet, premium control surface rather than a generic light chat with stacked cards.

## Interaction model

- Three persistent native-style destinations: Chat, Activity, and You.
- Chat begins with one large natural-language question and a composer.
- A submitted request becomes a readable draft; the first call always needs explicit confirmation.
- During work, Activity is a factual cue sheet: observable status, verified result, optional transcript, and a visible stop control. It never exposes model reasoning.
- A decision uses a high-contrast light sheet with price, cancellation terms, and clear next actions.

## Component rules

- Use the system safe area and a persistent bottom tab bar.
- Keep cards purposeful: active task, draft, factual event, or decision. Do not use containers as generic decoration.
- Use a single cobalt action colour (`#2E6AFF`) for forward motion and semantic rose only for stopping/cancelling.
- Copy should say what the app knows and what it will do. The local preview never suggests that it has placed a live call.

## References and sources

- Mobbin: Claude iOS conversation flow for the low-friction natural-language entry point.
- Mobbin: Superlist activity patterns for a scannable task timeline.
- Context7 Expo guidance: safe-area-aware iOS layout and press feedback.
- Impeccable seed `f06a6885`: own-world visual direction and finish contract.

## Visual review

Reviewed at 390 × 844 after the rewrite:

- Home: black surface, unambiguous single prompt, anchored composer, native tab bar.
- Draft: only the request, actual boundaries, and the confirmation button are prominent.
- Active: horizontal cobalt live horizon plus a factual time line and one visible stop control.

The next visual iteration should replace text-only action affordances (`Voice`, `Link`, `Photo`) with platform SF Symbols after adding their native Expo rendering surface; this avoids shipping improvised Unicode glyphs.
