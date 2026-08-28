import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { foundationMigrations } from "./foundation-migrations.js";
import { migrateDatabase } from "./migrate.js";
import { SqliteMetadataRepository } from "./sqlite-metadata-repository.js";

describe("SqliteMetadataRepository", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

  test("persists member-scoped metadata and idempotent links", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-metadata-")); directories.push(directory);
    const databasePath = join(directory, "api.sqlite"); migrateDatabase({ databasePath, migrations: foundationMigrations });
    const database = new Database(databasePath);
    database.prepare("INSERT INTO outcomes (id, kind, member_id, interpretation_id, capture_id, source_id, title, status, created_at) VALUES (?, 'task', ?, ?, ?, ?, ?, 'open', ?)").run("task-1", "member-1", "i-1", "c-1", "s-1", "Task", "2026-01-01T00:00:00.000Z"); database.close();
    const repository = new SqliteMetadataRepository(databasePath);
    const tag = repository.createTag({ id: "tag-1", memberId: "member-1", name: "urgent", createdAt: "2026-01-01T00:00:00.000Z" });
    const entity = repository.createEntity({ id: "entity-1", memberId: "member-1", name: "Office", type: "Place", createdAt: "2026-01-01T00:00:00.000Z" });
    repository.linkTag("task-1", "task", tag.id, "member-1"); repository.linkTag("task-1", "task", tag.id, "member-1"); repository.linkEntity("task-1", "task", entity.id, "member-1");
    expect(repository.listLinks("task-1", "task", "member-1")).toEqual({ tags: [tag], entities: [entity] });
    expect(repository.findTag(tag.id, "member-2")).toBeUndefined();
    expect(repository.itemExists("task-1", "task", "member-2")).toBe(false);
    repository.close();
  });
});
