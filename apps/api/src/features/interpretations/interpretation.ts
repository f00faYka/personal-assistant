import { randomUUID } from "node:crypto";

export const SUPPORTED_INTERPRETATION_CATALOG_VERSION = "direct-instructions.v1";

export type InterpretationClassification =
  | "clear_supported"
  | "ordinary"
  | "ambiguous"
  | "unsupported";

export type SchedulePeriod = "am" | "pm";
export type ScheduleDayPart = "morning" | "afternoon" | "evening" | "night";
export type ScheduleSpecialTime = "noon" | "midnight";

export interface InterpretationSchedule {
  readonly date?: string;
  readonly hour?: number;
  readonly minute?: number | null;
  readonly period?: SchedulePeriod;
  readonly dayPart?: ScheduleDayPart;
  readonly special?: ScheduleSpecialTime;
}

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
  readonly timeZone?: string;
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

export interface InterpretationServiceOptions {
  readonly timeZone?: string;
}

export interface InterpretationProviderInput {
  readonly transcriptionText: string;
  readonly catalogVersion: string;
}

export interface InterpretationProviderResult {
  readonly model: string;
  readonly rawOutput: unknown;
}

export interface InterpretationProvider {
  interpret(input: InterpretationProviderInput): Promise<InterpretationProviderResult>;
}

export class InterpretationService {
  private readonly timeZone: string;

  constructor(
    private readonly repository: InterpretationRepository,
    options: InterpretationServiceOptions = {},
  ) {
    this.timeZone = options.timeZone ?? "UTC";
  }

  getByTranscriptionId(transcriptionId: string): Interpretation | undefined {
    return this.repository.findByTranscriptionId(transcriptionId);
  }

