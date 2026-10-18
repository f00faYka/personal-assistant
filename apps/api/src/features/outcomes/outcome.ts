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
  readonly version: number;
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
  updateNote(
    noteId: string,
    memberId: string,
    expectedVersion: number,
    changes: NoteChanges,
  ): NoteOutcome | undefined;
  convertNoteToTask(
    noteId: string,
    memberId: string,
    expectedVersion: number,
  ): TaskOutcome | undefined;
  mutateTask(request: TaskMutationRequest): TaskMutationResult;
  listTaskStatusHistory(taskId: string, memberId: string): readonly TaskStatusTransition[];
}

export type TaskMutation =
  | { readonly kind: "edit"; readonly changes: Omit<TaskChanges, "status"> }
  | { readonly kind: "complete" }
  | { readonly kind: "reopen" };

export interface TaskMutationRequest {
  readonly taskId: string;
  readonly memberId: string;
  readonly expectedVersion: number;
  readonly operationId: string;
  readonly mutation: TaskMutation;
  readonly occurredAt: string;
}

export type TaskMutationResult =
  | { readonly kind: "applied"; readonly task: TaskOutcome }
  | { readonly kind: "not_found" }
  | { readonly kind: "operation_mismatch" }
  | { readonly kind: "version_conflict"; readonly task: TaskOutcome };

export interface TaskStatusTransition {
  readonly taskId: string;
  readonly memberId: string;
  readonly actorMemberId: string;
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  readonly operationId: string;
  readonly resultingVersion: number;
  readonly occurredAt: string;
}

export interface TaskChanges {
  readonly title?: string;
  readonly dueAt?: string | null;
  readonly status?: TaskStatus;
}

export interface NoteChanges {
  readonly content?: string;
  readonly reviewState?: NoteReviewState;
}

export interface ReviewNoteInput {
  readonly memberId: string;
  readonly interpretationId: string;
  readonly captureId: string;
  readonly sourceId: string;
  readonly content: string;
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
  constructor(taskId: string, readonly currentTask?: TaskOutcome) {
    super(`Task was changed by another request: ${taskId}`);
    this.name = "ConcurrentTaskUpdateError";
  }
}

export class TaskOperationMismatchError extends Error {
  constructor(operationId: string) {
    super(`Task operation ID was already used for a different request: ${operationId}`);
    this.name = "TaskOperationMismatchError";
  }
}

export class NoteNotFoundError extends Error {
  constructor(noteId: string) {
    super(`Note not found: ${noteId}`);
    this.name = "NoteNotFoundError";
  }
}

export class InvalidNoteMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidNoteMutationError";
  }
}

export class ConcurrentNoteUpdateError extends Error {
  constructor(noteId: string) {
    super(`Note was changed by another request: ${noteId}`);
    this.name = "ConcurrentNoteUpdateError";
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
  constructor(private readonly repository: Pick<OutcomeRepository, "findById" | "updateTask" | "mutateTask" | "listTaskStatusHistory">) {}

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

  editWithOperation(
    taskId: string,
    memberId: string,
    expectedVersion: number,
    operationId: string,
    changes: Omit<TaskChanges, "status">,
  ): TaskOutcome {
    validateTaskChanges(changes);
    return this.mutate({ taskId, memberId, expectedVersion, operationId, mutation: { kind: "edit", changes } });
  }

  completeWithOperation(taskId: string, memberId: string, expectedVersion: number, operationId: string): TaskOutcome {
    return this.mutate({ taskId, memberId, expectedVersion, operationId, mutation: { kind: "complete" } });
  }

  reopen(taskId: string, memberId: string, expectedVersion: number, operationId: string): TaskOutcome {
    return this.mutate({ taskId, memberId, expectedVersion, operationId, mutation: { kind: "reopen" } });
  }

  listStatusHistory(taskId: string, memberId: string): readonly TaskStatusTransition[] {
    const task = this.getTask(taskId, memberId);
    return this.repository.listTaskStatusHistory(task.id, memberId);
  }

  private mutate(request: Omit<TaskMutationRequest, "occurredAt">): TaskOutcome {
    if (!request.operationId.trim()) throw new InvalidTaskMutationError("operationId is required");
    const result = this.repository.mutateTask({ ...request, occurredAt: new Date().toISOString() });
    switch (result.kind) {
      case "applied": return result.task;
      case "not_found": throw new TaskNotFoundError(request.taskId);
      case "operation_mismatch": throw new TaskOperationMismatchError(request.operationId);
      case "version_conflict": throw new ConcurrentTaskUpdateError(request.taskId, result.task);
    }
  }

  private getTask(taskId: string, memberId: string): TaskOutcome {
    const outcome = this.repository.findById(taskId);
    if (!outcome || outcome.kind !== "task" || outcome.memberId !== memberId) {
      throw new TaskNotFoundError(taskId);
    }
    return outcome;
  }
}

export class NoteService {
  constructor(private readonly repository: Pick<OutcomeRepository, "findById" | "updateNote" | "findByInterpretationId" | "create" | "convertNoteToTask">) {}

