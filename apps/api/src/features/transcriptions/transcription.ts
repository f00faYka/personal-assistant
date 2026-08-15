import { randomUUID } from "node:crypto";

export type TranscriptionStatus = "pending" | "processing" | "succeeded" | "failed";

export interface TranscriptionCapture {
  readonly captureId: string;
  readonly sourceId: string;
  readonly contentType: string;
}

export interface Transcription {
  readonly id: string;
  readonly captureId: string;
  readonly sourceId: string;
  readonly contentType: string;
  readonly status: TranscriptionStatus;
  readonly text?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly error?: string;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TranscriptionResult {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
}

export interface TranscriptionProvider {
  transcribe(input: {
    readonly audio: Uint8Array;
    readonly contentType: string;
  }): Promise<TranscriptionResult>;
}

export interface CaptureAudioReader {
  readAudio(captureId: string): Promise<Uint8Array>;
}

export interface TranscriptionRepository {
  findByCaptureId(captureId: string): Transcription | undefined;
  create(transcription: Transcription): Transcription;
  markProcessing(captureId: string): Transcription;
  complete(captureId: string, result: TranscriptionResult): Transcription;
  fail(captureId: string, error: string): Transcription;
}

export interface SucceededTranscriptionReader {
  findSucceeded(): readonly Transcription[];
}

export class TranscriptionService {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly audioReader: CaptureAudioReader,
    private readonly provider: TranscriptionProvider,
  ) {}

  async enqueue(capture: TranscriptionCapture): Promise<Transcription> {
    const existing = this.repository.findByCaptureId(capture.captureId);
    if (existing) return existing;

    const now = new Date().toISOString();
    return this.repository.create({
      id: randomUUID(),
      captureId: capture.captureId,
      sourceId: capture.sourceId,
      contentType: capture.contentType,
      status: "pending",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  async process(captureId: string): Promise<Transcription> {
    const existing = this.repository.findByCaptureId(captureId);
    if (!existing) throw new TranscriptionNotFoundError(captureId);
    if (existing.status === "succeeded") return existing;

    const processing = this.repository.markProcessing(captureId);
    try {
      const result = await this.provider.transcribe({
        audio: await this.audioReader.readAudio(captureId),
        contentType: processing.contentType,
      });
      return this.repository.complete(captureId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcription failed";
      this.repository.fail(captureId, message);
      throw error;
    }
  }

  get(captureId: string): Transcription {
    const transcription = this.repository.findByCaptureId(captureId);
    if (!transcription) throw new TranscriptionNotFoundError(captureId);
    return transcription;
  }
}

export class TranscriptionNotFoundError extends Error {
  constructor(captureId: string) {
    super(`Transcription not found for Capture: ${captureId}`);
    this.name = "TranscriptionNotFoundError";
  }
}
