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
      transcriptionText: "buy milk tomorrow",
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
