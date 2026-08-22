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
  properties: {
    action: {
      type: "string",
      enum: ["create_task", "complete_task", "none", "unsupported"],
    },
    title: { type: "string" },
    dueAt: { type: "string" },
    reason: { type: "string", enum: ["ordinary", "ambiguous", "unsupported"] },
  },
  required: ["action"],
  additionalProperties: false,
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
  return `Classify this transcription using ${catalogVersion}. Return only the requested JSON. Use create_task only for a clear explicit request to create a Task, complete_task only for a clear explicit request to complete a named Task, none/ordinary for ordinary content, none/ambiguous for unclear instructions, and unsupported for any other requested action. Preserve the Member's words without inventing broader intent.`;
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
