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
      ...input({ action: "create_task", title: "Cancel subscription", schedule: { date: "2026-09-02" } }),
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

  test("combines relative dates with explicit English and Russian times", () => {
    const service = new InterpretationService(new MemoryRepository());

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Buy milk" }, undefined, "transcription-noon"),
      transcriptionText: "add task buy milk tomorrow at noon",
    })).toMatchObject({ action: { dueAt: "2026-08-24T12:00:00.000Z" } });

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Call Anna" }, undefined, "transcription-minutes"),
      transcriptionText: "remind me to call Anna tomorrow at 17:30",
    })).toMatchObject({ action: { dueAt: "2026-08-24T17:30:00.000Z" } });

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Позвонить Анне" }, undefined, "transcription-russian"),
      transcriptionText: "завтра в 5 вечера позвонить Анне",
    })).toMatchObject({ action: { dueAt: "2026-08-24T17:00:00.000Z" } });
  });

  test.each([
    {
      transcriptionText: "Remind me today at 5 o'clock to call the office.",
      rawOutput: { action: "create_task", title: "Call the office", schedule: { date: "today", hour: 5 } },
      expectedDueAt: "2026-08-23T03:00:00.000Z",
    },
    {
      transcriptionText: "напомни сегодня в 12 позвонить на тариус",
      rawOutput: { action: "create_task", title: "Позвонить на тариус", schedule: { date: "сегодня", hour: 12 } },
      expectedDueAt: "2026-08-23T10:00:00.000Z",
    },
  ])("resolves explicit spoken schedules in the supplied IANA timezone: $transcriptionText", ({ transcriptionText, rawOutput, expectedDueAt }) => {
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input(rawOutput, undefined, transcriptionText),
      transcriptionText,
      capturedAt: "2026-08-23T12:00:00.000Z",
      timeZone: "Europe/Warsaw",
    });

    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", dueAt: expectedDueAt },
    });
  });

  test("does not invent an exact time for a day part without an explicit hour", () => {
    expect(new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Call the office", schedule: { date: "today", dayPart: "morning" } }, undefined, "morning-only"),
      transcriptionText: "Remind me today morning to call the office.",
      timeZone: "Europe/Warsaw",
    })).toMatchObject({ classification: "unsupported", rejectionReason: "malformed_model_output" });
  });

  test.each([
    ["Remind me today at 11 to call the office.", { date: "today", hour: 11 }, "2026-08-23T09:00:00.000Z"],
    ["Remind me today at 5 PM to call the office.", { date: "today", hour: 5, period: "pm" }, "2026-08-23T15:00:00.000Z"],
    ["Remind me today at 5 in the evening to call the office.", { date: "today", hour: 5, dayPart: "evening" }, "2026-08-23T15:00:00.000Z"],
    ["Remind me today at noon to call the office.", { date: "today", special: "noon" }, "2026-08-23T10:00:00.000Z"],
    ["Remind me today at midnight to call the office.", { date: "today", special: "midnight" }, "2026-08-22T22:00:00.000Z"],
    ["напомни сегодня в 7 утра позвонить в офис", { date: "сегодня", hour: 7, dayPart: "morning" }, "2026-08-23T05:00:00.000Z"],
    ["напомни сегодня в 8 вечера позвонить в офис", { date: "сегодня", hour: 8, dayPart: "evening" }, "2026-08-23T18:00:00.000Z"],
  ] as const)("resolves supported clock and day-part form: $0", (transcriptionText, schedule, expectedDueAt) => {
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Call the office", schedule }, undefined, transcriptionText),
      transcriptionText,
      timeZone: "Europe/Warsaw",
    });

    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", dueAt: expectedDueAt },
    });
  });

  test("rejects an explicit but ambiguous spoken time and a contradictory model time", () => {
    const service = new InterpretationService(new MemoryRepository());

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Go running", schedule: { date: "tomorrow", dayPart: "morning" } }, undefined, "transcription-ambiguous-time"),
      transcriptionText: "add task go running tomorrow morning",
    })).toMatchObject({ classification: "unsupported", rejectionReason: "malformed_model_output" });

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Call Anna", schedule: { date: "tomorrow", hour: 4, period: "pm" } }, undefined, "transcription-wrong-time"),
      transcriptionText: "remind me to call Anna tomorrow at 5 PM",
    })).toMatchObject({ classification: "unsupported", rejectionReason: "malformed_model_output" });

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Buy milk", schedule: { date: "tomorrow", dayPart: "morning" } }, undefined, "transcription-invalid-time"),
      transcriptionText: "add task buy milk tomorrow morning",
    })).toMatchObject({ classification: "unsupported", rejectionReason: "malformed_model_output" });
  });

  test("supports day-after-tomorrow and this-week weekday dates", () => {
    const service = new InterpretationService(new MemoryRepository());

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Buy milk" }, undefined, "transcription-day-after"),
      transcriptionText: "add task buy milk the day after tomorrow",
    })).toMatchObject({ action: { dueAt: "2026-08-25T00:00:00.000Z" } });

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Call Anna" }, undefined, "transcription-this-week"),
      transcriptionText: "remind me to call Anna this week Saturday",
    })).toMatchObject({ action: { dueAt: "2026-08-29T00:00:00.000Z" } });
  });

  test("removes scheduling phrases when the provider includes them in the title", () => {
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Add a task to buy milk tomorrow at 5 PM" }),
      transcriptionText: "add task buy milk tomorrow at 5 PM",
    });

    expect(interpretation.action).toMatchObject({ title: "buy milk" });
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

  test("rejects absolute UTC and timezone fields from model output", () => {
    const service = new InterpretationService(new MemoryRepository());

    expect(service.evaluate(input({
      action: "create_task",
      title: "Call the office",
      dueAt: "2026-08-23T03:00:00.000Z",
    }, undefined, "absolute-due-at"))).toMatchObject({
      classification: "unsupported",
      rejectionReason: "malformed_model_output",
    });

    expect(service.evaluate({
      ...input({
        action: "create_task",
        title: "Call the office",
        schedule: { date: "today", hour: 5, timezone: "Europe/Warsaw" },
      }, undefined, "timezone-field"),
      transcriptionText: "Remind me today at 5 to call the office.",
    })).toMatchObject({
      classification: "unsupported",
      rejectionReason: "malformed_model_output",
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
