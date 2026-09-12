import type { MemberItemsClient, MemberListItem, TaskListItem } from "../list/member-items";

export type LocalDate = `${number}-${number}-${number}`;

export interface CompleteItemsResult {
  readonly items: readonly MemberListItem[];
  readonly complete: true;
}

/** Read every page so an empty day is never inferred from an incomplete collection. */
export async function loadCompleteMemberItems(client: MemberItemsClient, memberId: string): Promise<CompleteItemsResult> {
  const items: MemberListItem[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const page = await client.list(memberId, cursor);
    items.push(...page.items);
    if (page.nextCursor === null) return { items, complete: true };
    if (seenCursors.has(page.nextCursor)) throw new Error("Member items pagination did not advance");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export function tasksForLocalDate(items: readonly MemberListItem[], selectedDate: LocalDate, timeZone?: string): readonly TaskListItem[] {
  return items.filter((item): item is TaskListItem => item.kind === "task" && item.dueAt !== undefined && localDateKey(item.dueAt, timeZone) === selectedDate);
}

export function localDateKey(value: string | Date, timeZone?: string): LocalDate {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }).formatToParts(date);
  const part = (type: "year" | "month" | "day") => parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}` as LocalDate;
}

export function formatLocalDateHeading(selectedDate: LocalDate, timeZone?: string): string {
  const [year, month, day] = selectedDate.split("-").map(Number);
  // Noon UTC keeps the calendar label on the selected date in every supported local zone.
  const date = new Date(Date.UTC(year!, month! - 1, day!, 12));
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(date);
}

export function formatTaskTime(value: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(new Date(value));
}
