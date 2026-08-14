import { afterEach, describe, expect, test } from "vitest";

import type { Capture } from "../captures/capture.js";
import { buildApi } from "../../http/build-api.js";
import { ReviewService } from "./review.js";
import { registerReviewRoutes } from "./review-routes.js";

describe("Review routes", () => {
  const applications: Array<ReturnType<typeof buildApi>> = [];

  afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.close()));
  });

  test("returns the provenance contract for a Capture", async () => {
    const application = buildApi({ logger: false });
    registerReviewRoutes(application, new ReviewService({
      captureService: { get: () => capture },
      transcriptionRepository: { findByCaptureId: () => undefined },
      interpretationRepository: { findByTranscriptionId: () => undefined },
      outcomeRepository: { findByInterpretationId: () => undefined },
    }));
    applications.push(application);

    const response = await application.inject({ method: "GET", url: "/captures/capture-1/review" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      review: {
        state: "pending",
        source: { id: "source-1", captureId: "capture-1", content: { kind: "audio" }, blobIdentifier: "captures/capture-1/original-audio" },
        transcription: null,
        correction: null,
        interpretation: null,
        outcome: null,
      },
    });
  });
});

const capture: Capture = {
  id: "capture-1",
  sourceId: "source-1",
  memberId: "member-1",
  idempotencyKey: "key-1",
  contentType: "audio/mpeg",
  byteLength: 3,
  contentSha256: "hash",
  capturedAt: "2026-08-14T10:00:00.000Z",
  createdAt: "2026-08-14T10:00:00.000Z",
  storageState: "stored",
};
