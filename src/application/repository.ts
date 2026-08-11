import { DomainError } from "../domain/errors.js";
import type { CallTask } from "../domain/model.js";

export interface CallTaskRepository {
  insert(task: CallTask): Promise<void>;
  findById(id: string): Promise<CallTask | null>;
  save(task: CallTask, expectedRevision: number): Promise<void>;
}
export class InMemoryCallTaskRepository implements CallTaskRepository {
  private readonly tasks = new Map<string, CallTask>();

  async insert(task: CallTask): Promise<void> {
    if (this.tasks.has(task.id)) {
      throw new DomainError("STALE_REVISION", "The call task already exists");
    }
    this.tasks.set(task.id, structuredClone(task));
  }

  async findById(id: string): Promise<CallTask | null> {
    const task = this.tasks.get(id);
    return task ? structuredClone(task) : null;
  }

  async save(task: CallTask, expectedRevision: number): Promise<void> {
    const current = this.tasks.get(task.id);
    if (!current) throw new DomainError("NOT_FOUND", "Call task not found");
    if (current.revision !== expectedRevision) {
      throw new DomainError("STALE_REVISION", "The call task changed concurrently");
    }
    this.tasks.set(task.id, structuredClone(task));
  }
}