  evaluate(input: InterpretationInput): Interpretation {
    if (input.transcriptionStatus !== "succeeded") {
      throw new InterpretationNotReadyError(input.transcriptionId);
    }

    const existing = this.repository.findByTranscriptionId(input.transcriptionId);
    if (existing) return existing;

    const result = classify({ ...input, timeZone: input.timeZone ?? this.timeZone });
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
    if (!hasExpectedFields(input.rawOutput, ["action", "title", "schedule"])) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    const timeZone = input.timeZone ?? "UTC";
    const modelSchedule = parseModelSchedule(input.rawOutput.schedule, input.capturedAt, timeZone);
    if (modelSchedule === INVALID_SCHEDULE) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    const extractedDueAt = resolveExplicitSchedule({
      transcriptionText: input.transcriptionText,
      capturedAt: input.capturedAt,
      timeZone,
    });
    if (hasExplicitSchedule(input.transcriptionText) && extractedDueAt === undefined) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    if (modelSchedule !== undefined && !modelScheduleMatchesTranscription(
      modelSchedule,
      input.transcriptionText,
      input.capturedAt,
      timeZone,
    )) {
      return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    }
    const title = normalizeTaskTitle(input.rawOutput.title, input.transcriptionText);
    if (!title) return { classification: "unsupported", rejectionReason: "malformed_model_output" };
    return {
      classification: "clear_supported",
      action: {
        kind: "create_task",
        title,
        ...(extractedDueAt === undefined ? {} : { dueAt: extractedDueAt }),
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

const MONTHS = new Map([
  ["january", 0], ["february", 1], ["march", 2], ["april", 3], ["may", 4], ["june", 5],
  ["july", 6], ["august", 7], ["september", 8], ["october", 9], ["november", 10], ["december", 11],
]);

interface CalendarDate { readonly year: number; readonly month: number; readonly day: number }
interface ClockTime {
  readonly hour?: number;
  readonly minute?: number;
  readonly period?: SchedulePeriod;
  readonly dayPart?: ScheduleDayPart;
  readonly special?: ScheduleSpecialTime;
}

interface ParsedSchedule {
  readonly date?: CalendarDate;
  readonly time?: ClockTime;
}

const INVALID_SCHEDULE = Symbol("invalid schedule");

export interface ScheduleResolverInput {
  readonly transcriptionText: string;
  readonly capturedAt: string;
  readonly timeZone?: string;
}

export function resolveExplicitSchedule(input: ScheduleResolverInput): string | undefined {
  const normalized = input.transcriptionText.toLowerCase();
  const captured = new Date(input.capturedAt);
  if (Number.isNaN(captured.getTime()) || !isValidTimeZone(input.timeZone ?? "UTC")) return undefined;

  const timeZone = input.timeZone ?? "UTC";
  const capturedDate = localCalendarDate(captured, timeZone);
  const date = extractDate(normalized, capturedDate);
  const time = extractTime(normalized);
  if (hasExplicitTime(normalized) && time === undefined) return undefined;
  if (date === undefined && time === undefined) return undefined;
  if (time !== undefined && time.hour === undefined) return undefined;

  const base = date ?? capturedDate;
  return localDateTimeToUtc(base, time, timeZone);
}

function parseModelSchedule(value: unknown, capturedAt: string, timeZone: string): ParsedSchedule | typeof INVALID_SCHEDULE | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !hasExpectedFields(value, ["date", "hour", "minute", "period", "dayPart", "special"])) {
    return INVALID_SCHEDULE;
  }
  if (value.date !== undefined && (typeof value.date !== "string" || !value.date.trim())) return INVALID_SCHEDULE;
  const hour = value.hour;
  const minute = value.minute;
  const period = value.period;
  const dayPart = value.dayPart;
  const special = value.special;
  if (hour !== undefined && (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23)) return INVALID_SCHEDULE;
  if (minute !== undefined && minute !== null && (typeof minute !== "number" || !Number.isInteger(minute) || minute < 0 || minute > 59)) return INVALID_SCHEDULE;
  if (period !== undefined && period !== "am" && period !== "pm") return INVALID_SCHEDULE;
  if (dayPart !== undefined && !isScheduleDayPart(dayPart)) return INVALID_SCHEDULE;
  if (special !== undefined && special !== "noon" && special !== "midnight") return INVALID_SCHEDULE;
  if (special !== undefined && (hour !== undefined || minute !== undefined || period !== undefined || dayPart !== undefined)) {
    return INVALID_SCHEDULE;
  }
  const date = modelScheduleDate(value.date, capturedAt, timeZone);
  if (date === INVALID_DATE || (value.date !== undefined && date === undefined)) return INVALID_SCHEDULE;
  if (dayPart !== undefined && hour === undefined) {
    return { ...(date === undefined ? {} : { date }), time: { dayPart } };
  }
  if (period !== undefined && hour === undefined) return INVALID_SCHEDULE;
  if (hour !== undefined && period !== undefined && (hour < 1 || hour > 12)) return INVALID_SCHEDULE;
  if (hour === undefined && minute !== undefined) return INVALID_SCHEDULE;
  const effectivePeriod = period ?? periodForDayPart(dayPart);
  const time: ClockTime | undefined = special === undefined && hour === undefined && dayPart === undefined
    ? undefined
    : special !== undefined
      ? { special, hour: special === "noon" ? 12 : 0, minute: 0 }
      : {
        ...(hour === undefined ? {} : { hour: effectivePeriod === undefined ? hour : (hour % 12) + (effectivePeriod === "pm" ? 12 : 0) }),
        ...(minute === undefined || minute === null ? {} : { minute }),
        ...(period === undefined ? {} : { period }),
        ...(dayPart === undefined ? {} : { dayPart }),
      };
  return { ...(date === undefined ? {} : { date }), ...(time === undefined ? {} : { time }) };
}

const INVALID_DATE = Symbol("invalid date");

function modelScheduleDate(value: unknown, capturedAt: string, timeZone: string): CalendarDate | typeof INVALID_DATE | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return INVALID_DATE;
  const captured = new Date(capturedAt);
  if (Number.isNaN(captured.getTime())) return INVALID_DATE;
  if (!isValidTimeZone(timeZone)) return INVALID_DATE;
  const capturedDate = localCalendarDate(captured, timeZone);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match === null) return INVALID_DATE;
    const parsed = { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
    return isValidCalendarDate(parsed) ? parsed : INVALID_DATE;
  }
  const parsed = extractDate(value.toLowerCase(), capturedDate);
  return parsed ?? INVALID_DATE;
}

