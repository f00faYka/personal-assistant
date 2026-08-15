import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { CaptureService, type CaptureStoredHandler } from "../captures/capture.js";
import { ReviewService } from "../reviews/review.js";
import {
  TranscriptionService,
  type TranscriptionProvider,
  type TranscriptionResult,
} from "./transcription.js";
import { TranscriptionWorker } from "./transcription-worker.js";
import { buildApi } from "../../http/build-api.js";
import { FileSystemBlobStorage } from "../../infrastructure/blob-storage/filesystem-blob-storage.js";
import { SqliteCaptureRepository } from "../../infrastructure/sqlite/sqlite-capture-repository.js";
import { SqliteInterpretationRepository } from "../../infrastructure/sqlite/sqlite-interpretation-repository.js";
import { SqliteOutcomeRepository } from "../../infrastructure/sqlite/sqlite-outcome-repository.js";
import { SqliteTranscriptionRepository } from "../../infrastructure/sqlite/sqlite-transcription-repository.js";
import { prepareRuntime } from "../../runtime.js";

describe("production transcription runtime", () => {
  const harnesses: RuntimeHarness[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  test("submitting the same Capture twice produces one succeeded transcription", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-transcription-runtime-"));
    directories.push(directory);
    const provider = new DeterministicProvider();
    const harness = await createHarness(directory, provider);
    harnesses.push(harness);

    const first = await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const second = await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const captureId = first.json<{ capture: { id: string } }>().capture.id;
    const review = await waitForTranscription(harness, captureId, "succeeded");

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(review.transcription).toMatchObject({
      captureId,
      status: "succeeded",
      text: "buy milk tomorrow",
      provider: "deterministic-whisper",
      model: "test-model",
      attemptCount: 1,
    });
    expect(provider.calls).toBe(1);
    expect(provider.audio).toEqual(Uint8Array.from([1, 2, 3]));
  });

  test("preserves a failed Capture and retries its transcription after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-transcription-restart-"));
    directories.push(directory);
    const unavailableProvider = new DeterministicProvider(1);
    const firstRuntime = await createHarness(directory, unavailableProvider);
    harnesses.push(firstRuntime);

    const response = await firstRuntime.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const captureId = response.json<{ capture: { id: string } }>().capture.id;
    const failed = await waitForTranscription(firstRuntime, captureId, "failed");
    const retainedCapture = await firstRuntime.application.inject({ method: "GET", url: `/captures/${captureId}` });

    expect(failed.transcription).toMatchObject({
      captureId,
      status: "failed",
      error: "local Whisper unavailable",
      attemptCount: 1,
    });
    expect(retainedCapture.statusCode).toBe(200);

    await firstRuntime.close();
    harnesses.splice(harnesses.indexOf(firstRuntime), 1);

    const recoveredProvider = new DeterministicProvider();
    const restartedRuntime = await createHarness(directory, recoveredProvider);
    harnesses.push(restartedRuntime);
    const succeeded = await waitForTranscription(restartedRuntime, captureId, "succeeded");

    expect(succeeded.transcription).toMatchObject({
      captureId,
      status: "succeeded",
      attemptCount: 2,
    });
    expect(recoveredProvider.calls).toBe(1);
    expect(recoveredProvider.audio).toEqual(Uint8Array.from([1, 2, 3]));
  });

  test("startup discovers a stored Capture that predates transcription wiring", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-transcription-orphan-"));
    directories.push(directory);
    const captureId = await seedStoredCapture(directory, false);
    const provider = new DeterministicProvider();
    const harness = await createHarness(directory, provider);
    harnesses.push(harness);

    const review = await waitForTranscription(harness, captureId, "succeeded", 1);

    expect(review.transcription).toMatchObject({ captureId, status: "succeeded", attemptCount: 1 });
    expect(provider.audio).toEqual(Uint8Array.from([1, 2, 3]));
  });

  test("startup resumes an interrupted worker attempt through the provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-transcription-interrupted-"));
    directories.push(directory);
    const captureId = await seedStoredCapture(directory, true);
    const provider = new DeterministicProvider();
    const harness = await createHarness(directory, provider, 2);
    harnesses.push(harness);

    const review = await waitForTranscription(harness, captureId, "succeeded", 2);

    expect(review.transcription).toMatchObject({ captureId, status: "succeeded", attemptCount: 2 });
    expect(provider.calls).toBe(1);
  });

  test("startup records an interrupted exhausted attempt as failed without another provider call", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-transcription-interrupted-cap-"));
    directories.push(directory);
    const captureId = await seedStoredCapture(directory, true);
    const provider = new DeterministicProvider();
    const harness = await createHarness(directory, provider, 1);
    harnesses.push(harness);

    const review = await waitForTranscription(harness, captureId, "failed", 1);

    expect(review.transcription).toMatchObject({
      captureId,
      status: "failed",
      error: "Transcription was interrupted after reaching the configured attempt limit",
      attemptCount: 1,
    });
    expect(provider.calls).toBe(0);
  });

  test("leaves repeated provider failures durable after the configured attempt cap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "personal-assistant-transcription-cap-"));
    directories.push(directory);
    const provider = new DeterministicProvider(3);
    const harness = await createHarness(directory, provider, 2);
    harnesses.push(harness);

    const first = await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const captureId = first.json<{ capture: { id: string } }>().capture.id;
    await waitForTranscription(harness, captureId, "failed", 1);
    await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });
    const exhausted = await waitForTranscription(harness, captureId, "failed", 2);
    await harness.application.inject({ method: "POST", url: "/captures", payload: submission() });

    expect(exhausted.transcription).toMatchObject({ status: "failed", attemptCount: 2 });
    expect(provider.calls).toBe(2);
  });
});

