import { afterEach, describe, expect, test } from "vitest";

import { CaptureService } from "../captures/capture.js";
import { buildApi } from "../../http/build-api.js";
import { registerOfflineDraftRoutes } from "./offline-draft-routes.js";
import { OfflineDraftService, type OfflineDraft, type OfflineDraftRepository } from "./offline-draft.js";

describe("Offline draft routes", () => {
  const applications: Array<ReturnType<typeof buildApi>> = [];

  afterEach(async () => Promise.all(applications.splice(0).map((application) => application.close())));

  test("syncs text and exposes the durable unconfirmed state", async () => {
    const application = buildApi({ logger: false });
    registerOfflineDraftRoutes(application, new OfflineDraftService(new MemoryDraftRepository(), new CaptureService(new MemoryCaptureRepository(), new MemoryBlobStorage())));
    applications.push(application);

    const response = await application.inject({
      method: "POST",
      url: "/offline-drafts/sync",
      payload: { draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "text", text: "Buy milk" } },
    });
    const draft = response.json<{ draft: OfflineDraft }>().draft;

    expect(response.statusCode).toBe(200);
    expect(draft).toMatchObject({ draftId: "draft-1", status: "accepted", text: "Buy milk" });
    const retrieval = await application.inject({ method: "GET", url: "/offline-drafts/draft-1?memberId=member-1" });
    expect(retrieval.statusCode).toBe(200);
    expect(retrieval.json()).toEqual({ draft });
  });

  test("rejects invalid source data", async () => {
    const application = buildApi({ logger: false });
    registerOfflineDraftRoutes(application, new OfflineDraftService(new MemoryDraftRepository(), new CaptureService(new MemoryCaptureRepository(), new MemoryBlobStorage())));
    applications.push(application);

    const response = await application.inject({ method: "POST", url: "/offline-drafts/sync", payload: { draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "audio", audioBase64: "%%%", contentType: "audio/m4a" } } });

    expect(response.statusCode).toBe(400);
  });
});

class MemoryDraftRepository implements OfflineDraftRepository {
  readonly values: OfflineDraft[] = [];
  find(memberId: string, draftId: string): OfflineDraft | undefined { return this.values.find((draft) => draft.memberId === memberId && draft.draftId === draftId); }
  create(draft: OfflineDraft): OfflineDraft { this.values.push(draft); return draft; }
  update(memberId: string, draftId: string, changes: Pick<OfflineDraft, "status" | "captureId" | "error" | "retryable" | "updatedAt">): OfflineDraft { const draft = this.find(memberId, draftId)!; Object.assign(draft, changes); return draft; }
}

class MemoryCaptureRepository {
  findByIdempotencyKey(): undefined { return undefined; }
  findById(): undefined { return undefined; }
  create<T>(capture: T): T { return capture; }
  markStored(): void {}
}

class MemoryBlobStorage {
  async write(): Promise<void> {}
  async read(): Promise<Uint8Array> { return Uint8Array.from([]); }
}
