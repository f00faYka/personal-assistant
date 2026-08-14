import type { MemberListItem, TaskListItem, NoteListItem } from "../list/member-items";

export type PreviewItem = TaskListItem | NoteListItem;
export type PreviewState =
  | { readonly status: "processing"; readonly captureId: string; readonly startedAt: number }
  | { readonly status: "preview"; readonly item: PreviewItem; readonly expiresAt: number }
  | { readonly status: "failed"; readonly captureId: string }
  | { readonly status: "timed_out"; readonly captureId: string }
  | { readonly status: "saved"; readonly item: PreviewItem };

export const PREVIEW_WINDOW_MS = 15_000;

export const PROCESSING_TIMEOUT_MS = 30_000;

export function beginPreview(captureId: string, startedAt = Date.now()): PreviewState {
  return { status: "processing", captureId, startedAt };
}

export function resolvePreview(state: PreviewState, items: readonly MemberListItem[], now: number): PreviewState {
  if (state.status !== "processing") return state;
  const item = items.find((candidate) => candidate.captureId === state.captureId);
  if (!item) return state;
  if (item.kind === "capture") return item.state === "failed" ? { status: "failed", captureId: state.captureId } : state;
  return { status: "preview", item, expiresAt: now + PREVIEW_WINDOW_MS };
}

export function expirePreview(state: PreviewState, now: number): PreviewState {
  return state.status === "preview" && now >= state.expiresAt ? { status: "saved", item: state.item } : state;
}

export function timeOutPreview(state: PreviewState, now: number): PreviewState {
  return state.status === "processing" && now >= state.startedAt + PROCESSING_TIMEOUT_MS
    ? { status: "timed_out", captureId: state.captureId }
    : state;
}

export function savePreview(state: PreviewState): PreviewState {
  return state.status === "preview" ? { status: "saved", item: state.item } : state;
}
