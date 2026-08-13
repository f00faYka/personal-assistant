import { afterEach, describe, expect, test } from "vitest";

import { buildApi } from "./build-api.js";

describe("GET /health", () => {
  const applications: Array<ReturnType<typeof buildApi>> = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.close()));
  });

  test("reports that the local API is healthy", async () => {
    const application = buildApi({ logger: false });
    applications.push(application);

    const response = await application.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
