import type { Migration } from "./migrate.js";

export const foundationMigrations: readonly Migration[] = [
  {
    version: 2,
    name: "create captures",
    sql: `
      CREATE TABLE captures (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL UNIQUE,
        member_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        content_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        content_sha256 TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (member_id, idempotency_key)
      ) STRICT
    `,
  },
  {
    version: 3,
    name: "track capture storage state",
    sql: `
      ALTER TABLE captures ADD COLUMN storage_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (storage_state IN ('pending', 'stored'))
    `,
  },
];
