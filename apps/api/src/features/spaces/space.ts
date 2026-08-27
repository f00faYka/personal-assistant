import { randomUUID } from "node:crypto";

export interface Space {
  readonly id: string;
  readonly memberId: string;
  readonly name: string;
  readonly parentId?: string;
  readonly createdAt: string;
}

export type SpaceItem = "task" | "note";

export interface SpaceRepository {
  create(space: Space): Space;
  list(memberId: string): readonly Space[];
  findById(id: string, memberId: string): Space | undefined;
  hasDescendant(spaceId: string, possibleDescendantId: string, memberId: string): boolean;
  assign(itemId: string, itemKind: SpaceItem, memberId: string, spaceId: string | null): SpaceAssignment | undefined;
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
    if (parentId !== undefined && !this.repository.findById(parentId, memberId)) {
      throw new InvalidSpaceOperationError("parent Space does not belong to this Member");
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

  assign(itemId: string, itemKind: SpaceItem, memberId: string, spaceId: string | null): SpaceAssignment {
    this.requireMember(memberId);
    if (itemKind !== "task" && itemKind !== "note") throw new InvalidSpaceOperationError("invalid item kind");
    if (spaceId !== null && !this.repository.findById(spaceId, memberId)) {
      throw new InvalidSpaceOperationError("Space does not belong to this Member");
    }
    const assignment = this.repository.assign(itemId, itemKind, memberId, spaceId);
    if (!assignment) throw new SpaceItemNotFoundError(itemId);
    return assignment;
  }

  private requireMember(memberId: string): void {
    if (!memberId.trim()) throw new InvalidSpaceOperationError("memberId is required");
  }
}
