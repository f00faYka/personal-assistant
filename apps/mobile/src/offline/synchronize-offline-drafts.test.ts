import { expect, test, vi } from "vitest";

import type { OfflineDraft } from "./offline-drafts";
import { createOfflineDraftSyncClient } from "./synchronize-offline-drafts";

const draft: OfflineDraft = {
  draftId: "draft-1",
  memberId: "member-1",
  capturedAt: "2026-08-15T10:00:00.000Z",
  source: { kind: "audio", uri: "file:///draft.m4a", contentType: "audio/m4a" },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("synchronizes audio and removes the unconfirmed boundary only after server confirmation", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(response({ draft: { draftId: "draft-1", status: "accepted" } }))
    .mockResolvedValueOnce(response({ status: { draftId: "draft-1", state: "processing", processing: "pending", retryable: false, capture: { id: "capture-1", detailUrl: "/captures/capture-1/review" } } }))
    .mockResolvedValueOnce(response({ status: { draftId: "draft-1", state: "confirmed", processing: "confirmed", retryable: false, capture: { id: "capture-1", detailUrl: "/captures/capture-1/review" }, result: { kind: "note", id: "note-1", detailUrl: "/captures/capture-1/review" } } }));
  const readBase64 = vi.fn().mockResolvedValue("AQI=");
  const client = createOfflineDraftSyncClient("http://api.test", { fetcher, readBase64, delay: vi.fn().mockResolvedValue(undefined), pollIntervalMs: 0 });

  await expect(client.synchronize(draft)).resolves.toMatchObject({ state: "confirmed", result: { id: "note-1" } });
  expect(readBase64).toHaveBeenCalledWith("file:///draft.m4a");
  expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string)).toMatchObject({
    draftId: "draft-1", memberId: "member-1", source: { kind: "audio", audioBase64: "AQI=", contentType: "audio/m4a" },
  });
});

test("retains a draft and reports a retryable failure when synchronization cannot reach the server", async () => {
  const client = createOfflineDraftSyncClient("http://api.test", {
    fetcher: vi.fn().mockRejectedValue(new Error("offline")),
  });

  await expect(client.synchronize({ ...draft, source: { kind: "text", text: "Call the dentist" } })).resolves.toEqual({
    draftId: "draft-1", state: "failed", retryable: true, message: "offline",
  });
});

test("deduplicates repeated synchronization triggers for one draft", async () => {
  let release!: () => void;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(response({ draft: { draftId: "draft-1", status: "accepted" } }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = () => resolve(response({ status: { draftId: "draft-1", state: "confirmed", processing: "confirmed", retryable: false } })); }));
  const client = createOfflineDraftSyncClient("http://api.test", { fetcher });
  const first = client.synchronize({ ...draft, source: { kind: "text", text: "Call the dentist" } });
  const second = client.synchronize({ ...draft, source: { kind: "text", text: "Call the dentist" } });

  expect(first).toBe(second);
  await Promise.resolve();
  release();
  await expect(first).resolves.toMatchObject({ state: "confirmed" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
