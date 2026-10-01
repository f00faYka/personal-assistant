import type {
  InterpretationProvider,
  InterpretationProviderInput,
  InterpretationProviderResult,
} from "../../features/interpretations/interpretation.js";

export interface LocalOllamaInterpretationProviderOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMilliseconds: number;
  readonly fetch?: typeof globalThis.fetch;
}

const interpretationSchema = {
  type: "object",
  oneOf: [
    {
      properties: {
        action: { const: "create_task" },
        title: { type: "string", minLength: 1 },
        schedule: {
          type: "object",
          properties: {
            date: { type: "string", minLength: 1 },
            hour: { type: "integer", minimum: 0, maximum: 23 },
            minute: { oneOf: [{ type: "integer", minimum: 0, maximum: 59 }, { type: "null" }] },
            period: { type: "string", enum: ["am", "pm"] },
            dayPart: { type: "string", enum: ["morning", "afternoon", "evening", "night"] },
            special: { type: "string", enum: ["noon", "midnight"] },
          },
          additionalProperties: false,
        },
      },
      required: ["action", "title"],
      additionalProperties: false,
    },
    { properties: { action: { const: "complete_task" }, title: { type: "string", minLength: 1 } }, required: ["action", "title"], additionalProperties: false },
    { properties: { action: { const: "none" }, reason: { type: "string", enum: ["ordinary", "ambiguous"] } }, required: ["action", "reason"], additionalProperties: false },
    { properties: { action: { const: "unsupported" }, reason: { type: "string", enum: ["unsupported"] } }, required: ["action", "reason"], additionalProperties: false },
  ],
} as const;

export class LocalOllamaInterpretationProvider implements InterpretationProvider {
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: LocalOllamaInterpretationProviderOptions) {
    this.request = options.fetch ?? globalThis.fetch;
  }

  async interpret(input: InterpretationProviderInput): Promise<InterpretationProviderResult> {
    try {
      const response = await this.request(this.options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          stream: false,
          think: false,
          format: interpretationSchema,
          options: { temperature: 0 },
          messages: [
            {
              role: "system",
              content: systemPrompt(input.catalogVersion),
            },
            { role: "user", content: input.transcriptionText },
          ],
        }),
        signal: AbortSignal.timeout(this.options.timeoutMilliseconds),
      });
      if (!response.ok) {
        throw new LocalOllamaInterpretationProviderError(
          `Local Ollama request failed (HTTP ${response.status})`,
        );
      }

      const body: unknown = await response.json();
      if (!isOllamaResponse(body)) {
        throw new LocalOllamaInterpretationProviderError("Local Ollama returned an invalid response");
      }
      return {
        model: this.options.model,
        rawOutput: parseStructuredOutput(body.message.content),
      };
    } catch (error) {
      if (error instanceof LocalOllamaInterpretationProviderError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new LocalOllamaInterpretationProviderError(
          `Local Ollama request timed out after ${this.options.timeoutMilliseconds}ms`,
        );
      }
      throw new LocalOllamaInterpretationProviderError("Local Ollama request failed");
    }
  }
}

export class LocalOllamaInterpretationProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalOllamaInterpretationProviderError";
  }
}

function systemPrompt(catalogVersion: string): string {
  return `Classify this transcription using ${catalogVersion}. Return only JSON matching the schema. For create_task, title must be only the concise requested work, without command words or scheduling phrases. Extract only explicitly spoken schedule components into schedule: date is the spoken relative, weekday, or calendar date phrase, hour is the spoken clock hour as a number (normalize explicitly spoken English or Russian number words such as five, twenty three, пять, or двадцать три to numeric hours), minute is the spoken minute from 0 through 59 as a number or null when no minute was spoken (normalize word minutes such as thirty five or тридцать пять), period is am/pm only when spoken or normalized from an explicit day part, and dayPart may be morning, afternoon, evening, or night. Use special noon or midnight only when spoken. Never invent or guess a date, hour, minute, AM/PM, day part, timezone, or absolute UTC timestamp; omit schedule when no schedule is spoken. The application resolves local schedule components with its supplied IANA timezone. Use create_task only for a clear explicit request, complete_task only for a clear request to complete a named Task, none/ordinary for ordinary content, none/ambiguous for unclear instructions, and unsupported for any other action.`;
}

function isOllamaResponse(value: unknown): value is { readonly message: { readonly content: string } } {
  return typeof value === "object"
    && value !== null
    && "message" in value
    && typeof value.message === "object"
    && value.message !== null
    && "content" in value.message
    && typeof value.message.content === "string";
}

function parseStructuredOutput(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new LocalOllamaInterpretationProviderError(
      "Local Ollama returned invalid structured output",
    );
  }
}
