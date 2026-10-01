import type { OfflineDraft } from "./offline-drafts";

export type OfflineDraftSynchronizationState = "accepted" | "processing" | "confirmed" | "failed";

export interface OfflineDraftSynchronizationResult {
  readonly draftId: string;
  readonly state: OfflineDraftSynchronizationState;
  readonly retryable: boolean;
  readonly captureId?: string;
  readonly result?: { readonly kind: "task" | "note"; readonly id: string; readonly detailUrl: string };
  readonly message?: string;
}

export interface OfflineDraftSyncClient {
  synchronize(draft: OfflineDraft): Promise<OfflineDraftSynchronizationResult>;
}

export type OfflineDraftSyncFetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type OfflineDraftSyncDelay = (milliseconds: number) => Promise<void>;

interface OfflineDraftStatusResponse {
  readonly status: {
    readonly draftId: string;
    readonly state: OfflineDraftSynchronizationState;
    readonly processing: "not_started" | "pending" | "confirmed" | "failed";
    readonly retryable: boolean;
    readonly capture?: { readonly id: string; readonly detailUrl: string };
    readonly result?: { readonly kind: "task" | "note"; readonly id: string; readonly detailUrl: string };
    readonly failure?: { readonly classification: "retryable" | "terminal"; readonly message: string };
  };
}

interface Options {
  readonly fetcher?: OfflineDraftSyncFetcher;
  readonly readBase64?: (uri: string) => Promise<string>;
  readonly delay?: OfflineDraftSyncDelay;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
}

export function createOfflineDraftSyncClient(apiBaseUrl: string, options: Options = {}): OfflineDraftSyncClient {
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const readBase64 = options.readBase64;
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)));
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const maxPolls = options.maxPolls ?? 30;
  const inFlight = new Map<string, Promise<OfflineDraftSynchronizationResult>>();

  return {
    synchronize(draft) {
      const key = `${draft.memberId}:${draft.draftId}`;
      const existing = inFlight.get(key);
      if (existing) return existing;
      const operation = synchronizeDraft(draft, fetcher, readBase64, delay, pollIntervalMs, maxPolls, apiBaseUrl);
      inFlight.set(key, operation);
      void operation.finally(() => inFlight.delete(key));
      return operation;
    },
  };
}

async function synchronizeDraft(
  draft: OfflineDraft,
  fetcher: OfflineDraftSyncFetcher,
  readBase64: ((uri: string) => Promise<string>) | undefined,
  delay: OfflineDraftSyncDelay,
  pollIntervalMs: number,
  maxPolls: number,
  apiBaseUrl: string,
): Promise<OfflineDraftSynchronizationResult> {
  try {
    const source = draft.source.kind === "audio"
      ? {
          kind: "audio" as const,
          audioBase64: await readAudioBase64(draft.source.uri, readBase64),
          contentType: draft.source.contentType,
        }
      : draft.source;
    const syncResponse = await fetcher(`${apiBaseUrl}/offline-drafts/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: draft.draftId, memberId: draft.memberId, capturedAt: draft.capturedAt, timeZone: draft.timeZone ?? "UTC", source }),
    });
    if (!syncResponse.ok) return failureResult(draft.draftId, await responseMessage(syncResponse), isRetryable(syncResponse.status));

    let status = await readStatus(draft, fetcher, apiBaseUrl);
    for (let poll = 0; poll < maxPolls && status.state === "processing"; poll += 1) {
      await delay(pollIntervalMs);
      status = await readStatus(draft, fetcher, apiBaseUrl);
    }
    return status;
  } catch (error) {
    return failureResult(draft.draftId, error instanceof Error ? error.message : "Unable to synchronize Offline draft", true);
  }
}

async function readStatus(draft: OfflineDraft, fetcher: OfflineDraftSyncFetcher, apiBaseUrl: string): Promise<OfflineDraftSynchronizationResult> {
  const response = await fetcher(`${apiBaseUrl}/offline-drafts/${encodeURIComponent(draft.draftId)}/status?memberId=${encodeURIComponent(draft.memberId)}`);
  if (!response.ok) return failureResult(draft.draftId, await responseMessage(response), isRetryable(response.status));
  const body: unknown = await response.json();
  if (!isStatusResponse(body)) throw new Error("Invalid Offline draft status response");
  const status = body.status;
  return {
    draftId: status.draftId,
    state: status.state,
    retryable: status.retryable,
    ...(status.capture === undefined ? {} : { captureId: status.capture.id }),
    ...(status.result === undefined ? {} : { result: status.result }),
    ...(status.failure === undefined ? {} : { message: status.failure.message }),
  };
}

async function readAudioBase64(uri: string, readBase64: ((uri: string) => Promise<string>) | undefined): Promise<string> {
  if (!readBase64) throw new Error("Audio synchronization is unavailable");
  return readBase64(uri);
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch { /* Use the status when the server did not return JSON. */ }
  return `Unable to synchronize Offline draft (${response.status})`;
}

function failureResult(draftId: string, message: string, retryable: boolean): OfflineDraftSynchronizationResult {
  return { draftId, state: "failed", retryable, message };
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

function isStatusResponse(value: unknown): value is OfflineDraftStatusResponse {
  if (!isRecord(value) || !isRecord(value.status)) return false;
  const status = value.status;
  return typeof status.draftId === "string"
    && (status.state === "accepted" || status.state === "processing" || status.state === "confirmed" || status.state === "failed")
    && (status.processing === "not_started" || status.processing === "pending" || status.processing === "confirmed" || status.processing === "failed")
    && typeof status.retryable === "boolean"
    && (status.capture === undefined || isLink(status.capture))
    && (status.result === undefined || isResultLink(status.result))
    && (status.failure === undefined || (isRecord(status.failure) && (status.failure.classification === "retryable" || status.failure.classification === "terminal") && typeof status.failure.message === "string"));
}

function isLink(value: unknown): value is { readonly id: string; readonly detailUrl: string } {
  return isRecord(value) && typeof value.id === "string" && typeof value.detailUrl === "string";
}

function isResultLink(value: unknown): value is { readonly kind: "task" | "note"; readonly id: string; readonly detailUrl: string } {
  return isRecord(value) && typeof value.id === "string" && typeof value.detailUrl === "string"
    && (value.kind === "task" || value.kind === "note");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
