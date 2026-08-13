import Database from "better-sqlite3";

import type { Capture, CaptureRepository } from "../../features/captures/capture.js";

interface CaptureRow {
  id: string;
  source_id: string;
  member_id: string;
  idempotency_key: string;
  content_type: string;
  byte_length: number;
  content_sha256: string;
  captured_at: string;
  created_at: string;
  storage_state: "pending" | "stored";
}

export class SqliteCaptureRepository implements CaptureRepository {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
  }

  findByIdempotencyKey(memberId: string, idempotencyKey: string): Capture | undefined {
    const row = this.database
      .prepare<[string, string], CaptureRow>(
        "SELECT * FROM captures WHERE member_id = ? AND idempotency_key = ?",
      )
      .get(memberId, idempotencyKey);
    return row ? toCapture(row) : undefined;
  }

  findById(id: string): Capture | undefined {
    const row = this.database
      .prepare<[string], CaptureRow>("SELECT * FROM captures WHERE id = ?")
      .get(id);
    return row ? toCapture(row) : undefined;
  }

  create(capture: Capture): Capture {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO captures
          (id, source_id, member_id, idempotency_key, content_type, byte_length, content_sha256, captured_at, created_at, storage_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        capture.id,
        capture.sourceId,
        capture.memberId,
        capture.idempotencyKey,
        capture.contentType,
        capture.byteLength,
        capture.contentSha256,
        capture.capturedAt,
        capture.createdAt,
        capture.storageState,
      );
    return this.findByIdempotencyKey(capture.memberId, capture.idempotencyKey) ?? capture;
  }

  markStored(id: string): void {
    this.database.prepare("UPDATE captures SET storage_state = 'stored' WHERE id = ?").run(id);
  }

  close(): void {
    this.database.close();
  }
}

function toCapture(row: CaptureRow): Capture {
  return {
    id: row.id,
    sourceId: row.source_id,
    memberId: row.member_id,
    idempotencyKey: row.idempotency_key,
    contentType: row.content_type,
    byteLength: row.byte_length,
    contentSha256: row.content_sha256,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    storageState: row.storage_state,
  };
}