interface RuntimeHarness {
  readonly application: ReturnType<typeof buildApi>;
  readonly close: () => Promise<void>;
}

async function createHarness(
  directory: string,
  provider: TranscriptionProvider,
  maxAttempts = 3,
): Promise<RuntimeHarness> {
  const databasePath = join(directory, "api.sqlite");
  const blobRoot = join(directory, "blobs");
  await prepareRuntime({ databasePath, blobRoot });

  const captureRepository = new SqliteCaptureRepository(databasePath);
  const transcriptionRepository = new SqliteTranscriptionRepository(databasePath);
  const interpretationRepository = new SqliteInterpretationRepository(databasePath);
  const outcomeRepository = new SqliteOutcomeRepository(databasePath);
  const captureService = new CaptureService(captureRepository, new FileSystemBlobStorage(blobRoot));
  const worker: CaptureStoredHandler & { start(): Promise<void>; stop(): Promise<void> } = new TranscriptionWorker({
    service: new TranscriptionService(transcriptionRepository, captureService, provider),
    repository: transcriptionRepository,
    maxAttempts,
    onError: () => {},
  });
  const application = buildApi({
    logger: false,
    captureService,
    captureStoredHandler: worker,
    reviewService: new ReviewService({
      captureService,
      transcriptionRepository,
      interpretationRepository,
      outcomeRepository,
    }),
  });
  await worker.start();

  return {
    application,
    close: async () => {
      await worker.stop();
      await application.close();
      captureRepository.close();
      transcriptionRepository.close();
      interpretationRepository.close();
      outcomeRepository.close();
    },
  };
}

async function seedStoredCapture(directory: string, interruptTranscription: boolean): Promise<string> {
  const databasePath = join(directory, "api.sqlite");
  const blobRoot = join(directory, "blobs");
  await prepareRuntime({ databasePath, blobRoot });
  const captureRepository = new SqliteCaptureRepository(databasePath);
  const transcriptionRepository = new SqliteTranscriptionRepository(databasePath);
  const captureService = new CaptureService(captureRepository, new FileSystemBlobStorage(blobRoot));
  const application = buildApi({ logger: false, captureService });
  const response = await application.inject({ method: "POST", url: "/captures", payload: submission() });
  const capture = response.json<{ capture: { id: string; sourceId: string; contentType: string } }>().capture;
  if (interruptTranscription) {
    const service = new TranscriptionService(transcriptionRepository, captureService, new DeterministicProvider());
    await service.enqueue({ captureId: capture.id, sourceId: capture.sourceId, contentType: capture.contentType });
    transcriptionRepository.markProcessing(capture.id);
  }
  await application.close();
  captureRepository.close();
  transcriptionRepository.close();
  return capture.id;
}

async function waitForTranscription(
  harness: RuntimeHarness,
  captureId: string,
  status: "succeeded" | "failed",
  attemptCount?: number,
): Promise<{ transcription: Record<string, unknown> | null }> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await harness.application.inject({ method: "GET", url: `/captures/${captureId}/review` });
    const review = response.json<{ review: { transcription: Record<string, unknown> | null } }>().review;
    if (
      review.transcription?.status === status
      && (attemptCount === undefined || review.transcription.attemptCount === attemptCount)
    ) return review;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Transcription did not reach ${status}`);
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

class DeterministicProvider implements TranscriptionProvider {
  calls = 0;
  audio?: Uint8Array;

  constructor(private failures = 0) {}

  async transcribe(input: { readonly audio: Uint8Array }): Promise<TranscriptionResult> {
    this.calls += 1;
    this.audio = input.audio;
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("local Whisper unavailable");
    }
    return { text: "buy milk tomorrow", provider: "deterministic-whisper", model: "test-model" };
  }
}
