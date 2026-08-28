import { describe, expect, test, vi } from "vitest";

import { createMemberItemsClient, listItemLabel, listStateFromError, listStateFromPage, parseMemberItemsPage, type ItemsFetcher, type MemberListItem } from "./member-items";

describe("Member items client", () => {
  test("requests the Member list and preserves stable item identities", async () => {
    const fetcher = vi.fn<ItemsFetcher>().mockResolvedValue(new Response(JSON.stringify({
      items: [{ kind: "task", id: "task-1", captureId: "capture-1", title: "Buy milk", state: "open", createdAt: "2026-08-14T08:00:00Z", detailUrl: "/captures/capture-1/review" }],
      nextCursor: "next-1",
    }), { status: 200 }));
    const client = createMemberItemsClient("http://api.test", fetcher);

    const page = await client.list("member-1");

    expect(fetcher).toHaveBeenCalledWith("http://api.test/items?memberId=member-1");
    expect(page.items[0]?.id).toBe("task-1");
    expect(listStateFromPage(page)).toEqual({ status: "ready", items: page.items, nextCursor: "next-1" });
  });

  test("reports request failures without inventing a result", async () => {
    const client = createMemberItemsClient("http://api.test", vi.fn<ItemsFetcher>().mockResolvedValue(new Response("", { status: 503 })));

    await expect(client.list("member-1")).rejects.toThrow("Unable to load items (503)");
  });

  test("includes the opaque cursor when loading the next page", async () => {
    const fetcher = vi.fn<ItemsFetcher>().mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));
    await createMemberItemsClient("http://api.test", fetcher).list("member-1", "cursor/1");

    expect(fetcher).toHaveBeenCalledWith("http://api.test/items?memberId=member-1&cursor=cursor%2F1");
  });

  test("searches with combined content and organization filters", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));

    await createMemberItemsClient("http://api.test", fetcher).search("member-1", {
      text: "milk",
      spaceId: "space-1",
      tagId: "tag-1",
      entityId: "entity-1",
    }, "cursor/2");

    expect(fetcher).toHaveBeenCalledWith("http://api.test/items/search?memberId=member-1&q=milk&spaceId=space-1&tagId=tag-1&entityId=entity-1&cursor=cursor%2F2");
  });

  test("searches the discoverable unassigned root", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));

    await createMemberItemsClient("http://api.test", fetcher).search("member-1", { unassigned: true });

    expect(fetcher).toHaveBeenCalledWith("http://api.test/items/search?memberId=member-1&unassigned=true");
  });

  test("represents an empty server response as an empty ready state", () => {
    expect(listStateFromPage({ items: [], nextCursor: null })).toEqual({ status: "ready", items: [], nextCursor: null });
  });

  test("keeps existing items visible in an explicit error state", () => {
    const items: MemberListItem[] = [{ kind: "capture", id: "capture-1", captureId: "capture-1", state: "pending", createdAt: "now", detailUrl: "review" }];
    expect(listStateFromError(items, new Error("offline"))).toEqual({ status: "error", items, message: "offline" });
  });

  test("labels every backend list discriminator for the UI", () => {
    const items: MemberListItem[] = [
      { kind: "task", id: "task-1", captureId: "capture-1", title: "Task", state: "open", createdAt: "now", detailUrl: "review" },
      { kind: "task", id: "task-2", captureId: "capture-2", title: "Done", state: "completed", createdAt: "now", detailUrl: "review" },
      { kind: "note", id: "note-1", captureId: "capture-3", content: "Note", state: "none", createdAt: "now", detailUrl: "review" },
      { kind: "note", id: "note-2", captureId: "capture-4", content: "Review", state: "needs_review", createdAt: "now", detailUrl: "review" },
      { kind: "capture", id: "capture-5", captureId: "capture-5", state: "pending", createdAt: "now", detailUrl: "review" },
      { kind: "capture", id: "capture-6", captureId: "capture-6", state: "failed", createdAt: "now", detailUrl: "review" },
    ];

    expect(items.map(listItemLabel)).toEqual(["Task", "Completed task", "Note", "Needs review", "Processing", "Capture failed"]);
  });

  test("rejects malformed server responses before they reach the list", () => {
    expect(() => parseMemberItemsPage({ items: [{ kind: "task", id: "missing-fields" }], nextCursor: null })).toThrow("Invalid Member items response");
  });
});
