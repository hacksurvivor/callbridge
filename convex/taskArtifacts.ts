import { ConvexError, v } from "convex/values";

import {
  TASK_ARTIFACT_SCHEMA_VERSION,
  parseArtifactPayload,
  parseCreateArtifactPayload,
  parseWebMcpArtifactPatch,
  type ArtifactPayload,
  type AuthRequiredArtifactPayload,
  type ConversationArtifactPayload,
  type ConversationMessageProjection,
  type CreateArtifactPayload,
  type TaskArtifact,
  type UserQuestionArtifactPayload,
  type WebMcpAllowedArtifactPatch,
} from "../shared/taskArtifacts.js";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";

const MAX_ARTIFACTS_PER_READ = 48;
const MAX_PROJECTED_MESSAGES = 24;

async function requireOwnerId(ctx: Pick<QueryCtx, "auth"> | Pick<MutationCtx, "auth">): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

async function requireOwnedTask(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"inquiryTasks">,
  ownerId: string,
) {
  const task = await ctx.db.get("inquiryTasks", taskId);
  if (!task) throw new ConvexError({ code: "NOT_FOUND" });
  if (task.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
  return task;
}

async function requireOwnedArtifact(
  ctx: QueryCtx | MutationCtx,
  artifactId: Id<"taskArtifacts">,
  taskId: Id<"inquiryTasks">,
  ownerId: string,
) {
  const artifact = await ctx.db.get("taskArtifacts", artifactId);
  if (!artifact || artifact.taskId !== taskId) throw new ConvexError({ code: "NOT_FOUND" });
  if (artifact.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
  return artifact;
}

function requireIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new ConvexError({ code: "INVALID_INPUT", field: "idempotencyKey" });
  }
  return normalized;
}

function parseCreatePayload(value: unknown): CreateArtifactPayload {
  try {
    return parseCreateArtifactPayload(value);
  } catch {
    throw new ConvexError({ code: "VALIDATION_FAILED" });
  }
}

function parsePatch(value: unknown): WebMcpAllowedArtifactPatch {
  try {
    return parseWebMcpArtifactPatch(value);
  } catch {
    throw new ConvexError({ code: "VALIDATION_FAILED" });
  }
}

