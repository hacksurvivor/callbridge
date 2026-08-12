export type TaskStage = "home" | "draft" | "active" | "decision";

export type MobileTask = {
  id: string;
  request: string;
  stage: Exclude<TaskStage, "home">;
  activity: Array<{ title: string; detail: string; emphasis?: boolean }>;
  stopped?: boolean;
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
        { title: "Checking the details", detail: "Draft confirmed. No booking or payment is authorised." },
        { title: "Reception answered", detail: "Thai · translated live", emphasis: true },
        { title: "Comparing available options", detail: "Waiting for the final price" },
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

  clear(): void { this.task = null; }
}
