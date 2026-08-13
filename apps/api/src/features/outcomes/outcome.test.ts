import { describe, expect, test } from "vitest";

import { OutcomeService, type Outcome, type OutcomeRepository } from "./outcome.js";

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

  create(outcome: Outcome): Outcome {
    this.values.push(outcome);
    return outcome;
  }
}
