import { describe, expect, test } from "vitest";

import { ItemSearchService, MemberItemsService, type ListRow, type SearchRow } from "./items.js";

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

describe("ItemSearchService", () => {
  const row = (itemId: string, itemKind: "task" | "note", createdAt: string): SearchRow => ({
    itemId, itemKind, captureId: `capture-${itemId}`, createdAt, title: itemKind === "task" ? "Buy milk" : null,
    content: itemKind === "note" ? "Garden plans" : null, dueAt: null,
    taskStatus: itemKind === "task" ? "open" : null, noteState: itemKind === "note" ? "none" : null, primarySpaceId: null,
  });

  test("passes all filters together and returns stable typed items", () => {
    let received: unknown;
    const service = new ItemSearchService({
      search: (_memberId, filters, _cursor, _limit) => { received = filters; return [row("task-1", "task", "2026-08-14T12:00:00.000Z")]; },
    });
    const result = service.search({ memberId: "member-1", text: " milk ", spaceId: "space-1", tagId: "tag-1", entityId: "entity-1" });
    expect(received).toEqual({ text: "milk", spaceId: "space-1", unassigned: false, tagId: "tag-1", entityId: "entity-1" });
    expect(result.items).toEqual([expect.objectContaining({ kind: "task", id: "task-1" })]);
  });

  test("supports unassigned filtering and rejects conflicting space state", () => {
    const service = new ItemSearchService({ search: (_memberId, filters) => {
      expect(filters.unassigned).toBe(true); return [row("note-1", "note", "2026-08-14T11:00:00.000Z")];
    }});
    expect(service.search({ memberId: "member-1", unassigned: true }).items[0]).toMatchObject({ kind: "note", id: "note-1" });
    expect(() => service.search({ memberId: "member-1", spaceId: "space-1", unassigned: true })).toThrow("cannot be combined");
  });

  test("returns an explicit empty page when no item matches", () => {
    const service = new ItemSearchService({ search: () => [] });

    expect(service.search({ memberId: "member-1", text: "missing" })).toEqual({ items: [], nextCursor: null });
  });

  test("uses a member-bound keyset cursor", () => {
    let cursor: unknown;
    const service = new ItemSearchService({ search: (_memberId, _filters, receivedCursor) => { cursor = receivedCursor; return [row("task-2", "task", "2026-08-14T10:00:00.000Z")]; } });
    const first = new ItemSearchService({ search: () => [row("task-1", "task", "2026-08-14T12:00:00.000Z"), row("task-2", "task", "2026-08-14T11:00:00.000Z")] }).search({ memberId: "member-1", limit: 1 });
    service.search({ memberId: "member-1", cursor: first.nextCursor! });
    expect(cursor).toEqual({ memberId: "member-1", createdAt: "2026-08-14T12:00:00.000Z", itemId: "task-1" });
  });
});
