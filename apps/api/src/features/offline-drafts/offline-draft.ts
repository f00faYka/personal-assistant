import { createHash } from "node:crypto";

import type { CaptureService } from "../captures/capture.js";

export type OfflineDraftSource =
  | { readonly kind: "audio"; readonly audio: Uint8Array; readonly contentType: string }
  | { readonly kind: "text"; readonly text: string };

export type OfflineDraftStatus = "accepted" | "failed";

export interface OfflineDraftSubmission {
  readonly draftId: string;
  readonly memberId: string;
  readonly capturedAt: string;
  readonly source: OfflineDraftSource;
}

export interface OfflineDraft {
  readonly draftId: string;
  readonly memberId: string;
  readonly capturedAt: string;
  readonly sourceKind: OfflineDraftSource["kind"];
  readonly contentType?: string;
  readonly text?: string;
  readonly sourceSha256: string;
  readonly status: OfflineDraftStatus;
  readonly captureId?: string;
  readonly error?: string;
  readonly retryable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OfflineDraftRepository {
  find(memberId: string, draftId: string): OfflineDraft | undefined;
  create(draft: OfflineDraft): OfflineDraft;
  update(memberId: string, draftId: string, changes: Pick<OfflineDraft, "status" | "captureId" | "error" | "retryable" | "updatedAt">): OfflineDraft;
}

export class OfflineDraftService {
  private readonly inFlight = new Map<string, Promise<OfflineDraft>>();

  constructor(
    private readonly repository: OfflineDraftRepository,
    private readonly captureService: CaptureService,
  ) {}

  async sync(submission: OfflineDraftSubmission): Promise<OfflineDraft> {
    validateSubmission(submission);
    const key = `${submission.memberId}:${submission.draftId}`;
    const sourceSha256 = hashSource(submission.source);
    const existing = this.repository.find(submission.memberId, submission.draftId);
    if (existing) {
      ensureSameSource(existing, sourceSha256);
      if (existing.status === "accepted") return existing;
    }

    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight;
    const operation = this.syncOnce(submission, sourceSha256);
    this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(key);
    }
  }

  get(memberId: string, draftId: string): OfflineDraft {
    const draft = this.repository.find(memberId, draftId);
    if (!draft) throw new OfflineDraftNotFoundError(draftId);
    return draft;
  }

  private async syncOnce(submission: OfflineDraftSubmission, sourceSha256: string): Promise<OfflineDraft> {
    const now = new Date().toISOString();
    const draft = this.repository.create({
      draftId: submission.draftId,
      memberId: submission.memberId,
      capturedAt: submission.capturedAt,
      sourceKind: submission.source.kind,
      ...(submission.source.kind === "audio" ? { contentType: submission.source.contentType } : { text: submission.source.text }),
      sourceSha256,
      status: "accepted",
      retryable: false,
      createdAt: now,
      updatedAt: now,
    });

    if (submission.source.kind === "text") return draft;

    try {
      const capture = await this.captureService.submit({
        memberId: submission.memberId,
        idempotencyKey: `offline-draft:${submission.draftId}`,
        audio: submission.source.audio,
        contentType: submission.source.contentType,
        capturedAt: submission.capturedAt,
      });
      return this.repository.update(draft.memberId, draft.draftId, {
        status: "accepted",
        captureId: capture.id,
        retryable: false,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return this.repository.update(draft.memberId, draft.draftId, {
        status: "failed",
        error: error instanceof Error ? error.message : "Offline draft synchronization failed",
        retryable: true,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

export class InvalidOfflineDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOfflineDraftError";
  }
}

export class ConflictingOfflineDraftError extends Error {
  constructor(draftId: string) {
    super(`Offline draft retry conflicts with existing source: ${draftId}`);
    this.name = "ConflictingOfflineDraftError";
  }
}

export class OfflineDraftNotFoundError extends Error {
  constructor(draftId: string) {
    super(`Offline draft not found: ${draftId}`);
    this.name = "OfflineDraftNotFoundError";
  }
}

function validateSubmission(submission: OfflineDraftSubmission): void {
  if (!submission.draftId.trim()) throw new InvalidOfflineDraftError("draftId is required");
  if (!submission.memberId.trim()) throw new InvalidOfflineDraftError("memberId is required");
  if (!isIsoDate(submission.capturedAt)) throw new InvalidOfflineDraftError("capturedAt must be an ISO date");
  if (submission.source.kind === "audio") {
    if (submission.source.audio.byteLength === 0) throw new InvalidOfflineDraftError("audio must not be empty");
    if (!/^audio\/[A-Za-z0-9.+-]+$/.test(submission.source.contentType)) throw new InvalidOfflineDraftError("contentType must be an audio media type");
  } else if (!submission.source.text.trim()) {
    throw new InvalidOfflineDraftError("text must not be empty");
  }
}

function ensureSameSource(draft: OfflineDraft, sourceSha256: string): OfflineDraft {
  if (draft.sourceSha256 !== sourceSha256) throw new ConflictingOfflineDraftError(draft.draftId);
  return draft;
}

function hashSource(source: OfflineDraftSource): string {
  const hash = createHash("sha256");
  hash.update(source.kind);
  hash.update("\0");
  hash.update(source.kind === "audio" ? source.audio : source.text);
  return hash.digest("hex");
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  return new Date(value).toISOString() === normalized;
}
