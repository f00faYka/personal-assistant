import { describe, expect, test } from "vitest";

import { beginPreview, expirePreview, openPreviewReview, resolvePreview, savePreview, timeOutPreview } from "./result-preview";

const task = { kind: "task" as const, id: "task-1", captureId: "capture-1", title: "Buy milk", state: "open" as const, createdAt: "2026-08-15T10:00:00Z", detailUrl: "/captures/capture-1/review" };
const note = { kind: "note" as const, id: "note-1", captureId: "capture-1", content: "Call the dentist", state: "none" as const, createdAt: task.createdAt, detailUrl: task.detailUrl };

describe("result preview state", () => {
  test("starts in processing without starting the preview timer", () => {
    expect(beginPreview("capture-1", 1000)).toEqual({ status: "processing", captureId: "capture-1", startedAt: 1000 });
  });

  test("keeps processing until the server returns a result", () => {
    const state = beginPreview("capture-1", 1000);

    expect(resolvePreview(state, [{ kind: "capture", id: "capture-1", captureId: "capture-1", state: "pending", createdAt: task.createdAt, detailUrl: task.detailUrl }], 1000)).toEqual(state);
  });

  test("starts the 15-second timer when a Task result arrives", () => {
    const state = resolvePreview(beginPreview("capture-1", 1000), [task], 1000);

    expect(state).toEqual({ status: "preview", item: task, expiresAt: 16000 });
  });

  test("previews an ordinary Note without adding another confirmation gate", () => {
    expect(resolvePreview(beginPreview("capture-1", 1000), [note], 1000)).toEqual({ status: "preview", item: note, expiresAt: 16000 });
  });

  test("surfaces a failed processing result without starting the timer", () => {
    const failed = { kind: "capture" as const, id: "capture-1", captureId: "capture-1", state: "failed" as const, createdAt: task.createdAt, detailUrl: task.detailUrl };

    expect(resolvePreview(beginPreview("capture-1", 1000), [failed], 1000)).toEqual({ status: "failed", captureId: "capture-1" });
  });

  test("expires exactly once and manual save is idempotent", () => {
    const preview = resolvePreview(beginPreview("capture-1"), [task], 1000);
    expect(expirePreview(preview, 15999)).toBe(preview);
    const saved = expirePreview(preview, 16000);
    expect(saved).toEqual({ status: "saved", item: task });
    expect(expirePreview(saved, 20000)).toBe(saved);
    expect(savePreview(saved)).toBe(saved);
  });

  test("opening details freezes the unattended timer and keeps the same result on return", () => {
    const preview = resolvePreview(beginPreview("capture-1"), [task], 1000);
    const reviewing = openPreviewReview(preview);
    expect(reviewing).toEqual({ status: "reviewing", item: task });
    expect(expirePreview(reviewing, 60_000)).toBe(reviewing);
    expect(savePreview(reviewing)).toEqual({ status: "saved", item: task });
  });

  test("ignores stale results for another Capture", () => {
    const state = beginPreview("capture-1", 1000);
    const other = { ...task, captureId: "capture-2", id: "task-2" };

    expect(resolvePreview(state, [other], 1000)).toBe(state);
  });

  test("stops polling after the bounded processing window", () => {
    const state = beginPreview("capture-1", 1000);

    expect(timeOutPreview(state, 30_999)).toBe(state);
    expect(timeOutPreview(state, 31_000)).toEqual({ status: "timed_out", captureId: "capture-1" });
  });
});
