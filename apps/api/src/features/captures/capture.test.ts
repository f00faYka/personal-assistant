import { describe, expect, test } from "vitest";

import {
  CaptureService,
  ConflictingCaptureRetryError,
  InvalidCaptureSubmissionError,
  type Capture,
} from "./capture.js";
import { blobIdentifier } from "./capture.js";

describe("CaptureService", () => {
  test("stores one immutable source and returns it for a retry", async () => {
    const repository = new MemoryRepository();
    const blobs = new MemoryBlobStorage();
    const service = new CaptureService(repository, blobs);
    const submission = {
      memberId: "member-1",
      idempotencyKey: "capture-1",
      audio: Uint8Array.from([1, 2, 3]),
      contentType: "audio/m4a",
      capturedAt: "2026-08-14T10:00:00.000Z",
    };

    const first = await service.submit(submission);
    const second = await service.submit(submission);

    expect(second).toEqual(first);
    expect(blobs.values.get(blobIdentifier(first))).toEqual(Uint8Array.from([1, 2, 3]));
    expect(repository.values).toHaveLength(1);
  });

  test("rejects a retry with a different source", async () => {
    const service = new CaptureService(new MemoryRepository(), new MemoryBlobStorage());
    const submission = {
      memberId: "member-1",
      idempotencyKey: "capture-1",
      audio: Uint8Array.from([1, 2, 3]),
      contentType: "audio/m4a",
      capturedAt: "2026-08-14T10:00:00.000Z",
    };

    await service.submit(submission);
    await expect(
      service.submit({ ...submission, audio: Uint8Array.from([9]) }),
    ).rejects.toThrowError(ConflictingCaptureRetryError);
  });

  test("reuses stable identifiers after an interrupted metadata write", async () => {
    const repository = new MemoryRepository();
    const blobs = new MemoryBlobStorage();
    const firstService = new CaptureService(repository, blobs);
    const submission = {
      memberId: "member-1",
      idempotencyKey: "capture-1",
      audio: Uint8Array.from([1, 2, 3]),
      contentType: "audio/m4a",
      capturedAt: "2026-08-14T10:00:00.000Z",
    };
    const originalCreate = repository.create.bind(repository);
    repository.create = () => {
      throw new Error("simulated interruption");
    };

    await expect(firstService.submit(submission)).rejects.toThrow("simulated interruption");
    repository.create = originalCreate;
    const retry = await new CaptureService(repository, blobs).submit(submission);

    expect(retry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(retry.sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await new CaptureService(repository, blobs).submit(submission)).toEqual(retry);
  });

  test("rejects a concurrent retry with different audio", async () => {
    const repository = new MemoryRepository();
    const firstService = new CaptureService(repository, new MemoryBlobStorage());
    const secondService = new CaptureService(repository, new MemoryBlobStorage());
    const common = {
      memberId: "member-1",
      idempotencyKey: "capture-1",
      contentType: "audio/m4a",
      capturedAt: "2026-08-14T10:00:00.000Z",
    };

    const first = firstService.submit({ ...common, audio: Uint8Array.from([1]) });
    const second = secondService.submit({ ...common, audio: Uint8Array.from([2]) });
    await expect(Promise.all([first, second])).rejects.toThrowError(ConflictingCaptureRetryError);
  });

  test.each([
    { memberId: "", message: "memberId is required" },
    { idempotencyKey: "", message: "idempotencyKey is required" },
    { audio: Uint8Array.from([]), message: "audio must not be empty" },
    { contentType: "text/plain", message: "contentType must be an audio media type" },
    { capturedAt: "14 August 2026", message: "capturedAt must be an ISO date" },
  ])("rejects invalid submission", async (change) => {
    const service = new CaptureService(new MemoryRepository(), new MemoryBlobStorage());
    const submission = {
      memberId: "member-1",
      idempotencyKey: "capture-1",
      audio: Uint8Array.from([1]),
      contentType: "audio/m4a",
      capturedAt: "2026-08-14T10:00:00.000Z",
      ...change,
    };

    await expect(service.submit(submission)).rejects.toThrowError(
      new InvalidCaptureSubmissionError(change.message),
    );
  });
});

class MemoryRepository {
  readonly values: Capture[] = [];

  findByIdempotencyKey(memberId: string, idempotencyKey: string): Capture | undefined {
    return this.values.find((capture) => capture.memberId === memberId && capture.idempotencyKey === idempotencyKey);
  }

  findById(id: string): Capture | undefined {
    return this.values.find((capture) => capture.id === id);
  }

  create(capture: Capture): Capture {
    this.values.push(capture);
    return capture;
  }

  markStored(id: string): void {
    const index = this.values.findIndex((value) => value.id === id);
    const capture = this.values[index];
    if (capture) this.values[index] = { ...capture, storageState: "stored" };
  }
}

class MemoryBlobStorage {
  readonly values = new Map<string, Uint8Array>();

  async write(identifier: string, content: Uint8Array): Promise<void> {
    this.values.set(identifier, content);
  }

  async read(identifier: string): Promise<Uint8Array> {
    const content = this.values.get(identifier);
    if (!content) throw new Error(`Missing blob: ${identifier}`);
    return content;
  }
}
