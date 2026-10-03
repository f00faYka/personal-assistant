import type { MemberItemsClient, MemberListItem, SearchFilters } from "../list/member-items";
import type { Space } from "../spaces/spaces";

export type MaterialItem = Exclude<MemberListItem, { kind: "capture" }>;

export async function loadMaterialsPage(client: MemberItemsClient, memberId: string, filters: SearchFilters = {}, cursor?: string): Promise<{ readonly items: readonly MaterialItem[]; readonly nextCursor: string | null }> {
  const page = Object.values(filters).some((value) => value !== undefined && value !== "")
    ? await client.search(memberId, filters, cursor)
    : await client.list(memberId, cursor);
  return { items: page.items.filter(isMaterialItem), nextCursor: page.nextCursor };
}

/** Read every page so Materials never treats the first page as the complete collection. */
export async function loadAllMaterials(client: MemberItemsClient, memberId: string, filters: SearchFilters = {}): Promise<readonly MaterialItem[]> {
  const items: MaterialItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const page = await loadMaterialsPage(client, memberId, filters, cursor);
    items.splice(0, items.length, ...appendUniqueMaterials(items, page.items));
    if (page.nextCursor === null) return items;
    if (seenCursors.has(page.nextCursor)) throw new Error("Materials pagination did not advance");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export function appendUniqueMaterials(existing: readonly MaterialItem[], next: readonly MaterialItem[]): readonly MaterialItem[] {
  const seen = new Set(existing.map((item) => `${item.kind}:${item.id}`));
  return [...existing, ...next.filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}
export function isMaterialItem(item: MemberListItem): item is MaterialItem {
  return item.kind === "task" || item.kind === "note";
}

export function childSpaces(spaces: readonly Space[], parentId: string | null): readonly Space[] {
  return spaces.filter((space) => (space.parentId ?? null) === parentId && !space.archivedAt);
}

export function findSpace(spaces: readonly Space[], spaceId: string | null): Space | undefined {
  return spaceId === null ? undefined : spaces.find((space) => space.id === spaceId);
}

export function spacePath(spaces: readonly Space[], spaceId: string | undefined): string {
  if (!spaceId) return "Unassigned";
  const space = spaces.find((candidate) => candidate.id === spaceId);
  if (!space) return "Assigned Space";
  return space.parentId ? `${spacePath(spaces, space.parentId)} / ${space.name}` : space.name;
}

export function directItems(items: readonly MaterialItem[], spaceId: string | null): readonly MaterialItem[] {
  return items.filter((item) => (item.spaceId ?? null) === spaceId);
}
