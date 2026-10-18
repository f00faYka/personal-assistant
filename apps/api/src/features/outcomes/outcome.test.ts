import { describe, expect, test } from "vitest";

import {
  ConcurrentTaskUpdateError,
  ConcurrentNoteUpdateError,
  InvalidNoteMutationError,
  InvalidTaskMutationError,
  OutcomeService,
  TaskService,
  NoteService,
  type Outcome,
  type OutcomeRepository,
  type TaskChanges,
  type TaskMutationRequest,
  type TaskMutationResult,
  type TaskOutcome,
  type TaskStatusTransition,
  type NoteChanges,
  type NoteOutcome,
} from "./outcome.js";

describe("OutcomeService", () => {
  test("creates one Task for a clear create-task interpretation", () => {
    const repository = new MemoryRepository();
    const service = new OutcomeService(repository);

    const outcome = service.materialize({
      memberId: "member-1",
      transcriptionText: "buy milk tomorrow",
      interpretation: interpretation({
        classification: "clear_supported",
        action: { kind: "create_task", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z" },
      }),
    });

    expect(outcome).toMatchObject({
      kind: "task",
      memberId: "member-1",
      title: "Buy milk",
      dueAt: "2026-08-15T09:00:00.000Z",
      status: "open",
      interpretationId: "interpretation-1",
      version: 0,
    });
  });

  test("creates a Note for ordinary content and marks unclear content for review", () => {
    const repository = new MemoryRepository();
    const service = new OutcomeService(repository);

    const ordinary = service.materialize({
      memberId: "member-1",
      transcriptionText: "the garden looks lovely",
      interpretation: interpretation({ classification: "ordinary" }),
    });
    const ambiguous = service.materialize({
      memberId: "member-1",
      transcriptionText: "maybe do something about the garage",
      interpretation: interpretation({ id: "interpretation-2", classification: "ambiguous" }),
    });

    expect(ordinary).toMatchObject({ kind: "note", content: "the garden looks lovely", reviewState: "none" });
    expect(ambiguous).toMatchObject({ kind: "note", content: "maybe do something about the garage", reviewState: "needs_review" });
  });

  test("returns the existing outcome when the same interpretation is retried", () => {
    const repository = new MemoryRepository();
    const service = new OutcomeService(repository);
    const input = {
      memberId: "member-1",
      transcriptionText: "buy milk",
      interpretation: interpretation({
        classification: "clear_supported",
        action: { kind: "create_task", title: "Buy milk" },
      }),
    };

    const first = service.materialize(input);
    const retry = service.materialize(input);

    expect(retry).toEqual(first);
    expect(repository.values).toHaveLength(1);
  });

  test("does not create an item for a complete-task action", () => {
    const repository = new MemoryRepository();
    const service = new OutcomeService(repository);

    const outcome = service.materialize({
      memberId: "member-1",
      transcriptionText: "mark buy milk complete",
      interpretation: interpretation({
        classification: "clear_supported",
        action: { kind: "complete_task", title: "Buy milk" },
      }),
    });

    expect(outcome).toBeUndefined();
    expect(repository.values).toHaveLength(0);
  });

  test("edits an open Task without changing its provenance", () => {
    const repository = new MemoryRepository();
    const created = new OutcomeService(repository).materialize({
      memberId: "member-1",
      transcriptionText: "buy milk",
      interpretation: interpretation({
        classification: "clear_supported",
        action: { kind: "create_task", title: "Buy milk", dueAt: "2026-08-15T09:00:00.000Z" },
      }),
    });
    const edited = new TaskService(repository).edit(created!.id, "member-1", 0, {
      title: "Buy oat milk",
      dueAt: null,
    });

    expect(edited).toMatchObject({ kind: "task", title: "Buy oat milk", version: 1 });
    expect(edited.dueAt).toBeUndefined();
    expect(edited.captureId).toBe(created?.captureId);
    expect(edited.sourceId).toBe(created?.sourceId);
    expect(edited.interpretationId).toBe(created?.interpretationId);
  });

  test("rejects invalid edits and stale concurrent updates", () => {
    const repository = new MemoryRepository();
    new OutcomeService(repository).materialize({
      memberId: "member-1",
      transcriptionText: "buy milk",
      interpretation: interpretation({
        classification: "clear_supported",
        action: { kind: "create_task", title: "Buy milk" },
      }),
    });
    const service = new TaskService(repository);

    const taskId = repository.values[0]!.id;
    expect(() => service.edit(taskId, "member-1", 0, { title: " " })).toThrowError(InvalidTaskMutationError);
    expect(() => service.edit(taskId, "member-1", 0, { dueAt: "2026-99-99T09:00:00.000Z" })).toThrowError(InvalidTaskMutationError);
    service.edit(taskId, "member-1", 0, { title: "Buy oat milk" });
    expect(() => service.edit(taskId, "member-1", 0, { title: "Buy almond milk" })).toThrowError(ConcurrentTaskUpdateError);
  });

  test("completes a Task idempotently and rejects reopening or editing it", () => {
    const repository = new MemoryRepository();
    new OutcomeService(repository).materialize({
      memberId: "member-1",
      transcriptionText: "buy milk",
      interpretation: interpretation({
        classification: "clear_supported",
        action: { kind: "create_task", title: "Buy milk" },
      }),
    });
    const service = new TaskService(repository);
    const taskId = repository.values[0]!.id;
    const completed = service.complete(taskId, "member-1", 0);

    expect(completed).toMatchObject({ status: "completed", version: 1 });
    expect(service.complete(taskId, "member-1", 0)).toEqual(completed);
    expect(() => service.edit(taskId, "member-1", 1, { title: "Buy eggs" })).toThrowError(InvalidTaskMutationError);
  });

  test("edits a Note without changing its provenance or review state", () => {
    const repository = new MemoryRepository();
    const note = new OutcomeService(repository).materialize({
      memberId: "member-1",
      transcriptionText: "maybe do something",
      interpretation: interpretation({ classification: "ambiguous" }),
    });

    const edited = new NoteService(repository).edit(note!.id, "member-1", 0, {
      content: "Call the gardener about the garage",
    });

    expect(edited).toMatchObject({
      kind: "note",
      content: "Call the gardener about the garage",
      reviewState: "needs_review",
      version: 1,
      captureId: note!.captureId,
      sourceId: note!.sourceId,
      interpretationId: note!.interpretationId,
    });
  });

  test("explicitly saves one review Note and is idempotent", () => {
    const repository = new MemoryRepository();
    const service = new NoteService(repository);
    const input = {
      memberId: "member-1",
      interpretationId: "interpretation-1",
      captureId: "capture-1",
      sourceId: "source-1",
      content: "Remember to call the gardener",
    };

    const first = service.saveFromReview(input);
    const retry = service.saveFromReview(input);

    expect(retry).toEqual(first);
    expect(first).toMatchObject({ kind: "note", reviewState: "none", version: 0 });
    expect(repository.values).toHaveLength(1);
  });

  test("accepts an existing Needs review Note only through matching provenance", () => {
    const repository = new MemoryRepository();
    const existing = new OutcomeService(repository).materialize({
      memberId: "member-1",
      transcriptionText: "maybe water the garden",
      interpretation: interpretation({ classification: "ambiguous" }),
    });
    const service = new NoteService(repository);

    const saved = service.saveFromReview({
      memberId: "member-1",
      interpretationId: existing!.interpretationId,
      captureId: existing!.captureId,
      sourceId: existing!.sourceId,
      content: "Water the garden",
    });

    expect(saved).toMatchObject({ content: "Water the garden", reviewState: "none", version: 1 });
    expect(() => service.saveFromReview({
      memberId: "other-member",
      interpretationId: existing!.interpretationId,
      captureId: existing!.captureId,
      sourceId: existing!.sourceId,
      content: "Take over the garden",
    })).toThrowError(InvalidNoteMutationError);
  });

  test("rejects invalid Note edits and stale concurrent updates", () => {
    const repository = new MemoryRepository();
    const note = new OutcomeService(repository).materialize({
      memberId: "member-1",
      transcriptionText: "the garden looks lovely",
      interpretation: interpretation(),
    });
    const service = new NoteService(repository);

    expect(() => service.edit(note!.id, "member-1", 0, { content: " " })).toThrowError(InvalidNoteMutationError);
    service.edit(note!.id, "member-1", 0, { content: "The garden is thriving" });
    expect(() => service.edit(note!.id, "member-1", 0, { content: "The garden needs water" })).toThrowError(ConcurrentNoteUpdateError);
  });

  test("converts a Note into one Task in place and preserves provenance", () => {
    const repository = new MemoryRepository();
    const note = new OutcomeService(repository).materialize({
      memberId: "member-1",
      transcriptionText: "Call the gardener about the garage",
      interpretation: interpretation({ classification: "ambiguous" }),
    });
    const task = new NoteService(repository).convertToTask(note!.id, "member-1", 0);

    expect(task).toMatchObject({
      kind: "task",
      id: note!.id,
      title: "Call the gardener about the garage",
      status: "open",
      version: 1,
      memberId: "member-1",
      interpretationId: note!.interpretationId,
      captureId: note!.captureId,
      sourceId: note!.sourceId,
    });
    expect(repository.values).toHaveLength(1);
  });

  test("makes repeated Note conversion idempotent and rejects stale conversion", () => {
    const repository = new MemoryRepository();
    const note = new OutcomeService(repository).materialize({
      memberId: "member-1",
      transcriptionText: "Call the gardener",
      interpretation: interpretation({ classification: "ordinary" }),
    });
    const service = new NoteService(repository);
    const converted = service.convertToTask(note!.id, "member-1", 0);

    expect(service.convertToTask(note!.id, "member-1", 0)).toEqual(converted);
    expect(() => service.convertToTask(note!.id, "member-1", 0)).not.toThrow();
  });
});

function interpretation(overrides: {
  id?: string;
  classification?: "clear_supported" | "ordinary" | "ambiguous" | "unsupported";
  action?: { kind: "create_task"; title: string; dueAt?: string } | { kind: "complete_task"; title: string };
} = {}) {
  return {
    id: overrides.id ?? "interpretation-1",
    captureId: "capture-1",
    sourceId: "source-1",
    classification: overrides.classification ?? ("ordinary" as const),
    ...(overrides.action === undefined ? {} : { action: overrides.action }),
  };
}

class MemoryRepository implements OutcomeRepository {
  readonly values: Outcome[] = [];
  readonly taskOperations = new Map<string, { request: string; task: TaskOutcome }>();
  readonly taskTransitions: TaskStatusTransition[] = [];

  findByInterpretationId(interpretationId: string): Outcome | undefined {
    return this.values.find((value) => value.interpretationId === interpretationId);
  }

  findById(id: string): Outcome | undefined {
    return this.values.find((value) => value.id === id);
  }

  create(outcome: Outcome): Outcome {
    this.values.push(outcome);
    return outcome;
  }

  updateTask(taskId: string, memberId: string, expectedVersion: number, changes: TaskChanges): TaskOutcome | undefined {
    const index = this.values.findIndex((value) => value.id === taskId && value.kind === "task" && value.memberId === memberId && value.version === expectedVersion && value.status === "open");
    if (index < 0) return undefined;
    const task = this.values[index];
    if (!task || task.kind !== "task") return undefined;
    const { dueAt: existingDueAt, ...taskWithoutDueAt } = task;
    const updated: TaskOutcome = {
      ...taskWithoutDueAt,
      ...(changes.dueAt === undefined && existingDueAt === undefined ? {} : {}),
      ...(changes.dueAt === undefined && existingDueAt !== undefined ? { dueAt: existingDueAt } : {}),
      ...(changes.dueAt !== undefined && changes.dueAt !== null ? { dueAt: changes.dueAt } : {}),
      ...(changes.title === undefined ? {} : { title: changes.title }),
      ...(changes.status === undefined ? {} : { status: changes.status }),
      version: task.version + 1,
    };
    this.values[index] = updated;
    return updated;
  }

  updateNote(noteId: string, memberId: string, expectedVersion: number, changes: NoteChanges): NoteOutcome | undefined {
    const index = this.values.findIndex((value) => value.id === noteId && value.kind === "note" && value.memberId === memberId && value.version === expectedVersion);
    if (index < 0) return undefined;
    const note = this.values[index];
    if (!note || note.kind !== "note") return undefined;
      const updated: NoteOutcome = {
      ...note,
      ...(changes.content === undefined ? {} : { content: changes.content }),
      ...(changes.reviewState === undefined ? {} : { reviewState: changes.reviewState }),
      version: note.version + 1,
    };
    this.values[index] = updated;
    return updated;
  }

  convertNoteToTask(noteId: string, memberId: string, expectedVersion: number): TaskOutcome | undefined {
    const index = this.values.findIndex((value) => value.id === noteId && value.kind === "note" && value.memberId === memberId && value.version === expectedVersion);
    if (index < 0) return undefined;
    const note = this.values[index];
    if (!note || note.kind !== "note") return undefined;
    const task: TaskOutcome = {
      kind: "task",
      id: note.id,
      memberId: note.memberId,
      interpretationId: note.interpretationId,
      captureId: note.captureId,
      sourceId: note.sourceId,
      title: note.content,
      status: "open",
      version: note.version + 1,
      createdAt: note.createdAt,
    };
    this.values[index] = task;
    return task;
  }

  mutateTask(request: TaskMutationRequest): TaskMutationResult {
    const index = this.values.findIndex((value) => value.id === request.taskId && value.kind === "task" && value.memberId === request.memberId);
    if (index < 0) return { kind: "not_found" };
    const task = this.values[index];
    if (!task || task.kind !== "task") return { kind: "not_found" };
    const key = `${request.memberId}:${request.taskId}:${request.operationId}`;
    const serialized = JSON.stringify({ expectedVersion: request.expectedVersion, mutation: request.mutation });
    const previous = this.taskOperations.get(key);
    if (previous) return previous.request === serialized ? { kind: "applied", task: previous.task } : { kind: "operation_mismatch" };
    if (task.version !== request.expectedVersion) return { kind: "version_conflict", task };

    let updated = task;
    if (request.mutation.kind === "edit") {
      const { dueAt: oldDueAt, ...withoutDueAt } = task;
      updated = {
        ...withoutDueAt,
        ...(request.mutation.changes.dueAt === undefined && oldDueAt !== undefined ? { dueAt: oldDueAt } : {}),
        ...(request.mutation.changes.dueAt !== undefined && request.mutation.changes.dueAt !== null ? { dueAt: request.mutation.changes.dueAt } : {}),
        ...(request.mutation.changes.title === undefined ? {} : { title: request.mutation.changes.title }),
        version: task.version + 1,
      };
    } else {
      const to = request.mutation.kind === "complete" ? "completed" : "open";
      if (task.status !== to) {
        updated = { ...task, status: to, version: task.version + 1 };
        this.taskTransitions.push({ taskId: task.id, memberId: task.memberId, actorMemberId: request.memberId, from: task.status, to, operationId: request.operationId, resultingVersion: updated.version, occurredAt: request.occurredAt });
      }
    }
    this.values[index] = updated;
    this.taskOperations.set(key, { request: serialized, task: updated });
    return { kind: "applied", task: updated };
  }

  listTaskStatusHistory(taskId: string, memberId: string): readonly TaskStatusTransition[] {
    return this.taskTransitions.filter((transition) => transition.taskId === taskId && transition.memberId === memberId);
  }
}
