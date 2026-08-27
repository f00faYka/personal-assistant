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
  {
    version: 5,
    name: "create interpretations",
    sql: `
      CREATE TABLE interpretations (
        id TEXT PRIMARY KEY,
        capture_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        transcription_id TEXT NOT NULL UNIQUE,
        catalog_version TEXT NOT NULL,
        model TEXT NOT NULL,
        raw_output_json TEXT NOT NULL,
        classification TEXT NOT NULL CHECK (classification IN ('clear_supported', 'ordinary', 'ambiguous', 'unsupported')),
        action_json TEXT,
        rejection_reason TEXT,
        created_at TEXT NOT NULL
      ) STRICT
    `,
  },
  {
    version: 6,
    name: "create task and note outcomes",
    sql: `
      CREATE TABLE outcomes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('task', 'note')),
        member_id TEXT NOT NULL,
        interpretation_id TEXT NOT NULL UNIQUE,
        capture_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT,
        due_at TEXT,
        status TEXT CHECK (status IS NULL OR status IN ('open')),
        content TEXT,
        review_state TEXT CHECK (review_state IS NULL OR review_state IN ('none', 'needs_review')),
        created_at TEXT NOT NULL,
        CHECK (
          (kind = 'task' AND title IS NOT NULL AND status IS NOT NULL AND content IS NULL AND review_state IS NULL)
          OR
          (kind = 'note' AND title IS NULL AND status IS NULL AND content IS NOT NULL AND review_state IS NOT NULL)
        )
      ) STRICT
    `,
  },
  {
    version: 7,
    name: "support Task mutation state",
    sql: `
      CREATE TABLE outcomes_v7 (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('task', 'note')),
        member_id TEXT NOT NULL,
        interpretation_id TEXT NOT NULL UNIQUE,
        capture_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT,
        due_at TEXT,
        status TEXT CHECK (status IS NULL OR status IN ('open', 'completed')),
        content TEXT,
        review_state TEXT CHECK (review_state IS NULL OR review_state IN ('none', 'needs_review')),
        created_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
        CHECK (
          (kind = 'task' AND title IS NOT NULL AND status IS NOT NULL AND content IS NULL AND review_state IS NULL)
          OR
          (kind = 'note' AND title IS NULL AND status IS NULL AND content IS NOT NULL AND review_state IS NOT NULL)
        )
      ) STRICT;
      INSERT INTO outcomes_v7
        (id, kind, member_id, interpretation_id, capture_id, source_id, title, due_at,
         status, content, review_state, created_at)
        SELECT id, kind, member_id, interpretation_id, capture_id, source_id, title, due_at,
          status, content, review_state, created_at
        FROM outcomes;
      DROP TABLE outcomes;
      ALTER TABLE outcomes_v7 RENAME TO outcomes;
    `,
  },
  {
    version: 8,
    name: "create offline drafts",
    sql: `
      CREATE TABLE offline_drafts (
        draft_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('audio', 'text')),
        content_type TEXT,
        text TEXT,
        source_sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('accepted', 'failed')),
        capture_id TEXT,
        error TEXT,
        retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (member_id, draft_id),
        CHECK ((source_kind = 'audio' AND content_type IS NOT NULL AND text IS NULL) OR (source_kind = 'text' AND content_type IS NULL AND text IS NOT NULL))
      ) STRICT
    `,
  },
  {
    version: 9,
    name: "create interpretation processing jobs",
    sql: `
      CREATE TABLE interpretation_jobs (
        transcription_id TEXT PRIMARY KEY,
        capture_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
        error TEXT,
        retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT
    `,
  },
  {
    version: 10,
    name: "preserve transcription language",
    sql: "ALTER TABLE transcriptions ADD COLUMN language TEXT",
  },
  {
    version: 11,
    name: "create Spaces and primary item assignments",
    sql: `
      CREATE TABLE spaces (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        parent_space_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (member_id, id),
        FOREIGN KEY (member_id, parent_space_id) REFERENCES spaces(member_id, id)
      ) STRICT;
      ALTER TABLE outcomes ADD COLUMN primary_space_id TEXT
        REFERENCES spaces(id);
      CREATE INDEX outcomes_primary_space_index ON outcomes(primary_space_id);
    `,
  },
];
