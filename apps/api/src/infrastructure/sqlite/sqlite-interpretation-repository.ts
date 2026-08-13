import Database from "better-sqlite3";

import type {
  Interpretation,
  InterpretationAction,
  InterpretationClassification,
  InterpretationRepository,
} from "../../features/interpretations/interpretation.js";

interface InterpretationRow {
  id: string;
  capture_id: string;
  source_id: string;
  transcription_id: string;
  catalog_version: string;
  model: string;
  raw_output_json: string;
  classification: InterpretationClassification;
  action_json: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export class SqliteInterpretationRepository implements InterpretationRepository {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
  }

  findByTranscriptionId(transcriptionId: string): Interpretation | undefined {
    const row = this.database
      .prepare<[string], InterpretationRow>(
        "SELECT * FROM interpretations WHERE transcription_id = ?",
      )
      .get(transcriptionId);
    return row ? toInterpretation(row) : undefined;
  }

  create(interpretation: Interpretation): Interpretation {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO interpretations
          (id, capture_id, source_id, transcription_id, catalog_version, model,
           raw_output_json, classification, action_json, rejection_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        interpretation.id,
        interpretation.captureId,
        interpretation.sourceId,
        interpretation.transcriptionId,
        interpretation.catalogVersion,
        interpretation.model,
        interpretation.rawOutputJson,
        interpretation.classification,
        interpretation.action === undefined ? null : JSON.stringify(interpretation.action),
        interpretation.rejectionReason ?? null,
        interpretation.createdAt,
      );
    return this.findByTranscriptionId(interpretation.transcriptionId) ?? interpretation;
  }

  close(): void {
    this.database.close();
  }
}

function toInterpretation(row: InterpretationRow): Interpretation {
  const action = row.action_json === null ? undefined : JSON.parse(row.action_json) as InterpretationAction;
  return {
    id: row.id,
    captureId: row.capture_id,
    sourceId: row.source_id,
    transcriptionId: row.transcription_id,
    catalogVersion: row.catalog_version,
    model: row.model,
    rawOutputJson: row.raw_output_json,
    classification: row.classification,
    ...(action === undefined ? {} : { action }),
    ...(row.rejection_reason === null ? {} : { rejectionReason: row.rejection_reason }),
    createdAt: row.created_at,
  };
}
