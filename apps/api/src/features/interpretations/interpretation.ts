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
    if (hasExplicitSchedule(input.transcriptionText) && extractedDueAt === undefined) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    if (extractedDueAt !== undefined && input.rawOutput.dueAt !== undefined
      && normalizeIsoDate(input.rawOutput.dueAt) !== extractedDueAt) {
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
  if (Number.isNaN(captured.getTime())) return undefined;
  const date = extractDate(normalized, captured);
  const time = extractTime(normalized);
  if (hasExplicitTime(normalized) && time === undefined) return undefined;
  if (date === undefined && time === undefined) return undefined;
  const base = date ?? { year: captured.getUTCFullYear(), month: captured.getUTCMonth(), day: captured.getUTCDate() };
  return new Date(Date.UTC(base.year, base.month, base.day, time?.hour ?? 0, time?.minute ?? 0)).toISOString();
}

interface CalendarDate { readonly year: number; readonly month: number; readonly day: number }
interface ClockTime { readonly hour: number; readonly minute: number }

function extractDate(text: string, captured: Date): CalendarDate | undefined {
  if (/\b(?:today)\b|сегодня/.test(text)) {
    return { year: captured.getUTCFullYear(), month: captured.getUTCMonth(), day: captured.getUTCDate() };
  }
  if (/послезавтра|\bthe day after tomorrow\b/.test(text)) {
    const next = addUtcDays(startOfUtcDay(captured), 2);
    return { year: next.getUTCFullYear(), month: next.getUTCMonth(), day: next.getUTCDate() };
  }
  if (/\b(?:tomorrow)\b|завтра/.test(text)) {
    const next = addUtcDays(startOfUtcDay(captured), 1);
    return { year: next.getUTCFullYear(), month: next.getUTCMonth(), day: next.getUTCDate() };
  }
  const thisWeekday = text.match(/\bthis week\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)?.[1];
  if (thisWeekday) {
    const target = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].indexOf(thisWeekday);
    const monday = addUtcDays(startOfUtcDay(captured), 1 - (captured.getUTCDay() || 7));
    let result = addUtcDays(monday, target);
    if (result < startOfUtcDay(captured)) result = addUtcDays(result, 7);
    return { year: result.getUTCFullYear(), month: result.getUTCMonth(), day: result.getUTCDate() };
  }
  const weekday = text.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)?.[1];
  if (weekday) {
    const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(weekday);
    const next = addUtcDays(startOfUtcDay(captured), (target - captured.getUTCDay() + 7) % 7 || 7);
    return { year: next.getUTCFullYear(), month: next.getUTCMonth(), day: next.getUTCDate() };
  }
  const match = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/)
    ?? text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (!match) return undefined;
  const day = Number(/^\d/.test(match[1] ?? "") ? match[1] : match[2]);
  const monthName = MONTHS.has(match[1] ?? "") ? match[1] : match[2];
  const month = MONTHS.get(monthName ?? "");
  if (month === undefined || day < 1 || day > 31) return undefined;
  let year = captured.getUTCFullYear();
  let result = new Date(Date.UTC(year, month, day));
  if (result.getUTCMonth() !== month || result.getUTCDate() !== day) return undefined;
  if (result < startOfUtcDay(captured)) {
    year += 1;
    result = new Date(Date.UTC(year, month, day));
  }
  return { year, month, day: result.getUTCDate() };
}

function extractTime(text: string): ClockTime | undefined {
  if (/\bnoon\b|полдень/.test(text)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b|полночь/.test(text)) return { hour: 0, minute: 0 };
  const twelveHour = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
    ?? text.match(/в\s*(\d{1,2})(?::(\d{2}))?\s*(утра|дня|вечера|ночи)/);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return undefined;
    const period = twelveHour[3];
    const isPm = period === "pm" || period === "вечера" || period === "дня";
    return { hour: (hour % 12) + (isPm ? 12 : 0), minute };
  }
  const twentyFourHour = text.match(/\bat\s+(\d{1,2}):(\d{2})\b/)
    ?? text.match(/в\s*(\d{1,2}):(\d{2})/);
  if (!twentyFourHour) return undefined;
  const hour = Number(twentyFourHour[1]);
  const minute = Number(twentyFourHour[2]);
  return hour > 23 || minute > 59 ? undefined : { hour, minute };
}

function hasExplicitTime(text: string): boolean {
  return /\b(?:noon|midnight|at\s+\d{1,2}(?::\d{2})?|morning|afternoon|evening|night)\b/i.test(text)
    || /полдень|полночь|в\s+\d{1,2}(?::\d{2})?|утром|днём|днем|вечером|ночью/i.test(text);
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function hasExplicitSchedule(text: string): boolean {
  return /\b(?:today|tomorrow|the day after tomorrow|this week\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{1,2}(?:st|nd|rd|th)?\s+of\s+|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2})\b/i.test(text)
    || /послезавтра|сегодня|завтра/.test(text)
    || /\b(?:noon|midnight|at\s+\d{1,2}(?::\d{2})?|morning|afternoon|evening|night)\b/i.test(text)
    || /полдень|полночь|в\s+\d{1,2}(?::\d{2})?|утром|днём|днем|вечером|ночью/i.test(text);
}

function normalizeTaskTitle(title: string, transcription: string): string {
  const source = title.trim();
  const cleaned = source.replace(/^task[,:]?\s*/i, "").replace(/^please\s+/i, "");
  const extracted = cleaned.match(/^(?:remind me to|add (?:a )?task to|create (?:a )?task to)\s+(.+)$/i)?.[1];
  if (extracted) return removeSchedule(extracted);
  const transcriptionTitle = transcription.match(/(?:remind me to|add (?:a )?task to|create (?:a )?task to)\s+(.+)$/i)?.[1];
  return removeSchedule(transcriptionTitle ?? cleaned);
}

function removeSchedule(value: string): string {
  return value.trim()
    .replace(/\s+(?:today|tomorrow|the day after tomorrow|this week\s+\w+|послезавтра|сегодня|завтра)(?:\s+(?:at|в)\s+[^.!?]+)?[.!?]*$/i, "")
    .replace(/\s+(?:on\s+\d{1,2}(?:st|nd|rd|th)?\s+of\s+\w+|\w+\s+\d{1,2}(?:st|nd|rd|th)?)[.!?]*$/i, "")
    .replace(/\s+(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|в\s+\d{1,2}(?::\d{2})?(?:\s+(?:утра|дня|вечера|ночи))?)[.!?]*$/i, "")
    .trim().replace(/[.!?]+$/, "");
}

function normalizeIsoDate(value: string): string {
  return new Date(value).toISOString();
}
