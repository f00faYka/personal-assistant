import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { CaptureService } from "../captures/capture.js";
import { MemberItemsService } from "../items/items.js";
import { OutcomeService } from "../outcomes/outcome.js";
import { ReviewService } from "../reviews/review.js";
import {
  TranscriptionService,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "../transcriptions/transcription.js";
import { TranscriptionWorker } from "../transcriptions/transcription-worker.js";
import { buildApi } from "../../http/build-api.js";
import { FileSystemBlobStorage } from "../../infrastructure/blob-storage/filesystem-blob-storage.js";
import { SqliteCaptureRepository } from "../../infrastructure/sqlite/sqlite-capture-repository.js";
import { SqliteInterpretationJobRepository } from "../../infrastructure/sqlite/sqlite-interpretation-job-repository.js";
import { SqliteInterpretationRepository } from "../../infrastructure/sqlite/sqlite-interpretation-repository.js";
import { SqliteMemberItemsRepository } from "../../infrastructure/sqlite/sqlite-member-items-repository.js";
import { SqliteOutcomeRepository } from "../../infrastructure/sqlite/sqlite-outcome-repository.js";
import { SqliteTranscriptionRepository } from "../../infrastructure/sqlite/sqlite-transcription-repository.js";
import { prepareRuntime } from "../../runtime.js";
import {
  InterpretationService,
  type InterpretationProvider,
  type InterpretationProviderResult,
} from "./interpretation.js";
import { InterpretationWorker } from "./interpretation-worker.js";

describe("production interpretation runtime", () => {
  const harnesses: RuntimeHarness[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  test("duplicate Capture delivery produces one interpreted Task visible through list and review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-interpretation-runtime-"));
    directories.push(directory);
    const interpretationProvider = new DeterministicInterpretationProvider({
      action: "create_task",
      title: "Buy milk",
    });
    const harness = await createHarness(directory, interpretationProvider);
    harnesses.push(harness);

    const first = await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const second = await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const captureId = first.json<{ capture: { id: string } }>().capture.id;
    const item = await waitForItem(harness, captureId);
    const review = await harness.application.inject({ method: "GET", url: `/captures/${captureId}/review` });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(item).toMatchObject({
      kind: "task",
      captureId,
      title: "Buy milk",
      state: "open",
    });
    expect(review.json().review).toMatchObject({
      state: "completed",
      interpretation: {
        classification: "clear_supported",
        model: "deterministic-qwen",
        rawOutputJson: '{"action":"create_task","title":"Buy milk"}',
      },
      outcome: { kind: "task", title: "Buy milk" },
    });
    expect(interpretationProvider.calls).toBe(1);

    await harness.close();
    harnesses.splice(harnesses.indexOf(harness), 1);
    const restartedProvider = new DeterministicInterpretationProvider({ action: "none", reason: "ordinary" });
    const restartedHarness = await createHarness(directory, restartedProvider);
    harnesses.push(restartedHarness);

    expect(await waitForItem(restartedHarness, captureId)).toMatchObject({
      kind: "task",
      captureId,
      title: "Buy milk",
    });
    expect(restartedProvider.calls).toBe(0);
  });

  test("the explicit Strava request produces one Task with normalized due metadata and provenance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-interpretation-strava-"));
    directories.push(directory);
    const provider = new DeterministicInterpretationProvider({
      action: "create_task",
      title: "Task, please remind me to cancel subscription to the Strava series",
    });
    const harness = await createHarness(
      directory,
      provider,
      3,
      "Task, please remind me to cancel subscription to the Strava series on the 1st of September.",
    );
    harnesses.push(harness);

    const response = await harness.application.inject({
      method: "POST",
      url: "/captures",
      payload: { ...submission(), capturedAt: "2026-08-23T12:00:00.000Z" },
    });
    const captureId = response.json<{ capture: { id: string } }>().capture.id;
    const item = await waitForItem(harness, captureId);
    const review = await waitForReviewState(harness, captureId, "completed");

    expect(item).toMatchObject({
      kind: "task",
      title: "cancel subscription to the Strava series",
      dueAt: "2026-09-01T00:00:00.000Z",
    });
    expect(review).toMatchObject({
      capture: { id: captureId, capturedAt: "2026-08-23T12:00:00.000Z" },
      transcription: { text: "Task, please remind me to cancel subscription to the Strava series on the 1st of September." },
      interpretation: { classification: "clear_supported" },
      outcome: { kind: "task", title: "cancel subscription to the Strava series", dueAt: "2026-09-01T00:00:00.000Z" },
    });
  });

  test("incomplete Task output remains a Needs review Note without materializing a Task", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-interpretation-malformed-"));
    directories.push(directory);
    const harness = await createHarness(
      directory,
      new DeterministicInterpretationProvider({ action: "create_task", reason: "ambiguous" }),
      3,
      "Task, please remind me to cancel subscription on the 1st of September.",
    );
    harnesses.push(harness);

    const response = await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const captureId = response.json<{ capture: { id: string } }>().capture.id;
    const item = await waitForItem(harness, captureId);
    const review = await waitForReviewState(harness, captureId, "needs_review");

    expect(item).toMatchObject({ kind: "note", captureId, state: "needs_review" });
    expect(review).toMatchObject({
      interpretation: { classification: "unsupported", rejectionReason: "malformed_model_output" },
      outcome: { kind: "note", reviewState: "needs_review" },
    });
  });

  test("ordinary, ambiguous, and unsupported interpretations each produce one correctly reviewed Note", async () => {
    const cases = [
      {
        rawOutput: { action: "none", reason: "ordinary" },
        classification: "ordinary",
        state: "none",
        reviewState: "completed",
      },
      {
        rawOutput: { action: "none", reason: "ambiguous" },
        classification: "ambiguous",
        state: "needs_review",
        reviewState: "needs_review",
      },
      {
        rawOutput: { action: "delete_task", title: "Private Task" },
        classification: "unsupported",
        state: "needs_review",
        reviewState: "needs_review",
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const directory = await mkdtemp(join(tmpdir(), `personal-assistant-interpretation-note-${index}-`));
      directories.push(directory);
      const provider = new DeterministicInterpretationProvider(testCase.rawOutput);
      const harness = await createHarness(directory, provider);
      harnesses.push(harness);

      const response = await harness.application.inject({
        method: "POST",
        url: "/captures",
        payload: submission(),
      });
      const captureId = response.json<{ capture: { id: string } }>().capture.id;
      const item = await waitForItem(harness, captureId);
      const review = await harness.application.inject({
        method: "GET",
        url: `/captures/${captureId}/review`,
      });

      expect(item).toMatchObject({ kind: "note", captureId, state: testCase.state });
      expect(review.json().review).toMatchObject({
        state: testCase.reviewState,
        interpretation: { classification: testCase.classification },
        outcome: { kind: "note", reviewState: testCase.state },
      });
      expect(provider.calls).toBe(1);
    }
  });

  test("provider failure is retryable and restart recovery preserves the Capture before producing one item", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-interpretation-restart-"));
    directories.push(directory);
    const unavailableProvider = new DeterministicInterpretationProvider(
      { action: "create_task", title: "Buy milk" },
      1,
    );
    const firstRuntime = await createHarness(directory, unavailableProvider, 2);
    harnesses.push(firstRuntime);

    const response = await firstRuntime.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const captureId = response.json<{ capture: { id: string } }>().capture.id;
    const failed = await waitForReviewState(firstRuntime, captureId, "failed");
    const failedList = await firstRuntime.application.inject({
      method: "GET",
      url: "/items?memberId=member-1",
    });

    expect(failed).toMatchObject({
      state: "failed",
      transcription: { status: "succeeded", text: "add task buy milk" },
      interpretation: null,
      interpretationProcessing: {
        status: "failed",
        attemptCount: 1,
        retryable: true,
      },
      outcome: null,
      failure: {
        stage: "interpretation",
        message: "local Ollama unavailable",
        retryable: true,
      },
    });
    expect(failedList.json().items).toContainEqual(expect.objectContaining({
      kind: "capture",
      captureId,
      state: "failed",
    }));

    await firstRuntime.close();
    harnesses.splice(harnesses.indexOf(firstRuntime), 1);
    const recoveredProvider = new DeterministicInterpretationProvider({
      action: "create_task",
      title: "Buy milk",
    });
    const restartedRuntime = await createHarness(directory, recoveredProvider, 2);
    harnesses.push(restartedRuntime);

    expect(await waitForItem(restartedRuntime, captureId)).toMatchObject({
      kind: "task",
      captureId,
      title: "Buy milk",
    });
    const recovered = await waitForReviewState(restartedRuntime, captureId, "completed");
    expect(recovered.interpretationProcessing).toMatchObject({
      status: "succeeded",
      attemptCount: 2,
      retryable: false,
    });
    expect(recoveredProvider.calls).toBe(1);
  });

  test("restart reconciles a durable interpretation after the final provider attempt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-interpretation-interrupted-"));
    directories.push(directory);
    const captureId = await seedInterruptedInterpretation(directory);
    const provider = new DeterministicInterpretationProvider({
      action: "create_task",
      title: "Different Task",
    });
    const harness = await createHarness(directory, provider, 1);
    harnesses.push(harness);

    expect(await waitForItem(harness, captureId)).toMatchObject({
      kind: "task",
      captureId,
      title: "Buy milk",
    });
    const review = await waitForReviewState(harness, captureId, "completed");
    expect(review.interpretationProcessing).toMatchObject({
      status: "succeeded",
      attemptCount: 1,
    });
    expect(provider.calls).toBe(0);
  });

  test("the configured attempt cap leaves repeated provider failure durable and non-retryable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-interpretation-cap-"));
    directories.push(directory);
    const provider = new DeterministicInterpretationProvider(
      { action: "create_task", title: "Buy milk" },
      2,
    );
    const harness = await createHarness(directory, provider, 2);
    harnesses.push(harness);

    const first = await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const captureId = first.json<{ capture: { id: string } }>().capture.id;
    await waitForInterpretationAttempt(harness, captureId, 1);
    await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const exhausted = await waitForInterpretationAttempt(harness, captureId, 2);
    await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });

    expect(exhausted).toMatchObject({
      state: "failed",
      interpretationProcessing: {
        status: "failed",
        attemptCount: 2,
        retryable: false,
      },
      failure: { stage: "interpretation", retryable: false },
    });
    expect(provider.calls).toBe(2);

    await harness.close();
    harnesses.splice(harnesses.indexOf(harness), 1);
    const restartedProvider = new DeterministicInterpretationProvider({
      action: "create_task",
      title: "Buy milk",
    });
    const restartedHarness = await createHarness(directory, restartedProvider, 2);
    harnesses.push(restartedHarness);

    expect(await waitForReviewState(restartedHarness, captureId, "failed")).toMatchObject({
      interpretationProcessing: { attemptCount: 2, retryable: false },
    });
    expect(restartedProvider.calls).toBe(0);
  });
});

