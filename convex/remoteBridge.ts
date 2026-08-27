import { ConvexError, v } from "convex/values";

import {
  REMOTE_EVENT_MAX_LENGTH,
  REMOTE_RESULT_MAX_LENGTH,
  constantTimeEqualHex,
  normalizeRemoteInstruction,
  normalizeRemoteOutput,
  validateRemoteClientRequestId,
  validateRemoteCommandKind,
  validateRemoteDisplayName,
  validateRemoteHostId,
  validateRemoteSecretHash,
} from "../src/domain/remoteControl.js";
import {
  remoteCommandEventKindValidator,
  remoteCommandKindValidator,
  remoteCommandStatusValidator,
} from "./validators.js";
import type { Doc } from "./_generated/dataModel.js";
import { internalMutation, internalQuery } from "./_generated/server.js";

const remoteHostValidator = v.object({
  hostId: v.string(),
  displayName: v.string(),
  state: v.union(v.literal("online"), v.literal("offline"), v.literal("revoked")),
  lastSeenAt: v.string(),
});

const remoteCommandValidator = v.object({
  commandId: v.id("remoteCommands"),
  hostId: v.string(),
  clientRequestId: v.string(),
  kind: remoteCommandKindValidator,
  instruction: v.optional(v.string()),
  state: remoteCommandStatusValidator,
  requestedAt: v.string(),
  startedAt: v.optional(v.string()),
  completedAt: v.optional(v.string()),
  cancellationRequestedAt: v.optional(v.string()),
  resultSummary: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  events: v.optional(v.array(v.object({
    sequence: v.number(),
    kind: remoteCommandEventKindValidator,
    message: v.string(),
    createdAt: v.string(),
  }))),
});

function unauthorized(): never {
  throw new ConvexError({ code: "REMOTE_HOST_UNAUTHORIZED" });
}

function ensureAuthorized(storedHash: string, suppliedHash: string, state: string): void {
  if (state === "revoked" || !constantTimeEqualHex(storedHash, suppliedHash)) unauthorized();
}

function commandView(
  command: Doc<"remoteCommands">,
  overrides: Partial<Pick<Doc<"remoteCommands">, "state" | "startedAt">> = {},
) {
  const state = overrides.state ?? command.state;
  const startedAt = overrides.startedAt ?? command.startedAt;
  return {
    commandId: command._id,
    hostId: command.hostId,
    clientRequestId: command.clientRequestId,
    kind: command.kind,
    ...(command.instruction === undefined ? {} : { instruction: command.instruction }),
    state,
    requestedAt: command.requestedAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(command.completedAt === undefined ? {} : { completedAt: command.completedAt }),
    ...(command.cancellationRequestedAt === undefined ? {} : { cancellationRequestedAt: command.cancellationRequestedAt }),
    ...(command.resultSummary === undefined ? {} : { resultSummary: command.resultSummary }),
    ...(command.failureReason === undefined ? {} : { failureReason: command.failureReason }),
  };
}

export const registerHost = internalMutation({
  args: { hostId: v.string(), displayName: v.string(), secretHash: v.string(), now: v.string() },
  returns: v.id("remoteHosts"),
  handler: async (ctx, args) => {
    const hostId = validateRemoteHostId(args.hostId);
    const displayName = validateRemoteDisplayName(args.displayName);
    const secretHash = validateRemoteSecretHash(args.secretHash);
    const existing = await ctx.db.query("remoteHosts").withIndex("by_host_id", (q) => q.eq("hostId", hostId)).unique();
    if (existing) {
      ensureAuthorized(existing.secretHash, secretHash, existing.state);
      await ctx.db.patch("remoteHosts", existing._id, {
        displayName,
        state: "online",
        updatedAt: args.now,
        lastSeenAt: args.now,
      });
      return existing._id;
    }
    return await ctx.db.insert("remoteHosts", {
      hostId,
      displayName,
      secretHash,
      state: "online",
      createdAt: args.now,
      updatedAt: args.now,
      lastSeenAt: args.now,
    });
  },
});

export const heartbeat = internalMutation({
  args: { hostId: v.string(), secretHash: v.string(), now: v.string() },
  returns: remoteHostValidator,
  handler: async (ctx, args) => {
    const hostId = validateRemoteHostId(args.hostId);
    const secretHash = validateRemoteSecretHash(args.secretHash);
    const host = await ctx.db.query("remoteHosts").withIndex("by_host_id", (q) => q.eq("hostId", hostId)).unique();
    if (!host) unauthorized();
    ensureAuthorized(host.secretHash, secretHash, host.state);
    await ctx.db.patch("remoteHosts", host._id, { state: "online", updatedAt: args.now, lastSeenAt: args.now });
    return { hostId, displayName: host.displayName, state: "online" as const, lastSeenAt: args.now };
  },
});

