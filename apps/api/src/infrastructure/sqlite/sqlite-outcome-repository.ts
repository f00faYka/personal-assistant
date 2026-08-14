import Database from "better-sqlite3";

import type { NoteOutcome, Outcome, OutcomeRepository, TaskOutcome } from "../../features/outcomes/outcome.js";

interface OutcomeRow {
  id: string;
  kind: Outcome["kind"];
  member_id: string;
  interpretation_id: string;
  capture_id: string;
  source_id: string;
  title: string | null;
  due_at: string | null;
  status: "open" | null;
  content: string | null;
  review_state: NoteOutcome["reviewState"] | null;
  created_at: string;
}

export class SqliteOutcomeRepository implements OutcomeRepository {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
  }

  findByInterpretationId(interpretationId: string): Outcome | undefined {
    const row = this.database
      .prepare<[string], OutcomeRow>("SELECT * FROM outcomes WHERE interpretation_id = ?")
      .get(interpretationId);
    return row ? toOutcome(row) : undefined;
  }

  create(outcome: Outcome): Outcome {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO outcomes
          (id, kind, member_id, interpretation_id, capture_id, source_id, title, due_at,
           status, content, review_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        outcome.id,
        outcome.kind,
        outcome.memberId,
        outcome.interpretationId,
        outcome.captureId,
        outcome.sourceId,
        outcome.kind === "task" ? outcome.title : null,
        outcome.kind === "task" ? outcome.dueAt ?? null : null,
        outcome.kind === "task" ? outcome.status : null,
        outcome.kind === "note" ? outcome.content : null,
        outcome.kind === "note" ? outcome.reviewState : null,
        outcome.createdAt,
      );
    return this.findByInterpretationId(outcome.interpretationId) ?? outcome;
  }

  close(): void {
    this.database.close();
  }
}

function toOutcome(row: OutcomeRow): Outcome {
  if (row.kind === "task") {
    if (row.title === null || row.status !== "open") throw new Error(`Invalid Task outcome: ${row.id}`);
    const task: TaskOutcome = {
      kind: "task",
      id: row.id,
      memberId: row.member_id,
      interpretationId: row.interpretation_id,
      captureId: row.capture_id,
      sourceId: row.source_id,
      title: row.title,
      ...(row.due_at === null ? {} : { dueAt: row.due_at }),
      status: row.status,
      createdAt: row.created_at,
    };
    return task;
  }
  if (row.content === null || row.review_state === null) throw new Error(`Invalid Note outcome: ${row.id}`);
  return {
    kind: "note",
    id: row.id,
    memberId: row.member_id,
    interpretationId: row.interpretation_id,
    captureId: row.capture_id,
    sourceId: row.source_id,
    content: row.content,
    reviewState: row.review_state,
    createdAt: row.created_at,
  };
}
