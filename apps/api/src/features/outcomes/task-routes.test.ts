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
    registerTaskRoutes(application, new TaskService({ findById: (id) => id === task.id ? task : undefined, updateTask: (_id, _memberId, version, changes) => version === 0 ? { ...task, ...(changes.title === undefined ? {} : { title: changes.title }), ...(changes.status === undefined ? {} : { status: changes.status }), version: 1 } : undefined, mutateTask: () => ({ kind: "not_found" }), listTaskStatusHistory: () => [] }));
    applications.push(application);

    const response = await application.inject({ method: "PATCH", url: "/tasks/task-1", payload: { memberId: "member-1", expectedVersion: 0, title: "Buy bread" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ task: { ...task, title: "Buy bread", version: 1 } });
  });

  test("completes a Task through the reviewed optimistic-concurrency contract", async () => {
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "open", version: 0, createdAt: "2026-08-15T10:00:00.000Z" };
    const application = buildApi({ logger: false });
    registerTaskRoutes(application, new TaskService({ findById: (id) => id === task.id ? task : undefined, updateTask: (_id, _memberId, version, changes) => version === 0 ? { ...task, ...(changes.status === undefined ? {} : { status: changes.status }), version: 1 } : undefined, mutateTask: () => ({ kind: "not_found" }), listTaskStatusHistory: () => [] }));
    applications.push(application);

    const response = await application.inject({ method: "POST", url: "/tasks/task-1/complete", payload: { memberId: "member-1", expectedVersion: 0 } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ task: { ...task, status: "completed", version: 1 } });
  });

  test("edits a completed Task through an operation-keyed mutation", async () => {
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "completed", version: 3, createdAt: "2026-08-15T10:00:00.000Z" };
    const application = buildApi({ logger: false });
    registerTaskRoutes(application, new TaskService({
      findById: (id) => id === task.id ? task : undefined,
      updateTask: () => undefined,
      mutateTask: (request) => ({ kind: "applied", task: { ...task, title: request.mutation.kind === "edit" ? request.mutation.changes.title ?? task.title : task.title, version: 4 } }),
      listTaskStatusHistory: () => [],
    }));
    applications.push(application);

    const response = await application.inject({ method: "PATCH", url: "/tasks/task-1", payload: { memberId: "member-1", expectedVersion: 3, operationId: "edit-1", title: "Buy oat milk" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ task: { ...task, title: "Buy oat milk", version: 4 } });
  });

  test("requires UTC due instants for operation-keyed edits", async () => {
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "open", version: 0, createdAt: "2026-08-15T10:00:00.000Z" };
    const application = buildApi({ logger: false });
    registerTaskRoutes(application, new TaskService({
      findById: (id) => id === task.id ? task : undefined,
      updateTask: () => undefined,
      mutateTask: () => ({ kind: "not_found" }),
      listTaskStatusHistory: () => [],
    }));
    applications.push(application);

    const response = await application.inject({ method: "PATCH", url: "/tasks/task-1", payload: { memberId: "member-1", expectedVersion: 0, operationId: "edit-due", dueAt: "2026-08-16T11:00:00+02:00" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "validation_error" });
  });

  test("reopens a Task through an operation-keyed mutation", async () => {
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "completed", version: 4, createdAt: "2026-08-15T10:00:00.000Z" };
    const application = buildApi({ logger: false });
    registerTaskRoutes(application, new TaskService({
      findById: (id) => id === task.id ? task : undefined,
      updateTask: () => undefined,
      mutateTask: () => ({ kind: "applied", task: { ...task, status: "open", version: 5 } }),
      listTaskStatusHistory: () => [],
    }));
    applications.push(application);

    const response = await application.inject({ method: "POST", url: "/tasks/task-1/reopen", payload: { memberId: "member-1", expectedVersion: 4, operationId: "reopen-1" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ task: { ...task, status: "open", version: 5 } });
  });

  test("returns the current Task and stable code when an operation is stale", async () => {
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "completed", version: 5, createdAt: "2026-08-15T10:00:00.000Z" };
    const application = buildApi({ logger: false });
    registerTaskRoutes(application, new TaskService({
      findById: (id) => id === task.id ? task : undefined,
      updateTask: () => undefined,
      mutateTask: () => ({ kind: "version_conflict", task }),
      listTaskStatusHistory: () => [],
    }));
    applications.push(application);

    const response = await application.inject({ method: "PATCH", url: "/tasks/task-1", payload: { memberId: "member-1", expectedVersion: 4, operationId: "edit-stale", title: "Buy oat milk" } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "Task was changed by another request: task-1", code: "task_version_conflict", task });
  });

  test("rejects operation ID reuse with a stable conflict code", async () => {
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "open", version: 0, createdAt: "2026-08-15T10:00:00.000Z" };
    const application = buildApi({ logger: false });
    registerTaskRoutes(application, new TaskService({
      findById: (id) => id === task.id ? task : undefined,
      updateTask: () => undefined,
      mutateTask: () => ({ kind: "operation_mismatch" }),
      listTaskStatusHistory: () => [],
    }));
    applications.push(application);

    const response = await application.inject({ method: "PATCH", url: "/tasks/task-1", payload: { memberId: "member-1", expectedVersion: 0, operationId: "reused", title: "Buy oat milk" } });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "idempotency_key_mismatch" });
  });

  test("keeps legacy requests from editing completed Tasks", async () => {
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "completed", version: 2, createdAt: "2026-08-15T10:00:00.000Z" };
    const application = buildApi({ logger: false });
    registerTaskRoutes(application, new TaskService({
      findById: (id) => id === task.id ? task : undefined,
      updateTask: () => undefined,
      mutateTask: () => ({ kind: "not_found" }),
      listTaskStatusHistory: () => [],
    }));
    applications.push(application);

    const response = await application.inject({ method: "PATCH", url: "/tasks/task-1", payload: { memberId: "member-1", expectedVersion: 2, title: "Buy oat milk" } });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "completed Tasks cannot be edited" });
  });
});
