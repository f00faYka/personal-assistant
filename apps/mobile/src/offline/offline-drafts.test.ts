import { describe, expect, test, vi } from "vitest";

import { createOfflineDraftStore, type OfflineDraftPersistence } from "./offline-drafts";

describe("Offline draft store", () => {
  test("preserves an audio draft and restores it after a new store instance starts", async () => {
    const persistence = memoryPersistence();
    const store = createOfflineDraftStore(persistence);

    await store.save({
      draftId: "draft-audio-1",
      memberId: "member-1",
      capturedAt: "2026-08-15T10:00:00.000Z",
      source: { kind: "audio", uri: "file:///temporary/capture.m4a", contentType: "audio/m4a" },
    });

    await expect(createOfflineDraftStore(persistence).list("member-1")).resolves.toEqual([
      {
        draftId: "draft-audio-1",
        memberId: "member-1",
        capturedAt: "2026-08-15T10:00:00.000Z",
        source: { kind: "audio", uri: "file:///documents/draft-audio-1.m4a", contentType: "audio/m4a" },
      },
    ]);
  });

  test("preserves text drafts without presenting them as confirmed results", async () => {
    const store = createOfflineDraftStore(memoryPersistence());

    const draft = await store.save({
      draftId: "draft-text-1",
      memberId: "member-1",
      capturedAt: "2026-08-15T11:00:00.000Z",
      source: { kind: "text", text: "Call the dentist" },
    });

    expect(draft).toEqual({
      draftId: "draft-text-1",
      memberId: "member-1",
      capturedAt: "2026-08-15T11:00:00.000Z",
      source: { kind: "text", text: "Call the dentist" },
    });
    expect(draft).not.toHaveProperty("kind", "note");
    expect(draft).not.toHaveProperty("kind", "task");
  });

  test("restores multiple drafts newest first and keeps Members isolated", async () => {
    const store = createOfflineDraftStore(memoryPersistence());
    await store.save({ draftId: "older", memberId: "member-1", capturedAt: "2026-08-15T09:00:00.000Z", source: { kind: "text", text: "Older" } });
    await store.save({ draftId: "other-member", memberId: "member-2", capturedAt: "2026-08-15T12:00:00.000Z", source: { kind: "text", text: "Private" } });
    await store.save({ draftId: "newer", memberId: "member-1", capturedAt: "2026-08-15T11:00:00.000Z", source: { kind: "text", text: "Newer" } });

    await expect(store.list("member-1")).resolves.toMatchObject([
      { draftId: "newer", source: { kind: "text", text: "Newer" } },
      { draftId: "older", source: { kind: "text", text: "Older" } },
    ]);
  });

  test("surfaces corrupted storage instead of silently losing drafts", async () => {
    const persistence = memoryPersistence();
    persistence.readManifest = vi.fn().mockResolvedValue("not-json");

    await expect(createOfflineDraftStore(persistence).list("member-1")).rejects.toThrow("Offline draft storage is corrupted");
  });

  test("does not report an audio draft as saved when durable persistence fails", async () => {
    const persistence = memoryPersistence();
    persistence.writeManifest = vi.fn().mockRejectedValue(new Error("disk full"));

    await expect(createOfflineDraftStore(persistence).save({
      draftId: "draft-audio-1",
      memberId: "member-1",
      capturedAt: "2026-08-15T10:00:00.000Z",
      source: { kind: "audio", uri: "file:///temporary/capture.m4a", contentType: "audio/m4a" },
    })).rejects.toThrow("disk full");
    expect(persistence.deleteAudio).toHaveBeenCalledWith("file:///documents/draft-audio-1.m4a");
  });

  test("removes a draft only through the explicit delete operation", async () => {
    const persistence = memoryPersistence();
    const store = createOfflineDraftStore(persistence);
    await store.save({ draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "audio", uri: "file:///temporary/capture.m4a", contentType: "audio/m4a" } });

    await expect(store.list("member-1")).resolves.toHaveLength(1);
    await store.remove("member-1", "draft-1");

    await expect(store.list("member-1")).resolves.toEqual([]);
    expect(persistence.deleteAudio).toHaveBeenCalledWith("file:///documents/draft-1.m4a");
  });

  test("serializes concurrent mutations so one draft cannot overwrite another", async () => {
    const persistence = memoryPersistence();
    let releaseFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const writeManifest = persistence.writeManifest;
    vi.mocked(persistence.writeManifest)
      .mockImplementationOnce(async (contents) => { await firstWrite; await writeManifest(contents); });
    const store = createOfflineDraftStore(persistence);

    const first = store.save({ draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "text", text: "First" } });
    const second = store.save({ draftId: "draft-2", memberId: "member-1", capturedAt: "2026-08-15T11:00:00.000Z", source: { kind: "text", text: "Second" } });
    releaseFirstWrite();
    await Promise.all([first, second]);

    await expect(store.list("member-1")).resolves.toHaveLength(2);
  });

  test("rejects reuse of a draft ID for different source content", async () => {
    const store = createOfflineDraftStore(memoryPersistence());
    await store.save({ draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "text", text: "First" } });

    await expect(store.save({ draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "text", text: "Changed" } }))
      .rejects.toThrow("Offline draft conflicts with existing source: draft-1");
  });
});

function memoryPersistence(): OfflineDraftPersistence {
  let manifest: string | null = null;
  return {
    readManifest: vi.fn(async () => manifest),
    writeManifest: vi.fn(async (value: string) => { manifest = value; }),
    copyAudio: vi.fn(async (_sourceUri: string, draftId: string) => `file:///documents/${draftId}.m4a`),
    deleteAudio: vi.fn(async () => undefined),
  };
}
