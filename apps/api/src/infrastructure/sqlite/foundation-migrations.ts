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
  {
    version: 12,
    name: "support Space lifecycle",
    sql: "ALTER TABLE spaces ADD COLUMN archived_at TEXT",
  },
  {
    version: 13,
    name: "create Tags and Entities",
    sql: `
      CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        created_at TEXT NOT NULL,
        UNIQUE (member_id, name)
      ) STRICT;
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        member_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        type TEXT NOT NULL CHECK (type IN ('Person', 'Place', 'Organization', 'Object')),
        created_at TEXT NOT NULL,
        UNIQUE (member_id, name, type)
      ) STRICT;
      CREATE TABLE item_tags (
        member_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_kind TEXT NOT NULL CHECK (item_kind IN ('task', 'note')),
        tag_id TEXT NOT NULL REFERENCES tags(id),
        PRIMARY KEY (member_id, item_id, item_kind, tag_id)
      ) STRICT;
      CREATE TABLE item_entities (
        member_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_kind TEXT NOT NULL CHECK (item_kind IN ('task', 'note')),
        entity_id TEXT NOT NULL REFERENCES entities(id),
        PRIMARY KEY (member_id, item_id, item_kind, entity_id)
      ) STRICT;
      CREATE INDEX item_tags_item_index ON item_tags(member_id, item_id, item_kind);
      CREATE INDEX item_entities_item_index ON item_entities(member_id, item_id, item_kind);
    `,
  },
  {
    version: 14,
    name: "create organization proposals",
    sql: `
      CREATE TABLE organization_proposals (
        id TEXT PRIMARY KEY, member_id TEXT NOT NULL, item_id TEXT NOT NULL,
        item_kind TEXT NOT NULL CHECK (item_kind IN ('task', 'note')),
        idempotency_key TEXT NOT NULL, model_version TEXT NOT NULL, rules_version TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'dismissed')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (member_id, idempotency_key)
      ) STRICT;
      CREATE TABLE organization_proposal_candidates (
        id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES organization_proposals(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('space', 'tag', 'entity')), confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        confidence_band TEXT NOT NULL CHECK (confidence_band IN ('high', 'medium', 'low')),
        target_id TEXT, suggested_name TEXT, entity_type TEXT, provenance_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'dismissed')),
        CHECK (target_id IS NOT NULL OR suggested_name IS NOT NULL)
      ) STRICT;
      CREATE TABLE suggested_organization_metadata (
        id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES organization_proposals(id) ON DELETE CASCADE,
        candidate_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK (kind IN ('tag', 'entity')),
        name TEXT NOT NULL, entity_type TEXT, created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX organization_proposals_item_index ON organization_proposals(member_id, item_id, item_kind);
    `,
  },
  {
    version: 15,
    name: "persist capture device time zone",
    sql: "ALTER TABLE captures ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC'",
  },
  {
    version: 16,
    name: "persist Offline draft device time zone",
    sql: "ALTER TABLE offline_drafts ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC'",
  },
  {
    version: 17,
    name: "persist Task mutation operations and status history",
    sql: `
      CREATE TABLE task_mutation_operations (
        member_id TEXT NOT NULL,
        task_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL,
        operation_type TEXT NOT NULL CHECK (operation_type IN ('edit', 'complete', 'reopen')),
        request_json TEXT NOT NULL,
        result_task_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (member_id, task_id, operation_id)
      ) STRICT;
      CREATE TABLE task_status_transitions (
        task_id TEXT NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
        member_id TEXT NOT NULL,
        actor_member_id TEXT NOT NULL,
        from_status TEXT NOT NULL CHECK (from_status IN ('open', 'completed')),
        to_status TEXT NOT NULL CHECK (to_status IN ('open', 'completed')),
        operation_id TEXT NOT NULL,
        resulting_version INTEGER NOT NULL CHECK (resulting_version >= 0),
        occurred_at TEXT NOT NULL,
        PRIMARY KEY (member_id, task_id, operation_id),
        CHECK (from_status <> to_status)
      ) STRICT;
      CREATE INDEX task_status_transitions_history_index
        ON task_status_transitions(member_id, task_id, resulting_version)
    `,
  },
  {
    version: 18,
    name: "persist organization proposal generation jobs",
    sql: `
      CREATE TABLE organization_proposal_jobs (
        member_id TEXT NOT NULL, item_id TEXT NOT NULL, item_kind TEXT NOT NULL CHECK (item_kind IN ('task', 'note')),
        item_text TEXT NOT NULL, transcription_text TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
        error TEXT, retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (member_id, item_id)
      ) STRICT;
      CREATE INDEX organization_proposal_jobs_recovery_index ON organization_proposal_jobs(status, retryable, created_at)
    `,
  },
];
