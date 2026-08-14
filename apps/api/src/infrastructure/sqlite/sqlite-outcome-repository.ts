import Database from "better-sqlite3";

import type { NoteOutcome, Outcome, OutcomeRepository, TaskChanges, TaskOutcome } from "../../features/outcomes/outcome.js";

interface OutcomeRow {
  id: string;
  kind: Outcome["kind"];
  member_id: string;
  interpretation_id: string;
  capture_id: string;
  source_id: string;
  title: string | null;
  due_at: string | null;
  status: "open" | "completed" | null;
  version: number;
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

  findById(id: string): Outcome | undefined {
    const row = this.database.prepare<[string], OutcomeRow>("SELECT * FROM outcomes WHERE id = ?").get(id);
    return row ? toOutcome(row) : undefined;
  }

  create(outcome: Outcome): Outcome {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO outcomes
          (id, kind, member_id, interpretation_id, capture_id, source_id, title, due_at,
           status, content, review_state, created_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        outcome.kind === "task" ? outcome.version : 0,
      );
    return this.findByInterpretationId(outcome.interpretationId) ?? outcome;
  }

  updateTask(
    taskId: string,
    memberId: string,
    expectedVersion: number,
    changes: TaskChanges,
  ): TaskOutcome | undefined {
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    if ("title" in changes) {
      fields.push("title = ?");
      values.push(changes.title ?? null);
    }
    if ("dueAt" in changes) {
      fields.push("due_at = ?");
      values.push(changes.dueAt ?? null);
    }
    if ("status" in changes) {
      fields.push("status = ?");
      values.push(changes.status ?? null);
    }
    if (fields.length === 0) return undefined;
    fields.push("version = version + 1");
    const result = this.database
      .prepare(`UPDATE outcomes SET ${fields.join(", ")} WHERE id = ? AND member_id = ? AND version = ? AND kind = 'task' AND status = 'open'`)
      .run(...values, taskId, memberId, expectedVersion);
    if (result.changes === 0) return undefined;
    const outcome = this.findById(taskId);
    return outcome?.kind === "task" ? outcome : undefined;
  }

  close(): void {
    this.database.close();
  }
}

function toOutcome(row: OutcomeRow): Outcome {
  if (row.kind === "task") {
    if (row.title === null || row.status === null) throw new Error(`Invalid Task outcome: ${row.id}`);
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
      version: row.version,
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
