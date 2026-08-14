import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { Outcome } from "../../features/outcomes/outcome.js";
import { foundationMigrations } from "./foundation-migrations.js";
import { migrateDatabase } from "./migrate.js";
import { SqliteOutcomeRepository } from "./sqlite-outcome-repository.js";

describe("SqliteOutcomeRepository", () => {
  const directories: string[] = [];

  afterEach(async () => {
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
});
