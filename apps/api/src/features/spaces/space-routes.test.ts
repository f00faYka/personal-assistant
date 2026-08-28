import { afterEach, describe, expect, test } from "vitest";
import { buildApi } from "../../http/build-api.js";
import { SpaceService, type Space, type SpaceItemRecord, type SpaceRepository } from "./space.js";

class Repository implements SpaceRepository {
  spaces: Space[] = [];
  items: SpaceItemRecord[] = [];
  create(space: Space) { this.spaces.push(space); return space; }
  list(memberId: string) { return this.spaces.filter((space) => space.memberId === memberId); }
  findById(id: string, memberId: string) { return this.spaces.find((space) => space.id === id && space.memberId === memberId); }
  hasDescendant(spaceId: string, possibleDescendantId: string, memberId: string) { let current = this.findById(possibleDescendantId, memberId); while (current?.parentId) { if (current.parentId === spaceId) return true; current = this.findById(current.parentId, memberId); } return false; }
  update(id: string, memberId: string, changes: { name?: string; parentId?: string | null; archivedAt?: string | null }) { const space = this.findById(id, memberId); if (!space) return undefined; const updated = { ...space, ...(changes.name === undefined ? {} : { name: changes.name }), ...(changes.parentId === undefined ? {} : changes.parentId === null ? {} : { parentId: changes.parentId }), ...(changes.archivedAt === undefined ? {} : changes.archivedAt === null ? {} : { archivedAt: changes.archivedAt }) }; this.spaces[this.spaces.indexOf(space)] = updated; return updated; }
  delete(id: string, memberId: string) { const index = this.spaces.findIndex((space) => space.id === id && space.memberId === memberId); if (index < 0) return false; this.spaces.splice(index, 1); return true; }
  listItems(memberId: string, ids: readonly string[]) { return this.items.filter((item) => ids.includes(item.spaceId) && this.findById(item.spaceId, memberId)); }
  assign() { return undefined; }
}

describe("Space routes", () => {
  const applications: Array<ReturnType<typeof buildApi>> = [];
  afterEach(async () => Promise.all(applications.splice(0).map((application) => application.close())));

  test("returns hierarchical and flat subtree views and protects non-empty deletion", async () => {
    const repository = new Repository(); const service = new SpaceService(repository); const root = service.create("member-1", "Home"); const child = service.create("member-1", "Work", root.id);
    repository.items.push({ itemId: "task-1", itemKind: "task", spaceId: child.id, title: "Plan" });
    const application = buildApi({ logger: false, spaceService: service }); applications.push(application);
    const hierarchical = await application.inject({ method: "GET", url: `/spaces/${root.id}?memberId=member-1` });
    expect(hierarchical.statusCode).toBe(200); expect(hierarchical.json().mode).toBe("hierarchical");
    const flat = await application.inject({ method: "GET", url: `/spaces/${root.id}?memberId=member-1&view=flat` });
    expect(flat.json().items).toEqual([expect.objectContaining({ itemId: "task-1", path: "Home / Work" })]);
    const deletion = await application.inject({ method: "DELETE", url: `/spaces/${child.id}?memberId=member-1` });
    expect(deletion.statusCode).toBe(400);
  });
});