export const enqueueCommand = internalMutation({
  args: {
    hostId: v.string(),
    secretHash: v.string(),
    clientRequestId: v.string(),
    kind: v.string(),
    instruction: v.optional(v.string()),
    now: v.string(),
    expiresAt: v.string(),
  },
  returns: v.id("remoteCommands"),
  handler: async (ctx, args) => {
    const hostId = validateRemoteHostId(args.hostId);
    const secretHash = validateRemoteSecretHash(args.secretHash);
    const clientRequestId = validateRemoteClientRequestId(args.clientRequestId);
    const kind = validateRemoteCommandKind(args.kind);
    const instruction = normalizeRemoteInstruction(kind, args.instruction);
    const host = await ctx.db.query("remoteHosts").withIndex("by_host_id", (q) => q.eq("hostId", hostId)).unique();
    if (!host) unauthorized();
    ensureAuthorized(host.secretHash, secretHash, host.state);

    const hostRequestKey = `${hostId}:${clientRequestId}`;
    const existing = await ctx.db.query("remoteCommands").withIndex("by_host_request", (q) => q.eq("hostRequestKey", hostRequestKey)).unique();
    if (existing) {
      if (existing.kind !== kind || existing.instruction !== instruction) {
        throw new ConvexError({ code: "REMOTE_REQUEST_ID_CONFLICT" });
      }
      return existing._id;
    }

    return await ctx.db.insert("remoteCommands", {
      hostId,
      hostRequestKey,
      clientRequestId,
      kind,
      ...(instruction === undefined ? {} : { instruction }),
      state: "pending",
      nextEventSequence: 0,
      requestedAt: args.now,
      expiresAt: args.expiresAt,
    });
  },
});

export const claimNextCommand = internalMutation({
  args: { hostId: v.string(), secretHash: v.string(), now: v.string() },
  returns: v.union(remoteCommandValidator, v.null()),
  handler: async (ctx, args) => {
    const hostId = validateRemoteHostId(args.hostId);
    const secretHash = validateRemoteSecretHash(args.secretHash);
    const host = await ctx.db.query("remoteHosts").withIndex("by_host_id", (q) => q.eq("hostId", hostId)).unique();
    if (!host) unauthorized();
    ensureAuthorized(host.secretHash, secretHash, host.state);
    await ctx.db.patch("remoteHosts", host._id, { state: "online", updatedAt: args.now, lastSeenAt: args.now });

    const commands = await ctx.db
      .query("remoteCommands")
      .withIndex("by_host_state_requested", (q) => q.eq("hostId", hostId).eq("state", "pending"))
      .order("asc")
      .take(20);
    for (const command of commands) {
      if (command.expiresAt <= args.now) {
        await ctx.db.patch("remoteCommands", command._id, {
          state: "cancelled",
          completedAt: args.now,
          resultSummary: "Expired before the Mac claimed it.",
        });
        continue;
      }
      await ctx.db.patch("remoteCommands", command._id, { state: "running", startedAt: args.now });
      return commandView(command, { state: "running", startedAt: args.now });
    }
    return null;
  },
});

export const appendCommandEvent = internalMutation({
  args: {
    hostId: v.string(),
    secretHash: v.string(),
    commandId: v.id("remoteCommands"),
    kind: remoteCommandEventKindValidator,
    message: v.string(),
    now: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const hostId = validateRemoteHostId(args.hostId);
    const secretHash = validateRemoteSecretHash(args.secretHash);
    const message = normalizeRemoteOutput(args.message, REMOTE_EVENT_MAX_LENGTH);
    const host = await ctx.db.query("remoteHosts").withIndex("by_host_id", (q) => q.eq("hostId", hostId)).unique();
    if (!host) unauthorized();
    ensureAuthorized(host.secretHash, secretHash, host.state);
    const command = await ctx.db.get("remoteCommands", args.commandId);
    if (!command || command.hostId !== hostId) unauthorized();
    if (!(command.state === "running" || command.state === "cancellation_requested")) {
      throw new ConvexError({ code: "REMOTE_COMMAND_NOT_RUNNING" });
    }
    const sequence = command.nextEventSequence;
    if (sequence >= 200) throw new ConvexError({ code: "REMOTE_EVENT_LIMIT_REACHED" });
    await ctx.db.insert("remoteCommandEvents", {
      commandId: command._id,
      hostId,
      sequence,
      kind: args.kind,
      message,
      createdAt: args.now,
    });
    await ctx.db.patch("remoteCommands", command._id, { nextEventSequence: sequence + 1 });
    return sequence;
  },
});

