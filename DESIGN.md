# CallBridge design system

## Product experience

CallBridge is a conversation-first assistant for tasks that may lead to a phone call. The interface should feel immediately familiar to a ChatGPT user: natural-language input, plain assistant responses, visible but compact reasoning and tool activity, and secondary context that appears only when requested or operationally relevant.

The product is not an operations dashboard. The conversation remains the primary surface. Users should only manage the exact facts, choices, and approvals that require them.

## Web direction: Chat + activity drawer

The approved web composition has three responsive regions:

1. A quiet conversation sidebar for new tasks, search, task images, and thread history.
2. A centered conversation column with a maximum readable width of 760px and a bottom-anchored composer.
3. A contextual drawer that switches between Activity and Images. It is open for active desktop work, closed by default on mobile, and never competes with the conversation when it is unnecessary.

The direction was approved in Scratchpad as `2 · Chat + activity drawer` under seed `scratchpad-chatgpt-direction-2`.

## Visual language

- Use white for the conversation canvas and a quiet neutral gray for navigation and secondary surfaces.
- Use plain assistant text without an avatar, border, or message card.
- Use a soft gray bubble for the user's message.
- Use black for primary actions and neutral iconography.
- Reserve red for consequential approval or confirmation states. Use neutral or amber-brown treatment for stop and error states; do not use red as general brand decoration or progress color.
- Use blue for neutral running states and green for verified completion.
- Use 1px neutral dividers, 12–14px content-card radii, and a 20–22px composer radius. Avoid stacked decorative cards.
- Use the platform system sans-serif stack. Body copy is 14px on desktop and remains readable without zoom on mobile.

## Conversation components

### Reasoning

Reasoning is a concise, safe product-facing summary, never hidden chain-of-thought. It uses an expandable native disclosure row. While streaming, the row opens automatically and shows a restrained waveform; after completion it collapses and remains available.

### Tool use

Tool use appears as a compact inline row showing the action, tool count, and running or complete state. The Activity drawer carries the detailed tool log. Protected confirmation is explicitly described as unavailable to tools.

### Text streaming

Assistant text streams directly into the conversation. A quiet three-dot indicator communicates activity without moving the layout or replacing existing text.

### Timeline

The conversation shows four compact stages: Request, Prepared, Approval, and Result. The full factual event history belongs in the Activity drawer.

### Call plan

The call plan enters the conversation as a compact approval card. Its exact questions, context, authority, pricing, and disclosure expand only when the user selects Review. Editing creates a new revision and resets confirmation. Final confirmation remains a webpage-only action.

### Images

The sidebar exposes Files & images with an accurate count. Selecting it opens the drawer's Images tab. Only display-approved evidence is rendered; blocked or unsupported references never become broken thumbnails.

## Responsive behavior

- At wide desktop sizes, the sidebar, conversation, and contextual drawer can coexist.
- Below 1240px, the contextual drawer overlays from the right.
- Below 820px, the conversation sidebar also becomes an overlay and the Activity drawer stays closed on initial load.
- At 390px, the composer remains inside the viewport, the timeline stays legible, and the page has no horizontal overflow.
- Motion respects `prefers-reduced-motion`.

## Interaction and accessibility

- Every control has a visible keyboard focus state and an accessible name.
- Secondary text must meet WCAG AA contrast against its surface.
- Disabled attachment, dictation, calling, and confirmation states remain visibly distinct and truthful.
- The interface never implies a call was placed, an image exists, or a tool completed unless the backing state says so.
- Error states state both the failure and the safety outcome: nothing was shared and no call was placed.
