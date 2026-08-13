import { randomUUID } from "node:crypto";

export const SUPPORTED_INTERPRETATION_CATALOG_VERSION = "direct-instructions.v1";

export type InterpretationClassification =
  | "clear_supported"
  | "ordinary"
  | "ambiguous"
  | "unsupported";

export type InterpretationAction =
  | {
      readonly kind: "create_task";
      readonly title: string;
      readonly dueAt?: string;
    }
  | {
      readonly kind: "complete_task";
      readonly title: string;
    };

export interface InterpretationInput {
  readonly captureId: string;
  readonly sourceId: string;
  readonly transcriptionId: string;
  readonly transcriptionStatus: "succeeded";
  readonly transcriptionText: string;
  readonly catalogVersion: string;
  readonly model: string;
  readonly rawOutput: unknown;
}

export interface Interpretation {
  readonly id: string;
  readonly captureId: string;
  readonly sourceId: string;
  readonly transcriptionId: string;
  readonly catalogVersion: string;
  readonly model: string;
  readonly rawOutputJson: string;
  readonly classification: InterpretationClassification;
  readonly action?: InterpretationAction;
  readonly rejectionReason?: string;
  readonly createdAt: string;
}

export interface InterpretationRepository {
  findByTranscriptionId(transcriptionId: string): Interpretation | undefined;
  create(interpretation: Interpretation): Interpretation;
}

export class InterpretationService {
  constructor(private readonly repository: InterpretationRepository) {}

  evaluate(input: InterpretationInput): Interpretation {
    if (input.transcriptionStatus !== "succeeded") {
      throw new InterpretationNotReadyError(input.transcriptionId);
    }

    const existing = this.repository.findByTranscriptionId(input.transcriptionId);
    if (existing) return existing;

    const result = classify(input);
    return this.repository.create({
      id: randomUUID(),
      captureId: input.captureId,
      sourceId: input.sourceId,
      transcriptionId: input.transcriptionId,
      catalogVersion: input.catalogVersion,
      model: input.model,
      rawOutputJson: serializeRawOutput(input.rawOutput),
      ...result,
      createdAt: new Date().toISOString(),
    });
  }
}

export class InterpretationNotReadyError extends Error {
  constructor(transcriptionId: string) {
    super(`Interpretation requires a succeeded transcription: ${transcriptionId}`);
    this.name = "InterpretationNotReadyError";
  }
}

function classify(input: InterpretationInput): Pick<Interpretation, "classification" | "action" | "rejectionReason"> {
  if (input.catalogVersion !== SUPPORTED_INTERPRETATION_CATALOG_VERSION) {
    return {
      classification: "unsupported",
      rejectionReason: "catalog_version_mismatch",
    };
  }

  if (!isRecord(input.rawOutput) || typeof input.rawOutput.action !== "string") {
    return {
      classification: "unsupported",
      rejectionReason: "malformed_model_output",
    };
  }

  if (input.rawOutput.action === "none") {
    if (input.rawOutput.reason === "ordinary") {
      return { classification: "ordinary", rejectionReason: "ordinary_content" };
    }
    if (input.rawOutput.reason === "ambiguous") {
      return { classification: "ambiguous", rejectionReason: "ambiguous_instruction" };
    }
    return { classification: "unsupported", rejectionReason: "malformed_model_output" };
  }

  if (input.rawOutput.action === "create_task") {
    if (typeof input.rawOutput.title !== "string" || !input.rawOutput.title.trim()) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    if (input.rawOutput.dueAt !== undefined && !isIsoDate(input.rawOutput.dueAt)) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    return {
      classification: "clear_supported",
      action: {
        kind: "create_task",
        title: input.rawOutput.title.trim(),
        ...(input.rawOutput.dueAt === undefined ? {} : { dueAt: input.rawOutput.dueAt }),
      },
    };
  }

  if (input.rawOutput.action === "complete_task") {
    if (typeof input.rawOutput.title !== "string" || !input.rawOutput.title.trim()) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    return {
      classification: "clear_supported",
      action: { kind: "complete_task", title: input.rawOutput.title.trim() },
    };
  }

  return { classification: "unsupported", rejectionReason: "unsupported_action" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeRawOutput(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "null" : serialized;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return false;
  }
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  return new Date(value).toISOString() === normalized;
}
