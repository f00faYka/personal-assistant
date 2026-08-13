import { createHash } from "node:crypto";

import type { BlobStorage } from "../../shared/blob-storage.js";

export interface CaptureSubmission {
  readonly memberId: string;
  readonly idempotencyKey: string;
  readonly audio: Uint8Array;
  readonly contentType: string;
  readonly capturedAt: string;
}

export interface Capture {
  readonly id: string;
  readonly sourceId: string;
  readonly memberId: string;
  readonly idempotencyKey: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly contentSha256: string;
  readonly capturedAt: string;
  readonly createdAt: string;
  readonly storageState: "pending" | "stored";
}

export interface CaptureRepository {
  findByIdempotencyKey(memberId: string, idempotencyKey: string): Capture | undefined;
  findById(id: string): Capture | undefined;
  create(capture: Capture): Capture;
  markStored(id: string): void;
}

export class CaptureService {
  private readonly inFlightSubmissions = new Map<string, Promise<Capture>>();

  constructor(
    private readonly repository: CaptureRepository,
    private readonly blobStorage: BlobStorage,
  ) {}

  async submit(submission: CaptureSubmission): Promise<Capture> {
    validateSubmission(submission);
    const key = `${submission.memberId}:${submission.idempotencyKey}`;
    const inFlight = this.inFlightSubmissions.get(key);
    if (inFlight) return inFlight;
    const operation = this.submitOnce(submission);
    this.inFlightSubmissions.set(key, operation);
    try {
      return await operation;
    } finally {
      this.inFlightSubmissions.delete(key);
    }
  }

  private async submitOnce(submission: CaptureSubmission): Promise<Capture> {
    const existing = this.repository.findByIdempotencyKey(
      submission.memberId,
      submission.idempotencyKey,
    );
    const contentSha256 = hashAudio(submission.audio);
    if (existing && existing.contentSha256 !== contentSha256) {
      throw new ConflictingCaptureRetryError(submission.idempotencyKey);
    }

    const capture = existing ?? {
      id: stableId("capture", submission.memberId, submission.idempotencyKey),
      sourceId: stableId("source", submission.memberId, submission.idempotencyKey),
      memberId: submission.memberId,
      idempotencyKey: submission.idempotencyKey,
      contentType: submission.contentType,
      byteLength: submission.audio.byteLength,
      contentSha256,
      capturedAt: submission.capturedAt,
      createdAt: new Date().toISOString(),
      storageState: "pending" as const,
    };

    const reserved = existing ?? this.repository.create(capture);
    if (reserved.contentSha256 !== contentSha256) {
      throw new ConflictingCaptureRetryError(submission.idempotencyKey);
    }
    try {
      await this.blobStorage.write(blobIdentifier(reserved), submission.audio);
    } catch (error) {
      if (!isAlreadyExistingBlobError(error)) throw error;
      const existingAudio = await this.blobStorage.read(blobIdentifier(reserved));
      if (!buffersEqual(existingAudio, submission.audio)) {
        throw new ConflictingCaptureRetryError(submission.idempotencyKey);
      }
    }
    this.repository.markStored(reserved.id);
    return this.repository.findByIdempotencyKey(submission.memberId, submission.idempotencyKey) ?? {
      ...reserved,
      storageState: "stored",
    };
  }

  get(id: string): Capture {
    const capture = this.repository.findById(id);
    if (!capture) {
      throw new CaptureNotFoundError(id);
    }
    return capture;
  }

  async readAudio(id: string): Promise<Uint8Array> {
    const capture = this.get(id);
    return this.blobStorage.read(blobIdentifier(capture));
  }
}

export class InvalidCaptureSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCaptureSubmissionError";
  }
}

export class CaptureNotFoundError extends Error {
  constructor(id: string) {
    super(`Capture not found: ${id}`);
    this.name = "CaptureNotFoundError";
  }
}

export class ConflictingCaptureRetryError extends Error {
  constructor(idempotencyKey: string) {
    super(`Capture retry conflicts with existing source: ${idempotencyKey}`);
    this.name = "ConflictingCaptureRetryError";
  }
}

export function blobIdentifier(capture: Pick<Capture, "id">): string {
  return `captures/${capture.id}/original-audio`;
}

function validateSubmission(submission: CaptureSubmission): void {
  if (!submission.memberId.trim()) {
    throw new InvalidCaptureSubmissionError("memberId is required");
  }
  if (!submission.idempotencyKey.trim()) {
    throw new InvalidCaptureSubmissionError("idempotencyKey is required");
  }
  if (submission.audio.byteLength === 0) {
    throw new InvalidCaptureSubmissionError("audio must not be empty");
  }
  if (!/^audio\/[A-Za-z0-9.+-]+$/.test(submission.contentType)) {
    throw new InvalidCaptureSubmissionError("contentType must be an audio media type");
  }
  if (!isIsoDate(submission.capturedAt)) {
    throw new InvalidCaptureSubmissionError("capturedAt must be an ISO date");
  }
}

function hashAudio(audio: Uint8Array): string {
  return createHash("sha256").update(audio).digest("hex");
}

function stableId(kind: string, memberId: string, idempotencyKey: string): string {
  const digest = createHash("sha256")
    .update(`${kind}\0${memberId}\0${idempotencyKey}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return false;
  }
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  return new Date(value).toISOString() === normalized;
}

function isAlreadyExistingBlobError(error: unknown): boolean {
  return error instanceof Error && error.name === "BlobAlreadyExistsError";
}

function buffersEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
