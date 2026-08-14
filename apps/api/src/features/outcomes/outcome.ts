import { randomUUID } from "node:crypto";

import type { Interpretation, InterpretationAction } from "../interpretations/interpretation.js";

export type NoteReviewState = "none" | "needs_review";
export type TaskStatus = "open" | "completed";

export interface TaskOutcome {
  readonly kind: "task";
  readonly id: string;
  readonly memberId: string;
  readonly interpretationId: string;
  readonly captureId: string;
  readonly sourceId: string;
  readonly title: string;
  readonly dueAt?: string;
  readonly status: TaskStatus;
  readonly version: number;
  readonly createdAt: string;
}

export interface NoteOutcome {
  readonly kind: "note";
  readonly id: string;
  readonly memberId: string;
  readonly interpretationId: string;
  readonly captureId: string;
  readonly sourceId: string;
  readonly content: string;
  readonly reviewState: NoteReviewState;
  readonly createdAt: string;
}

export type Outcome = TaskOutcome | NoteOutcome;

export interface OutcomeInput {
  readonly memberId: string;
  readonly transcriptionText: string;
  readonly interpretation: Pick<
    Interpretation,
    "id" | "captureId" | "sourceId" | "classification" | "action"
  >;
}

export interface OutcomeRepository {
  findByInterpretationId(interpretationId: string): Outcome | undefined;
  findById(id: string): Outcome | undefined;
  create(outcome: Outcome): Outcome;
  updateTask(
    taskId: string,
    memberId: string,
    expectedVersion: number,
    changes: TaskChanges,
  ): TaskOutcome | undefined;
}

export interface TaskChanges {
  readonly title?: string;
  readonly dueAt?: string | null;
  readonly status?: TaskStatus;
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "TaskNotFoundError";
  }
}

export class InvalidTaskMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskMutationError";
  }
}

export class ConcurrentTaskUpdateError extends Error {
  constructor(taskId: string) {
    super(`Task was changed by another request: ${taskId}`);
    this.name = "ConcurrentTaskUpdateError";
  }
}

export class OutcomeService {
  constructor(private readonly repository: OutcomeRepository) {}

  materialize(input: OutcomeInput): Outcome | undefined {
    const existing = this.repository.findByInterpretationId(input.interpretation.id);
    if (existing) return existing;

    const outcome = createOutcome(input);
    return outcome === undefined ? undefined : this.repository.create(outcome);
  }
}

export class TaskService {
  constructor(private readonly repository: Pick<OutcomeRepository, "findById" | "updateTask">) {}

  edit(
    taskId: string,
    memberId: string,
    expectedVersion: number,
    changes: TaskChanges,
  ): TaskOutcome {
    const task = this.getTask(taskId, memberId);
    if (task.status !== "open") {
      throw new InvalidTaskMutationError("completed Tasks cannot be edited");
    }
    if ("status" in changes) {
      throw new InvalidTaskMutationError("use complete to change Task status");
    }
    validateTaskChanges(changes);
    const updated = this.repository.updateTask(taskId, memberId, expectedVersion, changes);
    if (!updated) throw new ConcurrentTaskUpdateError(taskId);
    return updated;
  }

  complete(taskId: string, memberId: string, expectedVersion: number): TaskOutcome {
    const task = this.getTask(taskId, memberId);
    if (task.status === "completed") return task;
    const updated = this.repository.updateTask(taskId, memberId, expectedVersion, { status: "completed" });
    if (!updated) throw new ConcurrentTaskUpdateError(taskId);
    return updated;
  }

  private getTask(taskId: string, memberId: string): TaskOutcome {
    const outcome = this.repository.findById(taskId);
    if (!outcome || outcome.kind !== "task" || outcome.memberId !== memberId) {
      throw new TaskNotFoundError(taskId);
    }
    return outcome;
  }
}

function validateTaskChanges(changes: TaskChanges): void {
  if (Object.keys(changes).length === 0) {
    throw new InvalidTaskMutationError("at least one Task field must change");
  }
  if ("title" in changes && (!changes.title || changes.title.trim().length === 0)) {
    throw new InvalidTaskMutationError("title must not be empty");
  }
  if ("dueAt" in changes && changes.dueAt !== null && !isIsoDate(changes.dueAt)) {
    throw new InvalidTaskMutationError("dueAt must be an ISO date");
  }
  if ("status" in changes && changes.status !== "completed") {
    throw new InvalidTaskMutationError("Tasks can only transition from open to completed");
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === normalized;
}

function createOutcome(input: OutcomeInput): Outcome | undefined {
  const { interpretation } = input;
  const common = {
    id: randomUUID(),
    memberId: input.memberId,
    interpretationId: interpretation.id,
    captureId: interpretation.captureId,
    sourceId: interpretation.sourceId,
    createdAt: new Date().toISOString(),
  };

  if (interpretation.classification === "clear_supported") {
    return createTask(common, interpretation.action);
  }

  return {
    ...common,
    kind: "note",
    content: input.transcriptionText,
    reviewState: interpretation.classification === "ordinary" ? "none" : "needs_review",
  };
}

function createTask(
  common: Omit<TaskOutcome, "kind" | "title" | "dueAt" | "status" | "version">,
  action: InterpretationAction | undefined,
): TaskOutcome | undefined {
  if (action?.kind !== "create_task") return undefined;
  return {
    ...common,
    kind: "task",
    title: action.title,
    ...(action.dueAt === undefined ? {} : { dueAt: action.dueAt }),
    status: "open",
    version: 0,
  };
}
