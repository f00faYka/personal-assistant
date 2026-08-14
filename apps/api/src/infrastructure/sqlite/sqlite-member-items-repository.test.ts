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
});
