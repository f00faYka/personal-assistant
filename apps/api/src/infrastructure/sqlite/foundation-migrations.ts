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
  {
    version: 4,
    name: "create transcriptions",
    sql: `
      CREATE TABLE transcriptions (
        id TEXT PRIMARY KEY,
        capture_id TEXT NOT NULL UNIQUE,
        source_id TEXT NOT NULL,
        content_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
        text TEXT,
        provider TEXT,
        model TEXT,
        error TEXT,
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `,
  },
];
