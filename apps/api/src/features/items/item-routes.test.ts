import { afterEach, describe, expect, test } from "vitest";

import { buildApi } from "../../http/build-api.js";
import { registerItemRoutes } from "./item-routes.js";
import { MemberItemsService } from "./items.js";

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
});
