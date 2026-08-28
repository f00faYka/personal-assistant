import { describe, expect, test } from "vitest";
import { InvalidSpaceOperationError, SpaceService, type Space, type SpaceItemRecord, type SpaceRepository } from "./space.js";

class MemorySpaceRepository implements SpaceRepository {
  spaces: Space[] = [];
  assignments: Array<{ itemId: string; itemKind: "task" | "note"; memberId: string; spaceId: string | null }> = [];
  items: SpaceItemRecord[] = [];
  create(space: Space): Space { this.spaces.push(space); return space; }
  list(memberId: string): readonly Space[] { return this.spaces.filter((space) => space.memberId === memberId); }
  findById(id: string, memberId: string): Space | undefined { return this.spaces.find((space) => space.id === id && space.memberId === memberId); }
  hasDescendant(spaceId: string, possibleDescendantId: string, memberId: string): boolean {
    let current = this.findById(possibleDescendantId, memberId);
    while (current?.parentId) { if (current.parentId === spaceId) return true; current = this.findById(current.parentId, memberId); }
    return false;
  }
  assign(itemId: string, itemKind: "task" | "note", memberId: string, spaceId: string | null) {
    if (itemId !== `${memberId}-${itemKind}`) return undefined;
    this.assignments.push({ itemId, itemKind, memberId, spaceId });
    return { itemId, itemKind, spaceId };
  }
  update(id: string, memberId: string, changes: { name?: string; parentId?: string | null; archivedAt?: string | null }): Space | undefined {
    const space = this.findById(id, memberId); if (!space) return undefined;
    const { parentId, archivedAt, ...base } = space;
    const updated: Space = { ...base, ...(changes.name === undefined ? { name: space.name } : { name: changes.name }), ...(changes.parentId === undefined ? (parentId === undefined ? {} : { parentId }) : changes.parentId === null ? {} : { parentId: changes.parentId }), ...(changes.archivedAt === undefined ? (archivedAt === undefined ? {} : { archivedAt }) : changes.archivedAt === null ? {} : { archivedAt: changes.archivedAt }) };
    this.spaces[this.spaces.indexOf(space)] = updated; return updated;
  }
  delete(id: string, memberId: string) { const index = this.spaces.findIndex((space) => space.id === id && space.memberId === memberId); if (index < 0) return false; this.spaces.splice(index, 1); return true; }
  listItems(memberId: string, spaceIds: readonly string[]) { return this.items.filter((item) => spaceIds.includes(item.spaceId) && this.findById(item.spaceId, memberId)); }
}

describe("SpaceService", () => {
  test("creates multiple roots and nested Spaces only within the Member boundary", () => {
    const repository = new MemorySpaceRepository();
    const service = new SpaceService(repository);
    const root = service.create("member-1", " Work ");
    const secondRoot = service.create("member-1", "Home");
    const child = service.create("member-1", "Projects", root.id);

    expect(service.list("member-1")).toEqual([root, secondRoot, child]);
    expect(child.parentId).toBe(root.id);
    expect(() => service.create("member-2", "Child", root.id)).toThrow("does not belong");
  });

  test("assigns and explicitly unassigns Tasks and Notes", () => {
    const repository = new MemorySpaceRepository();
    const service = new SpaceService(repository);
    const space = service.create("member-1", "Home");

    expect(service.assign("member-1-task", "task", "member-1", space.id).spaceId).toBe(space.id);
    expect(service.assign("member-1-note", "note", "member-1", null).spaceId).toBeNull();
    expect(() => service.assign("member-1-task", "task", "member-2", space.id)).toThrow(InvalidSpaceOperationError);
    expect(() => service.assign("missing", "task", "member-1", null)).toThrow("Item not found");
  });

  test("reads direct items hierarchically and all descendants with full paths", () => {
    const repository = new MemorySpaceRepository(); const service = new SpaceService(repository);
    const home = service.create("member-1", "Home"); const work = service.create("member-1", "Work", home.id); const project = service.create("member-1", "Assistant Project", work.id);
    repository.items.push({ itemId: "task-1", itemKind: "task", spaceId: work.id, title: "Plan" }, { itemId: "note-1", itemKind: "note", spaceId: project.id, content: "Ideas" });
    expect(service.read("member-1", home.id)).toMatchObject({ path: "Home", items: [], children: [{ path: "Home / Work", items: [{ itemId: "task-1", path: "Home / Work" }] }] });
    expect(service.read("member-1", home.id, true).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "task-1", path: "Home / Work" }), expect.objectContaining({ itemId: "note-1", path: "Home / Work / Assistant Project" }),
    ]));
  });

  test("renames and moves without changing identities, archives non-empty trees, and deletes only empty Spaces", () => {
    const repository = new MemorySpaceRepository(); const service = new SpaceService(repository);
    const home = service.create("member-1", "Home"); const work = service.create("member-1", "Work", home.id); const project = service.create("member-1", "Project", work.id); repository.items.push({ itemId: "task-1", itemKind: "task", spaceId: project.id, title: "Task" });
    service.rename(work.id, "member-1", "Office"); service.move(work.id, "member-1", null);
    expect(repository.findById(work.id, "member-1")).toMatchObject({ id: work.id, name: "Office" });
    expect(repository.findById(work.id, "member-1")?.parentId).toBeUndefined();
    expect(() => service.remove(work.id, "member-1")).toThrow("must be archived");
    service.archive(work.id, "member-1"); expect(() => service.read("member-1", work.id)).toThrow(); expect(repository.findById(project.id, "member-1")?.archivedAt).toBeDefined(); service.restore(work.id, "member-1"); expect(repository.findById(project.id, "member-1")?.archivedAt).toBeUndefined();
    service.remove(home.id, "member-1"); expect(repository.findById(home.id, "member-1")).toBeUndefined();
  });

  test("rejects cycles", () => {
    const repository = new MemorySpaceRepository(); const service = new SpaceService(repository); const root = service.create("member-1", "Root"); const child = service.create("member-1", "Child", root.id);
    expect(() => service.move(root.id, "member-1", child.id)).toThrow("subtree");
  });
});
