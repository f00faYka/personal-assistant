export interface TaskListItem {
  readonly kind: "task";
  readonly id: string;
  readonly captureId: string;
  readonly title: string;
  readonly dueAt?: string;
  readonly state: "open" | "completed";
  readonly createdAt: string;
  readonly detailUrl: string;
}

export interface NoteListItem {
  readonly kind: "note";
  readonly id: string;
  readonly captureId: string;
  readonly content: string;
  readonly state: "none" | "needs_review";
  readonly createdAt: string;
  readonly detailUrl: string;
}

export interface CaptureListItem {
  readonly kind: "capture";
  readonly id: string;
  readonly captureId: string;
  readonly state: "pending" | "failed";
  readonly createdAt: string;
  readonly detailUrl: string;
}

export type MemberListItem = TaskListItem | NoteListItem | CaptureListItem;

export interface MemberItemsPage {
  readonly items: readonly MemberListItem[];
  readonly nextCursor: string | null;
}

export interface MemberItemsClient {
  list(memberId: string, cursor?: string): Promise<MemberItemsPage>;
}

export type ItemsFetcher = (url: string) => Promise<Response>;

export function createMemberItemsClient(apiBaseUrl: string, fetcher: ItemsFetcher = (url) => fetch(url)): MemberItemsClient {
  return {
    async list(memberId, cursor) {
      const params = new URLSearchParams({ memberId });
      if (cursor) params.set("cursor", cursor);
      const response = await fetcher(`${apiBaseUrl}/items?${params.toString()}`);
      if (!response.ok) throw new Error(`Unable to load items (${response.status})`);
      return parseMemberItemsPage(await response.json());
    },
  };
}

export type ListState =
  | { readonly status: "loading"; readonly items: readonly MemberListItem[] }
  | { readonly status: "ready"; readonly items: readonly MemberListItem[]; readonly nextCursor: string | null }
  | { readonly status: "error"; readonly items: readonly MemberListItem[]; readonly message: string };

export const initialListState: ListState = { status: "loading", items: [] };

export function listStateFromPage(page: MemberItemsPage): ListState {
  return { status: "ready", items: page.items, nextCursor: page.nextCursor };
}

export function listStateFromError(items: readonly MemberListItem[], error: unknown): ListState {
  return { status: "error", items, message: error instanceof Error ? error.message : "Unable to load items" };
}

export function parseMemberItemsPage(value: unknown): MemberItemsPage {
  if (typeof value !== "object" || value === null || !("items" in value) || !("nextCursor" in value)
    || !Array.isArray(value.items) || (value.nextCursor !== null && typeof value.nextCursor !== "string")) {
    throw new Error("Invalid Member items response");
  }
  if (!value.items.every(isMemberListItem)) throw new Error("Invalid Member items response");
  return { items: value.items, nextCursor: value.nextCursor };
}

function isMemberListItem(value: unknown): value is MemberListItem {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.captureId !== "string"
    || typeof value.createdAt !== "string" || typeof value.detailUrl !== "string") return false;
  if (value.kind === "task") return typeof value.title === "string" && (value.state === "open" || value.state === "completed")
    && (value.dueAt === undefined || typeof value.dueAt === "string");
  if (value.kind === "note") return typeof value.content === "string" && (value.state === "none" || value.state === "needs_review");
  return value.kind === "capture" && (value.state === "pending" || value.state === "failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function listItemLabel(item: MemberListItem): string {
  if (item.kind === "task") return item.state === "completed" ? "Completed task" : "Task";
  if (item.kind === "note") return item.state === "needs_review" ? "Needs review" : "Note";
  return item.state === "failed" ? "Capture failed" : "Processing";
}
