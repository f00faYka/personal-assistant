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
  readonly capturedAt: string;
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

export interface InterpretationProviderInput {
  readonly transcriptionText: string;
  readonly catalogVersion: string;
  readonly capturedAt: string;
}

export interface InterpretationProviderResult {
  readonly model: string;
  readonly rawOutput: unknown;
}

export interface InterpretationProvider {
  interpret(input: InterpretationProviderInput): Promise<InterpretationProviderResult>;
}

export class InterpretationService {
  constructor(private readonly repository: InterpretationRepository) {}

  getByTranscriptionId(transcriptionId: string): Interpretation | undefined {
    return this.repository.findByTranscriptionId(transcriptionId);
  }

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
    if (!hasExpectedFields(input.rawOutput, ["action", "reason"])) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
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
    if (!hasExpectedFields(input.rawOutput, ["action", "title", "dueAt"])) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    const extractedDueAt = extractExplicitDueAt(input.transcriptionText, input.capturedAt);
    if (input.rawOutput.dueAt !== undefined && !isIsoDate(input.rawOutput.dueAt)) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    if (hasExplicitDate(input.transcriptionText) && extractedDueAt === undefined && input.rawOutput.dueAt === undefined) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    if (extractedDueAt !== undefined && input.rawOutput.dueAt !== undefined && input.rawOutput.dueAt !== extractedDueAt) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    const title = normalizeTaskTitle(input.rawOutput.title, input.transcriptionText);
    if (!title) return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    return {
      classification: "clear_supported",
      action: {
        kind: "create_task",
        title,
        ...(input.rawOutput.dueAt === undefined
          ? extractedDueAt === undefined ? {} : { dueAt: extractedDueAt }
          : { dueAt: input.rawOutput.dueAt }),
      },
    };
  }

  if (input.rawOutput.action === "complete_task") {
    if (!hasExpectedFields(input.rawOutput, ["action", "title"])) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
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

function hasExpectedFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).every((key) => fields.includes(key));
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

const MONTHS = new Map([
  ["january", 0], ["february", 1], ["march", 2], ["april", 3], ["may", 4], ["june", 5],
  ["july", 6], ["august", 7], ["september", 8], ["october", 9], ["november", 10], ["december", 11],
]);

function extractExplicitDueAt(text: string, capturedAt: string): string | undefined {
  const normalized = text.toLowerCase();
  const captured = new Date(capturedAt);
  if (/\btoday\b/.test(normalized)) return startOfUtcDay(captured).toISOString();
  if (/\btomorrow\b/.test(normalized)) return addUtcDays(startOfUtcDay(captured), 1).toISOString();
  const weekday = normalized.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)?.[1];
  if (weekday) {
    const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(weekday);
    const days = (target - captured.getUTCDay() + 7) % 7 || 7;
    return addUtcDays(startOfUtcDay(captured), days).toISOString();
  }
  const match = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/)
    ?? normalized.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (!match) return undefined;
  const day = Number(match[1] && /^\d/.test(match[1]) ? match[1] : match[2]);
  const monthName = MONTHS.has(match[1] ?? "") ? match[1] : match[2];
  const month = MONTHS.get(monthName ?? "");
  if (month === undefined || day < 1 || day > 31) return undefined;
  let year = captured.getUTCFullYear();
  let date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
  if (date < new Date(Date.UTC(captured.getUTCFullYear(), captured.getUTCMonth(), captured.getUTCDate()))) {
    year += 1;
    date = new Date(Date.UTC(year, month, day));
  }
  return date.toISOString();
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function hasExplicitDate(text: string): boolean {
  return /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+of\s+|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2})/i.test(text)
    || /\b(?:tomorrow|today|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(text);
}

function normalizeTaskTitle(title: string, transcription: string): string {
  const source = title.trim();
  const cleaned = source.replace(/^task[,:]?\s*/i, "").replace(/^please\s+/i, "");
  const extracted = cleaned.match(/^(?:remind me to|add (?:a )?task to|create (?:a )?task to)\s+(.+)$/i)?.[1];
  if (extracted) return extracted.trim().replace(/[.!?]+$/, "");
  const transcriptionTitle = transcription.match(/(?:remind me to|add (?:a )?task to|create (?:a )?task to)\s+(.+)$/i)?.[1];
  return (transcriptionTitle ?? cleaned).trim().replace(/[.!?]+$/, "");
}
