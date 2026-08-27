import Database from "better-sqlite3";

import type { ListCursor, ListRow, MemberItemsRepository } from "../../features/items/items.js";

export class SqliteMemberItemsRepository implements MemberItemsRepository {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
  }

  list(memberId: string, cursor: ListCursor | undefined, limit: number): readonly ListRow[] {
    const select = `SELECT c.id AS captureId, c.member_id AS memberId, c.created_at AS createdAt, c.storage_state AS captureState,
      tr.status AS transcriptionStatus, tr.error AS transcriptionError,
      ij.status AS interpretationStatus,
      o.kind AS outcomeKind, o.id AS outcomeId, o.title, o.due_at AS dueAt,
      o.status AS taskStatus, o.content, o.review_state AS noteState, o.primary_space_id AS primarySpaceId
      FROM captures c LEFT JOIN transcriptions tr ON tr.capture_id = c.id
      LEFT JOIN interpretation_jobs ij ON ij.transcription_id = tr.id
      LEFT JOIN interpretations i ON i.transcription_id = tr.id
      LEFT JOIN outcomes o ON o.interpretation_id = i.id`;
    const result = cursor === undefined
      ? this.database.prepare<[string, number], ListRow>(`${select} WHERE c.member_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(memberId, limit)
      : this.database.prepare<[string, string, string, string, number], ListRow>(`${select}
          WHERE c.member_id = ? AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))
          ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(memberId, cursor.createdAt, cursor.createdAt, cursor.captureId, limit);
    return result;
  }

  close(): void {
    this.database.close();
  }
}
