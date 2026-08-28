import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { buildApi } from "../../http/build-api.js";
import { foundationMigrations } from "../../infrastructure/sqlite/foundation-migrations.js";
import { migrateDatabase } from "../../infrastructure/sqlite/migrate.js";
import { SqliteMetadataRepository } from "../../infrastructure/sqlite/sqlite-metadata-repository.js";
import { MetadataService } from "./metadata.js";

describe("metadata routes", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => Promise.all(cleanups.splice(0).map((cleanup) => cleanup())));

  test("creates, updates, lists, links, and unlinks Tags and Entities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-metadata-routes-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const database = new Database(databasePath);
    database.prepare("INSERT INTO outcomes (id, kind, member_id, interpretation_id, capture_id, source_id, title, status, created_at) VALUES ('task-1', 'task', 'member-1', 'i-1', 'c-1', 's-1', 'Task', 'open', '2026-01-01T00:00:00.000Z')").run();
    database.prepare("INSERT INTO outcomes (id, kind, member_id, interpretation_id, capture_id, source_id, content, review_state, created_at) VALUES ('note-1', 'note', 'member-1', 'i-2', 'c-2', 's-2', 'Note', 'none', '2026-01-01T00:00:01.000Z')").run();
    database.close();
    const repository = new SqliteMetadataRepository(databasePath);
    const application = buildApi({ logger: false, metadataService: new MetadataService(repository) });
    cleanups.push(async () => { await application.close(); repository.close(); });

    const invalidEntity = await application.inject({ method: "POST", url: "/entities", payload: { memberId: "member-1", name: "Unknown", type: "Planet" } });
    expect(invalidEntity.statusCode).toBe(400);
    const createdTag = await application.inject({ method: "POST", url: "/tags", payload: { memberId: "member-1", name: " urgent " } });
    const secondTag = await application.inject({ method: "POST", url: "/tags", payload: { memberId: "member-1", name: "home" } });
    const createdEntity = await application.inject({ method: "POST", url: "/entities", payload: { memberId: "member-1", name: "Office", type: "Place" } });
    const secondEntity = await application.inject({ method: "POST", url: "/entities", payload: { memberId: "member-1", name: "Alice", type: "Person" } });
    expect(createdTag.statusCode).toBe(201); expect(secondTag.statusCode).toBe(201); expect(createdEntity.statusCode).toBe(201); expect(secondEntity.statusCode).toBe(201);
    const tagId = createdTag.json().tag.id as string; const secondTagId = secondTag.json().tag.id as string;
    const entityId = createdEntity.json().entity.id as string; const secondEntityId = secondEntity.json().entity.id as string;
    expect((await application.inject({ method: "PATCH", url: "/tags/" + tagId, payload: { memberId: "member-1", name: "important" } })).statusCode).toBe(200);
    expect((await application.inject({ method: "PATCH", url: "/entities/" + entityId, payload: { memberId: "member-1", name: "Head office", type: "Organization" } })).statusCode).toBe(200);
    expect((await application.inject({ method: "PUT", url: `/tasks/task-1/tags/${tagId}`, payload: { memberId: "member-1" } })).statusCode).toBe(200);
    expect((await application.inject({ method: "PUT", url: `/tasks/task-1/tags/${secondTagId}`, payload: { memberId: "member-1" } })).statusCode).toBe(200);
    expect((await application.inject({ method: "PUT", url: `/tasks/task-1/entities/${entityId}`, payload: { memberId: "member-1" } })).statusCode).toBe(200);
    expect((await application.inject({ method: "PUT", url: `/tasks/task-1/entities/${secondEntityId}`, payload: { memberId: "member-1" } })).statusCode).toBe(200);
    expect((await application.inject({ method: "PUT", url: `/notes/note-1/tags/${secondTagId}`, payload: { memberId: "member-1" } })).statusCode).toBe(200);
    expect((await application.inject({ method: "PUT", url: `/notes/note-1/entities/${secondEntityId}`, payload: { memberId: "member-1" } })).statusCode).toBe(200);
    const links = await application.inject({ method: "GET", url: "/tasks/task-1/metadata?memberId=member-1" });
    expect(links.json().tags).toHaveLength(2); expect(links.json().entities).toHaveLength(2);
    const noteLinks = await application.inject({ method: "GET", url: "/notes/note-1/metadata?memberId=member-1" });
    expect(noteLinks.json().tags).toHaveLength(1); expect(noteLinks.json().entities).toHaveLength(1);
    expect((await application.inject({ method: "DELETE", url: `/tasks/task-1/tags/${tagId}?memberId=member-1` })).statusCode).toBe(200);
    expect((await application.inject({ method: "DELETE", url: `/tasks/task-1/entities/${entityId}?memberId=member-1` })).statusCode).toBe(200);
    const afterUnlink = await application.inject({ method: "GET", url: "/tasks/task-1/metadata?memberId=member-1" });
    expect(afterUnlink.json().tags).toHaveLength(1); expect(afterUnlink.json().entities).toHaveLength(1);
  });
});
