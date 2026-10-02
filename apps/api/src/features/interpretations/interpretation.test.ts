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
      expectedDueAt: "2026-08-23T15:00:00.000Z",
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

  test("matches a normalized weekday name from the model to the spoken Russian weekday", () => {
    const transcriptionText = "напомни в понедельник позвонить Анне";
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Позвонить Анне", schedule: { date: "понедельник" } }, undefined, "transcription-russian-weekday-normalized"),
      transcriptionText,
      capturedAt: "2026-08-23T12:00:00.000Z",
      timeZone: "Europe/Warsaw",
    });

    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", dueAt: "2026-08-23T22:00:00.000Z" },
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
    ["Remind me today at 11 to call the office.", { date: "today", hour: 11 }, "2026-08-23T21:00:00.000Z"],
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

  test("accepts dot-separated minutes and chooses the upcoming PM occurrence for an ambiguous past time today", () => {
    const transcriptionText = "напомни забрать детей в 4.30 сегодня";
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Забрать детей", schedule: { date: "сегодня", hour: 4, minute: 30 } }, undefined, transcriptionText),
      transcriptionText,
      capturedAt: "2026-10-02T10:18:00.000Z",
      timeZone: "Europe/Warsaw",
    });

    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", title: "Забрать детей", dueAt: "2026-10-02T14:30:00.000Z" },
    });
  });

  test("preserves an explicit morning period for a past clock time today", () => {
    const transcriptionText = "напомни сегодня в 4.30 утра забрать детей";
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Забрать детей", schedule: { date: "сегодня", hour: 4, minute: 30, dayPart: "morning" } }, undefined, transcriptionText),
      transcriptionText,
      capturedAt: "2026-10-02T10:18:00.000Z",
      timeZone: "Europe/Warsaw",
    });

    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", dueAt: "2026-10-02T02:30:00.000Z" },
    });
  });

  test("accepts a redundant 24-hour PM value from the model", () => {
    const transcriptionText = "напомни сегодня в 11 вечера поцеловать жену";
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "поцеловать жену", schedule: { date: "today", hour: 23, period: "pm" } }, undefined, transcriptionText),
      transcriptionText,
      capturedAt: "2026-10-02T16:52:40.013Z",
      timeZone: "Europe/Warsaw",
    });

    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", title: "поцеловать жену", dueAt: "2026-10-02T21:00:00.000Z" },
    });
  });

  test("keeps the UTC instant correct across a DST transition in another device timezone", () => {
    const transcriptionText = "Remind me today at 9 AM to call the office.";
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Call the office", schedule: { date: "today", hour: 9, period: "am" } }, undefined, "dst-transition"),
      transcriptionText,
      capturedAt: "2026-03-08T06:30:00.000Z",
      timeZone: "America/New_York",
    });

    expect(interpretation).toMatchObject({ action: { kind: "create_task", dueAt: "2026-03-08T13:00:00.000Z" } });
  });

  test.each([
    ["one", "2026-08-23T11:00:00.000Z"],
    ["two", "2026-08-23T12:00:00.000Z"],
    ["three", "2026-08-23T13:00:00.000Z"],
    ["four", "2026-08-23T14:00:00.000Z"],
    ["five", "2026-08-23T15:00:00.000Z"],
    ["six", "2026-08-23T16:00:00.000Z"],
    ["seven", "2026-08-23T17:00:00.000Z"],
    ["eight", "2026-08-23T18:00:00.000Z"],
    ["nine", "2026-08-23T19:00:00.000Z"],
    ["ten", "2026-08-23T20:00:00.000Z"],
    ["eleven", "2026-08-23T21:00:00.000Z"],
    ["twelve", "2026-08-23T10:00:00.000Z"],
    ["один", "2026-08-23T11:00:00.000Z"],
    ["два", "2026-08-23T12:00:00.000Z"],
    ["три", "2026-08-23T13:00:00.000Z"],
    ["четыре", "2026-08-23T14:00:00.000Z"],
    ["пять", "2026-08-23T15:00:00.000Z"],
    ["шесть", "2026-08-23T16:00:00.000Z"],
    ["семь", "2026-08-23T17:00:00.000Z"],
    ["восемь", "2026-08-23T18:00:00.000Z"],
    ["девять", "2026-08-23T19:00:00.000Z"],
    ["десять", "2026-08-23T20:00:00.000Z"],
    ["одиннадцать", "2026-08-23T21:00:00.000Z"],
    ["двенадцать", "2026-08-23T10:00:00.000Z"],
  ] as const)("resolves spoken clock number $0", (spokenHour, expectedDueAt) => {
    const isRussian = /[а-я]/i.test(spokenHour);
    const numericHour = (isRussian
      ? ["один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять", "десять", "одиннадцать", "двенадцать"]
      : ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"]
    ).indexOf(spokenHour) + 1;
    const transcriptionText = isRussian
      ? `напомни сегодня в ${spokenHour} позвонить в офис`
      : `Remind me today at ${spokenHour} to call the office.`;
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Call the office", schedule: { date: isRussian ? "сегодня" : "today", hour: numericHour } }, undefined, transcriptionText),
      transcriptionText,
      timeZone: "Europe/Warsaw",
    });

    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", dueAt: expectedDueAt },
    });
  });

  test.each([
    ["thirteen", 13], ["fourteen", 14], ["fifteen", 15], ["sixteen", 16], ["seventeen", 17],
    ["eighteen", 18], ["nineteen", 19], ["twenty", 20], ["twenty one", 21], ["twenty two", 22], ["twenty three", 23],
    ["тринадцать", 13], ["четырнадцать", 14], ["пятнадцать", 15], ["шестнадцать", 16], ["семнадцать", 17],
    ["восемнадцать", 18], ["девятнадцать", 19], ["двадцать", 20], ["двадцать один", 21], ["двадцать два", 22], ["двадцать три", 23],
  ] as const)("resolves spoken 24-hour clock hour $0", (spokenHour, numericHour) => {
    const isRussian = /[а-я]/i.test(spokenHour);
    const transcriptionText = isRussian
      ? `напомни сегодня в ${spokenHour} позвонить в офис`
      : `Remind me today at ${spokenHour} to call the office.`;
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Call the office", schedule: { date: isRussian ? "сегодня" : "today", hour: numericHour } }, undefined, transcriptionText),
      transcriptionText,
      timeZone: "Europe/Warsaw",
    });

    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", dueAt: new Date(Date.UTC(2026, 7, 23, numericHour) - 2 * 60 * 60 * 1000).toISOString() },
    });
  });

  test.each([
    ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9],
    ["ten", 10], ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15], ["sixteen", 16], ["seventeen", 17],
    ["eighteen", 18], ["nineteen", 19], ["twenty", 20], ["twenty one", 21], ["twenty two", 22], ["twenty three", 23], ["twenty four", 24],
    ["twenty five", 25], ["twenty six", 26], ["twenty seven", 27], ["twenty eight", 28], ["twenty nine", 29], ["thirty", 30],
    ["thirty one", 31], ["thirty two", 32], ["thirty three", 33], ["thirty four", 34], ["thirty five", 35], ["thirty six", 36],
    ["thirty seven", 37], ["thirty eight", 38], ["thirty nine", 39], ["forty", 40], ["forty one", 41], ["forty two", 42],
    ["forty three", 43], ["forty four", 44], ["forty five", 45], ["forty six", 46], ["forty seven", 47], ["forty eight", 48],
    ["forty nine", 49], ["fifty", 50], ["fifty one", 51], ["fifty two", 52], ["fifty three", 53], ["fifty four", 54],
    ["fifty five", 55], ["fifty six", 56], ["fifty seven", 57], ["fifty eight", 58], ["fifty nine", 59],
    ["ноль", 0], ["один", 1], ["два", 2], ["три", 3], ["четыре", 4], ["пять", 5], ["шесть", 6], ["семь", 7], ["восемь", 8], ["девять", 9],
    ["десять", 10], ["одиннадцать", 11], ["двенадцать", 12], ["тринадцать", 13], ["четырнадцать", 14], ["пятнадцать", 15], ["шестнадцать", 16], ["семнадцать", 17],
    ["восемнадцать", 18], ["девятнадцать", 19], ["двадцать", 20], ["двадцать один", 21], ["двадцать два", 22], ["двадцать три", 23], ["двадцать четыре", 24],
    ["двадцать пять", 25], ["двадцать шесть", 26], ["двадцать семь", 27], ["двадцать восемь", 28], ["двадцать девять", 29], ["тридцать", 30],
    ["тридцать один", 31], ["тридцать два", 32], ["тридцать три", 33], ["тридцать четыре", 34], ["тридцать пять", 35], ["тридцать шесть", 36],
    ["тридцать семь", 37], ["тридцать восемь", 38], ["тридцать девять", 39], ["сорок", 40], ["сорок один", 41], ["сорок два", 42],
    ["сорок три", 43], ["сорок четыре", 44], ["сорок пять", 45], ["сорок шесть", 46], ["сорок семь", 47], ["сорок восемь", 48],
    ["сорок девять", 49], ["пятьдесят", 50], ["пятьдесят один", 51], ["пятьдесят два", 52], ["пятьдесят три", 53], ["пятьдесят четыре", 54],
    ["пятьдесят пять", 55], ["пятьдесят шесть", 56], ["пятьдесят семь", 57], ["пятьдесят восемь", 58], ["пятьдесят девять", 59],
  ] as const)("resolves every spoken minute $0", (spokenMinute, numericMinute) => {
    const isRussian = /[а-я]/i.test(spokenMinute);
    const transcriptionText = isRussian
      ? `напомни сегодня в двадцать три ${spokenMinute} позвонить в офис`
      : `Remind me today at twenty three ${spokenMinute} to call the office.`;
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Call the office", schedule: { date: isRussian ? "сегодня" : "today", hour: 23, minute: numericMinute } }, undefined, transcriptionText),
      transcriptionText,
      timeZone: "Europe/Warsaw",
    });

    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", dueAt: new Date(Date.UTC(2026, 7, 23, 23, numericMinute) - 2 * 60 * 60 * 1000).toISOString() },
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

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Call Anna" }, undefined, "transcription-after-tomorrow"),
      transcriptionText: "remind me to call Anna после завтра",
    })).toMatchObject({ action: { dueAt: "2026-08-25T00:00:00.000Z" } });

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Call Anna" }, undefined, "transcription-before-yesterday"),
      transcriptionText: "напомни поза вчера позвонить Анне",
    })).toMatchObject({ action: { dueAt: "2026-08-21T00:00:00.000Z" } });

    expect(service.evaluate({
      ...input({ action: "create_task", title: "Call Anna" }, undefined, "transcription-yesterday"),
      transcriptionText: "remind me to call Anna yesterday",
    })).toMatchObject({ action: { dueAt: "2026-08-22T00:00:00.000Z" } });
  });

  test.each([
    ["в понедельник", "2026-08-23T22:00:00.000Z"],
    ["во вторник", "2026-08-24T22:00:00.000Z"],
    ["в среду", "2026-08-25T22:00:00.000Z"],
    ["в четверг", "2026-08-26T22:00:00.000Z"],
    ["в пятницу", "2026-08-27T22:00:00.000Z"],
    ["в субботу", "2026-08-28T22:00:00.000Z"],
    ["в воскресенье", "2026-08-29T22:00:00.000Z"],
  ] as const)("resolves Russian weekday $0 to the next occurrence", (spokenDate, expectedDueAt) => {
    const transcriptionText = `напомни ${spokenDate} позвонить Анне`;
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Позвонить Анне", schedule: { date: spokenDate } }, undefined, transcriptionText),
      transcriptionText,
      capturedAt: "2026-08-23T12:00:00.000Z",
      timeZone: "Europe/Warsaw",
    });

    expect(interpretation).toMatchObject({
      classification: "clear_supported",
      action: { kind: "create_task", dueAt: expectedDueAt },
    });
  });

  test("removes scheduling phrases when the provider includes them in the title", () => {
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Add a task to buy milk tomorrow at 5 PM" }),
      transcriptionText: "add task buy milk tomorrow at 5 PM",
    });

    expect(interpretation.action).toMatchObject({ title: "buy milk" });
  });

  test("removes word-number scheduling phrases when the provider includes them in the title", () => {
    const interpretation = new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Add a task to call the office tomorrow at five" }),
      transcriptionText: "add task call the office tomorrow at five",
    });

    expect(interpretation.action).toMatchObject({ title: "call the office" });
  });

  test("removes compound spoken time and Russian weekday scheduling phrases from the title", () => {
    expect(new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "Add a task to call the office tomorrow at twenty three thirty" }),
      transcriptionText: "add task call the office tomorrow at twenty three thirty",
    }).action).toMatchObject({ title: "call the office" });

    expect(new InterpretationService(new MemoryRepository()).evaluate({
      ...input({ action: "create_task", title: "позвонить Анне в понедельник" }),
      transcriptionText: "добавить задачу позвонить Анне в понедельник",
    }).action).toMatchObject({ title: "позвонить Анне" });
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
