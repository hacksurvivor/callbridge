# Proactivity policy (backend)

## Purpose

Enable Concierge to become a useful personal concierge without becoming a noisy or presumptuous automation. This is server-side decision policy, not a frontend specification.

**Service principle:** the concierge takes work off the person; it must never create new work, uncertainty, or avoidable interruptions for them.

## Confirmed rules

- A proactive finding is a **proposal**, never an instruction or an action.
- The agent should actively surface the next helpful option in plain language rather than requiring people to discover settings, toggles or hidden sections. The person chooses; the agent carries the discovery burden.
- When a missing user answer materially affects the result, the agent reminds the user and explains the consequence in context. Example: it explains that without room preferences it could select an unsuitable room; it never asks merely to fill a form.
- The agent first notifies the user about a relevant finding, such as a better hotel, a discount, or an available restaurant time.
- Relevant findings discovered in the background are notified as they are found, rather than delayed into a digest, because their value can be time-sensitive.
- Notification delivery observes the user's quiet hours, defaulting to 22:00–08:00 in the user's time zone. A routine finding waits for the next allowed time; only a genuinely time-sensitive offer or an active call awaiting a decision may interrupt quiet hours, with the reason made explicit.
- Notification preference and background-search preference are independent per category. Disabling notifications changes only delivery; disabling search stops future background research for that category.
- It must not call, negotiate, reserve, purchase, place a hold, contact a seller, or otherwise commit merely because it found an opportunity.
- The user explicitly chooses whether to pursue that exact proposal. The user may already have found a better option outside Concierge.
- A user may explicitly authorize proactive follow-up for one important task while they are unavailable or asleep. That authorization is task-scoped and time-bounded: it states the goal and deadline, remains constrained by the target's local calling window, and permits only further inquiry or negotiation. It never permits payment, term acceptance, reservation, or another irreversible commitment.
- For an already confirmed booking or purchase, proactive follow-up may verify known factual details such as a reference, date, pickup time, address, or availability. It may not change the commitment or introduce cost. The next morning's brief records what was confirmed, any mismatch, and every decision still needed from the user.
- A confirmed booking or purchase is monitored only when the user marks it important or when it occurs within 48 hours. Older, ordinary commitments remain in history without background checking.
- The task-level **Stop** control immediately stops all future retries, proactive calls, and proactive messages for that task. It does not cancel or otherwise alter an existing booking or purchase.
- A morning brief is generated from fresh factual activity plus important commitments occurring that local day. If both are empty, the server produces no brief and no notification.
- When speaking or messaging while the user is unavailable, the agent may truthfully explain that it cannot authorize payment, new terms, or a binding reservation until the user is available. It may ask whether an option can be held until a stated time **only when no payment, term acceptance, or commitment is required**. It must describe interest, not promise that the user will purchase or book.
- The policy applies consistently to travel, restaurants, services, marketplaces, vehicles, real estate and future categories.
- Existing hard rules remain stronger: payment, acceptance of terms, irreversible commitments and fee-bearing cancellation always need the relevant explicit confirmation.
- Future evaluation must favor relevance and restraint over the number of notifications or actions taken.

## Required backend concepts

- A proposal has a source, category, factual evidence, timestamps, a relevance reason, its status, and the exact next action it would authorize.
- A proposal is scoped to a user/household and must be invalidated or suppressed when its underlying task is closed, replaced or expired.
- Notification delivery and permission to act are separate states. Delivering an alert never grants authority to proceed.
- The system needs per-category notification and proactivity preferences, plus an auditable record of the proposal and the user's decision.

## Missing-context policy

- Questions are classified as required task facts, preferences, consequential decisions, or sensitive information; their follow-up behavior must not be conflated.
- Relative dates (for example, “next weekend”) are resolved by a deterministic date service, never by model inference. The resolution records the source timestamp and an IANA time zone: use the consented device time zone first, otherwise the user's configured time zone. The draft displays the resulting explicit calendar dates and time-zone basis with an edit affordance.
- If no reliable time zone is available, if the device and configured time zone conflict, or if the phrase remains ambiguous, the agent must ask a short clarification. It must not search, call, message, reserve, or otherwise act externally on an unresolved date.
- For a required fact such as a requested date, the agent asks first. If unanswered, it may later propose a candidate to the user, but it does not assume it, search externally, message, or call until the user supplies or confirms the required fact.
- For a non-blocking preference such as sea view, the agent may continue by asking for alternatives that cover both relevant variants. It returns a compact comparison with the trade-off rather than blocking the task or sending a separate reminder by default. It asks for a decision only when that preference would change a consequential action.
- If a travelling group is known but the number of rooms is not, the agent treats it as a non-blocking accommodation preference: it may collect a family-room option and separate-room options, then compare price and convenience. It does not require room-count input before gathering those reversible options.
- If no option meets an explicit budget ceiling, the agent may show the closest higher-priced option, clearly labelled as over budget. It must not present it as a match or pursue it further without a user decision.
- For a consequential choice such as a price or paid reservation, the agent presents the comparable options and waits for the user's decision. It does not choose based on a presumed default.
- Relevant sensitive delivery details, such as an entry code, are requested in the contextual address/delivery-information step rather than as a detached later interruption. Retention remains subject to the task's sensitive-data controls.
- The agent may retrieve a previously saved delivery detail through the product's tenant-isolated memory layer (using PathMark-style relevance/provenance behavior). Before disclosing that detail to a courier or other external party, it asks the user for per-use confirmation, such as “Tell the courier the entry code?” A yes sends it; a no keeps it private.
- The default for an unanswered material question is at most two contextual reminders before the agent pauses and does not take the blocked action.
- This is not one universal reminder rule. The user can choose a separate policy by question type (required fact, preference, consequential choice, or sensitive disclosure), globally, for a category, or for one task. A policy can set the reminder count, pause the blocked work, allow safe option-gathering, or require an answer before any continuation.

The current domain policy implements the safe defaults: essential facts, consequential choices, and sensitive disclosure requests remind twice then pause; ordinary preferences do not create a reminder burden and permit reversible option gathering. A later persistence layer can apply user, category, and task overrides without changing this decision model.

## Open policy decisions

- Frequency caps and quiet hours for proactive suggestions.
- Freshness/expiry rules by category.
- Whether a user can opt into narrowly defined automatic research runs, while still requiring confirmation before external contact.
