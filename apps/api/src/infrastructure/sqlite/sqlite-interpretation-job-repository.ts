import Database from "better-sqlite3";

import type {
  InterpretationJob,
  InterpretationJobRepository,
} from "../../features/interpretations/interpretation-worker.js";
import type { Transcription } from "../../features/transcriptions/transcription.js";

interface InterpretationJobRow {
  transcription_id: string;
  capture_id: string;
  source_id: string;
  status: InterpretationJob["status"];
  error: string | null;
  retryable: number;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

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

export class SqliteInterpretationJobRepository implements InterpretationJobRepository {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
  }

  findByTranscriptionId(transcriptionId: string): InterpretationJob | undefined {
    const row = this.database
      .prepare<[string], InterpretationJobRow>(
        "SELECT * FROM interpretation_jobs WHERE transcription_id = ?",
      )
      .get(transcriptionId);
    return row ? toJob(row) : undefined;
  }

  findUnqueuedTranscriptions(): readonly Transcription[] {
    return this.database
      .prepare<[], TranscriptionRow>(
        `SELECT t.* FROM transcriptions t
         LEFT JOIN interpretation_jobs j ON j.transcription_id = t.id
         WHERE t.status = 'succeeded' AND j.transcription_id IS NULL
         ORDER BY t.created_at, t.id`,
      )
      .all()
      .map(toTranscription);
  }

  findRecoverable(maxAttempts: number): readonly InterpretationJob[] {
    return this.database
      .prepare<[number], InterpretationJobRow>(
        `SELECT * FROM interpretation_jobs
         WHERE status != 'succeeded' AND attempt_count < ?
         ORDER BY created_at, transcription_id`,
      )
      .all(maxAttempts)
      .map(toJob);
  }

  findExhaustedProcessing(maxAttempts: number): readonly InterpretationJob[] {
    return this.database
      .prepare<[number], InterpretationJobRow>(
        `SELECT * FROM interpretation_jobs
         WHERE status = 'processing' AND attempt_count >= ?
         ORDER BY created_at, transcription_id`,
      )
      .all(maxAttempts)
      .map(toJob);
  }

  create(transcription: Transcription): InterpretationJob {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT OR IGNORE INTO interpretation_jobs
          (transcription_id, capture_id, source_id, status, error, retryable,
           attempt_count, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', NULL, 1, 0, ?, ?)`,
      )
      .run(transcription.id, transcription.captureId, transcription.sourceId, now, now);
    return this.require(transcription.id);
  }

  markProcessing(transcriptionId: string): InterpretationJob {
    this.database
      .prepare(
        `UPDATE interpretation_jobs
         SET status = 'processing', error = NULL, retryable = 1,
             attempt_count = attempt_count + 1, updated_at = ?
         WHERE transcription_id = ?`,
      )
      .run(new Date().toISOString(), transcriptionId);
    return this.require(transcriptionId);
  }

  complete(transcriptionId: string): InterpretationJob {
    this.database
      .prepare(
        `UPDATE interpretation_jobs
         SET status = 'succeeded', error = NULL, retryable = 0, updated_at = ?
         WHERE transcription_id = ?`,
      )
      .run(new Date().toISOString(), transcriptionId);
    return this.require(transcriptionId);
  }

  fail(transcriptionId: string, error: string, retryable: boolean): InterpretationJob {
    this.database
      .prepare(
        `UPDATE interpretation_jobs
         SET status = 'failed', error = ?, retryable = ?, updated_at = ?
         WHERE transcription_id = ?`,
      )
      .run(error, retryable ? 1 : 0, new Date().toISOString(), transcriptionId);
    return this.require(transcriptionId);
  }

  close(): void {
    this.database.close();
  }

  private require(transcriptionId: string): InterpretationJob {
    const job = this.findByTranscriptionId(transcriptionId);
    if (!job) throw new Error(`Interpretation job not found: ${transcriptionId}`);
    return job;
  }
}

function toJob(row: InterpretationJobRow): InterpretationJob {
  return {
    transcriptionId: row.transcription_id,
    captureId: row.capture_id,
    sourceId: row.source_id,
    status: row.status,
    ...(row.error === null ? {} : { error: row.error }),
    retryable: row.retryable === 1,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
