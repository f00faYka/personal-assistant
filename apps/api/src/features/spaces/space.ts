import { randomUUID } from "node:crypto";

export interface Space {
  readonly id: string;
  readonly memberId: string;
  readonly name: string;
  readonly parentId?: string;
  readonly createdAt: string;
  readonly archivedAt?: string;
}

export type SpaceItem = "task" | "note";

export interface SpaceRepository {
  create(space: Space): Space;
  list(memberId: string): readonly Space[];
  findById(id: string, memberId: string): Space | undefined;
  hasDescendant(spaceId: string, possibleDescendantId: string, memberId: string): boolean;
  update(spaceId: string, memberId: string, changes: { name?: string; parentId?: string | null; archivedAt?: string | null }): Space | undefined;
  delete(spaceId: string, memberId: string): boolean;
  listItems(memberId: string, spaceIds: readonly string[]): readonly SpaceItemRecord[];
  assign(itemId: string, itemKind: SpaceItem, memberId: string, spaceId: string | null): SpaceAssignment | undefined;
}

export interface SpaceItemRecord {
  readonly itemId: string;
  readonly itemKind: SpaceItem;
  readonly spaceId: string;
  readonly title?: string;
  readonly content?: string;
}

export interface SpaceItemView extends SpaceItemRecord { readonly path: string; }
export interface SpaceTreeView {
  readonly space: Space;
  readonly path: string;
  readonly children: readonly SpaceTreeView[];
  readonly items: readonly SpaceItemView[];
}

export interface SpaceAssignment {
  readonly itemId: string;
  readonly itemKind: SpaceItem;
  readonly spaceId: string | null;
}

export class InvalidSpaceOperationError extends Error {
  constructor(message: string) { super(message); this.name = "InvalidSpaceOperationError"; }
}

export class SpaceItemNotFoundError extends Error {
  constructor(itemId: string) { super(`Item not found: ${itemId}`); this.name = "SpaceItemNotFoundError"; }
}

export class SpaceService {
  constructor(private readonly repository: SpaceRepository) {}

  create(memberId: string, name: string, parentId?: string): Space {
    this.requireMember(memberId);
    const normalizedName = name.trim();
    if (!normalizedName) throw new InvalidSpaceOperationError("Space name must not be empty");
    if (normalizedName.length > 200) throw new InvalidSpaceOperationError("Space name must be 200 characters or fewer");
    if (this.repository.list(memberId).some((space) => space.name === normalizedName)) {
      throw new InvalidSpaceOperationError("Space name already exists for this Member");
    }
    if (parentId !== undefined) {
      const parent = this.repository.findById(parentId, memberId);
      if (!parent) throw new InvalidSpaceOperationError("parent Space does not belong to this Member");
      if (parent.archivedAt) throw new InvalidSpaceOperationError("archived Spaces cannot contain new Spaces");
    }
    return this.repository.create({
      id: randomUUID(), memberId, name: normalizedName,
      ...(parentId === undefined ? {} : { parentId }), createdAt: new Date().toISOString(),
    });
  }

  list(memberId: string): readonly Space[] {
    this.requireMember(memberId);
    return this.repository.list(memberId);
  }

  read(memberId: string, spaceId: string, flat = false): SpaceTreeView {
    this.requireMember(memberId);
    const spaces = this.repository.list(memberId);
    const root = spaces.find((space) => space.id === spaceId);
    if (!root || root.archivedAt) throw new SpaceItemNotFoundError(spaceId);
    const byParent = new Map<string | undefined, Space[]>();
    for (const space of spaces) {
      if (space.archivedAt) continue;
      const siblings = byParent.get(space.parentId) ?? [];
      siblings.push(space);
      byParent.set(space.parentId, siblings);
    }
    const build = (space: Space, parentPath?: string): SpaceTreeView => {
      const path = parentPath ? `${parentPath} / ${space.name}` : space.name;
      const ids = flat ? collectIds(space, byParent) : [space.id];
      const items = this.repository.listItems(memberId, ids).map((item) => ({ ...item, path: this.pathFor(item.spaceId, spaces) }));
      return { space, path, children: flat ? [] : (byParent.get(space.id) ?? []).map((child) => build(child, path)), items };
    };
    return build(root);
  }

  rename(spaceId: string, memberId: string, name: string): Space {
    const space = this.getActive(spaceId, memberId);
    const normalizedName = name.trim();
    if (!normalizedName) throw new InvalidSpaceOperationError("Space name must not be empty");
    if (normalizedName.length > 200) throw new InvalidSpaceOperationError("Space name must be 200 characters or fewer");
    if (this.repository.list(memberId).some((candidate) => candidate.id !== spaceId && candidate.name === normalizedName && candidate.parentId === space.parentId && !candidate.archivedAt)) {
      throw new InvalidSpaceOperationError("Space name already exists beside this Space");
    }
    return this.repository.update(spaceId, memberId, { name: normalizedName }) ?? space;
  }

