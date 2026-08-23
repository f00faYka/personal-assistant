import type {
  TranscriptionProvider,
  TranscriptionResult,
} from "../../features/transcriptions/transcription.js";

export interface LocalWhisperProviderOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMilliseconds: number;
  readonly fetch?: typeof globalThis.fetch;
}

export class LocalWhisperProvider implements TranscriptionProvider {
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: LocalWhisperProviderOptions) {
    this.request = options.fetch ?? globalThis.fetch;
  }

  async transcribe(input: {
    readonly audio: Uint8Array;
    readonly contentType: string;
  }): Promise<TranscriptionResult> {
    const form = new FormData();
    form.set(
      "file",
      new File([Uint8Array.from(input.audio)], audioFilename(input.contentType), {
        type: input.contentType,
      }),
    );
    form.set("response_format", "json");

    try {
      const response = await this.request(this.options.endpoint, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(this.options.timeoutMilliseconds),
      });
      if (!response.ok) {
        throw new LocalWhisperProviderError(`Local Whisper request failed (HTTP ${response.status})`);
      }

      const body: unknown = await response.json();
      if (!isTranscriptionResponse(body)) {
        throw new LocalWhisperProviderError("Local Whisper returned an invalid response");
      }
      return {
        text: body.text.trim(),
        ...(body.language === undefined ? {} : { language: body.language }),
        provider: "whisper.cpp",
        model: this.options.model,
      };
    } catch (error) {
      if (error instanceof LocalWhisperProviderError) throw error;
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new LocalWhisperProviderError(
          `Local Whisper request timed out after ${this.options.timeoutMilliseconds}ms`,
        );
      }
      throw new LocalWhisperProviderError("Local Whisper request failed");
    }
  }
}

export class LocalWhisperProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalWhisperProviderError";
  }
}

function isTranscriptionResponse(value: unknown): value is { readonly text: string; readonly language?: string } {
  return typeof value === "object"
    && value !== null
    && "text" in value
    && typeof value.text === "string"
    && value.text.trim().length > 0
    && (!("language" in value) || typeof value.language === "string");
}

function audioFilename(contentType: string): string {
  const subtype = contentType.split("/")[1]?.split(";")[0]?.replace(/[^A-Za-z0-9]/g, "");
  return `capture.${subtype || "audio"}`;
}