interface RuntimeHarness {
  readonly application: ReturnType<typeof buildApi>;
  readonly close: () => Promise<void>;
}

async function createHarness(
  directory: string,
  interpretationProvider: InterpretationProvider,
  interpretationMaxAttempts = 3,
  transcriptionText = "add task buy milk",
): Promise<RuntimeHarness> {
  const databasePath = join(directory, "api.sqlite");
  const blobRoot = join(directory, "blobs");
  await prepareRuntime({ databasePath, blobRoot });

  const captureRepository = new SqliteCaptureRepository(databasePath);
  const transcriptionRepository = new SqliteTranscriptionRepository(databasePath);
  const interpretationRepository = new SqliteInterpretationRepository(databasePath);
  const interpretationJobRepository = new SqliteInterpretationJobRepository(databasePath);
  const outcomeRepository = new SqliteOutcomeRepository(databasePath);
  const memberItemsRepository = new SqliteMemberItemsRepository(databasePath);
  const captureService = new CaptureService(captureRepository, new FileSystemBlobStorage(blobRoot));
  const interpretationWorker = new InterpretationWorker({
    service: new InterpretationService(interpretationRepository),
    outcomeService: new OutcomeService(outcomeRepository),
    provider: interpretationProvider,
    repository: interpretationJobRepository,
    transcriptionRepository,
    captureReader: captureService,
    maxAttempts: interpretationMaxAttempts,
    onError: () => {},
  });
  const transcriptionWorker = new TranscriptionWorker({
    service: new TranscriptionService(
      transcriptionRepository,
      captureService,
      new DeterministicTranscriptionProvider(transcriptionText),
    ),
    repository: transcriptionRepository,
    maxAttempts: 3,
    succeededHandler: interpretationWorker,
    onError: () => {},
  });
  const reviewService = new ReviewService({
    captureService,
    transcriptionRepository,
    interpretationRepository,
    interpretationJobRepository,
    outcomeRepository,
  });
  const application = buildApi({
    logger: false,
    captureService,
    captureStoredHandler: transcriptionWorker,
    reviewService,
    memberItemsService: new MemberItemsService(memberItemsRepository),
  });
  await interpretationWorker.start();
  await transcriptionWorker.start();

  return {
    application,
    close: async () => {
      await transcriptionWorker.stop();
      await interpretationWorker.stop();
      await application.close();
      captureRepository.close();
      transcriptionRepository.close();
      interpretationRepository.close();
      interpretationJobRepository.close();
      outcomeRepository.close();
      memberItemsRepository.close();
    },
  };
}

