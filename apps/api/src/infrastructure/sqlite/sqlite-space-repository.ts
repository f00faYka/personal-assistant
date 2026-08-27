import Database from "better-sqlite3";
import type { Space, SpaceAssignment, SpaceItem, SpaceRepository } from "../../features/spaces/space.js";

interface SpaceRow { id: string; member_id: string; name: string; parent_space_id: string | null; created_at: string; }

export class SqliteSpaceRepository implements SpaceRepository {
  private readonly database: Database.Database;
  constructor(databasePath: string) { this.database = new Database(databasePath); }

  create(space: Space): Space {
    this.database.prepare("INSERT INTO spaces (id, member_id, name, parent_space_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(space.id, space.memberId, space.name, space.parentId ?? null, space.createdAt);
    return space;
  }

  list(memberId: string): readonly Space[] {
    return this.database.prepare<[string], SpaceRow>("SELECT * FROM spaces WHERE member_id = ? ORDER BY created_at ASC, id ASC").all(memberId).map(toSpace);
  }

  findById(id: string, memberId: string): Space | undefined {
    const row = this.database.prepare<[string, string], SpaceRow>("SELECT * FROM spaces WHERE id = ? AND member_id = ?").get(id, memberId);
    return row ? toSpace(row) : undefined;
  }

  hasDescendant(spaceId: string, possibleDescendantId: string, memberId: string): boolean {
    const row = this.database.prepare<[string, string, string, string], { found: number }>(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM spaces WHERE id = ? AND member_id = ?
        UNION ALL SELECT s.id FROM spaces s JOIN descendants d ON s.parent_space_id = d.id WHERE s.member_id = ?
      ) SELECT EXISTS (SELECT 1 FROM descendants WHERE id = ?) AS found`).get(spaceId, memberId, memberId, possibleDescendantId);
    return row?.found === 1;
  }

  assign(itemId: string, itemKind: SpaceItem, memberId: string, spaceId: string | null): SpaceAssignment | undefined {
    const result = this.database.prepare<[string | null, string, string, string]>(
      "UPDATE outcomes SET primary_space_id = ? WHERE id = ? AND member_id = ? AND kind = ?",
    ).run(spaceId, itemId, memberId, itemKind);
    return result.changes === 0 ? undefined : { itemId, itemKind, spaceId };
  }

  close(): void { this.database.close(); }
}

function toSpace(row: SpaceRow): Space {
  return { id: row.id, memberId: row.member_id, name: row.name, ...(row.parent_space_id === null ? {} : { parentId: row.parent_space_id }), createdAt: row.created_at };
}
