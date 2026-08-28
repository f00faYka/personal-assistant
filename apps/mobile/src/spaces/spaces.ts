export interface Space {
  readonly id: string;
  readonly memberId: string;
  readonly name: string;
  readonly parentId?: string;
  readonly createdAt: string;
  readonly archivedAt?: string;
}

export interface SpaceTreeView {
  readonly space: Space;
  readonly path: string;
  readonly children: readonly SpaceTreeView[];
  readonly items: readonly { readonly itemId: string; readonly itemKind: "task" | "note"; readonly spaceId: string; readonly path: string; readonly title?: string; readonly content?: string }[];
}

export interface SpacesClient {
  list(memberId: string): Promise<readonly Space[]>;
  create(memberId: string, name: string, parentId?: string): Promise<Space>;
  read(memberId: string, spaceId: string, view?: "hierarchical" | "flat"): Promise<SpaceTreeView>;
  update(memberId: string, spaceId: string, changes: { readonly name?: string; readonly parentId?: string | null }): Promise<Space>;
  archive(memberId: string, spaceId: string): Promise<Space>;
  restore(memberId: string, spaceId: string): Promise<Space>;
  remove(memberId: string, spaceId: string): Promise<void>;
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
    async read(memberId, spaceId, view) {
      const query = `memberId=${encodeURIComponent(memberId)}${view ? `&view=${view}` : ""}`;
      const response = await fetcher(`${apiBaseUrl}/spaces/${encodeURIComponent(spaceId)}?${query}`);
      if (!response.ok) throw new Error(`Unable to load Space (${response.status})`);
      const body: unknown = await response.json();
      if (!isRecord(body) || !isTree(body.space)) throw new Error("Invalid Space response");
      return body.space;
    },
    async update(memberId, spaceId, changes) {
      const response = await fetcher(`${apiBaseUrl}/spaces/${encodeURIComponent(spaceId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId, ...changes }) });
      if (!response.ok) throw new Error(`Unable to update Space (${response.status})`);
      const body: unknown = await response.json();
      if (!isRecord(body) || !isSpace(body.space)) throw new Error("Invalid Space response");
      return body.space;
    },
    async archive(memberId, spaceId) { return lifecycleRequest(apiBaseUrl, fetcher, memberId, spaceId, "archive"); },
    async restore(memberId, spaceId) { return lifecycleRequest(apiBaseUrl, fetcher, memberId, spaceId, "restore"); },
    async remove(memberId, spaceId) {
      const response = await fetcher(`${apiBaseUrl}/spaces/${encodeURIComponent(spaceId)}?memberId=${encodeURIComponent(memberId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Unable to delete Space (${response.status})`);
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
  return isRecord(value) && typeof value.id === "string" && typeof value.memberId === "string" && typeof value.name === "string" && (value.parentId === undefined || typeof value.parentId === "string") && typeof value.createdAt === "string" && (value.archivedAt === undefined || typeof value.archivedAt === "string");
}

function isTree(value: unknown): value is SpaceTreeView { return isRecord(value) && isSpace(value.space) && typeof value.path === "string" && Array.isArray(value.children) && value.children.every(isTree) && Array.isArray(value.items); }
async function lifecycleRequest(apiBaseUrl: string, fetcher: SpacesFetcher, memberId: string, spaceId: string, action: "archive" | "restore"): Promise<Space> {
  const response = await fetcher(`${apiBaseUrl}/spaces/${encodeURIComponent(spaceId)}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberId }) });
  if (!response.ok) throw new Error(`Unable to ${action} Space (${response.status})`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !isSpace(body.space)) throw new Error("Invalid Space response");
  return body.space;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
