import { beforeEach, describe, expect, test, vi } from "vitest";

const fakeFileSystem = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failNextManifestPromotion: false,
  failNextAudioRestore: false,
  failNextStagedDelete: false,
}));

vi.mock("expo-file-system", () => {
  const join = (parts: readonly unknown[]) => parts.map((part) => typeof part === "string" ? part : (part as { uri: string }).uri)
    .reduce((uri, part) => `${uri.replace(/\/$/, "")}/${part.replace(/^\//, "")}`);

  class Directory {
    readonly uri: string;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    get exists() { return true; }
    create() { /* The in-memory directory always exists. */ }
    list() { return [...fakeFileSystem.files.keys()].filter((uri) => uri.startsWith(`${this.uri}/`)).map((uri) => new File(uri)); }
  }

  class File {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = parts.length === 1 && typeof parts[0] === "string" ? parts[0] : join(parts); }
    get exists() { return fakeFileSystem.files.has(this.uri); }
    async text() { return fakeFileSystem.files.get(this.uri) ?? ""; }
    write(contents: string) { fakeFileSystem.files.set(this.uri, contents); }
    delete() {
      if (fakeFileSystem.failNextStagedDelete && this.uri.endsWith(".m4a.deleting")) {
        fakeFileSystem.failNextStagedDelete = false;
        throw new Error("file busy");
      }
      fakeFileSystem.files.delete(this.uri);
    }
    copy(destination: File) { fakeFileSystem.files.set(destination.uri, fakeFileSystem.files.get(this.uri) ?? "audio"); }
    move(destination: File) {
      if (fakeFileSystem.failNextManifestPromotion && this.uri.endsWith("manifest.next.json") && destination.uri.endsWith("manifest.json")) {
        fakeFileSystem.failNextManifestPromotion = false;
        throw new Error("promotion interrupted");
      }
      if (fakeFileSystem.failNextAudioRestore && this.uri.endsWith(".m4a.deleting") && destination.uri.endsWith(".m4a")) {
        fakeFileSystem.failNextAudioRestore = false;
        throw new Error("restore interrupted");
      }
      const contents = fakeFileSystem.files.get(this.uri);
      if (contents === undefined) throw new Error("source missing");
      fakeFileSystem.files.delete(this.uri);
      fakeFileSystem.files.set(destination.uri, contents);
      this.uri = destination.uri;
    }
  }

  return { Directory, File, Paths: { document: "file:///documents" } };
});

import { createExpoOfflineDraftStore } from "./expo-offline-drafts";

describe("Expo Offline draft persistence", () => {
  beforeEach(() => {
    fakeFileSystem.files.clear();
    fakeFileSystem.failNextManifestPromotion = false;
    fakeFileSystem.failNextAudioRestore = false;
    fakeFileSystem.failNextStagedDelete = false;
  });

  test("keeps the last durable manifest when replacement is interrupted", async () => {
    const store = createExpoOfflineDraftStore();
    await store.save({ draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "text", text: "First" } });
    fakeFileSystem.failNextManifestPromotion = true;

    await expect(store.save({ draftId: "draft-2", memberId: "member-1", capturedAt: "2026-08-15T11:00:00.000Z", source: { kind: "text", text: "Second" } }))
      .rejects.toThrow("promotion interrupted");

    await expect(createExpoOfflineDraftStore().list("member-1")).resolves.toMatchObject([
      { draftId: "draft-1", source: { kind: "text", text: "First" } },
    ]);
  });

  test("restores staged audio after both manifest promotion and immediate rollback are interrupted", async () => {
    fakeFileSystem.files.set("file:///capture.m4a", "audio");
    const store = createExpoOfflineDraftStore();
    await store.save({ draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "audio", uri: "file:///capture.m4a", contentType: "audio/m4a" } });
    fakeFileSystem.failNextManifestPromotion = true;
    fakeFileSystem.failNextAudioRestore = true;

    await expect(store.remove("member-1", "draft-1")).rejects.toThrow("promotion interrupted");
    expect(fakeFileSystem.files.has("file:///documents/offline-drafts/draft-1.m4a.deleting")).toBe(true);

    await expect(createExpoOfflineDraftStore().list("member-1")).resolves.toHaveLength(1);
    expect(fakeFileSystem.files.has("file:///documents/offline-drafts/draft-1.m4a")).toBe(true);
    expect(fakeFileSystem.files.has("file:///documents/offline-drafts/draft-1.m4a.deleting")).toBe(false);
  });

  test("finishes deferred staged-file cleanup from the committed manifest on restart", async () => {
    fakeFileSystem.files.set("file:///capture.m4a", "audio");
    const store = createExpoOfflineDraftStore();
    await store.save({ draftId: "draft-1", memberId: "member-1", capturedAt: "2026-08-15T10:00:00.000Z", source: { kind: "audio", uri: "file:///capture.m4a", contentType: "audio/m4a" } });
    fakeFileSystem.failNextStagedDelete = true;

    await expect(store.remove("member-1", "draft-1")).resolves.toBeUndefined();
    expect(fakeFileSystem.files.has("file:///documents/offline-drafts/draft-1.m4a.deleting")).toBe(true);

    await expect(createExpoOfflineDraftStore().list("member-1")).resolves.toEqual([]);
    expect(fakeFileSystem.files.has("file:///documents/offline-drafts/draft-1.m4a.deleting")).toBe(false);
  });
});
