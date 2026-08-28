import Database from "better-sqlite3";
import type { Entity, EntityType, MetadataItemKind, MetadataLinks, MetadataRepository, Tag } from "../../features/metadata/metadata.js";

interface TagRow { id: string; member_id: string; name: string; created_at: string; }
interface EntityRow { id: string; member_id: string; name: string; type: EntityType; created_at: string; }

export class SqliteMetadataRepository implements MetadataRepository {
  private readonly database: Database.Database;
  constructor(databasePath: string) { this.database = new Database(databasePath); }
  createTag(tag: Tag): Tag { this.database.prepare("INSERT INTO tags (id, member_id, name, created_at) VALUES (?, ?, ?, ?)").run(tag.id, tag.memberId, tag.name, tag.createdAt); return tag; }
  findTag(id: string, memberId: string): Tag | undefined { const row = this.database.prepare<[string, string], TagRow>("SELECT * FROM tags WHERE id = ? AND member_id = ?").get(id, memberId); return row ? toTag(row) : undefined; }
  listTags(memberId: string): readonly Tag[] { return this.database.prepare<[string], TagRow>("SELECT * FROM tags WHERE member_id = ? ORDER BY name ASC, id ASC").all(memberId).map(toTag); }
  updateTag(id: string, memberId: string, name: string): Tag | undefined { const result = this.database.prepare("UPDATE tags SET name = ? WHERE id = ? AND member_id = ?").run(name, id, memberId); return result.changes ? this.findTag(id, memberId) : undefined; }
  createEntity(entity: Entity): Entity { this.database.prepare("INSERT INTO entities (id, member_id, name, type, created_at) VALUES (?, ?, ?, ?, ?)").run(entity.id, entity.memberId, entity.name, entity.type, entity.createdAt); return entity; }
  findEntity(id: string, memberId: string): Entity | undefined { const row = this.database.prepare<[string, string], EntityRow>("SELECT * FROM entities WHERE id = ? AND member_id = ?").get(id, memberId); return row ? toEntity(row) : undefined; }
  listEntities(memberId: string): readonly Entity[] { return this.database.prepare<[string], EntityRow>("SELECT * FROM entities WHERE member_id = ? ORDER BY name ASC, id ASC").all(memberId).map(toEntity); }
  updateEntity(id: string, memberId: string, name: string, type: EntityType): Entity | undefined { const result = this.database.prepare("UPDATE entities SET name = ?, type = ? WHERE id = ? AND member_id = ?").run(name, type, id, memberId); return result.changes ? this.findEntity(id, memberId) : undefined; }
  itemExists(itemId: string, itemKind: MetadataItemKind, memberId: string): boolean { return this.database.prepare<[string, string, string], { found: number}>("SELECT EXISTS (SELECT 1 FROM outcomes WHERE id = ? AND kind = ? AND member_id = ?) AS found").get(itemId, itemKind, memberId)?.found === 1; }
  linkTag(itemId: string, itemKind: MetadataItemKind, tagId: string, memberId: string): void { this.database.prepare("INSERT OR IGNORE INTO item_tags (member_id, item_id, item_kind, tag_id) VALUES (?, ?, ?, ?)").run(memberId, itemId, itemKind, tagId); }
  unlinkTag(itemId: string, itemKind: MetadataItemKind, tagId: string, memberId: string): boolean { return this.database.prepare("DELETE FROM item_tags WHERE member_id = ? AND item_id = ? AND item_kind = ? AND tag_id = ?").run(memberId, itemId, itemKind, tagId).changes > 0; }
  linkEntity(itemId: string, itemKind: MetadataItemKind, entityId: string, memberId: string): void { this.database.prepare("INSERT OR IGNORE INTO item_entities (member_id, item_id, item_kind, entity_id) VALUES (?, ?, ?, ?)").run(memberId, itemId, itemKind, entityId); }
  unlinkEntity(itemId: string, itemKind: MetadataItemKind, entityId: string, memberId: string): boolean { return this.database.prepare("DELETE FROM item_entities WHERE member_id = ? AND item_id = ? AND item_kind = ? AND entity_id = ?").run(memberId, itemId, itemKind, entityId).changes > 0; }
  listLinks(itemId: string, itemKind: MetadataItemKind, memberId: string): MetadataLinks {
    const tags = this.database.prepare<[string, string, string], TagRow>("SELECT t.* FROM tags t JOIN item_tags l ON l.tag_id = t.id WHERE l.member_id = ? AND l.item_id = ? AND l.item_kind = ? ORDER BY t.name ASC, t.id ASC").all(memberId, itemId, itemKind).map(toTag);
    const entities = this.database.prepare<[string, string, string], EntityRow>("SELECT e.* FROM entities e JOIN item_entities l ON l.entity_id = e.id WHERE l.member_id = ? AND l.item_id = ? AND l.item_kind = ? ORDER BY e.name ASC, e.id ASC").all(memberId, itemId, itemKind).map(toEntity);
    return { tags, entities };
  }
  close(): void { this.database.close(); }
}
function toTag(row: TagRow): Tag { return { id: row.id, memberId: row.member_id, name: row.name, createdAt: row.created_at }; }
function toEntity(row: EntityRow): Entity { return { id: row.id, memberId: row.member_id, name: row.name, type: row.type, createdAt: row.created_at }; }
