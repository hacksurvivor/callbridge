import { DomainError } from "../domain/errors.js";
import type {
  AuthenticatedActor,
  CallTask,
  CancellationTerms,
} from "../domain/model.js";
import {
  beginOptionGathering,
  confirmCancellation,
  confirmCallTask,
  createCallTask,
  type Clock,
  type IdGenerator,
  prepareCancellation,
  stopAutomaticRetries,
  systemClock,
  updateCallTaskDraft,
  uuidGenerator,
} from "../domain/workflow.js";
import type {
  EntitlementProvider,
  IdentityProvider,
  OptionGatheringGateway,
  RealtimeRuntime,
} from "../integrations/ports.js";
import { DEFAULT_REALTIME_RUNTIME } from "../integrations/ports.js";
import type { CallTaskRepository } from "./repository.js";

export type CallTaskServiceDependencies = {
  identity: IdentityProvider;
  entitlements: EntitlementProvider;
  calls: OptionGatheringGateway;
  tasks: CallTaskRepository;
  realtimeRuntime?: RealtimeRuntime;
  clock?: Clock;
  ids?: IdGenerator;
};

export class CallTaskService {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly realtimeRuntime: RealtimeRuntime;

  constructor(private readonly dependencies: CallTaskServiceDependencies) {
    this.clock = dependencies.clock ?? systemClock;
    this.ids = dependencies.ids ?? uuidGenerator;
    this.realtimeRuntime =
      dependencies.realtimeRuntime ?? DEFAULT_REALTIME_RUNTIME;
  }

  async create(credential: string, draft: unknown): Promise<CallTask> {
    const actor = await this.requireActor(credential);
    const task = createCallTask(draft, actor, this.clock, this.ids);
    await this.dependencies.tasks.insert(task);
    return task;
  }

  async get(credential: string, taskId: string): Promise<CallTask> {
    const actor = await this.requireActor(credential);
    return this.requireOwnedTask(taskId, actor);
  }

  async updateDraft(
    credential: string,
    taskId: string,
    replacementDraft: unknown,
    expectedRevision: number,
  ): Promise<CallTask> {
    const actor = await this.requireActor(credential);
    const current = await this.requireOwnedTask(taskId, actor);
    const next = updateCallTaskDraft(
      current,
      replacementDraft,
      expectedRevision,
      actor,
      this.clock,
    );
    await this.dependencies.tasks.save(next, expectedRevision);
    return next;
  }

  async confirm(
    credential: string,
    taskId: string,
    expectedRevision: number,
    noSaveModeAcknowledged = false,
  ): Promise<CallTask> {
    const actor = await this.requireActor(credential);
    const current = await this.requireOwnedTask(taskId, actor);
    const next = confirmCallTask(current, expectedRevision, actor, this.clock, {
      noSaveModeAcknowledged,
    });
    await this.dependencies.tasks.save(next, expectedRevision);
    return next;
  }

  async startOptionGathering(credential: string, taskId: string): Promise<CallTask> {
    const actor = await this.requireActor(credential);
    const entitlement = await this.dependencies.entitlements.getCallEntitlement(actor.userId);
    if (!entitlement.active) {
      throw new DomainError("ENTITLEMENT_REQUIRED", "An active call entitlement is required");
    }

    const current = await this.requireOwnedTask(taskId, actor);
    const gathering = beginOptionGathering(current, actor, this.clock);
    await this.dependencies.tasks.save(gathering, current.revision);

    const confirmation = gathering.confirmation;
    if (!confirmation) {
      throw new DomainError("INVALID_TRANSITION", "Confirmation unexpectedly missing");
    }
    const session = await this.dependencies.calls.start({
      taskId: gathering.id,
      ownerId: gathering.ownerId,
      draft: gathering.draft,
      confirmation: {
        confirmedAt: confirmation.confirmedAt,
        confirmedRevision: confirmation.confirmedRevision,
      },
      runtime: this.realtimeRuntime,
      capability: "gather_options_only",
      forbiddenActions: [
        "book",
        "pay",
        "accept_terms",
        "irreversible_commitment",
        "cancel",
      ],
    });

    const started: CallTask = {
      ...gathering,
      revision: gathering.revision + 1,
      execution: {
        externalSessionId: session.externalSessionId,
        startedAt: this.clock.now().toISOString(),
      },
      updatedAt: this.clock.now().toISOString(),
    };
    await this.dependencies.tasks.save(started, gathering.revision);
    return started;
  }

  async stopRetries(credential: string, taskId: string): Promise<CallTask> {
    const actor = await this.requireActor(credential);
    const current = await this.requireOwnedTask(taskId, actor);
    const next = stopAutomaticRetries(current, actor, this.clock);
    await this.dependencies.tasks.save(next, current.revision);
    return next;
  }

  async prepareCancellation(
    credential: string,
    taskId: string,
    terms: CancellationTerms,
    expectedRevision: number,
  ): Promise<CallTask> {
    const actor = await this.requireActor(credential);
    const current = await this.requireOwnedTask(taskId, actor);
    const next = prepareCancellation(
      current,
      terms,
      expectedRevision,
      actor,
      this.clock,
    );
    await this.dependencies.tasks.save(next, expectedRevision);
    return next;
  }

  async confirmCancellation(
    credential: string,
    taskId: string,
    expectedRevision: number,
  ): Promise<CallTask> {
    const actor = await this.requireActor(credential);
    const current = await this.requireOwnedTask(taskId, actor);
    const next = confirmCancellation(
      current,
      expectedRevision,
      actor,
      this.clock,
    );
    await this.dependencies.tasks.save(next, expectedRevision);
    return next;
  }

  private async requireActor(credential: string): Promise<AuthenticatedActor> {
    const actor = await this.dependencies.identity.authenticate(credential);
    if (!actor) throw new DomainError("UNAUTHENTICATED", "Authentication is required");
    return actor;
  }

  private async requireOwnedTask(taskId: string, actor: AuthenticatedActor): Promise<CallTask> {
    const task = await this.dependencies.tasks.findById(taskId);
    if (!task) throw new DomainError("NOT_FOUND", "Call task not found");
    if (task.ownerId !== actor.userId) {
      throw new DomainError("FORBIDDEN", "The call task belongs to another user");
    }
    return task;
  }
}
