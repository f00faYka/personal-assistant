import type { Capture, CaptureStoredHandler } from "../captures/capture.js";
import type {
  Transcription,
  TranscriptionCapture,
  TranscriptionRepository,
  TranscriptionService,
} from "./transcription.js";

export interface TranscriptionRecoveryRepository extends TranscriptionRepository {
  findRecoverable(maxAttempts: number): readonly Transcription[];
  findExhaustedProcessing(maxAttempts: number): readonly Transcription[];
  findUnqueuedCaptures(): readonly TranscriptionCapture[];
}

export interface TranscriptionWorkerOptions {
  readonly service: TranscriptionService;
  readonly repository: TranscriptionRecoveryRepository;
  readonly maxAttempts: number;
  readonly succeededHandler?: TranscriptionSucceededHandler;
  readonly onError?: (error: unknown, captureId: string) => void;
}

export interface TranscriptionSucceededHandler {
  handleSucceededTranscription(transcription: Transcription): Promise<void>;
}

export class TranscriptionWorker implements CaptureStoredHandler {
  private readonly scheduled = new Set<string>();
  private queue = Promise.resolve();
  private started = false;

  constructor(private readonly options: TranscriptionWorkerOptions) {
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new Error("maxAttempts must be a positive integer");
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const capture of this.options.repository.findUnqueuedCaptures()) {
      this.schedule(await this.options.service.enqueue(capture));
    }
    for (const transcription of this.options.repository.findExhaustedProcessing(this.options.maxAttempts)) {
      this.options.repository.fail(
        transcription.captureId,
        "Transcription was interrupted after reaching the configured attempt limit",
      );
    }
    for (const transcription of this.options.repository.findRecoverable(this.options.maxAttempts)) {
      this.schedule(transcription);
    }
  }

  async handleStoredCapture(capture: Capture): Promise<void> {
    if (!this.started) throw new Error("Transcription worker is not started");
    const transcription = await this.options.service.enqueue({
      captureId: capture.id,
      sourceId: capture.sourceId,
      contentType: capture.contentType,
    });
    if (transcription.status === "succeeded") {
      await this.options.succeededHandler?.handleSucceededTranscription(transcription);
      return;
    }
    this.schedule(transcription);
  }

  async stop(): Promise<void> {
    this.started = false;
    await this.queue;
  }

  private schedule(transcription: Transcription): void {
    if (
      !this.started
      || transcription.status === "succeeded"
      || transcription.attemptCount >= this.options.maxAttempts
      || this.scheduled.has(transcription.captureId)
    ) {
      return;
    }

    this.scheduled.add(transcription.captureId);
    this.queue = this.queue.then(async () => {
      try {
        const succeeded = await this.options.service.process(transcription.captureId);
        await this.options.succeededHandler?.handleSucceededTranscription(succeeded);
      } catch (error) {
        this.options.onError?.(error, transcription.captureId);
      } finally {
        this.scheduled.delete(transcription.captureId);
      }
    });
  }
}
