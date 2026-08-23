import { describe, expect, test } from "vitest";

import {
  InterpretationService,
  SUPPORTED_INTERPRETATION_CATALOG_VERSION,
  type Interpretation,
} from "./interpretation.js";

describe("InterpretationService", () => {
  test("accepts a clear supported create-task proposal", () => {
    const service = new InterpretationService(new MemoryRepository());

    const interpretation = service.evaluate({
      captureId: "capture-1",
      sourceId: "source-1",
      transcriptionId: "transcription-1",
      transcriptionStatus: "succeeded",
      transcriptionText: "buy milk",
      capturedAt: "2026-08-23T12:00:00.000Z",
      catalogVersion: SUPPORTED_INTERPRETATION_CATALOG_VERSION,
      model: "qwen-test",
      rawOutput: {
        action: "create_task",
        title: "Buy milk",
        dueAt: "2026-08-15T09:00:00.000Z",
      },
    });

    expect(interpretation).toMatchObject({
      captureId: "capture-1",
      sourceId: "source-1",
      transcriptionId: "transcription-1",
      catalogVersion: SUPPORTED_INTERPRETATION_CATALOG_VERSION,
      model: "qwen-test",
      classification: "clear_supported",
      action: {
        kind: "create_task",
        title: "Buy milk",
        dueAt: "2026-08-15T09:00:00.000Z",
      },
    });
  });

  test("normalizes the explicit spoken date and removes command filler from the title", () => {
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Task, please remind me to cancel subscription to the Strava series" }, undefined, "strava-transcription"),
      transcriptionText: "Task, please remind me to cancel subscription to the Strava series on the 1st of September.",
      capturedAt: "2026-08-23T12:00:00.000Z",
    });
    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", title: "cancel subscription to the Strava series", dueAt: "2026-09-01T00:00:00.000Z" },
    });
  });

  test("rejects an explicit date when the model supplies a contradictory date", () => {
    expect(new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Cancel subscription", dueAt: "2026-09-02T00:00:00.000Z" }),
      transcriptionText: "Task, cancel subscription on the 1st of September",
      capturedAt: "2026-08-23T12:00:00.000Z",
    })).toMatchObject({ classification: "unsupported", rejectionReason: "malformed_model_output" });
  });

  test("normalizes relative dates and rejects titles that clean to empty", () => {
    const service = new InterpretationService(new MemoryRepository());
    expect(service.evaluate({
      ...input({ action: "create_task", title: "Buy milk" }),
      transcriptionText: "add task buy milk tomorrow",
    })).toMatchObject({ action: { dueAt: "2026-08-24T00:00:00.000Z" } });
    expect(service.evaluate({
      ...input({ action: "create_task", title: "Task" }, undefined, "blank-title"),
      transcriptionText: "create a task",
    })).toMatchObject({ classification: "unsupported", rejectionReason: "malformed_model_output" });
  });

  test("classifies ordinary and ambiguous content without an action", () => {
    const service = new InterpretationService(new MemoryRepository());

    expect(service.evaluate(input({ action: "none", reason: "ordinary" }, undefined, "transcription-ordinary"))).toMatchObject({
      classification: "ordinary",
      rejectionReason: "ordinary_content",
    });
    expect(service.evaluate(input({ action: "none", reason: "ambiguous" }, undefined, "transcription-ambiguous"))).toMatchObject({
      classification: "ambiguous",
      rejectionReason: "ambiguous_instruction",
    });
  });

  test("classifies malformed, unsupported, and catalog-mismatched output deterministically", () => {
    const service = new InterpretationService(new MemoryRepository());

    expect(service.evaluate(input(null, undefined, "transcription-malformed"))).toMatchObject({
      classification: "unsupported",
      rejectionReason: "malformed_model_output",
    });
    expect(service.evaluate(input({ action: "delete_task", title: "Buy milk" }, undefined, "transcription-unsupported"))).toMatchObject({
      classification: "unsupported",
      rejectionReason: "unsupported_action",
    });
    expect(service.evaluate(input({ action: "create_task", title: "Buy milk" }, "direct-instructions.v0", "transcription-version"))).toMatchObject({
      classification: "unsupported",
      rejectionReason: "catalog_version_mismatch",
    });
  });

  test("preserves raw evidence and returns one interpretation for a transcription retry", () => {
    const repository = new MemoryRepository();
    const service = new InterpretationService(repository);
    const first = service.evaluate(input({ action: "complete_task", title: "Buy milk" }));
    const retry = service.evaluate(input({ action: "create_task", title: "Different result" }));

    expect(retry).toEqual(first);
    expect(first.rawOutputJson).toBe('{"action":"complete_task","title":"Buy milk"}');
    expect(repository.values).toHaveLength(1);
  });
});

function input(
  rawOutput: unknown,
  catalogVersion = SUPPORTED_INTERPRETATION_CATALOG_VERSION,
  transcriptionId = "transcription-1",
) {
  return {
    captureId: "capture-1",
    sourceId: "source-1",
    transcriptionId,
    transcriptionStatus: "succeeded" as const,
    transcriptionText: "buy milk tomorrow",
    capturedAt: "2026-08-23T12:00:00.000Z",
    catalogVersion,
    model: "qwen-test",
    rawOutput,
  };
}

class MemoryRepository {
  readonly values: Interpretation[] = [];

  create(interpretation: Interpretation): Interpretation {
    this.values.push(interpretation);
    return interpretation;
  }

  findByTranscriptionId(transcriptionId: string): Interpretation | undefined {
    return this.values.find((value) => value.transcriptionId === transcriptionId);
  }
}