function modelScheduleMatchesTranscription(
  model: ParsedSchedule,
  transcription: string,
  capturedAt: string,
  timeZone: string,
): boolean {
  const captured = new Date(capturedAt);
  if (Number.isNaN(captured.getTime())) return false;
  if (!isValidTimeZone(timeZone)) return false;
  const capturedDate = localCalendarDate(captured, timeZone);
  const spoken = parseSpokenSchedule(transcription, capturedDate);
  if (model.date !== undefined && !sameCalendarDate(model.date, spoken.date)) return false;
  if (model.time === undefined) return true;
  if (spoken.time === undefined) return false;
  if (model.time.special !== undefined) return model.time.special === spoken.time.special;
  if (model.time.hour !== undefined && model.time.hour !== spoken.time.hour) return false;
  if (model.time.minute !== undefined && model.time.minute !== spoken.time.minute) return false;
  if (model.time.period !== undefined && model.time.period !== spoken.time.period) return false;
  if (model.time.dayPart !== undefined && model.time.dayPart !== spoken.time.dayPart) return false;
  return true;
}

function parseSpokenSchedule(text: string, capturedDate: CalendarDate): ParsedSchedule {
  const normalized = text.toLowerCase();
  const date = extractDate(normalized, capturedDate);
  const time = extractTime(normalized);
  return { ...(date === undefined ? {} : { date }), ...(time === undefined ? {} : { time }) };
}

function extractDate(text: string, captured: CalendarDate): CalendarDate | undefined {
  if (/\b(?:today)\b|сегодня/.test(text)) {
    return captured;
  }
  if (/послезавтра|\bthe day after tomorrow\b/.test(text)) {
    return addCalendarDays(captured, 2);
  }
  if (/\b(?:tomorrow)\b|завтра/.test(text)) {
    return addCalendarDays(captured, 1);
  }
  const thisWeekday = text.match(/\bthis week\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)?.[1];
  if (thisWeekday) {
    const target = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].indexOf(thisWeekday);
    const monday = addCalendarDays(captured, 1 - (calendarDayOfWeek(captured) || 7));
    let result = addCalendarDays(monday, target);
    if (compareCalendarDates(result, captured) < 0) result = addCalendarDays(result, 7);
    return result;
  }
  const weekday = text.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)?.[1];
  if (weekday) {
    const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(weekday);
    return addCalendarDays(captured, (target - calendarDayOfWeek(captured) + 7) % 7 || 7);
  }
  const match = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/)
    ?? text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (!match) return undefined;
  const first = match[1] ?? "";
  const second = match[2] ?? "";
  const day = Number(/^\d/.test(first) ? first : second);
  const monthName = MONTHS.has(first) ? first : second;
  const month = MONTHS.get(monthName);
  if (month === undefined || !Number.isInteger(day) || day < 1 || day > 31) return undefined;
  let year = captured.year;
  let result = { year, month, day };
  if (!isValidCalendarDate(result)) return undefined;
  if (compareCalendarDates(result, captured) < 0) {
    year += 1;
    result = { year, month, day };
  }
  return isValidCalendarDate(result) ? result : undefined;
}

