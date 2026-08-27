import { describe, expect, test } from "vitest";
import { InvalidSpaceOperationError, SpaceService, type Space, type SpaceRepository } from "./space.js";

class MemorySpaceRepository implements SpaceRepository {
  spaces: Space[] = [];
  assignments: Array<{ itemId: string; itemKind: "task" | "note"; memberId: string; spaceId: string | null }> = [];
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
});
