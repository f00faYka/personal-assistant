import { afterEach, describe, expect, test } from "vitest";

import type { Capture } from "../captures/capture.js";
import type { Outcome } from "../outcomes/outcome.js";
import { NoteService } from "../outcomes/outcome.js";
import { registerOutcomeRoutes } from "../outcomes/outcome-routes.js";
import type { Interpretation } from "../interpretations/interpretation.js";
import type { Transcription } from "../transcriptions/transcription.js";
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

  test("explicitly saves and edits one Note from review", async () => {
    const outcomes: Outcome[] = [];
    const interpretation: Interpretation = {
      id: "interpretation-1",
      captureId: "capture-1",
      sourceId: "source-1",
      transcriptionId: "transcription-1",
      catalogVersion: "direct-instructions.v1",
      model: "test-model",
      rawOutputJson: '{"action":"none","reason":"ordinary"}',
      classification: "ordinary",
      createdAt: "2026-08-14T10:00:00.000Z",
    };
    const transcription: Transcription = {
      id: "transcription-1",
      captureId: "capture-1",
      sourceId: "source-1",
      contentType: "audio/mpeg",
      status: "succeeded",
      text: "remember the garden",
      provider: "test",
      model: "test-model",
      attemptCount: 1,
      createdAt: "2026-08-14T10:00:00.000Z",
      updatedAt: "2026-08-14T10:00:00.000Z",
    };
    const repository = {
      findByInterpretationId: (id: string) => outcomes.find((value) => value.interpretationId === id),
      findById: (id: string) => outcomes.find((value) => value.id === id),
      create: (outcome: Outcome) => { outcomes.push(outcome); return outcome; },
      updateNote: (id: string, memberId: string, expectedVersion: number, changes: { content?: string }) => {
        const index = outcomes.findIndex((value) => value.id === id && value.kind === "note" && value.memberId === memberId && value.version === expectedVersion);
        if (index < 0) return undefined;
        const note = outcomes[index];
        if (!note || note.kind !== "note") return undefined;
        const updated = { ...note, ...(changes.content === undefined ? {} : { content: changes.content }), version: note.version + 1 };
        outcomes[index] = updated;
        return updated;
      },
      convertNoteToTask: (id: string, memberId: string, expectedVersion: number) => {
        const index = outcomes.findIndex((value) => value.id === id && value.kind === "note" && value.memberId === memberId && value.version === expectedVersion);
        if (index < 0) return undefined;
        const note = outcomes[index];
        if (!note || note.kind !== "note") return undefined;
        const task = {
          kind: "task" as const,
          id: note.id,
          memberId: note.memberId,
          interpretationId: note.interpretationId,
          captureId: note.captureId,
          sourceId: note.sourceId,
          title: note.content,
          status: "open" as const,
          version: note.version + 1,
          createdAt: note.createdAt,
        };
        outcomes[index] = task;
        return task;
      },
    };
    const application = buildApi({ logger: false });
    registerReviewRoutes(application, new ReviewService({
      captureService: { get: () => capture },
      transcriptionRepository: { findByCaptureId: () => transcription },
      interpretationRepository: { findByTranscriptionId: () => interpretation },
      outcomeRepository: { findByInterpretationId: () => outcomes[0] },
    }));
    registerOutcomeRoutes(application, new NoteService(repository), new ReviewService({
      captureService: { get: () => capture },
      transcriptionRepository: { findByCaptureId: () => transcription },
      interpretationRepository: { findByTranscriptionId: () => interpretation },
      outcomeRepository: { findByInterpretationId: () => outcomes[0] },
    }));
    applications.push(application);

    const saved = await application.inject({
      method: "POST",
      url: "/captures/capture-1/review/note",
      payload: { memberId: "member-1", content: "Remember to water the garden" },
    });
    const edited = await application.inject({
      method: "PATCH",
      url: "/notes/" + saved.json().note.id,
      payload: { memberId: "member-1", expectedVersion: 0, content: "Water the garden on Sunday" },
    });
    const converted = await application.inject({
      method: "POST",
      url: "/notes/" + saved.json().note.id + "/convert-to-task",
      payload: { memberId: "member-1", expectedVersion: 1 },
    });

    expect(saved.statusCode).toBe(201);
    expect(edited.statusCode).toBe(200);
    expect(edited.json().note).toMatchObject({ content: "Water the garden on Sunday", version: 1 });
    expect(edited.json().note).toMatchObject({ captureId: "capture-1", sourceId: "source-1", interpretationId: "interpretation-1" });
    expect(converted.statusCode).toBe(200);
    expect(converted.json().task).toMatchObject({
      id: saved.json().note.id,
      title: "Water the garden on Sunday",
      status: "open",
      version: 2,
      captureId: "capture-1",
      sourceId: "source-1",
      interpretationId: "interpretation-1",
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