function artifactSnapshot(artifact: Doc<"taskArtifacts">): TaskArtifact {
  let payload: ArtifactPayload;
  try {
    payload = parseArtifactPayload(artifact.payload);
  } catch {
    throw new ConvexError({ code: "INTERNAL_ERROR" });
  }
  return {
    schemaVersion: TASK_ARTIFACT_SCHEMA_VERSION,
    artifactId: String(artifact._id),
    taskId: String(artifact.taskId),
    createdSequence: artifact.createdSequence,
    lastEventSequence: artifact.lastEventSequence,
    revision: artifact.revision,
    type: artifact.type,
    status: artifact.status,
    visibility: "owner",
    source: artifact.source,
    payload,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

async function nextArtifactCreationSequence(ctx: MutationCtx, taskId: Id<"inquiryTasks">): Promise<number> {
  const last = await ctx.db
    .query("taskArtifacts")
    .withIndex("by_task_created", (q) => q.eq("taskId", taskId))
    .order("desc")
    .first();
  return (last?.createdSequence ?? 0) + 1;
}

async function nextArtifactEventSequence(ctx: MutationCtx, taskId: Id<"inquiryTasks">): Promise<number> {
  const last = await ctx.db
    .query("taskArtifactEvents")
    .withIndex("by_task_sequence", (q) => q.eq("taskId", taskId))
    .order("desc")
    .first();
  return (last?.sequence ?? 0) + 1;
}

async function nextMessageSequence(ctx: MutationCtx, artifactId: Id<"taskArtifacts">): Promise<number> {
  const last = await ctx.db
    .query("conversationMessages")
    .withIndex("by_artifact_sequence", (q) => q.eq("artifactId", artifactId))
    .order("desc")
    .first();
  return (last?.sequence ?? 0) + 1;
}

async function projectLatestMessages(
  ctx: MutationCtx,
  artifactId: Id<"taskArtifacts">,
): Promise<{ latestMessages: ConversationMessageProjection[]; hasEarlierMessages: boolean }> {
  const rows = await ctx.db
    .query("conversationMessages")
    .withIndex("by_artifact_sequence", (q) => q.eq("artifactId", artifactId))
    .order("desc")
    .take(MAX_PROJECTED_MESSAGES + 1);
  const bounded = rows.slice(0, MAX_PROJECTED_MESSAGES).reverse();
  return {
    latestMessages: bounded.map((row) => ({
      messageId: row.messageId,
      sequence: row.sequence,
      authorRole: row.authorRole,
      authorDisplayName: row.authorDisplayName,
      text: row.text,
      state: row.state,
      occurredAt: row.occurredAt,
    })),
    hasEarlierMessages: rows.length > MAX_PROJECTED_MESSAGES,
  };
}

async function insertArtifactEvent(
  ctx: MutationCtx,
  input: {
    ownerId: string;
    taskId: Id<"inquiryTasks">;
    artifactId: Id<"taskArtifacts">;
    artifactRevision: number;
    idempotencyKey: string;
    eventType: Doc<"taskArtifactEvents">["eventType"];
    source: Doc<"taskArtifactEvents">["source"];
    publicChange: unknown;
    occurredAt: string;
  },
): Promise<number> {
  const sequence = await nextArtifactEventSequence(ctx, input.taskId);
  await ctx.db.insert("taskArtifactEvents", {
    ownerId: input.ownerId,
    taskId: input.taskId,
    artifactId: input.artifactId,
    eventId: `artifact:${input.taskId}:${sequence}`,
    idempotencyKey: input.idempotencyKey,
    sequence,
    artifactRevision: input.artifactRevision,
    eventType: input.eventType,
    source: input.source,
    publicChange: input.publicChange,
    occurredAt: input.occurredAt,
  });
  return sequence;
}

function materializeCreatePayload(payload: CreateArtifactPayload): ArtifactPayload {
  switch (payload.type) {
    case "conversation":
      return { ...payload, latestMessages: [], hasEarlierMessages: false };
    case "auth_required":
      return { ...payload, state: "required" };
    case "user_question":
      return payload;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function createArtifactRecord(
  ctx: MutationCtx,
  input: {
    ownerId: string;
    taskId: Id<"inquiryTasks">;
    idempotencyKey: string;
    source: Doc<"taskArtifacts">["source"];
    payload: ArtifactPayload;
    status?: Doc<"taskArtifacts">["status"];
    now: string;
  },
): Promise<TaskArtifact> {
  const createdSequence = await nextArtifactCreationSequence(ctx, input.taskId);
  const artifactId = await ctx.db.insert("taskArtifacts", {
    ownerId: input.ownerId,
    taskId: input.taskId,
    createIdempotencyKey: input.idempotencyKey,
    createdSequence,
    lastEventSequence: 0,
    revision: 1,
    type: input.payload.type,
    status: input.status ?? "active",
    visibility: "owner",
    source: input.source,
    payload: input.payload,
    createdAt: input.now,
    updatedAt: input.now,
  });
  const eventSequence = await insertArtifactEvent(ctx, {
    ownerId: input.ownerId,
    taskId: input.taskId,
    artifactId,
    artifactRevision: 1,
    idempotencyKey: input.idempotencyKey,
    eventType: input.payload.type === "evidence" ? "evidence_attached" : "created",
    source: input.source,
    publicChange: { type: input.payload.type, status: input.status ?? "active" },
    occurredAt: input.now,
  });
  await ctx.db.patch("taskArtifacts", artifactId, { lastEventSequence: eventSequence });
  const created = await ctx.db.get("taskArtifacts", artifactId);
  if (!created) throw new ConvexError({ code: "INTERNAL_ERROR" });
  return artifactSnapshot(created);
}

async function idempotentEventResult(
  ctx: MutationCtx,
  ownerId: string,
  idempotencyKey: string,
  taskId: Id<"inquiryTasks">,
  artifactId?: Id<"taskArtifacts">,
): Promise<TaskArtifact | null> {
  const event = await ctx.db
    .query("taskArtifactEvents")
    .withIndex("by_owner_idempotency", (q) => q.eq("ownerId", ownerId).eq("idempotencyKey", idempotencyKey))
    .unique();
  if (!event) return null;
  if (event.taskId !== taskId || artifactId !== undefined && event.artifactId !== artifactId) {
    throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
  }
  const artifact = await ctx.db.get("taskArtifacts", event.artifactId);
  if (!artifact) throw new ConvexError({ code: "INTERNAL_ERROR" });
  return artifactSnapshot(artifact);
}

export const createTaskArtifact = mutation({
  args: {
    taskId: v.id("inquiryTasks"),
    expectedTaskRevision: v.number(),
    idempotencyKey: v.string(),
    artifact: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const task = await requireOwnedTask(ctx, args.taskId, ownerId);
    if (task.revision !== args.expectedTaskRevision) throw new ConvexError({ code: "STALE_REVISION" });
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    const payload = parseCreatePayload(args.artifact);
    const existing = await ctx.db
      .query("taskArtifacts")
      .withIndex("by_owner_create_key", (q) => q.eq("ownerId", ownerId).eq("createIdempotencyKey", idempotencyKey))
      .unique();
    if (existing) {
      const expected = materializeCreatePayload(payload);
      if (stableJson(existing.payload) !== stableJson(expected) || existing.taskId !== args.taskId) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      return artifactSnapshot(existing);
    }
    return createArtifactRecord(ctx, {
      ownerId,
      taskId: args.taskId,
      idempotencyKey,
      source: "chatgpt",
      payload: materializeCreatePayload(payload),
      now: new Date().toISOString(),
    });
  },
});

export const updateTaskArtifact = mutation({
  args: {
    taskId: v.id("inquiryTasks"),
    artifactId: v.id("taskArtifacts"),
    expectedArtifactRevision: v.number(),
    idempotencyKey: v.string(),
    patch: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedTask(ctx, args.taskId, ownerId);
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    const repeated = await idempotentEventResult(ctx, ownerId, idempotencyKey, args.taskId, args.artifactId);
    if (repeated) return repeated;
    const patch = parsePatch(args.patch);
    const artifact = await requireOwnedArtifact(ctx, args.artifactId, args.taskId, ownerId);
    if (artifact.revision !== args.expectedArtifactRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (artifact.status !== "active") throw new ConvexError({ code: "INVALID_TRANSITION" });
    if (artifact.type !== patch.type) throw new ConvexError({ code: "VALIDATION_FAILED" });

    const now = new Date().toISOString();
    let payload = parseArtifactPayload(artifact.payload);
    let status: Doc<"taskArtifacts">["status"] = artifact.status;
    if (patch.type === "conversation" && payload.type === "conversation") {
      if (patch.appendAgentDraft) {
        const sequence = await nextMessageSequence(ctx, artifact._id);
        await ctx.db.insert("conversationMessages", {
          ownerId,
          taskId: args.taskId,
          artifactId: artifact._id,
          messageId: `agent:${artifact._id}:${sequence}`,
          idempotencyKey,
          sequence,
          authorRole: "agent",
          authorDisplayName: patch.appendAgentDraft.authorDisplayName,
          text: patch.appendAgentDraft.text,
          state: "draft",
          source: "chatgpt",
          occurredAt: now,
        });
      }
      const messages = await projectLatestMessages(ctx, artifact._id);
      payload = { ...payload, ...(patch.title ? { title: patch.title } : {}), ...messages };
      if (patch.status) status = patch.status;
    } else if (patch.type === "auth_required" && payload.type === "auth_required") {
      payload = {
        ...payload,
        ...(patch.reason ? { reason: patch.reason } : {}),
        ...(patch.state ? { state: patch.state } : {}),
      };
      if (patch.status) status = patch.status;
    } else if (patch.type === "user_question" && payload.type === "user_question") {
      payload = {
        ...payload,
        ...(patch.prompt ? { prompt: patch.prompt } : {}),
        ...(patch.options ? { options: patch.options } : {}),
      };
      if (patch.status) status = patch.status;
    } else {
      throw new ConvexError({ code: "VALIDATION_FAILED" });
    }

    const revision = artifact.revision + 1;
    const eventSequence = await insertArtifactEvent(ctx, {
      ownerId,
      taskId: args.taskId,
      artifactId: artifact._id,
      artifactRevision: revision,
      idempotencyKey,
      eventType: "updated",
      source: "chatgpt",
      publicChange: { type: patch.type, status },
      occurredAt: now,
    });
    await ctx.db.patch("taskArtifacts", artifact._id, {
      payload,
      status,
      revision,
      lastEventSequence: eventSequence,
      updatedAt: now,
    });
    const updated = await ctx.db.get("taskArtifacts", artifact._id);
    if (!updated) throw new ConvexError({ code: "INTERNAL_ERROR" });
    return artifactSnapshot(updated);
  },
});

export const readTaskArtifacts = query({
  args: { taskId: v.id("inquiryTasks"), afterEventSequence: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedTask(ctx, args.taskId, ownerId);
    const rows = args.afterEventSequence === undefined
      ? await ctx.db
        .query("taskArtifacts")
        .withIndex("by_owner_task_created", (q) => q.eq("ownerId", ownerId).eq("taskId", args.taskId))
        .order("asc")
        .take(MAX_ARTIFACTS_PER_READ)
      : await ctx.db
        .query("taskArtifacts")
        .withIndex("by_task_event", (q) => q.eq("taskId", args.taskId).gt("lastEventSequence", args.afterEventSequence ?? 0))
        .order("asc")
        .take(MAX_ARTIFACTS_PER_READ);
    const artifacts = rows.filter((row) => row.ownerId === ownerId).map(artifactSnapshot);
    return {
      taskId: String(args.taskId),
      artifacts,
      nextEventSequence: artifacts.reduce<number | null>(
        (latest, artifact) => latest === null ? artifact.lastEventSequence : Math.max(latest, artifact.lastEventSequence),
        args.afterEventSequence ?? null,
      ),
    };
  },
});

export const submitUserQuestionResponse = mutation({
  args: {
    taskId: v.id("inquiryTasks"),
    artifactId: v.id("taskArtifacts"),
    expectedArtifactRevision: v.number(),
    idempotencyKey: v.string(),
    value: v.union(v.string(), v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedTask(ctx, args.taskId, ownerId);
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    const repeated = await idempotentEventResult(ctx, ownerId, idempotencyKey, args.taskId, args.artifactId);
    if (repeated) return repeated;
    const artifact = await requireOwnedArtifact(ctx, args.artifactId, args.taskId, ownerId);
    if (artifact.revision !== args.expectedArtifactRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (artifact.type !== "user_question" || artifact.status !== "active") throw new ConvexError({ code: "INVALID_TRANSITION" });
    const payload = parseArtifactPayload(artifact.payload);
    if (payload.type !== "user_question" || payload.response) throw new ConvexError({ code: "INVALID_TRANSITION" });
    const responseValue = Array.isArray(args.value)
      ? args.value.map((value) => value.trim()).filter(Boolean)
      : args.value.trim();
    const allowedOptions = new Set(payload.options?.map((option) => option.id) ?? []);
    if (
      (typeof responseValue === "string" && (payload.responseMode !== "text" || responseValue.length < 1 || responseValue.length > 4_000))
      || (Array.isArray(responseValue) && (
        payload.responseMode === "text"
        || responseValue.length < 1
        || responseValue.length > (payload.responseMode === "single_choice" ? 1 : 12)
        || responseValue.some((value) => !allowedOptions.has(value))
      ))
    ) {
      throw new ConvexError({ code: "VALIDATION_FAILED" });
    }
    const now = new Date().toISOString();
    const nextPayload: UserQuestionArtifactPayload = {
      ...payload,
      response: { value: responseValue, submittedAt: now },
    };
    const revision = artifact.revision + 1;
    const eventSequence = await insertArtifactEvent(ctx, {
      ownerId,
      taskId: args.taskId,
      artifactId: artifact._id,
      artifactRevision: revision,
      idempotencyKey,
      eventType: "user_responded",
      source: "user",
      publicChange: { responseSubmitted: true, status: "resolved" },
      occurredAt: now,
    });
    await ctx.db.patch("taskArtifacts", artifact._id, {
      payload: nextPayload,
      status: "resolved",
      revision,
      lastEventSequence: eventSequence,
      updatedAt: now,
    });
    const updated = await ctx.db.get("taskArtifacts", artifact._id);
    if (!updated) throw new ConvexError({ code: "INTERNAL_ERROR" });
    return artifactSnapshot(updated);
  },
});

export const beginControlledFixture = mutation({
  args: { taskId: v.id("inquiryTasks"), expectedTaskRevision: v.number(), idempotencyKey: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const task = await requireOwnedTask(ctx, args.taskId, ownerId);
    if (task.revision !== args.expectedTaskRevision) throw new ConvexError({ code: "STALE_REVISION" });
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    const existing = await ctx.db
      .query("taskArtifacts")
      .withIndex("by_owner_create_key", (q) => q.eq("ownerId", ownerId).eq("createIdempotencyKey", idempotencyKey))
      .unique();
    if (existing) return artifactSnapshot(existing);
    const payload: AuthRequiredArtifactPayload = {
      type: "auth_required",
      providerId: "callbridge_demo",
      providerName: "Concierge controlled provider",
      reason: "This labeled fixture requires a protected authorization handoff before the provider message is revealed.",
      state: "required",
      continuation: "open_secure_browser",
      simulated: true,
    };
    return createArtifactRecord(ctx, {
      ownerId,
      taskId: args.taskId,
      idempotencyKey,
      source: "callbridge_server",
      payload,
      now: new Date().toISOString(),
    });
  },
});

export const completeControlledFixtureAuthorization = mutation({
  args: {
    taskId: v.id("inquiryTasks"),
    artifactId: v.id("taskArtifacts"),
    expectedArtifactRevision: v.number(),
    idempotencyKey: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedTask(ctx, args.taskId, ownerId);
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    const repeated = await idempotentEventResult(ctx, ownerId, idempotencyKey, args.taskId, args.artifactId);
    if (repeated) return repeated;
    const artifact = await requireOwnedArtifact(ctx, args.artifactId, args.taskId, ownerId);
    if (artifact.revision !== args.expectedArtifactRevision) throw new ConvexError({ code: "STALE_REVISION" });
    const payload = parseArtifactPayload(artifact.payload);
    if (payload.type !== "auth_required" || payload.providerId !== "callbridge_demo" || !payload.simulated || artifact.status !== "active") {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }
    const now = new Date().toISOString();
    const revision = artifact.revision + 1;
    const eventSequence = await insertArtifactEvent(ctx, {
      ownerId,
      taskId: args.taskId,
      artifactId: artifact._id,
      artifactRevision: revision,
      idempotencyKey,
      eventType: "authorization_resolved",
      source: "user",
      publicChange: { state: "authorized", status: "resolved", simulated: true },
      occurredAt: now,
    });
    await ctx.db.patch("taskArtifacts", artifact._id, {
      payload: { ...payload, state: "authorized" },
      status: "resolved",
      revision,
      lastEventSequence: eventSequence,
      updatedAt: now,
    });

    const conversation = await createArtifactRecord(ctx, {
      ownerId,
      taskId: args.taskId,
      idempotencyKey: `${idempotencyKey}:conversation`,
      source: "callbridge_server",
      payload: {
        type: "conversation",
        channel: "web_chat",
        title: "Controlled provider conversation",
        participants: [
          { id: "callbridge-agent", displayName: "Concierge", role: "agent" },
          { id: "fixture-provider", displayName: "Controlled provider", role: "provider" },
        ],
        latestMessages: [],
        hasEarlierMessages: false,
        simulated: true,
      },
      now,
    });
    const conversationId = conversation.artifactId as Id<"taskArtifacts">;
    await ctx.db.insert("conversationMessages", {
      ownerId,
      taskId: args.taskId,
      artifactId: conversationId,
      messageId: `provider:${conversationId}:1`,
      idempotencyKey: `${idempotencyKey}:provider-message`,
      sequence: 1,
      authorRole: "provider",
      authorDisplayName: "Controlled provider",
      text: "Late arrival is available. Please provide the approximate arrival window so the desk can leave a factual note.",
      state: "observed",
      source: "callbridge_server",
      occurredAt: now,
    });
    const conversationRow = await ctx.db.get("taskArtifacts", conversationId);
    if (!conversationRow) throw new ConvexError({ code: "INTERNAL_ERROR" });
    const projected = await projectLatestMessages(ctx, conversationId);
    const providerEventSequence = await insertArtifactEvent(ctx, {
      ownerId,
      taskId: args.taskId,
      artifactId: conversationId,
      artifactRevision: 2,
      idempotencyKey: `${idempotencyKey}:provider-message`,
      eventType: "provider_message_observed",
      source: "callbridge_server",
      publicChange: { providerMessageObserved: true, simulated: true },
      occurredAt: now,
    });
    await ctx.db.patch("taskArtifacts", conversationId, {
      payload: { ...(conversationRow.payload as ConversationArtifactPayload), ...projected },
      revision: 2,
      lastEventSequence: providerEventSequence,
      updatedAt: now,
    });
    await createArtifactRecord(ctx, {
      ownerId,
      taskId: args.taskId,
      idempotencyKey: `${idempotencyKey}:question`,
      source: "callbridge_server",
      payload: {
        type: "user_question",
        prompt: "What arrival window should Concierge share with the provider?",
        responseMode: "single_choice",
        options: [
          { id: "before-midnight", label: "Before midnight" },
          { id: "midnight-to-one", label: "12:00–1:00 AM" },
          { id: "after-one", label: "After 1:00 AM" },
        ],
        simulated: true,
      },
      now,
    });
    const updated = await ctx.db.get("taskArtifacts", artifact._id);
    if (!updated) throw new ConvexError({ code: "INTERNAL_ERROR" });
    return artifactSnapshot(updated);
  },
});

export const attachControlledFixtureEvidence = mutation({
  args: { taskId: v.id("inquiryTasks"), idempotencyKey: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedTask(ctx, args.taskId, ownerId);
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    const existing = await ctx.db
      .query("taskArtifacts")
      .withIndex("by_owner_create_key", (q) => q.eq("ownerId", ownerId).eq("createIdempotencyKey", idempotencyKey))
      .unique();
    if (existing) return artifactSnapshot(existing);
    return createArtifactRecord(ctx, {
      ownerId,
      taskId: args.taskId,
      idempotencyKey,
      source: "callbridge_server",
      payload: {
        type: "evidence",
        kind: "screenshot",
        assetRef: "fixture:evidence:late-arrival-policy",
        caption: "Controlled fixture evidence showing the provider's late-arrival policy.",
        capturedAt: new Date().toISOString(),
        provenance: "browser_capture",
        redactionState: "not_required",
        simulated: true,
      },
      now: new Date().toISOString(),
    });
  },
});

// Trusted adapters use this internal capability. It never accepts a caller-supplied source.
export const appendTrustedProviderMessage = internalMutation({
  args: {
    taskId: v.id("inquiryTasks"),
    artifactId: v.id("taskArtifacts"),
    idempotencyKey: v.string(),
    authorDisplayName: v.string(),
    text: v.string(),
    occurredAt: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("inquiryTasks", args.taskId);
    const artifact = await ctx.db.get("taskArtifacts", args.artifactId);
    if (!task || !artifact || artifact.taskId !== args.taskId || artifact.ownerId !== task.ownerId || artifact.type !== "conversation") {
      throw new ConvexError({ code: "NOT_FOUND" });
    }
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    const existing = await ctx.db
      .query("conversationMessages")
      .withIndex("by_artifact_idempotency", (q) => q.eq("artifactId", args.artifactId).eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) return artifactSnapshot(artifact);
    const sequence = await nextMessageSequence(ctx, args.artifactId);
    await ctx.db.insert("conversationMessages", {
      ownerId: task.ownerId,
      taskId: args.taskId,
      artifactId: args.artifactId,
      messageId: `provider:${args.artifactId}:${sequence}`,
      idempotencyKey,
      sequence,
      authorRole: "provider",
      authorDisplayName: args.authorDisplayName,
      text: args.text,
      state: "observed",
      source: "channel_adapter",
      occurredAt: args.occurredAt,
    });
    const projected = await projectLatestMessages(ctx, args.artifactId);
    const revision = artifact.revision + 1;
    const eventSequence = await insertArtifactEvent(ctx, {
      ownerId: task.ownerId,
      taskId: args.taskId,
      artifactId: args.artifactId,
      artifactRevision: revision,
      idempotencyKey,
      eventType: "provider_message_observed",
      source: "channel_adapter",
      publicChange: { providerMessageObserved: true },
      occurredAt: args.occurredAt,
    });
    const payload = parseArtifactPayload(artifact.payload);
    if (payload.type !== "conversation") throw new ConvexError({ code: "INTERNAL_ERROR" });
    await ctx.db.patch("taskArtifacts", args.artifactId, {
      payload: { ...payload, ...projected },
      revision,
      lastEventSequence: eventSequence,
      updatedAt: args.occurredAt,
    });
    const updated = await ctx.db.get("taskArtifacts", args.artifactId);
    if (!updated) throw new ConvexError({ code: "INTERNAL_ERROR" });
    return artifactSnapshot(updated);
  },
});
