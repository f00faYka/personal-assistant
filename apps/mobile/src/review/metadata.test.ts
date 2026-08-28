import { describe, expect, test, vi } from "vitest";

import { createMetadataClient } from "./metadata";

describe("metadata client", () => {
  test("uses the #120 list, link, and unlink contracts", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ tags: [] }))
      .mockResolvedValueOnce(json({ entities: [] }))
      .mockResolvedValueOnce(json({ tags: [], entities: [] }))
      .mockResolvedValueOnce(json({ tags: [], entities: [] }))
      .mockResolvedValueOnce(json({ tags: [], entities: [] }));
    vi.stubGlobal("fetch", fetcher);
    const client = createMetadataClient("http://api.test/");

    await client.listTags("member 1");
    await client.listEntities("member-1");
    await client.listLinks("task-1", "task", "member-1");
    await client.linkTag("task-1", "task", "tag-1", "member-1");
    await client.unlinkTag("task-1", "task", "tag-1", "member-1");

    expect(fetcher).toHaveBeenNthCalledWith(1, "http://api.test/tags?memberId=member%201", expect.anything());
    expect(fetcher).toHaveBeenNthCalledWith(3, "http://api.test/tasks/task-1/metadata?memberId=member-1", expect.anything());
    expect(fetcher).toHaveBeenNthCalledWith(4, "http://api.test/tasks/task-1/tags/tag-1", expect.objectContaining({ method: "PUT" }));
    expect(fetcher).toHaveBeenNthCalledWith(5, "http://api.test/tasks/task-1/tags/tag-1?memberId=member-1", expect.objectContaining({ method: "DELETE" }));
  });

  test("uses the #120 update contracts for Tags and Entities", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ tag: { id: "tag-1" } })).mockResolvedValueOnce(json({ entity: { id: "entity-1" } }));
    vi.stubGlobal("fetch", fetcher);
    const client = createMetadataClient("http://api.test");
    await client.updateTag("tag-1", "member-1", "urgent");
    await client.updateEntity("entity-1", "member-1", "Office", "Place");
    expect(fetcher).toHaveBeenNthCalledWith(1, "http://api.test/tags/tag-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ memberId: "member-1", name: "urgent" }) }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "http://api.test/entities/entity-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ memberId: "member-1", name: "Office", type: "Place" }) }));
  });
});

function json(body: unknown): Response { return new Response(JSON.stringify(body), { status: 200 }); }
