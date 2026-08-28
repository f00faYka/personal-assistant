import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { migrateDatabase } from "./migrate.js";
import { foundationMigrations } from "./foundation-migrations.js";
import { SqliteMemberItemsRepository } from "./sqlite-member-items-repository.js";

describe("SqliteMemberItemsRepository", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

  test("joins mixed processing and outcome states in stable order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-items-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const database = new Database(databasePath);
    database.exec(`
      INSERT INTO captures (id, source_id, member_id, idempotency_key, content_type, byte_length, content_sha256, captured_at, created_at, storage_state)
      VALUES ('capture-1', 'source-1', 'member-1', 'key-1', 'audio/mpeg', 1, 'hash', '2026-08-14T10:00:00.000Z', '2026-08-14T10:00:00.000Z', 'stored');
      INSERT INTO captures (id, source_id, member_id, idempotency_key, content_type, byte_length, content_sha256, captured_at, created_at, storage_state)
      VALUES ('capture-2', 'source-2', 'member-1', 'key-2', 'audio/mpeg', 1, 'hash', '2026-08-14T11:00:00.000Z', '2026-08-14T11:00:00.000Z', 'stored');
      INSERT INTO transcriptions (id, capture_id, source_id, content_type, status, attempt_count, created_at, updated_at)
      VALUES ('transcription-2', 'capture-2', 'source-2', 'audio/mpeg', 'failed', 1, '2026-08-14T11:00:00.000Z', '2026-08-14T11:00:00.000Z');
    `);
    database.close();
    const repository = new SqliteMemberItemsRepository(databasePath);

    const rows = repository.list("member-1", undefined, 2);
    repository.close();

    expect(rows.map((row) => [row.captureId, row.transcriptionStatus])).toEqual([
      ["capture-2", "failed"],
      ["capture-1", null],
    ]);
  });

  test("searches combined content, subtree, tag, entity, and unassigned filters without leaking Members", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-search-"));
    directories.push(directory);
    const databasePath = join(directory, "api.sqlite");
    migrateDatabase({ databasePath, migrations: foundationMigrations });
    const database = new Database(databasePath);
    database.exec(`
      INSERT INTO spaces (id, member_id, name, created_at) VALUES ('space-root', 'member-1', 'Home', '2026-08-14T09:00:00.000Z');
      INSERT INTO spaces (id, member_id, name, parent_space_id, created_at) VALUES ('space-child', 'member-1', 'Work', 'space-root', '2026-08-14T09:01:00.000Z');
      INSERT INTO tags (id, member_id, name, created_at) VALUES ('tag-work', 'member-1', 'work', '2026-08-14T09:00:00.000Z');
      INSERT INTO entities (id, member_id, name, type, created_at) VALUES ('entity-acme', 'member-1', 'Acme', 'Organization', '2026-08-14T09:00:00.000Z');
      INSERT INTO outcomes (id, kind, member_id, interpretation_id, capture_id, source_id, title, status, created_at, primary_space_id)
        VALUES ('task-match', 'task', 'member-1', 'i-1', 'capture-match', 'source-1', 'Plan Acme work', 'open', '2026-08-14T12:00:00.000Z', 'space-child');
      INSERT INTO outcomes (id, kind, member_id, interpretation_id, capture_id, source_id, title, status, created_at)
        VALUES ('task-unassigned', 'task', 'member-1', 'i-2', 'capture-unassigned', 'source-2', 'Plan Acme work', 'open', '2026-08-14T11:00:00.000Z');
      INSERT INTO outcomes (id, kind, member_id, interpretation_id, capture_id, source_id, title, status, created_at)
        VALUES ('task-other', 'task', 'member-2', 'i-3', 'capture-other', 'source-3', 'Plan Acme work', 'open', '2026-08-14T13:00:00.000Z');
      INSERT INTO outcomes (id, kind, member_id, interpretation_id, capture_id, source_id, content, review_state, created_at)
        VALUES ('note-unassigned', 'note', 'member-1', 'i-4', 'capture-note', 'source-4', 'Acme notes', 'none', '2026-08-14T10:00:00.000Z');
      INSERT INTO item_tags (member_id, item_id, item_kind, tag_id) VALUES ('member-1', 'task-match', 'task', 'tag-work');
      INSERT INTO item_entities (member_id, item_id, item_kind, entity_id) VALUES ('member-1', 'task-match', 'task', 'entity-acme');
    `);
    database.close();
    const repository = new SqliteMemberItemsRepository(databasePath);

    const matched = repository.search("member-1", { text: "acme", spaceId: "space-root", unassigned: false, tagId: "tag-work", entityId: "entity-acme" }, undefined, 10);
    const unassigned = repository.search("member-1", { unassigned: true }, undefined, 10);
    const firstPage = repository.search("member-1", { unassigned: true }, undefined, 1);
    const secondPage = repository.search("member-1", { unassigned: true }, {
      memberId: "member-1", createdAt: firstPage[0]!.createdAt, itemId: firstPage[0]!.itemId,
    }, 1);
    repository.close();

    expect(matched.map((row) => row.itemId)).toEqual(["task-match"]);
    expect(unassigned.map((row) => row.itemId)).toEqual(["task-unassigned", "note-unassigned"]);
    expect(firstPage.map((row) => [row.itemId, row.itemKind])).toEqual([["task-unassigned", "task"]]);
    expect(secondPage.map((row) => [row.itemId, row.itemKind])).toEqual([["note-unassigned", "note"]]);
  });
});
