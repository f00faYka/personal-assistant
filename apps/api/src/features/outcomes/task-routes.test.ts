import { afterEach, describe, expect, test } from "vitest";

import { buildApi } from "../../http/build-api.js";
import { TaskService, type TaskOutcome } from "./outcome.js";
import { registerTaskRoutes } from "./task-routes.js";

describe("Task routes", () => {
  const applications: Array<ReturnType<typeof buildApi>> = [];
  afterEach(async () => Promise.all(applications.splice(0).map((application) => application.close())));

  test("edits a Task through the reviewed optimistic-concurrency contract", async () => {
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "open", version: 0, createdAt: "2026-08-15T10:00:00.000Z" };
    const application = buildApi({ logger: false });
    registerTaskRoutes(application, new TaskService({ findById: (id) => id === task.id ? task : undefined, updateTask: (_id, _memberId, version, changes) => version === 0 ? { ...task, ...(changes.title === undefined ? {} : { title: changes.title }), version: 1 } : undefined }));
    applications.push(application);

    const response = await application.inject({ method: "PATCH", url: "/tasks/task-1", payload: { memberId: "member-1", expectedVersion: 0, title: "Buy bread" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ task: { ...task, title: "Buy bread", version: 1 } });
  });
});
