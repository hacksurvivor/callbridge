export type TaskStage = "home" | "draft" | "active" | "decision" | "activity" | "preferences";

export type MobileTask = {
  id: string;
  request: string;
  stage: Exclude<TaskStage, "home">;
  activity: Array<{ title: string; detail: string; emphasis?: boolean }>;
  stopped?: boolean;
  remote?: { id: string; revision: number; state: "syncing" | "synced" | "failed"; message?: string };
};

/**
 * Client-side adapter used until a configured Convex deployment is available.
 * It mirrors the safe UI state machine only; no call, payment, or contact can
 * leave the device through this adapter.
 */
export class LocalTaskStore {
  private task: MobileTask | null = null;

  createDraft(request: string): MobileTask {
    this.task = {
      id: `draft-${Date.now()}`,
      request,
      stage: "draft",
      activity: [],
    };
    return this.task;
  }

  confirmCurrent(): MobileTask {
    if (!this.task || this.task.stage !== "draft") throw new Error("Only a draft can be confirmed");
    this.task = {
      ...this.task,
      stage: "active",
      activity: [
        { title: "Draft confirmed", detail: "No booking or payment is authorised." },
        { title: "Waiting for a live calling connection", detail: "Local preview never places a call or invents a response.", emphasis: true },
      ],
    };
    return this.task;
  }

  prepareDecision(): MobileTask {
    if (!this.task || this.task.stage !== "active" || this.task.stopped) throw new Error("An active task is required");
    this.task = { ...this.task, stage: "decision" };
    return this.task;
  }

  stopCurrent(): MobileTask {
    if (!this.task || this.task.stage !== "active") throw new Error("An active task is required");
    this.task = { ...this.task, stopped: true, activity: [...this.task.activity, { title: "Future attempts stopped", detail: "Your existing booking or request was not cancelled." }] };
    return this.task;
  }

  markRemoteCreated(id: string): MobileTask {
    if (!this.task) throw new Error("A task is required");
    this.task = { ...this.task, remote: { id, revision: 1, state: "synced" } };
    return this.task;
  }

  markRemoteConfirmed(): MobileTask {
    if (!this.task?.remote) throw new Error("A synced task is required");
    this.task = { ...this.task, remote: { ...this.task.remote, revision: this.task.remote.revision + 1, state: "synced" } };
    return this.task;
  }

  markRemoteStopped(): MobileTask {
    if (!this.task?.remote) throw new Error("A synced task is required");
    this.task = { ...this.task, remote: { ...this.task.remote, revision: this.task.remote.revision + 1, state: "synced" } };
    return this.task;
  }

  markRemoteFailure(message: string): MobileTask {
    if (!this.task) throw new Error("A task is required");
    this.task = { ...this.task, remote: { id: this.task.remote?.id ?? "", revision: this.task.remote?.revision ?? 0, state: "failed", message } };
    return this.task;
  }

  retryCurrent(): MobileTask {
    if (!this.task || this.task.stage !== "active" || this.task.stopped) throw new Error("An active task is required");
    this.task = {
      ...this.task,
      activity: [
        ...this.task.activity,
        { title: "Retry preference saved", detail: "A live provider can use this 5-minute retry after it is connected." },
      ],
    };
    return this.task;
  }

  clear(): void { this.task = null; }
}
