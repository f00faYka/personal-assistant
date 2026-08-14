import { describe, expect, test, vi } from "vitest";

import { createCaptureSubmitter, createIdempotencyKey } from "./voice-capture";

describe("Capture submission client", () => {
  test("submits the recorded audio using the backend contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ capture: { id: "capture-1" } }), { status: 201 }));
    const submitter = createCaptureSubmitter("http://api.test", async () => "AQI=", fetcher);

    await expect(submitter.submit({
      memberId: "member-1",
      idempotencyKey: "capture-key",
      audio: { uri: "file:///capture.m4a", contentType: "audio/m4a" },
      capturedAt: "2026-08-14T10:00:00.000Z",
    })).resolves.toEqual({ captureId: "capture-1" });

    expect(fetcher).toHaveBeenCalledWith("http://api.test/captures", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        memberId: "member-1",
        idempotencyKey: "capture-key",
        audioBase64: "AQI=",
        contentType: "audio/m4a",
        capturedAt: "2026-08-14T10:00:00.000Z",
      }),
    }));
  });

  test("keeps server failures retryable", async () => {
    const submitter = createCaptureSubmitter("http://api.test", async () => "AQI=", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(submitter.submit({
      memberId: "member-1",
      idempotencyKey: "capture-key",
      audio: { uri: "file:///capture.m4a", contentType: "audio/m4a" },
      capturedAt: "2026-08-14T10:00:00.000Z",
    })).rejects.toThrow("Unable to submit Capture (503)");
  });

  test("creates a non-empty idempotency key", () => {
    expect(createIdempotencyKey()).toMatch(/^capture-/);
  });
});