async function waitForItem(
  harness: RuntimeHarness,
  captureId: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await harness.application.inject({ method: "GET", url: "/items?memberId=member-1" });
    const item = response.json<{ items: Array<Record<string, unknown>> }>().items
      .find((candidate) => candidate.captureId === captureId);
    if (item && item.kind !== "capture") return item;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Interpretation did not produce an item");
}

async function waitForReviewState(
  harness: RuntimeHarness,
  captureId: string,
  state: "failed" | "completed" | "needs_review",
): Promise<ObservedReview> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await harness.application.inject({
      method: "GET",
      url: `/captures/${captureId}/review`,
    });
    const review = response.json<{ review: ObservedReview }>().review;
    if (review.state === state) return review;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Interpretation review did not reach ${state}`);
}

async function waitForInterpretationAttempt(
  harness: RuntimeHarness,
  captureId: string,
  attemptCount: number,
): Promise<ObservedReview> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await harness.application.inject({
      method: "GET",
      url: `/captures/${captureId}/review`,
    });
    const review = response.json<{ review: ObservedReview }>().review;
    if (
      review.state === "failed"
      && review.interpretationProcessing?.attemptCount === attemptCount
    ) return review;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Interpretation did not reach attempt ${attemptCount}`);
}

async function seedInterruptedInterpretation(directory: string): Promise<string> {
  const databasePath = join(directory, "api.sqlite");
  const blobRoot = join(directory, "blobs");
  await prepareRuntime({ databasePath, blobRoot });
  const captureRepository = new SqliteCaptureRepository(databasePath);
  const transcriptionRepository = new SqliteTranscriptionRepository(databasePath);
  const interpretationRepository = new SqliteInterpretationRepository(databasePath);
  const interpretationJobRepository = new SqliteInterpretationJobRepository(databasePath);
  const captureService = new CaptureService(captureRepository, new FileSystemBlobStorage(blobRoot));
  const capture = await captureService.submit({
    memberId: "member-1",
    idempotencyKey: "capture-1",
    audio: Uint8Array.from([1, 2, 3]),
    contentType: "audio/m4a",
    capturedAt: "2026-08-15T10:00:00.000Z",
  });
  const transcriptionService = new TranscriptionService(
    transcriptionRepository,
    captureService,
    new DeterministicTranscriptionProvider(),
  );
  await transcriptionService.enqueue({
    captureId: capture.id,
    sourceId: capture.sourceId,
    contentType: capture.contentType,
  });
  const transcription = await transcriptionService.process(capture.id);
  if (transcription.text === undefined) throw new Error("Seed transcription did not succeed");
  new InterpretationService(interpretationRepository).evaluate({
    captureId: capture.id,
    sourceId: capture.sourceId,
    transcriptionId: transcription.id,
    transcriptionStatus: "succeeded",
    transcriptionText: transcription.text,
    capturedAt: "2026-08-15T10:00:00.000Z",
    catalogVersion: "direct-instructions.v1",
    model: "deterministic-qwen",
    rawOutput: { action: "create_task", title: "Buy milk" },
  });
  interpretationJobRepository.create(transcription);
  interpretationJobRepository.markProcessing(transcription.id);
  captureRepository.close();
  transcriptionRepository.close();
  interpretationRepository.close();
  interpretationJobRepository.close();
  return capture.id;
}

interface ObservedReview {
  readonly state: "pending" | "failed" | "completed" | "needs_review";
  readonly interpretationProcessing: {
    readonly status: "pending" | "processing" | "succeeded" | "failed";
    readonly attemptCount: number;
    readonly retryable: boolean;
  } | null;
  readonly [key: string]: unknown;
}

function submission(): Record<string, string> {
  return {
    memberId: "member-1",
    idempotencyKey: "capture-1",
    audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
    contentType: "audio/m4a",
    capturedAt: "2026-08-15T10:00:00.000Z",
  };
}

class DeterministicTranscriptionProvider implements TranscriptionProvider {
  constructor(private readonly text = "add task buy milk") {}

  async transcribe(): Promise<TranscriptionResult> {
    return { text: this.text, provider: "deterministic-whisper", model: "test-model" };
  }
}

class DeterministicInterpretationProvider implements InterpretationProvider {
  calls = 0;

  constructor(
    private readonly rawOutput: unknown,
    private failures = 0,
  ) {}

  async interpret(): Promise<InterpretationProviderResult> {
    this.calls += 1;
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("local Ollama unavailable");
    }
    return { model: "deterministic-qwen", rawOutput: this.rawOutput };
  }
}
