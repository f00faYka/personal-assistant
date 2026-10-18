import Database from "better-sqlite3";

import type { NoteChanges, NoteOutcome, Outcome, OutcomeRepository, TaskChanges, TaskMutationRequest, TaskMutationResult, TaskOutcome, TaskStatusTransition } from "../../features/outcomes/outcome.js";

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

  mutateTask(request: TaskMutationRequest): TaskMutationResult {
    const mutate = this.database.transaction((): TaskMutationResult => {
      const row = this.database
        .prepare<[string, string], OutcomeRow>("SELECT * FROM outcomes WHERE id = ? AND member_id = ? AND kind = 'task'")
        .get(request.taskId, request.memberId);
      if (!row) return { kind: "not_found" };
      const task = toOutcome(row);
      if (task.kind !== "task") return { kind: "not_found" };

      const requestJson = serializeMutationRequest(request);
      const previousOperation = this.database
        .prepare<[string, string, string], { request_json: string; result_task_json: string }>(
          "SELECT request_json, result_task_json FROM task_mutation_operations WHERE member_id = ? AND task_id = ? AND operation_id = ?",
        )
        .get(request.memberId, request.taskId, request.operationId);
      if (previousOperation) {
        if (previousOperation.request_json !== requestJson) return { kind: "operation_mismatch" };
        return { kind: "applied", task: JSON.parse(previousOperation.result_task_json) as TaskOutcome };
      }

      if (task.version !== request.expectedVersion) return { kind: "version_conflict", task };

      let updated = task;
      let transition: TaskStatusTransition | undefined;
      switch (request.mutation.kind) {
        case "edit": {
          const changes = request.mutation.changes;
          const fields: string[] = [];
          const values: Array<string | number | null> = [];
          if ("title" in changes) { fields.push("title = ?"); values.push(changes.title ?? null); }
          if ("dueAt" in changes) { fields.push("due_at = ?"); values.push(changes.dueAt ?? null); }
          fields.push("version = version + 1");
          this.database
            .prepare(`UPDATE outcomes SET ${fields.join(", ")} WHERE id = ? AND member_id = ? AND version = ? AND kind = 'task'`)
            .run(...values, request.taskId, request.memberId, request.expectedVersion);
          const editedTask = this.findById(request.taskId);
          if (!editedTask || editedTask.kind !== "task") throw new Error(`Task disappeared during mutation: ${request.taskId}`);
          updated = editedTask;
          break;
        }
        case "complete":
          if (task.status === "open") {
            updated = this.updateStatus(task, request, "completed");
            transition = createTransition(task, updated, request);
          }
          break;
        case "reopen":
          if (task.status === "completed") {
            updated = this.updateStatus(task, request, "open");
            transition = createTransition(task, updated, request);
          }
          break;
      }

      if (transition) {
        this.database.prepare(
          `INSERT INTO task_status_transitions
            (task_id, member_id, actor_member_id, from_status, to_status, operation_id, resulting_version, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(transition.taskId, transition.memberId, transition.actorMemberId, transition.from, transition.to, transition.operationId, transition.resultingVersion, transition.occurredAt);
      }
      this.database.prepare(
        `INSERT INTO task_mutation_operations
          (member_id, task_id, operation_id, operation_type, request_json, result_task_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(request.memberId, request.taskId, request.operationId, request.mutation.kind, requestJson, JSON.stringify(updated), request.occurredAt);
      return { kind: "applied", task: updated };
    });
    return mutate();
  }

  listTaskStatusHistory(taskId: string, memberId: string): readonly TaskStatusTransition[] {
    return this.database.prepare<[string, string], TransitionRow>(
      `SELECT task_id, member_id, actor_member_id, from_status, to_status, operation_id, resulting_version, occurred_at
       FROM task_status_transitions WHERE task_id = ? AND member_id = ? ORDER BY resulting_version ASC`,
    ).all(taskId, memberId).map((row) => ({
      taskId: row.task_id,
      memberId: row.member_id,
      actorMemberId: row.actor_member_id,
      from: row.from_status,
      to: row.to_status,
      operationId: row.operation_id,
      resultingVersion: row.resulting_version,
      occurredAt: row.occurred_at,
    }));
  }

  private updateStatus(task: TaskOutcome, request: TaskMutationRequest, status: TaskOutcome["status"]): TaskOutcome {
    this.database.prepare(
      "UPDATE outcomes SET status = ?, version = version + 1 WHERE id = ? AND member_id = ? AND version = ? AND kind = 'task'",
    ).run(status, task.id, request.memberId, request.expectedVersion);
    const updated = this.findById(task.id);
    if (!updated || updated.kind !== "task") throw new Error(`Task disappeared during mutation: ${task.id}`);
    return updated;
  }

  updateNote(
    noteId: string,
    memberId: string,
    expectedVersion: number,
    changes: NoteChanges,
  ): NoteOutcome | undefined {
    const fields: string[] = [];
    const values: Array<string | number> = [];
    if ("content" in changes) {
      fields.push("content = ?");
      values.push(changes.content!);
    }
    if ("reviewState" in changes) {
      fields.push("review_state = ?");
      values.push(changes.reviewState!);
    }
    if (fields.length === 0) return undefined;
    fields.push("version = version + 1");
    const result = this.database
      .prepare(`UPDATE outcomes SET ${fields.join(", ")} WHERE id = ? AND member_id = ? AND version = ? AND kind = 'note'`)
      .run(...values, noteId, memberId, expectedVersion);
    if (result.changes === 0) return undefined;
    const outcome = this.findById(noteId);
    return outcome?.kind === "note" ? outcome : undefined;
  }

  convertNoteToTask(noteId: string, memberId: string, expectedVersion: number): TaskOutcome | undefined {
    const convert = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE outcomes
           SET kind = 'task', title = content, content = NULL, review_state = NULL,
               status = 'open', due_at = NULL, version = version + 1
           WHERE id = ? AND member_id = ? AND version = ? AND kind = 'note'`,
        )
        .run(noteId, memberId, expectedVersion);
      if (result.changes === 0) return undefined;

      this.database
        .prepare(
          "UPDATE item_tags SET item_kind = 'task' WHERE member_id = ? AND item_id = ? AND item_kind = 'note'",
        )
        .run(memberId, noteId);
      this.database
        .prepare(
          "UPDATE item_entities SET item_kind = 'task' WHERE member_id = ? AND item_id = ? AND item_kind = 'note'",
        )
        .run(memberId, noteId);

      const outcome = this.findById(noteId);
      return outcome?.kind === "task" ? outcome : undefined;
    });
    return convert();
  }

  close(): void {
    if (this.database.open) this.database.close();
  }
}

interface TransitionRow {
  task_id: string;
  member_id: string;
  actor_member_id: string;
  from_status: TaskStatusTransition["from"];
  to_status: TaskStatusTransition["to"];
  operation_id: string;
  resulting_version: number;
  occurred_at: string;
}

function createTransition(task: TaskOutcome, updated: TaskOutcome, request: TaskMutationRequest): TaskStatusTransition {
  return {
    taskId: task.id,
    memberId: task.memberId,
    actorMemberId: request.memberId,
    from: task.status,
    to: updated.status,
    operationId: request.operationId,
    resultingVersion: updated.version,
    occurredAt: request.occurredAt,
  };
}

function serializeMutationRequest(request: TaskMutationRequest): string {
  if (request.mutation.kind !== "edit") {
    return JSON.stringify({ kind: request.mutation.kind, expectedVersion: request.expectedVersion });
  }
  const { changes } = request.mutation;
  return JSON.stringify({
    kind: "edit",
    expectedVersion: request.expectedVersion,
    changes: {
      ...(changes.title === undefined ? {} : { title: changes.title }),
      ...(changes.dueAt === undefined ? {} : { dueAt: changes.dueAt }),
    },
  });
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
    version: row.version,
    createdAt: row.created_at,
  };
}
