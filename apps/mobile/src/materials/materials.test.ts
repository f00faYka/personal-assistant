import { describe, expect, test, vi } from "vitest";

import type { MemberItemsClient } from "../list/member-items";
import { childSpaces, directItems, loadAllMaterials, spacePath } from "./materials";

const task = (id: string, spaceId?: string) => ({ kind: "task" as const, id, captureId: `capture-${id}`, title: id, state: "open" as const, createdAt: "now", detailUrl: `/captures/${id}/review`, ...(spaceId ? { spaceId } : {}) });

describe("Materials browsing model", () => {
  test("loads every list page and excludes pending Captures from the Task/Note collection", async () => {
    const client: MemberItemsClient = {
      list: vi.fn()
        .mockResolvedValueOnce({ items: [task("first"), { kind: "capture", id: "capture-1", captureId: "capture-1", state: "pending", createdAt: "now", detailUrl: "review" }], nextCursor: "next" })
        .mockResolvedValueOnce({ items: [task("second")], nextCursor: null }),
      search: vi.fn(),
    };

    await expect(loadAllMaterials(client, "member-1")).resolves.toEqual([task("first"), task("second")]);
    expect(client.list).toHaveBeenNthCalledWith(2, "member-1", "next");
  });

  test("uses the search seam for a complete filtered collection", async () => {
    const client: MemberItemsClient = {
      list: vi.fn(),
      search: vi.fn()
        .mockResolvedValueOnce({ items: [task("first", "space-1")], nextCursor: "next" })
        .mockResolvedValueOnce({ items: [task("second", "space-1")], nextCursor: null }),
    };

    await expect(loadAllMaterials(client, "member-1", { text: "first", spaceId: "space-1" })).resolves.toHaveLength(2);
    expect(client.search).toHaveBeenNthCalledWith(1, "member-1", { text: "first", spaceId: "space-1" }, undefined);
    expect(client.search).toHaveBeenNthCalledWith(2, "member-1", { text: "first", spaceId: "space-1" }, "next");
  });

  test("builds full paths and direct child/item views without inventing an Unassigned Space", () => {
    const spaces = [
      { id: "home", memberId: "member-1", name: "Home", createdAt: "now" },
      { id: "health", memberId: "member-1", name: "Health", parentId: "home", createdAt: "now" },
      { id: "archived", memberId: "member-1", name: "Old", createdAt: "now", archivedAt: "later" },
    ];
    const items = [task("unassigned"), task("health-item", "health")];

    expect(childSpaces(spaces, null).map((space) => space.id)).toEqual(["home"]);
    expect(childSpaces(spaces, "home").map((space) => space.id)).toEqual(["health"]);
    expect(spacePath(spaces, "health")).toBe("Home / Health");
    expect(directItems(items, null).map((item) => item.id)).toEqual(["unassigned"]);
    expect(directItems(items, "health").map((item) => item.id)).toEqual(["health-item"]);
  });
});
