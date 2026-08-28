import { describe, expect, test, vi } from "vitest";
import { createSpacesClient, type SpacesFetcher } from "./spaces";

const space = { id: "space-1", memberId: "member-1", name: "Home", createdAt: "now" };

describe("Spaces client", () => {
  test("lists and creates nested Spaces", async () => {
    const fetcher = vi.fn<SpacesFetcher>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ spaces: [space] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ space: { ...space, id: "space-2", name: "Kitchen", parentId: "space-1" } }), { status: 201 }));
    const client = createSpacesClient("http://api.test", fetcher);
    expect(await client.list("member-1")).toEqual([space]);
    expect(await client.create("member-1", "Kitchen", "space-1")).toMatchObject({ parentId: "space-1" });
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ memberId: "member-1", name: "Kitchen", parentId: "space-1" }));
  });

  test("assigns and unassigns both item kinds", async () => {
    const fetcher = vi.fn<SpacesFetcher>().mockResolvedValue(new Response("{}", { status: 200 }));
    const client = createSpacesClient("http://api.test", fetcher);
    await client.assign("task-1", "task", "member-1", "space-1");
    await client.assign("note-1", "note", "member-1", null);
    expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["http://api.test/tasks/task-1/space", "PUT"],
      ["http://api.test/notes/note-1/space?memberId=member-1", "DELETE"],
    ]);
  });
});
