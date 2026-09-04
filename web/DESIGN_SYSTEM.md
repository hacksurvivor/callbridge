# Concierge web design system

Source of truth: `../docs/designs/assets/callbridge-review-approved.png` at 1600 × 1000.

## Composition

- True-white canvas and header; no cream tint, gradient, hero treatment, or decorative imagery.
- 58 px top bar with a quiet wordmark, one ChatGPT collaboration status, and avatar.
- Desktop work area is split at 1264 px in the reference viewport. The review content is an open 760 px column beginning at x=252; Activity is a 336 px right rail.
- One functional rounded brief container. No nested card grid.
- On narrow screens the Activity rail follows the brief; content remains one readable column.

## Tokens

- Background/surface: `#ffffff`
- Subtle surface: `#f7f7f8`
- Primary text: `#202123`
- Secondary text: `#5f6368`
- Quiet text: `#7a7f87`
- Border: `#e1e2e4`
- Strong action: `#202123`
- Verified accent: `#178f5b`
- Radii: 10 px controls, 14 px brief, 999 px compact statuses
- Font: system sans with deliberate UI sizes; no browser-default control typography

## Component families

- `BrandMark`: 26 px rounded outline mark plus 14 px semibold wordmark.
- `Status`: small outlined collaboration status with an 8 px green dot.
- `Brief`: destination header, open definition rows, disclosure strip, and one approval footer.
- `Assistant questions`: ordinary conversational cue followed by compact numbered rows. Never use completion checks for questions that have not yet been asked; keep selectable answers close to the composer when a future clarification state needs them.
- `Button`: quiet outline secondary and black primary; 34 px high.
- `Activity`: open timeline rows with green check marks and separators, followed by one subtle human-control note.
- Icons: custom 16 px SVGs with 1.4 px strokes and rounded caps/joins.

## Visible copy lock

The reference controls the header, breadcrumb, hierarchy, approval copy, buttons, human-control note, and webpage-only confirmation note. The hotel remains the golden visual fixture only: runtime titles, descriptions, brief rows, Activity entries, and results must derive from the generalized inquiry contract without changing this composition or inventing marketing copy.

`Edit brief` expands one inline editor for the objective, questions, private background, and explicitly shareable facts. It disables confirmation while open. Material saves create a new execution revision and reset confirmation. A completed inquiry adds one evidence-bound result section below the brief; it does not create a dashboard or expose hidden reasoning, raw transcripts, or provider payloads.
