import { describe, expect, test } from "vitest";

import {
  ConcurrentTaskUpdateError,
  InvalidTaskMutationError,
  OutcomeService,
  TaskService,
  type Outcome,
  type OutcomeRepository,
  type TaskChanges,
  type TaskOutcome,
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
}
