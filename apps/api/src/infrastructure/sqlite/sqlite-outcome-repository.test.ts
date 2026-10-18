import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { afterEach, describe, expect, test } from "vitest";

import type { Outcome } from "../../features/outcomes/outcome.js";
import type { TaskMutationRequest, TaskOutcome } from "../../features/outcomes/outcome.js";
import { buildApi } from "../../http/build-api.js";
import { TaskService } from "../../features/outcomes/outcome.js";
import { registerTaskRoutes } from "../../features/outcomes/task-routes.js";
import { foundationMigrations } from "./foundation-migrations.js";
import { migrateDatabase } from "./migrate.js";
import { SqliteOutcomeRepository } from "./sqlite-outcome-repository.js";
import { SqliteMetadataRepository } from "./sqlite-metadata-repository.js";
import { SqliteSpaceRepository } from "./sqlite-space-repository.js";
import { MetadataService } from "../../features/metadata/metadata.js";
import { SpaceService } from "../../features/spaces/space.js";

describe("SqliteOutcomeRepository", () => {
  const directories: string[] = [];
  const repositories: SqliteOutcomeRepository[] = [];
  const applications: Array<ReturnType<typeof buildApi>> = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.close()));
    repositories.splice(0).forEach((repository) => repository.close());
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  test("persists Tasks and Notes with one outcome per interpretation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-outcome-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteOutcomeRepository(databasePath);
    const task: Outcome = {
      kind: "task",
      id: "task-1",
      memberId: "member-1",
      interpretationId: "interpretation-1",
      captureId: "capture-1",
      sourceId: "source-1",
      title: "Buy milk",
      dueAt: "2026-08-15T09:00:00.000Z",
      status: "open",
      version: 0,
      createdAt: "2026-08-14T10:00:00.000Z",
    };
    const note: Outcome = {
      kind: "note",
      id: "note-1",
      memberId: "member-1",
      interpretationId: "interpretation-2",
      captureId: "capture-2",
      sourceId: "source-2",
      content: "The garden looks lovely",
      reviewState: "none",
      version: 0,
      createdAt: "2026-08-14T10:01:00.000Z",
    };

    expect(repository.create(task)).toEqual(task);
    expect(repository.create({ ...task, id: "different-id" })).toEqual(task);
    expect(repository.create(note)).toEqual(note);
    repository.close();

    const reopened = new SqliteOutcomeRepository(databasePath);
    expect(reopened.findByInterpretationId("interpretation-1")).toEqual(task);
    expect(reopened.findByInterpretationId("interpretation-2")).toEqual(note);
    reopened.close();
  });

  test("applies optimistic Task mutations and preserves provenance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-task-mutation-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteOutcomeRepository(databasePath);
    const task: Outcome = {
      kind: "task",
      id: "task-1",
      memberId: "member-1",
      interpretationId: "interpretation-1",
      captureId: "capture-1",
      sourceId: "source-1",
      title: "Buy milk",
      status: "open",
      version: 0,
      createdAt: "2026-08-14T10:00:00.000Z",
    };
    repository.create(task);

    const edited = repository.updateTask("task-1", "member-1", 0, { title: "Buy oat milk", dueAt: null });
    const stale = repository.updateTask("task-1", "member-1", 0, { title: "Buy almond milk" });
    const completed = repository.updateTask("task-1", "member-1", 1, { status: "completed" });

    expect(edited).toMatchObject({ title: "Buy oat milk", status: "open", version: 1 });
    expect(stale).toBeUndefined();
    expect(completed).toMatchObject({
      id: "task-1",
      status: "completed",
      version: 2,
      captureId: "capture-1",
      sourceId: "source-1",
      interpretationId: "interpretation-1",
    });
    repository.close();
  });

  test("replays Task operations after restart and records each transition once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-task-operation-replay-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const original: Outcome = {
      kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1",
      captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "open", version: 0,
      createdAt: "2026-08-14T10:00:00.000Z",
    };
    const first = new SqliteOutcomeRepository(databasePath);
    first.create(original);
    const complete: TaskMutationRequest = { taskId: "task-1", memberId: "member-1", expectedVersion: 0, operationId: "complete-1", mutation: { kind: "complete" }, occurredAt: "2026-08-15T10:00:00.000Z" };
    const completed = first.mutateTask(complete);
    expect(completed).toMatchObject({ kind: "applied", task: { status: "completed", version: 1 } });
    const edit: TaskMutationRequest = { taskId: "task-1", memberId: "member-1", expectedVersion: 1, operationId: "edit-1", mutation: { kind: "edit", changes: { title: "Buy oat milk", dueAt: "2026-08-16T09:00:00.000Z" } }, occurredAt: "2026-08-15T10:00:30.000Z" };
    const edited = first.mutateTask(edit);
    expect(edited).toMatchObject({ kind: "applied", task: { status: "completed", version: 2, title: "Buy oat milk", dueAt: "2026-08-16T09:00:00.000Z" } });
    const reopen: TaskMutationRequest = { taskId: "task-1", memberId: "member-1", expectedVersion: 2, operationId: "reopen-1", mutation: { kind: "reopen" }, occurredAt: "2026-08-15T10:01:00.000Z" };
    const reopened = first.mutateTask(reopen);
    expect(reopened).toMatchObject({ kind: "applied", task: { status: "open", version: 3 } });
    first.close();

    const restarted = new SqliteOutcomeRepository(databasePath);
    expect(restarted.mutateTask(complete)).toEqual(completed);
    expect(restarted.mutateTask(edit)).toEqual(edited);
    expect(restarted.mutateTask(reopen)).toEqual(reopened);
    expect(restarted.mutateTask({ ...complete, mutation: { kind: "complete" }, occurredAt: "2026-08-15T10:02:00.000Z", expectedVersion: 2 })).toEqual({ kind: "operation_mismatch" });
    expect(restarted.listTaskStatusHistory("task-1", "member-1")).toEqual([
      { taskId: "task-1", memberId: "member-1", actorMemberId: "member-1", from: "open", to: "completed", operationId: "complete-1", resultingVersion: 1, occurredAt: "2026-08-15T10:00:00.000Z" },
      { taskId: "task-1", memberId: "member-1", actorMemberId: "member-1", from: "completed", to: "open", operationId: "reopen-1", resultingVersion: 3, occurredAt: "2026-08-15T10:01:00.000Z" },
    ]);
    expect(restarted.findById("task-1")).toMatchObject({ title: "Buy oat milk", dueAt: "2026-08-16T09:00:00.000Z", captureId: "capture-1", sourceId: "source-1", interpretationId: "interpretation-1", version: 3 });
    restarted.close();
  });

  test("a current-version Reopen on an open Task is a durable no-op", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-task-reopen-noop-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteOutcomeRepository(databasePath);
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "open", version: 7, createdAt: "2026-08-14T10:00:00.000Z" };
    repository.create(task);
    const request: TaskMutationRequest = { taskId: task.id, memberId: task.memberId, expectedVersion: task.version, operationId: "reopen-noop", mutation: { kind: "reopen" }, occurredAt: "2026-08-15T10:00:00.000Z" };

    expect(repository.mutateTask(request)).toEqual({ kind: "applied", task });
    expect(repository.mutateTask(request)).toEqual({ kind: "applied", task });
    expect(repository.mutateTask({ ...request, memberId: "another-member" })).toEqual({ kind: "not_found" });
    expect(repository.mutateTask({ ...request, expectedVersion: 6, operationId: "stale-reopen" })).toEqual({ kind: "version_conflict", task });
    expect(repository.listTaskStatusHistory(task.id, task.memberId)).toEqual([]);
    repository.close();
  });

  test("serves durable operation replay through the API after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-task-mutation-api-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "open", version: 0, createdAt: "2026-08-14T10:00:00.000Z" };
    const firstRepository = new SqliteOutcomeRepository(databasePath);
    repositories.push(firstRepository);
    firstRepository.create(task);
    const firstApplication = buildApi({ logger: false });
    applications.push(firstApplication);
    registerTaskRoutes(firstApplication, new TaskService(firstRepository));

    const completed = await firstApplication.inject({ method: "POST", url: "/tasks/task-1/complete", payload: { memberId: "member-1", expectedVersion: 0, operationId: "complete-1" } });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toEqual({ task: { ...task, status: "completed", version: 1 } });
    const reopened = await firstApplication.inject({ method: "POST", url: "/tasks/task-1/reopen", payload: { memberId: "member-1", expectedVersion: 1, operationId: "reopen-1" } });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toEqual({ task: { ...task, status: "open", version: 2 } });
    await firstApplication.close();
    firstRepository.close();

    const restartedRepository = new SqliteOutcomeRepository(databasePath);
    repositories.push(restartedRepository);
    const restartedApplication = buildApi({ logger: false });
    applications.push(restartedApplication);
    registerTaskRoutes(restartedApplication, new TaskService(restartedRepository));
    const replayed = await restartedApplication.inject({ method: "POST", url: "/tasks/task-1/complete", payload: { memberId: "member-1", expectedVersion: 0, operationId: "complete-1" } });

    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual({ task: { ...task, status: "completed", version: 1 } });
    expect(restartedRepository.findById(task.id)).toMatchObject({ status: "open", version: 2 });
    expect(restartedRepository.listTaskStatusHistory(task.id, task.memberId)).toHaveLength(2);
  });

  test("a failed transition insert rolls back the Task and operation together", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-task-mutation-rollback-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteOutcomeRepository(databasePath);
    const task: TaskOutcome = { kind: "task", id: "task-1", memberId: "member-1", interpretationId: "interpretation-1", captureId: "capture-1", sourceId: "source-1", title: "Buy milk", status: "open", version: 0, createdAt: "2026-08-14T10:00:00.000Z" };
    repository.create(task);
    const database = new Database(databasePath);
    database.exec("CREATE TRIGGER reject_task_transition BEFORE INSERT ON task_status_transitions BEGIN SELECT RAISE(ABORT, 'rejected transition'); END");
    const request: TaskMutationRequest = { taskId: task.id, memberId: task.memberId, expectedVersion: 0, operationId: "complete-rollback", mutation: { kind: "complete" }, occurredAt: "2026-08-15T10:00:00.000Z" };

    expect(() => repository.mutateTask(request)).toThrow("rejected transition");
    expect(repository.findById(task.id)).toEqual(task);
    expect(repository.listTaskStatusHistory(task.id, task.memberId)).toEqual([]);
    database.exec("DROP TRIGGER reject_task_transition");
    database.close();
    expect(repository.mutateTask(request)).toMatchObject({ kind: "applied", task: { status: "completed", version: 1 } });
    repository.close();
  });

  test("applies optimistic Note mutations without changing provenance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-note-mutation-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteOutcomeRepository(databasePath);
    const note: Outcome = {
      kind: "note",
      id: "note-1",
      memberId: "member-1",
      interpretationId: "interpretation-1",
      captureId: "capture-1",
      sourceId: "source-1",
      content: "The garden looks lovely",
      reviewState: "needs_review",
      version: 0,
      createdAt: "2026-08-14T10:00:00.000Z",
    };
    repository.create(note);

    const edited = repository.updateNote("note-1", "member-1", 0, { content: "The garden is thriving" });
    const stale = repository.updateNote("note-1", "member-1", 0, { content: "The garden needs water" });

    expect(edited).toMatchObject({ kind: "note", content: "The garden is thriving", reviewState: "needs_review", version: 1 });
    expect(edited).toMatchObject({ captureId: "capture-1", sourceId: "source-1", interpretationId: "interpretation-1" });
    expect(stale).toBeUndefined();
    repository.close();
  });

  test("explicit Note save resolves review state while preserving provenance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-note-review-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteOutcomeRepository(databasePath);
    const note: Outcome = {
      kind: "note",
      id: "note-1",
      memberId: "member-1",
      interpretationId: "interpretation-1",
      captureId: "capture-1",
      sourceId: "source-1",
      content: "Maybe water the garden",
      reviewState: "needs_review",
      version: 0,
      createdAt: "2026-08-14T10:00:00.000Z",
    };
    repository.create(note);

    const saved = repository.updateNote("note-1", "member-1", 0, { content: "Water the garden", reviewState: "none" });

    expect(saved).toMatchObject({ content: "Water the garden", reviewState: "none", version: 1 });
    expect(saved).toMatchObject({ captureId: "capture-1", sourceId: "source-1", interpretationId: "interpretation-1" });
    repository.close();
  });

  test("converts a Note in place and rejects stale or cross-member conversion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-note-conversion-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteOutcomeRepository(databasePath);
    const note: Outcome = {
      kind: "note",
      id: "note-1",
      memberId: "member-1",
      interpretationId: "interpretation-1",
      captureId: "capture-1",
      sourceId: "source-1",
      content: "Call the gardener",
      reviewState: "needs_review",
      version: 0,
      createdAt: "2026-08-14T10:00:00.000Z",
    };
    repository.create(note);

    const converted = repository.convertNoteToTask("note-1", "member-1", 0);

    expect(converted).toMatchObject({
      kind: "task",
      id: "note-1",
      title: "Call the gardener",
      status: "open",
      version: 1,
      memberId: "member-1",
      interpretationId: "interpretation-1",
      captureId: "capture-1",
      sourceId: "source-1",
    });
    expect(repository.convertNoteToTask("note-1", "member-1", 0)).toBeUndefined();
    expect(repository.convertNoteToTask("note-1", "other-member", 1)).toBeUndefined();
    repository.close();
  });

  test("inherits the primary Space, Tags, and Entities when converting a Note", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-note-organization-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const repository = new SqliteOutcomeRepository(databasePath);
    const spaceRepository = new SqliteSpaceRepository(databasePath);
    const metadataRepository = new SqliteMetadataRepository(databasePath);
    const spaces = new SpaceService(spaceRepository);
    const metadata = new MetadataService(metadataRepository);
    const note: Outcome = {
      kind: "note",
      id: "note-1",
      memberId: "member-1",
      interpretationId: "interpretation-1",
      captureId: "capture-1",
      sourceId: "source-1",
      content: "Call the gardener",
      reviewState: "none",
      version: 0,
      createdAt: "2026-08-14T10:00:00.000Z",
    };
    repository.create(note);
    const space = spaces.create("member-1", "Home");
    spaces.assign(note.id, "note", note.memberId, space.id);
    const tag = metadata.createTag("member-1", "Garden");
    const entity = metadata.createEntity("member-1", "Gardener", "Person");
    metadata.linkTag(note.id, "note", note.memberId, tag.id);
    metadata.linkEntity(note.id, "note", note.memberId, entity.id);

    const converted = repository.convertNoteToTask(note.id, note.memberId, note.version);

    expect(converted).toMatchObject({
      kind: "task",
      id: note.id,
      title: note.content,
      version: 1,
      interpretationId: note.interpretationId,
      captureId: note.captureId,
      sourceId: note.sourceId,
    });
    expect(spaces.read(note.memberId, space.id).items).toEqual([
      expect.objectContaining({ itemId: note.id, itemKind: "task", spaceId: space.id }),
    ]);
    expect(metadata.listLinks(note.id, "task", note.memberId)).toEqual({ tags: [tag], entities: [entity] });
    repository.close();
    spaceRepository.close();
    metadataRepository.close();
  });
});