function extractTime(text: string): ClockTime | undefined {
  if (/\bnoon\b|полдень/.test(text)) return { hour: 12, minute: 0, special: "noon" };
  if (/\bmidnight\b|полночь/.test(text)) return { hour: 0, minute: 0, special: "midnight" };
  const english = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(?:o['’]?clock)?\s+(am|pm|morning|afternoon|evening|night|in\s+the\s+(?:morning|afternoon|evening|night))\b/)
    ?? text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(?:o['’]?clock)?(?=\s|[.!?,]|$)/);
  const russian = text.match(/в\s*(\d{1,2})(?::(\d{2}))?(?:\s*час(?:а|ов)?)?\s+(утра|утром|дня|днём|днем|вечера|вечером|ночи|ночью)/)
    ?? text.match(/в\s*(\d{1,2})(?::(\d{2}))?(?:\s*час(?:а|ов)?)?(?=\s|[.!?,]|$)/);
  const match = english ?? russian;
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? undefined : Number(match[2]);
  const periodValue = match[3] ?? match[4] ?? match[3];
  const dayPart = normalizeDayPart(periodValue);
  const period = periodValue === "am" || periodValue === "pm" ? periodValue : periodForDayPart(dayPart);
  if (hour < 1 || hour > 23 || (period !== undefined && hour > 12) || (minute !== undefined && minute > 59)) return undefined;
  return {
    hour: period === undefined ? hour : (hour % 12) + (period === "pm" ? 12 : 0),
    ...(minute === undefined ? {} : { minute }),
    ...(period === undefined ? {} : { period }),
    ...(dayPart === undefined ? {} : { dayPart }),
  };
}

function hasExplicitTime(text: string): boolean {
  return /\b(?:noon|midnight|at\s+\d{1,2}(?::\d{2})?|morning|afternoon|evening|night)\b/i.test(text)
    || /полдень|полночь|в\s*\d{1,2}(?::\d{2})?|утра|утром|дня|днём|днем|вечера|вечером|ночи|ночью/i.test(text);
}

function localCalendarDate(value: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  return { year: partNumber(parts, "year"), month: partNumber(parts, "month") - 1, day: partNumber(parts, "day") };
}

function localDateTimeToUtc(date: CalendarDate, time: ClockTime | undefined, timeZone: string): string | undefined {
  if (!isValidCalendarDate(date)) return undefined;
  const hour = time?.hour ?? 0;
  const minute = time?.minute ?? 0;
  const target = Date.UTC(date.year, date.month, date.day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = localCalendarDateTime(new Date(candidate), timeZone);
    const offset = Date.UTC(local.year, local.month, local.day, local.hour, local.minute) - candidate;
    candidate = target - offset;
  }
  const result = new Date(candidate);
  const local = localCalendarDateTime(result, timeZone);
  if (Date.UTC(local.year, local.month, local.day, local.hour, local.minute) !== target) return undefined;
  return result.toISOString();
}

function hasExplicitSchedule(text: string): boolean {
  return /\b(?:today|tomorrow|the day after tomorrow|this week\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{1,2}(?:st|nd|rd|th)?\s+of\s+|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2})\b/i.test(text)
    || /послезавтра|сегодня|завтра/.test(text)
    || /\b(?:noon|midnight|at\s+\d{1,2}(?::\d{2})?|morning|afternoon|evening|night)\b/i.test(text)
    || /полдень|полночь|в\s*\d{1,2}(?::\d{2})?|утра|утром|дня|днём|днем|вечера|вечером|ночи|ночью/i.test(text);
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
    .replace(/\s+(?:at\s+\d{1,2}(?::\d{2})?\s*(?:o['’]?clock\s*)?(?:am|pm)?(?:\s+in\s+the\s+(?:morning|afternoon|evening|night))?|в\s*\d{1,2}(?::\d{2})?(?:\s+(?:утра|утром|дня|днём|днем|вечера|вечером|ночи|ночью))?)[.!?]*$/i, "")
    .trim().replace(/[.!?]+$/, "");
}

function isScheduleDayPart(value: unknown): value is ScheduleDayPart {
  return value === "morning" || value === "afternoon" || value === "evening" || value === "night";
}

function normalizeDayPart(value: string | undefined): ScheduleDayPart | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith("in the ")) value = value.slice("in the ".length);
  if (value === "morning" || value === "утра" || value === "утром") return "morning";
  if (value === "afternoon" || value === "дня" || value === "днём" || value === "днем") return "afternoon";
  if (value === "evening" || value === "вечера" || value === "вечером") return "evening";
  if (value === "night" || value === "ночи" || value === "ночью") return "night";
  return undefined;
}

function periodForDayPart(dayPart: ScheduleDayPart | undefined): SchedulePeriod | undefined {
  return dayPart === "morning" ? "am" : dayPart === undefined ? undefined : "pm";
}

function localCalendarDateTime(value: Date, timeZone: string): CalendarDate & { readonly hour: number; readonly minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return {
    year: partNumber(parts, "year"),
    month: partNumber(parts, "month") - 1,
    day: partNumber(parts, "day"),
    hour: partNumber(parts, "hour"),
    minute: partNumber(parts, "minute"),
  };
}

function partNumber(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  return Number(value);
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isValidCalendarDate(value: CalendarDate): boolean {
  const date = new Date(Date.UTC(value.year, value.month, value.day));
  return date.getUTCFullYear() === value.year && date.getUTCMonth() === value.month && date.getUTCDate() === value.day;
}

function addCalendarDays(value: CalendarDate, days: number): CalendarDate {
  const date = new Date(Date.UTC(value.year, value.month, value.day));
  date.setUTCDate(date.getUTCDate() + days);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
}

function calendarDayOfWeek(value: CalendarDate): number {
  return new Date(Date.UTC(value.year, value.month, value.day)).getUTCDay();
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  return Date.UTC(left.year, left.month, left.day) - Date.UTC(right.year, right.month, right.day);
}

function sameCalendarDate(left: CalendarDate, right: CalendarDate | undefined): boolean {
  return right !== undefined && left.year === right.year && left.month === right.month && left.day === right.day;
}
