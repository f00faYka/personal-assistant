import { afterEach, describe, expect, test } from "vitest";

import { buildApi } from "../../http/build-api.js";
import { registerItemRoutes } from "./item-routes.js";
import { ItemSearchService, MemberItemsService, type SearchRow } from "./items.js";

describe("item routes", () => {
  const applications: Array<ReturnType<typeof buildApi>> = [];
  afterEach(async () => Promise.all(applications.splice(0).map((application) => application.close())));

  test("returns a paginated Member list", async () => {
    const service = new MemberItemsService({ list: () => [] });
    const application = buildApi({ logger: false, memberItemsService: service });
    applications.push(application);

    const response = await application.inject({ method: "GET", url: "/items?memberId=member-1&limit=2" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
  });

  test("rejects invalid pagination", async () => {
    const application = buildApi({ logger: false });
    registerItemRoutes(application, new MemberItemsService({ list: () => [] }));
    applications.push(application);

    const response = await application.inject({ method: "GET", url: "/items?memberId=member-1&limit=0" });

    expect(response.statusCode).toBe(400);
  });

  test("exposes combined search filters", async () => {
    const row: SearchRow = { itemId: "task-1", itemKind: "task", captureId: "capture-1", createdAt: "2026-08-14T10:00:00.000Z", title: "Buy milk", content: null, dueAt: null, taskStatus: "open", noteState: null, primarySpaceId: "space-1" };
    let received: unknown;
    const search = new ItemSearchService({ search: (_memberId, filters) => { received = filters; return [row]; } });
    const application = buildApi({ logger: false, memberItemsService: new MemberItemsService({ list: () => [] }), itemSearchService: search });
    applications.push(application);
    const response = await application.inject({ method: "GET", url: "/items/search?memberId=member-1&q=milk&spaceId=space-1&tagId=tag-1&entityId=entity-1&limit=5" });
    expect(response.statusCode).toBe(200);
    expect(received).toEqual({ text: "milk", spaceId: "space-1", unassigned: false, tagId: "tag-1", entityId: "entity-1" });
    expect(response.json().items[0]).toMatchObject({ kind: "task", id: "task-1" });
  });
});
