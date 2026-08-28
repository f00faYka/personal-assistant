import { responseError } from "../http/request-error";

export const entityTypes = ["Person", "Place", "Organization", "Object"] as const;
export type EntityType = (typeof entityTypes)[number];

export interface Tag { readonly id: string; readonly memberId: string; readonly name: string; readonly createdAt: string; }
export interface Entity { readonly id: string; readonly memberId: string; readonly name: string; readonly type: EntityType; readonly createdAt: string; }
export interface MetadataLinks { readonly tags: readonly Tag[]; readonly entities: readonly Entity[]; }
export type MetadataItemKind = "task" | "note";

export interface MetadataClient {
  listTags(memberId: string): Promise<readonly Tag[]>;
  createTag(memberId: string, name: string): Promise<Tag>;
  updateTag(id: string, memberId: string, name: string): Promise<Tag>;
  listEntities(memberId: string): Promise<readonly Entity[]>;
  createEntity(memberId: string, name: string, type: EntityType): Promise<Entity>;
  updateEntity(id: string, memberId: string, name: string, type: EntityType): Promise<Entity>;
  listLinks(itemId: string, itemKind: MetadataItemKind, memberId: string): Promise<MetadataLinks>;
  linkTag(itemId: string, itemKind: MetadataItemKind, tagId: string, memberId: string): Promise<MetadataLinks>;
  unlinkTag(itemId: string, itemKind: MetadataItemKind, tagId: string, memberId: string): Promise<MetadataLinks>;
  linkEntity(itemId: string, itemKind: MetadataItemKind, entityId: string, memberId: string): Promise<MetadataLinks>;
  unlinkEntity(itemId: string, itemKind: MetadataItemKind, entityId: string, memberId: string): Promise<MetadataLinks>;
}

export function createMetadataClient(apiBaseUrl: string): MetadataClient {
  return {
    async listTags(memberId) { const body = await request<{ tags: readonly Tag[] }>(apiBaseUrl, `/tags?memberId=${encodeURIComponent(memberId)}`); return body.tags; },
    async createTag(memberId, name) { const body = await request<{ tag: Tag }>(apiBaseUrl, "/tags", { method: "POST", body: { memberId, name } }); return body.tag; },
    async updateTag(id, memberId, name) { const body = await request<{ tag: Tag }>(apiBaseUrl, `/tags/${id}`, { method: "PATCH", body: { memberId, name } }); return body.tag; },
    async listEntities(memberId) { const body = await request<{ entities: readonly Entity[] }>(apiBaseUrl, `/entities?memberId=${encodeURIComponent(memberId)}`); return body.entities; },
    async createEntity(memberId, name, type) { const body = await request<{ entity: Entity }>(apiBaseUrl, "/entities", { method: "POST", body: { memberId, name, type } }); return body.entity; },
    async updateEntity(id, memberId, name, type) { const body = await request<{ entity: Entity }>(apiBaseUrl, `/entities/${id}`, { method: "PATCH", body: { memberId, name, type } }); return body.entity; },
    async listLinks(itemId, itemKind, memberId) { return request<MetadataLinks>(apiBaseUrl, itemPath(itemId, itemKind, "/metadata") + `?memberId=${encodeURIComponent(memberId)}`); },
    async linkTag(itemId, itemKind, tagId, memberId) { return request<MetadataLinks>(apiBaseUrl, itemPath(itemId, itemKind, `/tags/${tagId}`), { method: "PUT", body: { memberId } }); },
    async unlinkTag(itemId, itemKind, tagId, memberId) { return request<MetadataLinks>(apiBaseUrl, itemPath(itemId, itemKind, `/tags/${tagId}`) + `?memberId=${encodeURIComponent(memberId)}`, { method: "DELETE" }); },
    async linkEntity(itemId, itemKind, entityId, memberId) { return request<MetadataLinks>(apiBaseUrl, itemPath(itemId, itemKind, `/entities/${entityId}`), { method: "PUT", body: { memberId } }); },
    async unlinkEntity(itemId, itemKind, entityId, memberId) { return request<MetadataLinks>(apiBaseUrl, itemPath(itemId, itemKind, `/entities/${entityId}`) + `?memberId=${encodeURIComponent(memberId)}`, { method: "DELETE" }); },
  };
}

async function request<T>(base: string, path: string, options: { readonly method?: string; readonly body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
    ...(options.method ? { method: options.method } : {}),
    ...(options.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) }),
  });
  const body = await response.json() as T | { error?: string };
  if (!response.ok) throw responseError(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${response.status})`, response.status);
  return body as T;
}

function itemPath(itemId: string, itemKind: MetadataItemKind, suffix: string): string { return `/${itemKind === "task" ? "tasks" : "notes"}/${itemId}${suffix}`; }