  move(spaceId: string, memberId: string, parentId: string | null): Space {
    const space = this.getActive(spaceId, memberId);
    if (parentId === spaceId || (parentId !== null && this.repository.hasDescendant(spaceId, parentId, memberId))) {
      throw new InvalidSpaceOperationError("moving a Space into its subtree is not allowed");
    }
    if (parentId !== null) {
      const parent = this.getActive(parentId, memberId);
      if (this.repository.list(memberId).some((candidate) => candidate.id !== spaceId && candidate.parentId === parent.id && candidate.name === space.name && !candidate.archivedAt)) {
        throw new InvalidSpaceOperationError("Space name already exists beside the destination");
      }
    }
    return this.repository.update(spaceId, memberId, { parentId }) ?? space;
  }

  archive(spaceId: string, memberId: string): Space {
    const space = this.getActive(spaceId, memberId);
    const archivedAt = new Date().toISOString();
    for (const descendant of this.subtree(spaceId, memberId)) this.repository.update(descendant.id, memberId, { archivedAt });
    return this.repository.findById(spaceId, memberId) ?? space;
  }

  restore(spaceId: string, memberId: string): Space {
    const space = this.repository.findById(spaceId, memberId);
    if (!space) throw new SpaceItemNotFoundError(spaceId);
    if (!space.archivedAt) return space;
    const parent = space.parentId ? this.repository.findById(space.parentId, memberId) : undefined;
    if (parent?.archivedAt) throw new InvalidSpaceOperationError("restore the parent Space first");
    for (const descendant of this.subtree(spaceId, memberId)) this.repository.update(descendant.id, memberId, { archivedAt: null });
    return this.repository.findById(spaceId, memberId) ?? space;
  }

  remove(spaceId: string, memberId: string): void {
    const space = this.repository.findById(spaceId, memberId);
    if (!space) throw new SpaceItemNotFoundError(spaceId);
    if (this.repository.list(memberId).some((candidate) => candidate.parentId === spaceId) || this.repository.listItems(memberId, [spaceId]).length > 0) {
      throw new InvalidSpaceOperationError("non-empty Spaces must be archived");
    }
    if (!this.repository.delete(spaceId, memberId)) throw new SpaceItemNotFoundError(spaceId);
  }

  assign(itemId: string, itemKind: SpaceItem, memberId: string, spaceId: string | null): SpaceAssignment {
    this.requireMember(memberId);
    if (itemKind !== "task" && itemKind !== "note") throw new InvalidSpaceOperationError("invalid item kind");
    if (spaceId !== null) {
      const space = this.repository.findById(spaceId, memberId);
      if (!space) throw new InvalidSpaceOperationError("Space does not belong to this Member");
      if (space.archivedAt) throw new InvalidSpaceOperationError("archived Spaces cannot receive items");
    }
    const assignment = this.repository.assign(itemId, itemKind, memberId, spaceId);
    if (!assignment) throw new SpaceItemNotFoundError(itemId);
    return assignment;
  }

  private requireMember(memberId: string): void {
    if (!memberId.trim()) throw new InvalidSpaceOperationError("memberId is required");
  }

  private getActive(spaceId: string, memberId: string): Space {
    const space = this.repository.findById(spaceId, memberId);
    if (!space) throw new SpaceItemNotFoundError(spaceId);
    if (space.archivedAt) throw new InvalidSpaceOperationError("archived Spaces cannot be changed");
    return space;
  }

  private subtree(spaceId: string, memberId: string): readonly Space[] {
    const spaces = this.repository.list(memberId);
    const result: Space[] = [];
    const visit = (id: string) => { const space = spaces.find((candidate) => candidate.id === id); if (!space) return; result.push(space); for (const child of spaces.filter((candidate) => candidate.parentId === id)) visit(child.id); };
    visit(spaceId);
    return result;
  }

  private pathFor(spaceId: string, spaces: readonly Space[]): string {
    const names: string[] = [];
    let current = spaces.find((space) => space.id === spaceId);
    while (current) { names.unshift(current.name); current = current.parentId ? spaces.find((space) => space.id === current?.parentId) : undefined; }
    return names.join(" / ");
  }
}

function collectIds(space: Space, byParent: Map<string | undefined, Space[]>): string[] {
  return [space.id, ...(byParent.get(space.id) ?? []).flatMap((child) => collectIds(child, byParent))];
}
