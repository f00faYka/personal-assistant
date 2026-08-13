import Database from "better-sqlite3";

import type {
  Transcription,
  TranscriptionRepository,
  TranscriptionResult,
} from "../../features/transcriptions/transcription.js";

interface TranscriptionRow {
  id: string;
  capture_id: string;
  source_id: string;
  content_type: string;
  status: Transcription["status"];
  text: string | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

export class SqliteTranscriptionRepository implements TranscriptionRepository {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
  }

  findByCaptureId(captureId: string): Transcription | undefined {
    const row = this.database
      .prepare<[string], TranscriptionRow>("SELECT * FROM transcriptions WHERE capture_id = ?")
      .get(captureId);
    return row ? toTranscription(row) : undefined;
  }

  create(transcription: Transcription): Transcription {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO transcriptions
          (id, capture_id, source_id, content_type, status, attempt_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        transcription.id,
        transcription.captureId,
        transcription.sourceId,
        transcription.contentType,
        transcription.status,
        transcription.attemptCount,
        transcription.createdAt,
        transcription.updatedAt,
      );
    return this.findByCaptureId(transcription.captureId) ?? transcription;
  }

  markProcessing(captureId: string): Transcription {
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE transcriptions
         SET status = 'processing', attempt_count = attempt_count + 1, error = NULL, updated_at = ?
         WHERE capture_id = ?`,
      )
      .run(updatedAt, captureId);
    return this.require(captureId);
  }

  complete(captureId: string, result: TranscriptionResult): Transcription {
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE transcriptions
         SET status = 'succeeded', text = ?, provider = ?, model = ?, error = NULL, updated_at = ?
         WHERE capture_id = ?`,
      )
      .run(result.text, result.provider, result.model, updatedAt, captureId);
    return this.require(captureId);
  }

  fail(captureId: string, error: string): Transcription {
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE transcriptions SET status = 'failed', error = ?, updated_at = ?
         WHERE capture_id = ?`,
      )
      .run(error, updatedAt, captureId);
    return this.require(captureId);
  }

  close(): void {
    this.database.close();
  }

  private require(captureId: string): Transcription {
    const transcription = this.findByCaptureId(captureId);
    if (!transcription) throw new Error(`Transcription not found for Capture: ${captureId}`);
    return transcription;
  }
}

function toTranscription(row: TranscriptionRow): Transcription {
  return {
    id: row.id,
    captureId: row.capture_id,
    sourceId: row.source_id,
    contentType: row.content_type,
    status: row.status,
    ...(row.text === null ? {} : { text: row.text }),
    ...(row.provider === null ? {} : { provider: row.provider }),
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.error === null ? {} : { error: row.error }),
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
