export interface TaskListItem {
  readonly kind: "task";
  readonly id: string;
  readonly captureId: string;
  readonly title: string;
  readonly dueAt?: string;
  readonly state: "open" | "completed";
  readonly createdAt: string;
  readonly detailUrl: string;
  readonly spaceId?: string;
}

export interface NoteListItem {
  readonly kind: "note";
  readonly id: string;
  readonly captureId: string;
  readonly content: string;
  readonly state: "none" | "needs_review";
  readonly createdAt: string;
  readonly detailUrl: string;
  readonly spaceId?: string;
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

export interface MemberItemsQuery {
  readonly memberId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ListRow {
  readonly captureId: string;
  readonly memberId: string;
  readonly createdAt: string;
  readonly captureState: "pending" | "stored";
  readonly transcriptionStatus: "pending" | "processing" | "succeeded" | "failed" | null;
  readonly transcriptionError: string | null;
  readonly interpretationStatus?: "pending" | "processing" | "succeeded" | "failed" | null;
  readonly outcomeKind: "task" | "note" | null;
  readonly outcomeId: string | null;
  readonly title: string | null;
  readonly dueAt: string | null;
  readonly taskStatus: "open" | "completed" | null;
  readonly content: string | null;
  readonly noteState: "none" | "needs_review" | null;
  readonly primarySpaceId: string | null;
}

export interface MemberItemsRepository {
  list(memberId: string, cursor: ListCursor | undefined, limit: number): readonly ListRow[];
}

export interface ListCursor {
  readonly memberId: string;
  readonly createdAt: string;
  readonly captureId: string;
}

export class InvalidMemberItemsQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMemberItemsQueryError";
  }
}

export class MemberItemsService {
  constructor(private readonly repository: MemberItemsRepository) {}

  list(query: MemberItemsQuery): MemberItemsPage {
    if (!query.memberId.trim()) throw new InvalidMemberItemsQueryError("memberId is required");
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new InvalidMemberItemsQueryError("limit must be an integer between 1 and 100");
    }
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (cursor && cursor.memberId !== query.memberId) throw new InvalidMemberItemsQueryError("cursor belongs to another Member");
    const rows = this.repository.list(query.memberId, cursor, limit + 1);
    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(toListItem),
      nextCursor: hasNext && last ? encodeCursor({ memberId: query.memberId, createdAt: last.createdAt, captureId: last.captureId }) : null,
    };
  }
}

function toListItem(row: ListRow): MemberListItem {
  const detailUrl = `/captures/${row.captureId}/review`;
  if (row.outcomeKind === "task") {
    if (row.outcomeId === null || row.title === null || row.taskStatus === null) throw new Error(`Invalid Task list row: ${row.captureId}`);
    return {
      kind: "task", id: row.outcomeId, captureId: row.captureId, title: row.title,
      ...(row.dueAt === null ? {} : { dueAt: row.dueAt }), ...(row.primarySpaceId === null ? {} : { spaceId: row.primarySpaceId }),
      state: row.taskStatus, createdAt: row.createdAt, detailUrl,
    };
  }
  if (row.outcomeKind === "note") {
    if (row.outcomeId === null || row.content === null || row.noteState === null) throw new Error(`Invalid Note list row: ${row.captureId}`);
    return { kind: "note", id: row.outcomeId, captureId: row.captureId, content: row.content, state: row.noteState,
      ...(row.primarySpaceId === null ? {} : { spaceId: row.primarySpaceId }), createdAt: row.createdAt, detailUrl };
  }
  const state = row.transcriptionStatus === "failed" || row.interpretationStatus === "failed"
    ? "failed"
    : "pending";
  return {
    kind: "capture", id: row.captureId, captureId: row.captureId, state,
    createdAt: row.createdAt, detailUrl,
  };
}

function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): ListCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || !("memberId" in parsed) || !("createdAt" in parsed) || !("captureId" in parsed)
      || typeof parsed.memberId !== "string" || typeof parsed.createdAt !== "string" || typeof parsed.captureId !== "string") throw new Error();
    return { memberId: parsed.memberId, createdAt: parsed.createdAt, captureId: parsed.captureId };
  } catch {
    throw new InvalidMemberItemsQueryError("cursor is invalid");
  }
}
