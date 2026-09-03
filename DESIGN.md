---
name: CallBridge
description: A ChatGPT-native conversation interface for bounded phone tasks.
colors:
  ink: "#0d0d0d"
  paper: "#ffffff"
  sidebar: "#f9f9f8"
  surface-soft: "#f4f4f4"
  surface-hover: "#ececec"
  border: "#e5e5e5"
  text-muted: "#5d5d5d"
  text-quiet: "#777771"
  approval: "#d0442f"
  success: "#1f8b4c"
typography:
  title:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-0.01em"
  body:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.62
  label:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
rounded:
  control: "8px"
  content: "12px"
  message: "18px"
  composer: "28px"
spacing:
  compact: "8px"
  control: "12px"
  content: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 13px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.content}"
    padding: "12px 14px"
  composer:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.composer}"
    padding: "9px 9px 9px 16px"
---

# Design System: CallBridge

## Overview

**Creative North Star: "The Quiet Task Thread"**

CallBridge adopts the current ChatGPT web interaction language so the phone-task workflow feels native to an assistant conversation. The conversation owns the canvas; operational detail appears only as compact reasoning, tool, plan, approval, and activity elements.

The system is neutral, flat, and information-led. It rejects dashboard density, oversized branding, decorative process diagrams, and clickable chrome without a real state or action.

**Key Characteristics:**

- Open white conversation canvas with generous negative space.
- Warm gray navigation and soft gray user messages.
- Plain assistant text with compact reasoning and tool disclosures.
- Black primary controls; red reserved for consequential approval.
- A narrow, optional activity rail using small source favicons.

## Colors

The palette is nearly monochrome so state and content hierarchy remain stronger than branding.

### Primary

- **Approval red** marks the exact human confirmation boundary and is never used as general progress decoration.

### Neutral

- **Conversation ink** carries primary copy and decisive controls.
- **Open paper** is the main thread and panel ground.
- **Quiet sidebar** separates navigation by tone, not a hard border.
- **Soft surface** is reserved for user bubbles, hovers, and compact icon grounds.
- **Neutral border** defines plan, approval, result, and media containers with one-pixel rules.
- **Muted and quiet text** separate supporting explanations and timestamps without becoming illegible.

**The Rare Signal Rule.** Approval red and success green appear only when their state is true; neutral work stays neutral.

## Typography

**Display Font:** platform UI sans-serif stack
**Body Font:** platform UI sans-serif stack

**Character:** Familiar, compact, and conversational. Hierarchy comes from modest changes in weight and spacing, not editorial display typography.

### Hierarchy

- **Title** (600, 15px, 1.45): plan, result, and activity titles.
- **Body** (400, 15px, 1.62): assistant and user conversation copy, held to a readable 68–72 character measure.
- **Label** (600, 12px, 1.35): navigation, tool states, plan steps, and compact metadata.

**The Conversation Scale Rule.** Product copy stays at reading size while chrome stays one step smaller; no workflow state becomes a hero heading.

## Layout

Desktop uses three coordinated regions: a 260px sidebar, a flexible conversation canvas with a 768px maximum reading measure, and an optional 380px activity or image rail. The header is 52px tall and the capsule composer is sticky at the bottom of the thread.

Below 1240px, the context rail overlays from the right. Below 820px, navigation becomes an off-canvas sheet and the thread takes the full width. At 390px, the content keeps 14px side margins, the user bubble may reach 90% width, and plan details collapse to one column without horizontal overflow.

## Elevation & Depth

The system is flat by default. Tonal differences and one-pixel borders create structure. Ambient shadow appears only on temporary floating surfaces: the composer, menus, the scroll-to-latest control, overlays, and full-size media preview.

**The Flat-By-Default Rule.** Permanent content never receives decorative elevation; shadow must explain floating behavior.

## Shapes

Controls use gently curved 8px corners, content containers use 12px corners, user messages use 18px corners, and the composer uses a full 28px capsule. Small source icons use 6px squares; status progress uses true circles. Pills are not used for general metadata.

## Components

### Buttons

- **Shape:** gently curved control corners (8px) or true circles for icon-only actions.
- **Primary:** black ground, white label, 36px minimum height.
- **Hover / Focus:** tonal hover and a two-pixel black focus outline with offset.
- **Secondary / Ghost:** white bordered controls for explicit alternatives; borderless controls for navigation and panel switching.

### Cards / Containers

- **Corner Style:** compact 12px corners.
- **Background:** white on the conversation canvas.
- **Shadow Strategy:** none at rest.
- **Border:** one-pixel neutral gray.
- **Internal Padding:** 12–16px depending on density.

### Inputs / Fields

- **Style:** white field, neutral one-pixel border, 8px corners; the main composer uses the 28px capsule.
- **Focus:** two-pixel black outline with offset.
- **Disabled:** unavailable runtime capabilities are omitted instead of shown as inert controls.

### Navigation

Sidebar and top-bar navigation use 13–14px labels, 18px stroke icons, 8px hover grounds, and one subtle selected row. Mobile navigation and context become dismissible overlay sheets.

### Reasoning, tools, and plan

Reasoning is a plain disclosure row with a safe product-facing summary. Tool actions use a 22px favicon, the real tool action, and a running or done state. The plan uses four short steps and a three-pixel progress rule; factual event detail lives in the Activity rail.

### Approval

The approval card is the only place where red is structural. Review and editing expand the same card; final confirmation remains a distinct webpage-only action tied to one revision.

## Do's and Don'ts

### Do:

- **Do** keep assistant output as open text and user input as a soft gray bubble.
- **Do** render actual Assistant UI reasoning, tool, streaming, message, composer, and scroll primitives.
- **Do** name the real tool action and show small source favicons in dense activity lists.
- **Do** keep unsupported capabilities out of the interface and explain safety boundaries in plain language.
- **Do** use one readable conversation measure across messages, plans, artifacts, results, and the composer.

### Don't:

- **Don't** turn the conversation into an operations dashboard or a stack of decorative cards.
- **Don't** invent thread history, attachments, calls, tools, or evidence the runtime does not own.
- **Don't** use red as branding, routine progress, or decoration.
- **Don't** use oversized type, uppercase section furniture, gradient fills, glass effects, or glossy icon tiles.
- **Don't** ship clickable selectors, menus, images, or search fields without working behavior.
