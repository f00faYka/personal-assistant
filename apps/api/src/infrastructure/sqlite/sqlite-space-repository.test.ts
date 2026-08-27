import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { foundationMigrations } from "./foundation-migrations.js";
import { migrateDatabase } from "./migrate.js";
import { SqliteSpaceRepository } from "./sqlite-space-repository.js";

describe("SqliteSpaceRepository", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

  test("persists a tree and prevents cross-member assignment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-spaces-")); directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const database = new Database(databasePath);
    database.exec("INSERT INTO outcomes (id, kind, member_id, interpretation_id, capture_id, source_id, title, status, created_at) VALUES ('task-1', 'task', 'member-1', 'interp-1', 'capture-1', 'source-1', 'Task', 'open', '2026-01-01T00:00:00.000Z')");
    database.close();
    const repository = new SqliteSpaceRepository(databasePath);
    const root = repository.create({ id: "space-1", memberId: "member-1", name: "Home", createdAt: "2026-01-01T00:00:00.000Z" });
    repository.create({ id: "space-2", memberId: "member-1", name: "Kitchen", parentId: root.id, createdAt: "2026-01-01T00:00:01.000Z" });

    expect(repository.list("member-1")).toHaveLength(2);
    expect(repository.hasDescendant(root.id, "space-2", "member-1")).toBe(true);
    expect(repository.assign("task-1", "task", "member-1", "space-2")).toEqual({ itemId: "task-1", itemKind: "task", spaceId: "space-2" });
    expect(repository.assign("task-1", "task", "member-2", "space-2")).toBeUndefined();
    repository.close();
  });
});
