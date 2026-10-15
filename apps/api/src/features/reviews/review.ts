import { blobIdentifier, type Capture, type CaptureService } from "../captures/capture.js";
import type { Interpretation, InterpretationRepository } from "../interpretations/interpretation.js";
import type {
  InterpretationJob,
  InterpretationJobRepository,
} from "../interpretations/interpretation-worker.js";
import type { Outcome, OutcomeRepository } from "../outcomes/outcome.js";
import { UNUSABLE_TRANSCRIPTION_ERROR, type Transcription, type TranscriptionRepository } from "../transcriptions/transcription.js";

export type ReviewState = "pending" | "failed" | "completed" | "needs_review";

export interface SourceRecord {
  readonly id: string;
  readonly captureId: string;
  readonly content: {
    readonly kind: "audio";
    readonly contentType: string;
    readonly byteLength: number;
    readonly sha256: string;
  };
  readonly storageState: Capture["storageState"];
  readonly blobIdentifier: string;
}

export interface CorrectionRecord {
  readonly id: string;
  readonly captureId: string;
  readonly sourceId: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface ReviewContract {
  readonly state: ReviewState;
  readonly capture: Capture;
  readonly source: SourceRecord;
  readonly transcription: Transcription | null;
  readonly correction: CorrectionRecord | null;
  readonly interpretation: Interpretation | null;
  readonly interpretationProcessing: {
    readonly status: InterpretationJob["status"];
    readonly attemptCount: number;
    readonly retryable: boolean;
  } | null;
  readonly outcome: Outcome | null;
  readonly failure: {
    readonly stage: "capture" | "transcription" | "interpretation";
    readonly message: string;
    readonly classification?: "unusable_transcription";
    readonly retryable?: boolean;
  } | null;
}

export interface ReviewDependencies {
  readonly captureService: Pick<CaptureService, "get">;
  readonly transcriptionRepository: Pick<TranscriptionRepository, "findByCaptureId">;
  readonly interpretationRepository: Pick<InterpretationRepository, "findByTranscriptionId">;
  readonly interpretationJobRepository?: Pick<InterpretationJobRepository, "findByTranscriptionId">;
  readonly outcomeRepository: Pick<OutcomeRepository, "findByInterpretationId">;
  readonly correctionRepository?: { findByCaptureId(captureId: string): CorrectionRecord | undefined };
}

export class ReviewService {
  constructor(private readonly dependencies: ReviewDependencies) {}

  get(captureId: string): ReviewContract {
    const capture = this.dependencies.captureService.get(captureId);
    const source: SourceRecord = {
      id: capture.sourceId,
      captureId: capture.id,
      content: {
        kind: "audio",
        contentType: capture.contentType,
        byteLength: capture.byteLength,
        sha256: capture.contentSha256,
      },
      storageState: capture.storageState,
      blobIdentifier: blobIdentifier(capture),
    };
    const transcription = this.dependencies.transcriptionRepository.findByCaptureId(capture.id) ?? null;
    const interpretation = transcription === null
      ? null
      : this.dependencies.interpretationRepository.findByTranscriptionId(transcription.id) ?? null;
    const interpretationJob = transcription === null
      ? null
      : this.dependencies.interpretationJobRepository?.findByTranscriptionId(transcription.id) ?? null;
    const interpretationProcessing = interpretationJob === null
      ? null
      : {
        status: interpretationJob.status,
        attemptCount: interpretationJob.attemptCount,
        retryable: interpretationJob.retryable,
      };
    const outcome = interpretation === null
      ? null
      : this.dependencies.outcomeRepository.findByInterpretationId(interpretation.id) ?? null;
    const correction = this.dependencies.correctionRepository?.findByCaptureId(capture.id) ?? null;

    return {
      state: determineState(capture, transcription, interpretationJob, interpretation, outcome),
      capture,
      source,
      transcription,
      correction,
      interpretation,
      interpretationProcessing,
      outcome,
      failure: failureFor(capture, transcription, interpretationJob),
    };
  }
}

function determineState(
  capture: Capture,
  transcription: Transcription | null,
  interpretationProcessing: InterpretationJob | null,
  interpretation: Interpretation | null,
  outcome: Outcome | null,
): ReviewState {
  if (capture.storageState === "pending" || transcription === null) return "pending";
  if (transcription.status === "failed") return "failed";
  if (interpretationProcessing?.status === "failed") return "failed";
  if (transcription.status !== "succeeded" || interpretation === null || outcome === null) return "pending";
  if (outcome?.kind === "note" && outcome.reviewState === "needs_review") return "needs_review";
  return "completed";
}

function failureFor(
  capture: Capture,
  transcription: Transcription | null,
  interpretationProcessing: InterpretationJob | null,
): ReviewContract["failure"] {
  if (capture.storageState === "pending") {
    return { stage: "capture", message: "Capture source is not stored" };
  }
  if (transcription?.status === "failed") {
    if (transcription.error === UNUSABLE_TRANSCRIPTION_ERROR) {
      return {
        stage: "transcription",
        classification: "unusable_transcription",
        message: "Transcription could not be used. The Capture and original audio are saved.",
      };
    }
    return { stage: "transcription", message: transcription.error ?? "Transcription failed" };
  }
  if (interpretationProcessing?.status === "failed") {
    return {
      stage: "interpretation",
      message: interpretationProcessing.error ?? "Interpretation failed",
      retryable: interpretationProcessing.retryable,
    };
  }
  return null;
}