export const completeCommand = internalMutation({
  args: {
    hostId: v.string(),
    secretHash: v.string(),
    commandId: v.id("remoteCommands"),
    outcome: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("cancelled")),
    summary: v.string(),
    now: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const hostId = validateRemoteHostId(args.hostId);
    const secretHash = validateRemoteSecretHash(args.secretHash);
    const summary = normalizeRemoteOutput(args.summary, REMOTE_RESULT_MAX_LENGTH);
    const host = await ctx.db.query("remoteHosts").withIndex("by_host_id", (q) => q.eq("hostId", hostId)).unique();
    if (!host) unauthorized();
    ensureAuthorized(host.secretHash, secretHash, host.state);
    const command = await ctx.db.get("remoteCommands", args.commandId);
    if (!command || command.hostId !== hostId) unauthorized();
    if (!(["running", "cancellation_requested"] as string[]).includes(command.state)) {
      throw new ConvexError({ code: "REMOTE_COMMAND_NOT_RUNNING" });
    }
    await ctx.db.patch("remoteCommands", command._id, {
      state: args.outcome,
      completedAt: args.now,
      ...(args.outcome === "failed" ? { failureReason: summary } : { resultSummary: summary }),
    });
    return null;
  },
});

export const requestCancellation = internalMutation({
  args: { hostId: v.string(), secretHash: v.string(), commandId: v.id("remoteCommands"), now: v.string() },
  returns: remoteCommandStatusValidator,
  handler: async (ctx, args) => {
    const hostId = validateRemoteHostId(args.hostId);
    const secretHash = validateRemoteSecretHash(args.secretHash);
    const host = await ctx.db.query("remoteHosts").withIndex("by_host_id", (q) => q.eq("hostId", hostId)).unique();
    if (!host) unauthorized();
    ensureAuthorized(host.secretHash, secretHash, host.state);
    const command = await ctx.db.get("remoteCommands", args.commandId);
    if (!command || command.hostId !== hostId) unauthorized();
    if (command.state === "pending") {
      await ctx.db.patch("remoteCommands", command._id, { state: "cancelled", completedAt: args.now, resultSummary: "Cancelled before the Mac started it." });
      return "cancelled";
    }
    if (command.state === "running") {
      await ctx.db.patch("remoteCommands", command._id, { state: "cancellation_requested", cancellationRequestedAt: args.now });
      return "cancellation_requested";
    }
    return command.state;
  },
});

export const getCommandState = internalQuery({
  args: { hostId: v.string(), secretHash: v.string(), commandId: v.id("remoteCommands") },
  returns: remoteCommandStatusValidator,
  handler: async (ctx, args) => {
    const hostId = validateRemoteHostId(args.hostId);
    const secretHash = validateRemoteSecretHash(args.secretHash);
    const host = await ctx.db.query("remoteHosts").withIndex("by_host_id", (q) => q.eq("hostId", hostId)).unique();
    if (!host) unauthorized();
    ensureAuthorized(host.secretHash, secretHash, host.state);
    const command = await ctx.db.get("remoteCommands", args.commandId);
    if (!command || command.hostId !== hostId) unauthorized();
    return command.state;
  },
});

export const listCommands = internalQuery({
  args: { hostId: v.string(), secretHash: v.string(), limit: v.number() },
  returns: v.object({ host: remoteHostValidator, commands: v.array(remoteCommandValidator) }),
  handler: async (ctx, args) => {
    const hostId = validateRemoteHostId(args.hostId);
    const secretHash = validateRemoteSecretHash(args.secretHash);
    const host = await ctx.db.query("remoteHosts").withIndex("by_host_id", (q) => q.eq("hostId", hostId)).unique();
    if (!host) unauthorized();
    ensureAuthorized(host.secretHash, secretHash, host.state);
    const limit = Math.max(1, Math.min(Math.floor(args.limit), 50));
    const commands = await ctx.db.query("remoteCommands").withIndex("by_host_requested", (q) => q.eq("hostId", hostId)).order("desc").take(limit);
    const commandsWithEvents = await Promise.all(commands.map(async (command) => {
      const events = await ctx.db
        .query("remoteCommandEvents")
        .withIndex("by_command_sequence", (q) => q.eq("commandId", command._id))
        .order("desc")
        .take(10);
      return {
        ...commandView(command),
        events: events.reverse().map((event) => ({
          sequence: event.sequence,
          kind: event.kind,
          message: event.message,
          createdAt: event.createdAt,
        })),
      };
    }));
    return {
      host: { hostId, displayName: host.displayName, state: host.state, lastSeenAt: host.lastSeenAt },
      commands: commandsWithEvents,
    };
  },
});
