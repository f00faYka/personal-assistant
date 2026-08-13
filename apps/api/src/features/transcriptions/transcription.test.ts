import { describe, expect, test } from "vitest";

import { TranscriptionService, type Transcription } from "./transcription.js";

describe("TranscriptionService", () => {
  test("creates a durable pending transcription once for a Capture", async () => {
    const repository = new MemoryRepository();
    const service = new TranscriptionService(repository, new MemoryAudioReader(), new MemoryProvider());

    const first = await service.enqueue({
      captureId: "capture-1",
      sourceId: "source-1",
      contentType: "audio/m4a",
    });
    const second = await service.enqueue({
      captureId: "capture-1",
      sourceId: "source-1",
      contentType: "audio/m4a",
    });

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      captureId: "capture-1",
      sourceId: "source-1",
      status: "pending",
      attemptCount: 0,
    });
    expect(repository.values).toHaveLength(1);
  });

  test("transcribes a pending Capture and retains provider metadata", async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    const service = new TranscriptionService(
      repository,
      new MemoryAudioReader(Uint8Array.from([1, 2, 3])),
      provider,
    );
    await service.enqueue({ captureId: "capture-1", sourceId: "source-1", contentType: "audio/m4a" });

    const result = await service.process("capture-1");

    expect(result).toMatchObject({
      status: "succeeded",
      text: "buy milk tomorrow",
      provider: "test-provider",
      model: "test-model",
      attemptCount: 1,
    });
    expect(provider.audio).toEqual(Uint8Array.from([1, 2, 3]));
  });

  test("retains a failed processing state and can retry it", async () => {
    const repository = new MemoryRepository();
    const provider = new MemoryProvider();
    provider.failures = 1;
    const service = new TranscriptionService(repository, new MemoryAudioReader(), provider);
    await service.enqueue({ captureId: "capture-1", sourceId: "source-1", contentType: "audio/m4a" });

    await expect(service.process("capture-1")).rejects.toThrow("provider unavailable");
    expect(service.get("capture-1")).toMatchObject({
      status: "failed",
      error: "provider unavailable",
      attemptCount: 1,
    });

    const retry = await service.process("capture-1");
    expect(retry).toMatchObject({ status: "succeeded", attemptCount: 2 });
  });
});

class MemoryRepository {
  readonly values: Transcription[] = [];

  findByCaptureId(captureId: string): Transcription | undefined {
    return this.values.find((value) => value.captureId === captureId);
  }

  create(transcription: Transcription): Transcription {
    this.values.push(transcription);
    return transcription;
  }

  markProcessing(captureId: string): Transcription {
    const value = this.findByCaptureId(captureId);
    if (!value) throw new Error("missing transcription");
    const updated = { ...value, status: "processing" as const, attemptCount: value.attemptCount + 1 };
    this.values[this.values.indexOf(value)] = updated;
    return updated;
  }

  complete(captureId: string, result: { text: string; provider: string; model: string }): Transcription {
    const value = this.findByCaptureId(captureId);
    if (!value) throw new Error("missing transcription");
    const updated = { ...value, ...result, status: "succeeded" as const };
    this.values[this.values.indexOf(value)] = updated;
    return updated;
  }

  fail(captureId: string, error: string): Transcription {
    const value = this.findByCaptureId(captureId);
    if (!value) throw new Error("missing transcription");
    const updated = { ...value, status: "failed" as const, error };
    this.values[this.values.indexOf(value)] = updated;
    return updated;
  }
}

class MemoryAudioReader {
  constructor(private readonly content = Uint8Array.from([9])) {}

  async readAudio(_captureId: string): Promise<Uint8Array> {
    return this.content;
  }
}

class MemoryProvider {
  audio?: Uint8Array;
  failures = 0;

  async transcribe(input: { audio: Uint8Array; contentType: string }): Promise<{
    text: string;
    provider: string;
    model: string;
  }> {
    this.audio = input.audio;
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("provider unavailable");
    }
    return { text: "buy milk tomorrow", provider: "test-provider", model: "test-model" };
  }
}
