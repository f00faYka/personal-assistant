import Database from "better-sqlite3";

import type { OfflineDraft, OfflineDraftRepository } from "../../features/offline-drafts/offline-draft.js";

interface OfflineDraftRow {
  draft_id: string;
  member_id: string;
  captured_at: string;
  time_zone: string;
  source_kind: "audio" | "text";
  content_type: string | null;
  text: string | null;
  source_sha256: string;
  status: "accepted" | "failed";
  capture_id: string | null;
  error: string | null;
  retryable: number;
  created_at: string;
  updated_at: string;
}

export class SqliteOfflineDraftRepository implements OfflineDraftRepository {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
  }

  find(memberId: string, draftId: string): OfflineDraft | undefined {
    const row = this.database.prepare<[string, string], OfflineDraftRow>("SELECT * FROM offline_drafts WHERE member_id = ? AND draft_id = ?").get(memberId, draftId);
    return row ? toDraft(row) : undefined;
  }

  create(draft: OfflineDraft): OfflineDraft {
    this.database.prepare(`INSERT OR IGNORE INTO offline_drafts
      (draft_id, member_id, captured_at, time_zone, source_kind, content_type, text, source_sha256, status, capture_id, error, retryable, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      draft.draftId, draft.memberId, draft.capturedAt, draft.timeZone, draft.sourceKind, draft.contentType ?? null, draft.text ?? null,
      draft.sourceSha256, draft.status, draft.captureId ?? null, draft.error ?? null, draft.retryable ? 1 : 0, draft.createdAt, draft.updatedAt,
    );
    return this.find(draft.memberId, draft.draftId) ?? draft;
  }

  update(memberId: string, draftId: string, changes: Pick<OfflineDraft, "status" | "captureId" | "error" | "retryable" | "updatedAt">): OfflineDraft {
    this.database.prepare("UPDATE offline_drafts SET status = ?, capture_id = ?, error = ?, retryable = ?, updated_at = ? WHERE member_id = ? AND draft_id = ?").run(
      changes.status, changes.captureId ?? null, changes.error ?? null, changes.retryable ? 1 : 0, changes.updatedAt, memberId, draftId,
    );
    const row = this.database.prepare<[string, string], OfflineDraftRow>("SELECT * FROM offline_drafts WHERE member_id = ? AND draft_id = ?").get(memberId, draftId);
    if (!row) throw new Error(`Offline draft not found: ${draftId}`);
    return toDraft(row);
  }

  close(): void {
    this.database.close();
  }
}

function toDraft(row: OfflineDraftRow): OfflineDraft {
  return {
    draftId: row.draft_id,
    memberId: row.member_id,
    capturedAt: row.captured_at,
    timeZone: row.time_zone,
    sourceKind: row.source_kind,
    ...(row.content_type === null ? {} : { contentType: row.content_type }),
    ...(row.text === null ? {} : { text: row.text }),
    sourceSha256: row.source_sha256,
    status: row.status,
    ...(row.capture_id === null ? {} : { captureId: row.capture_id }),
    ...(row.error === null ? {} : { error: row.error }),
    retryable: row.retryable === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