  saveFromReview(input: ReviewNoteInput): NoteOutcome {
    validateNoteChanges({ content: input.content });
    const existing = this.repository.findByInterpretationId(input.interpretationId);
    if (existing) {
      if (existing.kind !== "note") throw new InvalidNoteMutationError("a Task already exists for this review");
      if (existing.memberId !== input.memberId || existing.captureId !== input.captureId || existing.sourceId !== input.sourceId) {
        throw new InvalidNoteMutationError("review provenance does not match the existing Note");
      }
      if (existing.reviewState === "none") return existing;
      const updated = this.repository.updateNote(existing.id, input.memberId, existing.version, {
        content: input.content,
        reviewState: "none",
      });
      if (!updated) throw new ConcurrentNoteUpdateError(existing.id);
      return updated;
    }
    return this.repository.create({
      kind: "note",
      id: randomUUID(),
      memberId: input.memberId,
      interpretationId: input.interpretationId,
      captureId: input.captureId,
      sourceId: input.sourceId,
      content: input.content,
      reviewState: "none",
      version: 0,
      createdAt: new Date().toISOString(),
    }) as NoteOutcome;
  }

  edit(
    noteId: string,
    memberId: string,
    expectedVersion: number,
    changes: NoteChanges,
  ): NoteOutcome {
    const note = this.getNote(noteId, memberId);
    validateNoteChanges(changes);
    const updated = this.repository.updateNote(noteId, memberId, expectedVersion, changes);
    if (!updated) throw new ConcurrentNoteUpdateError(note.id);
    return updated;
  }

  convertToTask(noteId: string, memberId: string, expectedVersion: number): TaskOutcome {
    const outcome = this.repository.findById(noteId);
    if (!outcome || outcome.memberId !== memberId) throw new NoteNotFoundError(noteId);
    if (outcome.kind === "task") return outcome;
    const converted = this.repository.convertNoteToTask(noteId, memberId, expectedVersion);
    if (!converted) throw new ConcurrentNoteUpdateError(noteId);
    return converted;
  }

  private getNote(noteId: string, memberId: string): NoteOutcome {
    const outcome = this.repository.findById(noteId);
    if (!outcome || outcome.kind !== "note" || outcome.memberId !== memberId) {
      throw new NoteNotFoundError(noteId);
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

function validateNoteChanges(changes: NoteChanges): void {
  if (Object.keys(changes).length === 0) {
    throw new InvalidNoteMutationError("at least one Note field must change");
  }
  if ("content" in changes && (!changes.content || changes.content.trim().length === 0)) {
    throw new InvalidNoteMutationError("content must not be empty");
  }
  if ("reviewState" in changes && changes.reviewState !== "none" && changes.reviewState !== "needs_review") {
    throw new InvalidNoteMutationError("invalid Note review state");
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
    version: 0,
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
