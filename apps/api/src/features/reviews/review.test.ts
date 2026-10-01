import { describe, expect, test } from "vitest";

import type { Capture } from "../captures/capture.js";
import type { Interpretation } from "../interpretations/interpretation.js";
import type { Outcome } from "../outcomes/outcome.js";
import type { Transcription } from "../transcriptions/transcription.js";
import { ReviewService, type CorrectionRecord } from "./review.js";

describe("ReviewService", () => {
  test("returns a complete, separate provenance chain", () => {
    const transcription = transcriptionRecord();
    const interpretation = interpretationRecord();
    const outcome = outcomeRecord();
    const review = service({ transcription, interpretation, outcome }).get("capture-1");

    expect(review).toMatchObject({
      state: "completed",
      capture: { id: "capture-1" },
      source: { id: "source-1", captureId: "capture-1", blobIdentifier: "captures/capture-1/original-audio" },
      transcription: { id: "transcription-1", text: "buy milk" },
      correction: null,
      interpretation: { id: "interpretation-1", transcriptionId: "transcription-1" },
      outcome: { id: "outcome-1", interpretationId: "interpretation-1" },
      failure: null,
    });
    expect(review.source).toMatchObject({ content: { kind: "audio", sha256: "hash" } });
  });

  test("distinguishes a pending partial chain from a missing correction", () => {
    const review = service({}).get("capture-1");

    expect(review.state).toBe("pending");
    expect(review.transcription).toBeNull();
    expect(review.interpretation).toBeNull();
    expect(review.outcome).toBeNull();
    expect(review.correction).toBeNull();
    expect(review.failure).toBeNull();
  });

  test("exposes failed transcription without treating it as an absent stage", () => {
    const review = service({ transcription: transcriptionRecord({ status: "failed", error: "provider offline" }) }).get("capture-1");

    expect(review.state).toBe("failed");
    expect(review.transcription).toMatchObject({ status: "failed", error: "provider offline" });
    expect(review.failure).toEqual({ stage: "transcription", message: "provider offline" });
  });

  test("exposes ambiguous outcomes as Needs review", () => {
    const review = service({
      transcription: transcriptionRecord(),
      interpretation: interpretationRecord({ classification: "ambiguous" }),
      outcome: {
        kind: "note",
        id: "outcome-1",
        memberId: "member-1",
        interpretationId: "interpretation-1",
        captureId: "capture-1",
        sourceId: "source-1",
        content: "maybe do something",
        reviewState: "needs_review",
        version: 0,
        createdAt: "2026-08-14T10:00:00.000Z",
      },
    }).get("capture-1");

    expect(review.state).toBe("needs_review");
  });

  test("keeps a materialization without a durable outcome pending", () => {
    const review = service({
      transcription: transcriptionRecord(),
      interpretation: interpretationRecord(),
    }).get("capture-1");

    expect(review.state).toBe("pending");
    expect(review.outcome).toBeNull();
  });

  test("includes a correction as a separate provenance record when one exists", () => {
    const correction: CorrectionRecord = {
      id: "correction-1",
      captureId: "capture-1",
      sourceId: "source-1",
      text: "buy oat milk",
      createdAt: "2026-08-14T10:01:00.000Z",
    };
    const review = new ReviewService({
      captureService: { get: () => captureRecord() },
      transcriptionRepository: { findByCaptureId: () => undefined },
      interpretationRepository: { findByTranscriptionId: () => undefined },
      outcomeRepository: { findByInterpretationId: () => undefined },
      correctionRepository: { findByCaptureId: () => correction },
    }).get("capture-1");

    expect(review.correction).toEqual(correction);
    expect(review.transcription).toBeNull();
  });
});

function service(records: {
  transcription?: Transcription;
  interpretation?: Interpretation;
  outcome?: Outcome;
}) {
  const capture = captureRecord();
  return new ReviewService({
    captureService: { get: () => capture },
    transcriptionRepository: { findByCaptureId: () => records.transcription },
    interpretationRepository: { findByTranscriptionId: () => records.interpretation },
    outcomeRepository: { findByInterpretationId: () => records.outcome },
  });
}

function captureRecord(overrides: Partial<Capture> = {}): Capture {
  return {
    id: "capture-1",
    sourceId: "source-1",
    memberId: "member-1",
    idempotencyKey: "key-1",
    contentType: "audio/mpeg",
    byteLength: 3,
    contentSha256: "hash",
    capturedAt: "2026-08-14T10:00:00.000Z",
    timeZone: "UTC",
    createdAt: "2026-08-14T10:00:00.000Z",
    storageState: "stored",
    ...overrides,
  };
}

function transcriptionRecord(overrides: Partial<Transcription> = {}): Transcription {
  return {
    id: "transcription-1",
    captureId: "capture-1",
    sourceId: "source-1",
    contentType: "audio/mpeg",
    status: "succeeded",
    text: "buy milk",
    provider: "test",
    model: "test-model",
    attemptCount: 1,
    createdAt: "2026-08-14T10:00:00.000Z",
    updatedAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  };
}

function interpretationRecord(overrides: Partial<Interpretation> = {}): Interpretation {
  return {
    id: "interpretation-1",
    captureId: "capture-1",
    sourceId: "source-1",
    transcriptionId: "transcription-1",
    catalogVersion: "direct-instructions.v1",
    model: "test-model",
    rawOutputJson: '{"action":"create_task"}',
    classification: "clear_supported",
    createdAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  };
}

function outcomeRecord(): Outcome {
  return {
    kind: "task",
    id: "outcome-1",
    memberId: "member-1",
    interpretationId: "interpretation-1",
    captureId: "capture-1",
    sourceId: "source-1",
    title: "Buy milk",
    status: "open",
    version: 0,
    createdAt: "2026-08-14T10:00:00.000Z",
  };
}
