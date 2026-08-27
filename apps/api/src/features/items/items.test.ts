import { describe, expect, test } from "vitest";

import { MemberItemsService, type ListRow } from "./items.js";

const base = (captureId: string, createdAt: string): ListRow => ({
  captureId, memberId: "member-1", createdAt, captureState: "stored",
  transcriptionStatus: "succeeded", transcriptionError: null,
  outcomeKind: null, outcomeId: null, title: null, dueAt: null, taskStatus: null, content: null, noteState: null, primarySpaceId: null,
});

describe("MemberItemsService", () => {
  test("returns mixed durable and processing entries with review links", () => {
    const rows: ListRow[] = [
      { ...base("capture-task", "2026-08-14T12:00:00.000Z"), outcomeKind: "task", outcomeId: "task-1", title: "Buy milk", taskStatus: "open", dueAt: null },
      { ...base("capture-note", "2026-08-14T11:00:00.000Z"), outcomeKind: "note", outcomeId: "note-1", content: "Garden", noteState: "needs_review" },
      { ...base("capture-failed", "2026-08-14T10:00:00.000Z"), transcriptionStatus: "failed", transcriptionError: "Whisper unavailable" },
    ];
    const service = new MemberItemsService({ list: () => rows });

    expect(service.list({ memberId: "member-1" })).toEqual({
      items: [
        expect.objectContaining({ kind: "task", id: "task-1", state: "open", detailUrl: "/captures/capture-task/review" }),
        expect.objectContaining({ kind: "note", id: "note-1", state: "needs_review" }),
        expect.objectContaining({ kind: "capture", captureId: "capture-failed", state: "failed" }),
      ],
      nextCursor: null,
    });
  });

  test("uses an opaque keyset cursor and keeps the extra row out of the page", () => {
    let receivedCursor: unknown;
    const rows = [base("capture-2", "2026-08-14T11:00:00.000Z"), base("capture-1", "2026-08-14T10:00:00.000Z")];
    const service = new MemberItemsService({ list: (_memberId, cursor, limit) => {
      receivedCursor = cursor;
      expect(limit).toBe(2);
      return rows;
    }});

    const page = service.list({ memberId: "member-1", limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    service.list({ memberId: "member-1", limit: 1, cursor: page.nextCursor! });
    expect(receivedCursor).toEqual({ memberId: "member-1", createdAt: "2026-08-14T11:00:00.000Z", captureId: "capture-2" });
  });

  test("rejects a cursor issued for another Member", () => {
    const service = new MemberItemsService({ list: () => [base("capture-1", "2026-08-14T10:00:00.000Z"), base("capture-2", "2026-08-14T09:00:00.000Z")] });
    const cursor = service.list({ memberId: "member-1", limit: 1 }).nextCursor;
    expect(() => service.list({ memberId: "member-2", cursor: cursor ?? "" })).toThrow("cursor belongs to another Member");
  });

  test("reflects processing state changes without changing item order", () => {
    let row = base("capture-1", "2026-08-14T10:00:00.000Z");
    const service = new MemberItemsService({ list: () => [row] });
    expect(service.list({ memberId: "member-1" }).items[0]).toMatchObject({ kind: "capture", state: "pending" });
    row = { ...row, outcomeKind: "note", outcomeId: "note-1", content: "Garden", noteState: "none" };
    expect(service.list({ memberId: "member-1" }).items[0]).toMatchObject({ kind: "note", id: "note-1", state: "none" });
  });
});
