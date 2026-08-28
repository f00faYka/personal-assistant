import { randomUUID } from "node:crypto";

export const entityTypes = ["Person", "Place", "Organization", "Object"] as const;
export type EntityType = (typeof entityTypes)[number];
export type MetadataItemKind = "task" | "note";

export interface Tag { readonly id: string; readonly memberId: string; readonly name: string; readonly createdAt: string; }
export interface Entity { readonly id: string; readonly memberId: string; readonly name: string; readonly type: EntityType; readonly createdAt: string; }
export interface MetadataLinks { readonly tags: readonly Tag[]; readonly entities: readonly Entity[]; }

export interface MetadataRepository {
  createTag(tag: Tag): Tag;
  findTag(id: string, memberId: string): Tag | undefined;
  listTags(memberId: string): readonly Tag[];
  updateTag(id: string, memberId: string, name: string): Tag | undefined;
  createEntity(entity: Entity): Entity;
  findEntity(id: string, memberId: string): Entity | undefined;
  listEntities(memberId: string): readonly Entity[];
  updateEntity(id: string, memberId: string, name: string, type: EntityType): Entity | undefined;
  itemExists(itemId: string, itemKind: MetadataItemKind, memberId: string): boolean;
  linkTag(itemId: string, itemKind: MetadataItemKind, tagId: string, memberId: string): void;
  unlinkTag(itemId: string, itemKind: MetadataItemKind, tagId: string, memberId: string): boolean;
  linkEntity(itemId: string, itemKind: MetadataItemKind, entityId: string, memberId: string): void;
  unlinkEntity(itemId: string, itemKind: MetadataItemKind, entityId: string, memberId: string): boolean;
  listLinks(itemId: string, itemKind: MetadataItemKind, memberId: string): MetadataLinks;
}

export class InvalidMetadataOperationError extends Error { constructor(message: string) { super(message); this.name = "InvalidMetadataOperationError"; } }
export class MetadataResourceNotFoundError extends Error { constructor(kind: string, id: string) { super(`${kind} not found: ${id}`); this.name = "MetadataResourceNotFoundError"; } }
export class MetadataDuplicateError extends Error { constructor(message: string) { super(message); this.name = "MetadataDuplicateError"; } }

export class MetadataService {
  constructor(private readonly repository: MetadataRepository) {}

  createTag(memberId: string, name: string): Tag {
    this.requireMember(memberId); const normalized = this.name(name);
    if (this.repository.listTags(memberId).some((tag) => tag.name === normalized)) throw new MetadataDuplicateError("Tag already exists for this Member");
    return this.repository.createTag({ id: randomUUID(), memberId, name: normalized, createdAt: new Date().toISOString() });
  }
  listTags(memberId: string): readonly Tag[] { this.requireMember(memberId); return this.repository.listTags(memberId); }
  updateTag(id: string, memberId: string, name: string): Tag {
    this.requireMember(memberId); this.requireTag(id, memberId); const normalized = this.name(name);
    if (this.repository.listTags(memberId).some((tag) => tag.id !== id && tag.name === normalized)) throw new MetadataDuplicateError("Tag already exists for this Member");
    return this.repository.updateTag(id, memberId, normalized) ?? this.missing("Tag", id);
  }

  createEntity(memberId: string, name: string, type: EntityType): Entity {
    this.requireMember(memberId); const normalized = this.name(name); this.requireType(type);
    if (this.repository.listEntities(memberId).some((entity) => entity.name === normalized && entity.type === type)) throw new MetadataDuplicateError("Entity already exists for this Member");
    return this.repository.createEntity({ id: randomUUID(), memberId, name: normalized, type, createdAt: new Date().toISOString() });
  }
  listEntities(memberId: string): readonly Entity[] { this.requireMember(memberId); return this.repository.listEntities(memberId); }
  updateEntity(id: string, memberId: string, name: string, type: EntityType): Entity {
    this.requireMember(memberId); this.requireEntity(id, memberId); const normalized = this.name(name); this.requireType(type);
    if (this.repository.listEntities(memberId).some((entity) => entity.id !== id && entity.name === normalized && entity.type === type)) throw new MetadataDuplicateError("Entity already exists for this Member");
    return this.repository.updateEntity(id, memberId, normalized, type) ?? this.missing("Entity", id);
  }

  linkTag(itemId: string, itemKind: MetadataItemKind, memberId: string, tagId: string): MetadataLinks { this.requireItem(itemId, itemKind, memberId); this.requireTag(tagId, memberId); this.repository.linkTag(itemId, itemKind, tagId, memberId); return this.links(itemId, itemKind, memberId); }
  unlinkTag(itemId: string, itemKind: MetadataItemKind, memberId: string, tagId: string): MetadataLinks { this.requireItem(itemId, itemKind, memberId); this.requireTag(tagId, memberId); this.repository.unlinkTag(itemId, itemKind, tagId, memberId); return this.links(itemId, itemKind, memberId); }
  linkEntity(itemId: string, itemKind: MetadataItemKind, memberId: string, entityId: string): MetadataLinks { this.requireItem(itemId, itemKind, memberId); this.requireEntity(entityId, memberId); this.repository.linkEntity(itemId, itemKind, entityId, memberId); return this.links(itemId, itemKind, memberId); }
  unlinkEntity(itemId: string, itemKind: MetadataItemKind, memberId: string, entityId: string): MetadataLinks { this.requireItem(itemId, itemKind, memberId); this.requireEntity(entityId, memberId); this.repository.unlinkEntity(itemId, itemKind, entityId, memberId); return this.links(itemId, itemKind, memberId); }
  listLinks(itemId: string, itemKind: MetadataItemKind, memberId: string): MetadataLinks { this.requireItem(itemId, itemKind, memberId); return this.links(itemId, itemKind, memberId); }

  private links(itemId: string, itemKind: MetadataItemKind, memberId: string): MetadataLinks { return this.repository.listLinks(itemId, itemKind, memberId); }
  private requireItem(id: string, kind: MetadataItemKind, memberId: string): void { this.requireMember(memberId); if (kind !== "task" && kind !== "note") throw new InvalidMetadataOperationError("invalid item kind"); if (!this.repository.itemExists(id, kind, memberId)) throw new MetadataResourceNotFoundError(kind === "task" ? "Task" : "Note", id); }
  private requireTag(id: string, memberId: string): Tag { return this.repository.findTag(id, memberId) ?? this.missing("Tag", id); }
  private requireEntity(id: string, memberId: string): Entity { return this.repository.findEntity(id, memberId) ?? this.missing("Entity", id); }
  private requireMember(memberId: string): void { if (!memberId.trim()) throw new InvalidMetadataOperationError("memberId is required"); }
  private name(value: string): string { const name = value.trim(); if (!name) throw new InvalidMetadataOperationError("name must not be empty"); if (name.length > 200) throw new InvalidMetadataOperationError("name must be 200 characters or fewer"); return name; }
  private requireType(type: EntityType): void { if (!entityTypes.includes(type)) throw new InvalidMetadataOperationError("invalid Entity type"); }
  private missing(kind: string, id: string): never { throw new MetadataResourceNotFoundError(kind, id); }
}
