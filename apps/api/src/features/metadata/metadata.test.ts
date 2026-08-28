import { describe, expect, test } from "vitest";
import { MetadataDuplicateError, MetadataResourceNotFoundError, MetadataService, type Entity, type EntityType, type MetadataLinks, type MetadataRepository, type Tag } from "./metadata.js";

class Repository implements MetadataRepository {
  tags: Tag[] = [];
  entities: Entity[] = [];
  links: MetadataLinks = { tags: [], entities: [] };
  createTag(tag: Tag) { this.tags.push(tag); return tag; }
  findTag(id: string, memberId: string) { return this.tags.find((tag) => tag.id === id && tag.memberId === memberId); }
  listTags(memberId: string) { return this.tags.filter((tag) => tag.memberId === memberId); }
  updateTag(id: string, memberId: string, name: string) { const tag = this.findTag(id, memberId); if (!tag) return undefined; const updated = { ...tag, name }; this.tags[this.tags.indexOf(tag)] = updated; return updated; }
  createEntity(entity: Entity) { this.entities.push(entity); return entity; }
  findEntity(id: string, memberId: string) { return this.entities.find((entity) => entity.id === id && entity.memberId === memberId); }
  listEntities(memberId: string) { return this.entities.filter((entity) => entity.memberId === memberId); }
  updateEntity(id: string, memberId: string, name: string, type: EntityType) { const entity = this.findEntity(id, memberId); if (!entity) return undefined; const updated = { ...entity, name, type }; this.entities[this.entities.indexOf(entity)] = updated; return updated; }
  itemExists(itemId: string, _kind: "task" | "note", memberId: string) { return itemId === "item-1" && memberId === "member-1"; }
  linkTag(_itemId: string, _kind: "task" | "note", tagId: string) { const tag = this.findTag(tagId, "member-1"); if (tag) this.links = { ...this.links, tags: [...this.links.tags, tag] }; }
  unlinkTag() { return true; }
  linkEntity(_itemId: string, _kind: "task" | "note", entityId: string) { const entity = this.findEntity(entityId, "member-1"); if (entity) this.links = { ...this.links, entities: [...this.links.entities, entity] }; }
  unlinkEntity() { return true; }
  listLinks() { return this.links; }
}

describe("MetadataService", () => {
  test("validates types, rejects duplicates, and links multiple Tags and Entities", () => {
    const repository = new Repository(); const service = new MetadataService(repository);
    const tag = service.createTag("member-1", " urgent ");
    expect(() => service.createTag("member-1", "urgent")).toThrow(MetadataDuplicateError);
    const entity = service.createEntity("member-1", "Office", "Place");
    expect(() => service.createEntity("member-1", "Office", "Place")).toThrow(MetadataDuplicateError);
    service.linkTag("item-1", "task", "member-1", tag.id);
    service.linkEntity("item-1", "task", "member-1", entity.id);
    expect(service.listLinks("item-1", "task", "member-1")).toEqual({ tags: [tag], entities: [entity] });
  });

  test("does not allow a Member to use another Member's resources or items", () => {
    const repository = new Repository(); const service = new MetadataService(repository); const tag = service.createTag("member-1", "tag");
    expect(() => service.linkTag("item-1", "task", "member-2", tag.id)).toThrow(MetadataResourceNotFoundError);
    expect(() => service.listLinks("item-1", "task", "member-2")).toThrow(MetadataResourceNotFoundError);
  });
});
