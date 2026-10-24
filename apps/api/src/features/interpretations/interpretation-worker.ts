import type { CaptureService } from "../captures/capture.js";
import type { OutcomeService } from "../outcomes/outcome.js";
import type { Outcome } from "../outcomes/outcome.js";
import type {
  Transcription,
  TranscriptionRepository,
  SucceededTranscriptionReader,
} from "../transcriptions/transcription.js";
import type { TranscriptionSucceededHandler } from "../transcriptions/transcription-worker.js";
import {
  SUPPORTED_INTERPRETATION_CATALOG_VERSION,
  type Interpretation,
  type InterpretationProvider,
  type InterpretationService,
} from "./interpretation.js";

export type InterpretationJobStatus = "pending" | "processing" | "succeeded" | "failed";

export interface InterpretationJob {
  readonly transcriptionId: string;
  readonly captureId: string;
  readonly sourceId: string;
  readonly status: InterpretationJobStatus;
  readonly error?: string;
  readonly retryable: boolean;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InterpretationJobRepository {
  findByTranscriptionId(transcriptionId: string): InterpretationJob | undefined;
  findRecoverable(maxAttempts: number): readonly InterpretationJob[];
  findExhaustedProcessing(maxAttempts: number): readonly InterpretationJob[];
  create(transcription: Transcription): InterpretationJob;
  markProcessing(transcriptionId: string): InterpretationJob;
  complete(transcriptionId: string): InterpretationJob;
  fail(transcriptionId: string, error: string, retryable: boolean): InterpretationJob;
}

export interface InterpretationWorkerOptions {
  readonly service: InterpretationService;
  readonly outcomeService: OutcomeService;
  readonly provider: InterpretationProvider;
  readonly repository: InterpretationJobRepository;
  readonly transcriptionRepository: Pick<TranscriptionRepository, "findByCaptureId">
    & SucceededTranscriptionReader;
  readonly captureReader: Pick<CaptureService, "get">;
  readonly onOutcomeMaterialized?: (outcome: Outcome, transcriptionText: string) => void;
  readonly maxAttempts: number;
  readonly onError?: (error: unknown, transcriptionId: string) => void;
}

export class InterpretationWorker implements TranscriptionSucceededHandler {
  private readonly scheduled = new Set<string>();
  private queue = Promise.resolve();
  private started = false;

  constructor(private readonly options: InterpretationWorkerOptions) {
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new Error("maxAttempts must be a positive integer");
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const transcription of this.options.transcriptionRepository.findSucceeded()) {
      const job = this.options.repository.findByTranscriptionId(transcription.id)
        ?? this.options.repository.create(transcription);
      if (job.status === "succeeded") continue;
      try {
        if (this.resumePersistedInterpretation(job, transcription)) continue;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Interpretation failed";
        this.options.repository.fail(
          job.transcriptionId,
          message,
          job.attemptCount < this.options.maxAttempts,
        );
        this.options.onError?.(error, job.transcriptionId);
      }
    }
    for (const job of this.options.repository.findExhaustedProcessing(this.options.maxAttempts)) {
      this.options.repository.fail(
        job.transcriptionId,
        "Interpretation was interrupted after reaching the configured attempt limit",
        false,
      );
    }
    for (const job of this.options.repository.findRecoverable(this.options.maxAttempts)) {
      this.schedule(job);
    }
  }

  async handleSucceededTranscription(transcription: Transcription): Promise<void> {
    if (!this.started) throw new Error("Interpretation worker is not started");
    this.schedule(this.options.repository.create(transcription));
  }

  async stop(): Promise<void> {
    this.started = false;
    await this.queue;
  }

  private schedule(job: InterpretationJob): void {
    if (
      !this.started
      || job.status === "succeeded"
      || job.attemptCount >= this.options.maxAttempts
      || this.scheduled.has(job.transcriptionId)
    ) {
      return;
    }

    this.scheduled.add(job.transcriptionId);
    this.queue = this.queue.then(async () => {
      try {
        await this.process(job);
      } catch (error) {
        this.options.onError?.(error, job.transcriptionId);
      } finally {
        this.scheduled.delete(job.transcriptionId);
      }
    });
  }

  private async process(job: InterpretationJob): Promise<void> {
    const processing = this.options.repository.markProcessing(job.transcriptionId);
    try {
      const transcription = this.options.transcriptionRepository.findByCaptureId(job.captureId);
      if (transcription?.status !== "succeeded" || transcription.text === undefined) {
        throw new Error(`Interpretation requires a succeeded transcription: ${job.transcriptionId}`);
      }
      const capture = this.options.captureReader.get(transcription.captureId);
      let interpretation = this.options.service.getByTranscriptionId(job.transcriptionId);
      if (interpretation === undefined) {
        const providerResult = await this.options.provider.interpret({
          transcriptionText: transcription.text,
          catalogVersion: SUPPORTED_INTERPRETATION_CATALOG_VERSION,
        });
        interpretation = this.options.service.evaluate({
          captureId: transcription.captureId,
          sourceId: transcription.sourceId,
          transcriptionId: transcription.id,
          transcriptionStatus: "succeeded",
          transcriptionText: transcription.text,
          capturedAt: capture.capturedAt,
          timeZone: capture.timeZone,
          catalogVersion: SUPPORTED_INTERPRETATION_CATALOG_VERSION,
          model: providerResult.model,
          rawOutput: providerResult.rawOutput,
        });
      }
      this.materializeOutcome(transcription, transcription.text, interpretation);
      this.options.repository.complete(job.transcriptionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Interpretation failed";
      this.options.repository.fail(
        job.transcriptionId,
        message,
        processing.attemptCount < this.options.maxAttempts,
      );
      throw error;
    }
  }

  private resumePersistedInterpretation(
    job: InterpretationJob,
    transcription: Transcription,
  ): boolean {
    const interpretation = this.options.service.getByTranscriptionId(job.transcriptionId);
    if (interpretation === undefined) return false;
    if (transcription.text === undefined) {
      throw new Error(`Interpretation requires transcription text: ${job.transcriptionId}`);
    }
    this.materializeOutcome(transcription, transcription.text, interpretation);
    this.options.repository.complete(job.transcriptionId);
    return true;
  }

  private materializeOutcome(
    transcription: Pick<Transcription, "id" | "captureId">,
    transcriptionText: string,
    interpretation: Interpretation,
  ): void {
    const capture = this.options.captureReader.get(transcription.captureId);
    const outcome = this.options.outcomeService.materialize({
      memberId: capture.memberId,
      transcriptionText,
      interpretation,
    });
    if (outcome) {
      try { this.options.onOutcomeMaterialized?.(outcome, transcriptionText); }
      catch (error) { this.options.onError?.(error, transcription.id); }
    }
  }
}
