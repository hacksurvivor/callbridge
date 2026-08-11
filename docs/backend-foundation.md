# Backend foundation

## State and confirmation invariant

The core lifecycle begins as:

```text
create -> draft --explicit confirm(revision N)--> confirmed(revision N+1)
                    |
                    +-- incomplete or stale revision -> rejected

confirmed --active entitlement + matching confirmation--> gathering_options
```

Draft updates use full-replacement semantics and optimistic concurrency. An
update is accepted only while the task is `draft` and its `expectedRevision`
matches. A confirmed task is immutable, so execution can verify that the
confirmation still describes the stored draft.

Confirmation is an authenticated server mutation. It records the user ID,
server time, confirmed revision, and the only permitted scope:
`gather_options_only`. Validation makes all of the following literal `false`:

- booking or reservation
- payment
- accepting terms or cancellation conditions
- any irreversible commitment
- cancellation

## Normalized draft

The draft retains original source references alongside editable normalized
fields:

- typed context, voice-note storage key/transcript, standalone transcript, URL,
  and screenshot storage key/extracted text
- category, title, target, contact methods, and address
- dynamic category fields and an optional maximum budget in integer minor units
- questions, notes, user language, call language, and locale
- permission boundaries

The draft is category-driven rather than hotel-specific. Supported categories
are accommodation, restaurant, service, transport, delivery, marketplace,
property, vehicle, and other. Every task has a title, target, verified or
unverified contact candidates, dynamic category details, questions, budget,
languages, autonomy, memory, local call window, and the invariant permission
boundary. Accommodation confirmation additionally checks valid arrival and
departure dates.

Delivery tasks have a typed extension for leave location, entry/intercom
instructions, landmarks, and contact preference. `savedLocationId` is an
explicit reference point for a future owner-isolated saved-location store; the
selected values are copied into the editable task draft. Location and contact
instructions remain governed by that task's retention mode. This slice does not
connect to couriers or external delivery accounts.

## Autonomy, retries, and local time

Full Access is intentionally narrow. It can enable trying another verified
number and a five-minute automatic retry, but it cannot widen financial, legal,
or irreversible capabilities. The retry policy allows at most two automatic
retries per number. A stored stop marker disables all remaining attempts.

Retry planning and the final Convex reservation gate both evaluate the target's
IANA time zone, enabled weekdays, and local opening/closing time. An attempt
outside the window fails closed with the next allowed instant.

## Memory

Each task selects exactly one retention mode:

- `save_for_30_days`: derived task memory is eligible until 30 days after the
  task completes.
- `no_save`: derived memory must not be created and is purged when the task
  completes.

No-save mode requires a separate acknowledgement in the revision-bound
confirmation before option gathering can start.

## Household and task sharing

Convex models owner-isolated households, verified-email invite acceptance,
members, and indexed task grants. User-facing levels are:

- Can manage everything
- Can help with tasks
- Can only view updates

Invite settings choose full history versus new updates, transcript visibility,
and approval notifications. Each invited user independently chooses push
notifications or monitor-only mode. Transcript-disabled task reads redact the
standalone transcript, voice-note transcript, and screenshot-extracted text.
No sharing level grants payment, term, purchase, or irreversible authority.

## Cancellation safety

Cancellation is a preparation workflow, not an executor. Unknown terms can only
lead to a terms inquiry. Known free or fee-bearing terms are stored and
disclosed, then require an explicit confirmation against the exact task
revision. The confirmed record contains the exact disclosed terms and fee.
There is deliberately no mutation, gateway, or state transition that performs
the cancellation or marks the task cancelled.

## Integration boundaries

`IdentityProvider` is the WorkOS AuthKit adapter target. It must return only an
identity from a verified session/JWT. Missing, expired, malformed, or
unverified credentials return no actor; decoding claims without verification is
not sufficient.

`EntitlementWebhookVerifier` receives the untouched request body and signature.
Only a successfully verified Lemon Squeezy event can reach
`EntitlementEventStore.applyOnce`. Convex stores processed event IDs and applies
subscription state idempotently.

`OptionGatheringGateway` is the future server-side realtime/telephony adapter
target. The port remains provider-neutral and can receive a future fallback
selection. The launch default is `openai_realtime` with
`gpt-realtime-2.1-mini`. Its request includes the confirmed revision, the
single inquiry capability, and an explicit forbidden-action tuple. There is
deliberately no live adapter, credential lookup, or session creation in this
repository.

## Convex boundary

`convex/callTasks.ts` derives identity from `ctx.auth.getUserIdentity()` rather
than client input. `convex/optionGathering.ts` is an internal mutation that
atomically rechecks ownership, collaborator confirmation authority,
confirmation/revision equality, no-save acknowledgement, local call time, and
active entitlement before reserving a task for a future server action.

All registered functions define argument and return validators. Queries use
indexes; generic-schema compound lookups use stored compound keys so they remain
index-backed before generated Convex types are available. Sensitive server-only
operations remain internal.

This credential-free scaffold uses Convex's generic function builders so it can
typecheck before a deployment is configured. After a project is configured,
`npx convex codegen` can replace those imports with the generated builders for
schema-specific database types.
