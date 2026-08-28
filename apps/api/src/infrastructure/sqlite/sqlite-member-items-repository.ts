import Database from "better-sqlite3";

import type { ListCursor, ListRow, MemberItemsRepository, SearchCursor, SearchFilters, SearchRepository, SearchRow } from "../../features/items/items.js";

export class SqliteMemberItemsRepository implements MemberItemsRepository, SearchRepository {
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

  search(memberId: string, filters: SearchFilters, cursor: SearchCursor | undefined, limit: number): readonly SearchRow[] {
    const conditions = ["o.member_id = ?", "o.kind IN ('task', 'note')"];
    const parameters: Array<string | number> = [memberId];
    if (filters.unassigned) {
      conditions.push("o.primary_space_id IS NULL");
    } else if (filters.spaceId !== undefined) {
      conditions.push(`o.primary_space_id IN (
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM spaces WHERE id = ? AND member_id = ?
          UNION ALL
          SELECT s.id FROM spaces s JOIN subtree child ON s.parent_space_id = child.id WHERE s.member_id = ?
        ) SELECT id FROM subtree
      )`);
      parameters.push(filters.spaceId, memberId, memberId);
    }
    if (filters.tagId !== undefined) {
      conditions.push("EXISTS (SELECT 1 FROM item_tags l JOIN tags t ON t.id = l.tag_id AND t.member_id = l.member_id WHERE l.member_id = o.member_id AND l.item_id = o.id AND l.item_kind = o.kind AND l.tag_id = ?)");
      parameters.push(filters.tagId);
    }
    if (filters.entityId !== undefined) {
      conditions.push("EXISTS (SELECT 1 FROM item_entities l JOIN entities e ON e.id = l.entity_id AND e.member_id = l.member_id WHERE l.member_id = o.member_id AND l.item_id = o.id AND l.item_kind = o.kind AND l.entity_id = ?)");
      parameters.push(filters.entityId);
    }
    if (filters.text === undefined && cursor !== undefined) {
      conditions.push("(o.created_at < ? OR (o.created_at = ? AND o.id < ?))");
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.itemId);
    }
    const sql = `SELECT o.id AS itemId, o.kind AS itemKind, o.capture_id AS captureId, o.created_at AS createdAt,
      o.title, o.content, o.due_at AS dueAt, o.status AS taskStatus, o.review_state AS noteState,
      o.primary_space_id AS primarySpaceId FROM outcomes o WHERE ${conditions.join(" AND ")}
      ORDER BY o.created_at DESC, o.id DESC${filters.text === undefined ? " LIMIT ?" : ""}`;
    if (filters.text === undefined) {
      parameters.push(limit);
      return this.database.prepare<Array<string | number>, SearchRow>(sql).all(...parameters);
    }

    const rows = this.database.prepare<Array<string | number>, SearchRow>(sql).all(...parameters);
    const searchText = foldSearchText(filters.text);
    return rows
      .filter((row) => foldSearchText(row.itemKind === "task" ? row.title ?? "" : row.content ?? "").includes(searchText))
      .filter((row) => cursor === undefined || row.createdAt < cursor.createdAt || (row.createdAt === cursor.createdAt && row.itemId < cursor.itemId))
      .slice(0, limit);
  }

  close(): void {
    this.database.close();
  }
}

function foldSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und");
}
