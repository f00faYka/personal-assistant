import { describe, expect, test } from "vitest";

import { localDateKey, tasksForLocalDate } from "./selected-day";

const task = (dueAt?: string) => ({ kind: "task" as const, id: dueAt ?? "undated", captureId: "capture", title: "Task", state: "open" as const, createdAt: "2026-09-15T00:00:00Z", detailUrl: "/review", ...(dueAt ? { dueAt } : {}) });

describe("selected-day date boundary", () => {
  test("interprets due timestamps in the selected local timezone", () => {
    expect(localDateKey("2026-09-15T23:30:00.000Z", "Europe/Warsaw")).toBe("2026-09-16");
    expect(localDateKey("2026-09-15T23:30:00.000Z", "America/Los_Angeles")).toBe("2026-09-15");
  });

  test("keeps undated and other-day Tasks out of the selected day", () => {
    expect(tasksForLocalDate([task("2026-09-15T23:00:00.000Z"), task("2026-09-15T00:00:00.000Z"), task()], "2026-09-16", "Europe/Warsaw").map((item) => item.id)).toEqual(["2026-09-15T23:00:00.000Z"]);
  });
});
