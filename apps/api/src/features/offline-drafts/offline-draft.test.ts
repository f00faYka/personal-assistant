import { describe, expect, test } from "vitest";

import { CaptureService, type Capture } from "../captures/capture.js";
import { blobIdentifier } from "../captures/capture.js";
import {
  ConflictingOfflineDraftError,
  OfflineDraftService,
  type OfflineDraft,
  type OfflineDraftRepository,
} from "./offline-draft.js";

describe("OfflineDraftService", () => {
  test("accepts an audio draft into one idempotent Capture", async () => {
    const repository = new MemoryDraftRepository();
    const blobs = new MemoryBlobStorage();
    const handled: Capture[] = [];
    const service = new OfflineDraftService(
      repository,
      new CaptureService(new MemoryCaptureRepository(), blobs),
      undefined,
      { handleStoredCapture: async (capture) => { handled.push(capture); } },
    );
    const submission = { draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "audio" as const, audio: Uint8Array.from([1, 2]), contentType: "audio/m4a" } };

    const first = await service.sync(submission);
    const second = await service.sync(submission);

    expect(second).toEqual(first);
    expect(first).toMatchObject({ draftId: "draft-1", status: "accepted", captureId: expect.any(String), retryable: false });
    expect(blobs.values.get(blobIdentifier({ id: first.captureId! }))).toEqual(Uint8Array.from([1, 2]));
    expect(repository.values).toHaveLength(1);
    expect(handled).toEqual([expect.objectContaining({ id: first.captureId })]);
  });

  test("preserves text drafts without inventing a confirmed outcome", async () => {
    const service = new OfflineDraftService(new MemoryDraftRepository(), new CaptureService(new MemoryCaptureRepository(), new MemoryBlobStorage()));

    const draft = await service.sync({ draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "text", text: "Buy milk" } });

    expect(draft).toMatchObject({ sourceKind: "text", text: "Buy milk", status: "accepted", retryable: false });
    expect(draft.captureId).toBeUndefined();
  });

  test("rejects a retry with a different original and retries a failed audio sync", async () => {
    const captureRepository = new MemoryCaptureRepository();
    const blobs = new FailingBlobStorage();
    const service = new OfflineDraftService(new MemoryDraftRepository(), new CaptureService(captureRepository, blobs));
    const common = { draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "audio" as const, audio: Uint8Array.from([1]), contentType: "audio/m4a" } };

    const failed = await service.sync(common);
    expect(failed).toMatchObject({ status: "failed", retryable: true });
    blobs.fail = false;
    const recovered = await service.sync(common);
    expect(recovered).toMatchObject({ status: "accepted", captureId: expect.any(String), retryable: false });
    await expect(service.sync({ ...common, source: { ...common.source, audio: Uint8Array.from([2]) } })).rejects.toThrowError(ConflictingOfflineDraftError);
  });

  test("exposes accepted, processing, confirmed, and retryable failed states", async () => {
    const repository = new MemoryDraftRepository();
    const captureRepository = new MemoryCaptureRepository();
    const captureService = new CaptureService(captureRepository, new MemoryBlobStorage());
    const service = new OfflineDraftService(repository, captureService, {
      get: (captureId: string) => captureId === "capture-confirmed"
        ? { state: "completed" as const, outcome: { kind: "task" as const, id: "task-1" } }
        : { state: "pending" as const, outcome: null },
    });

    const text = await service.sync({ draftId: "text-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "text", text: "Buy milk" } });
    expect(service.getStatus("member-1", text.draftId)).toMatchObject({ state: "accepted", processing: "not_started", retryable: false });

    const audio = await service.sync({ draftId: "audio-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "audio", audio: Uint8Array.from([1]), contentType: "audio/m4a" } });
    expect(service.getStatus("member-1", audio.draftId)).toMatchObject({ state: "processing", processing: "pending", capture: { id: audio.captureId, detailUrl: `/captures/${audio.captureId}/review` } });

    repository.create({ ...audio, draftId: "confirmed-1", captureId: "capture-confirmed" });
    expect(service.getStatus("member-1", "confirmed-1")).toMatchObject({
      state: "confirmed",
      processing: "confirmed",
      result: { kind: "task", id: "task-1", detailUrl: "/captures/capture-confirmed/review" },
    });

    const failedRepository = new MemoryDraftRepository();
    const failedService = new OfflineDraftService(failedRepository, new CaptureService(new MemoryCaptureRepository(), new FailingBlobStorage()));
    const failed = await failedService.sync({ draftId: "failed-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "audio", audio: Uint8Array.from([1]), contentType: "audio/m4a" } });
    expect(failedService.getStatus("member-1", failed.draftId)).toMatchObject({
      state: "failed",
      processing: "not_started",
      retryable: true,
      failure: { classification: "retryable" },
    });
  });
});

class MemoryDraftRepository implements OfflineDraftRepository {
  readonly values: OfflineDraft[] = [];
  find(memberId: string, draftId: string): OfflineDraft | undefined { return this.values.find((draft) => draft.memberId === memberId && draft.draftId === draftId); }
  create(draft: OfflineDraft): OfflineDraft { const existing = this.find(draft.memberId, draft.draftId); if (existing) return existing; this.values.push(draft); return draft; }
  update(memberId: string, draftId: string, changes: Pick<OfflineDraft, "status" | "captureId" | "error" | "retryable" | "updatedAt">): OfflineDraft { const draft = this.find(memberId, draftId)!; Object.assign(draft, changes); return draft; }
}

class MemoryCaptureRepository {
  readonly values: Capture[] = [];
  findByIdempotencyKey(memberId: string, idempotencyKey: string): Capture | undefined { return this.values.find((capture) => capture.memberId === memberId && capture.idempotencyKey === idempotencyKey); }
  findById(id: string): Capture | undefined { return this.values.find((capture) => capture.id === id); }
  create(capture: Capture): Capture { this.values.push(capture); return capture; }
  markStored(id: string): void { const capture = this.findById(id); if (capture) this.values[this.values.indexOf(capture)] = { ...capture, storageState: "stored" }; }
}

class MemoryBlobStorage {
  readonly values = new Map<string, Uint8Array>();
  async write(identifier: string, content: Uint8Array): Promise<void> { this.values.set(identifier, content); }
  async read(identifier: string): Promise<Uint8Array> { return this.values.get(identifier) ?? Uint8Array.from([]); }
}

class FailingBlobStorage extends MemoryBlobStorage {
  fail = true;
  override async write(identifier: string, content: Uint8Array): Promise<void> { if (this.fail) throw new Error("storage unavailable"); await super.write(identifier, content); }
}
