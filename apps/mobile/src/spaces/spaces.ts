export interface Space {
  readonly id: string;
  readonly memberId: string;
  readonly name: string;
  readonly parentId?: string;
  readonly createdAt: string;
}

export interface SpacesClient {
  list(memberId: string): Promise<readonly Space[]>;
  create(memberId: string, name: string, parentId?: string): Promise<Space>;
  assign(itemId: string, itemKind: "task" | "note", memberId: string, spaceId: string | null): Promise<void>;
}

export type SpacesFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function createSpacesClient(apiBaseUrl: string, fetcher: SpacesFetcher = (url, init) => fetch(url, init)): SpacesClient {
  return {
    async list(memberId) {
      const response = await fetcher(`${apiBaseUrl}/spaces?memberId=${encodeURIComponent(memberId)}`);
      if (!response.ok) throw new Error(`Unable to load Spaces (${response.status})`);
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.spaces) || !body.spaces.every(isSpace)) throw new Error("Invalid Spaces response");
      return body.spaces;
    },
    async create(memberId, name, parentId) {
      const response = await fetcher(`${apiBaseUrl}/spaces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId, name, ...(parentId === undefined ? {} : { parentId }) }) });
      if (!response.ok) throw new Error(`Unable to create Space (${response.status})`);
      const body: unknown = await response.json();
      if (!isRecord(body) || !isSpace(body.space)) throw new Error("Invalid Space response");
      return body.space;
    },
    async assign(itemId, itemKind, memberId, spaceId) {
      const plural = itemKind === "task" ? "tasks" : "notes";
      const response = spaceId === null
        ? await fetcher(`${apiBaseUrl}/${plural}/${encodeURIComponent(itemId)}/space?memberId=${encodeURIComponent(memberId)}`, { method: "DELETE" })
        : await fetcher(`${apiBaseUrl}/${plural}/${encodeURIComponent(itemId)}/space`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId, spaceId }) });
      if (!response.ok) throw new Error(`Unable to update Space assignment (${response.status})`);
    },
  };
}

function isSpace(value: unknown): value is Space {
  return isRecord(value) && typeof value.id === "string" && typeof value.memberId === "string" && typeof value.name === "string" && (value.parentId === undefined || typeof value.parentId === "string") && typeof value.createdAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
